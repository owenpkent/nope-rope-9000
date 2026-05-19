// ==UserScript==
// @name         nope-rope-9000
// @namespace    https://github.com/owenpkent/nope-rope-9000
// @version      0.4.1
// @description  Slither.io bot, from-scratch build. See README.
// @author       Owen
// @match        *://*.slither.io/*
// @match        *://*.slither.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[nope-rope-9000]';
  const log = (...args) => console.log(TAG, ...args);

  log('loaded, version 0.4.1');

  // ---- Tunables ----------------------------------------------------------
  // Steering loop rate, sampling, and safety thresholds. Changing these is
  // the cheapest way to experiment with bot behavior. Keep them grouped here
  // so anyone reading the file can find them in one place.
  const CFG = {
    tickHz: 200,                 // setInterval rate; faster than display
    nickDefault: 'nope-rope',
    foodSearchRadius: 1500,      // ignore foods further than this from head
    candidateAngles: 48,         // direction samples per tick
    candidateSpread: 3 * Math.PI / 2, // 270° spread; lets us turn back if needed
    projectFactor: 10,           // sweep the ray this many snake-radii forward
    dangerRadius: 1.8,           // ray-to-obstacle clearance ratio that counts as "too close"
    fallbackRadius: 25,          // assumed head radius if slither.sc is missing
    wallBuffer: 250,             // start pulling inward this many world-units from wall
    foodAlignWeight: 0.6,        // 0..1, how much we prefer matching food direction
    autoNickPollMs: 500,         // how often to retry filling nick input
    // Threat tracking. Two parallel mechanisms:
    //  - Velocity ghosts: drop predicted-position points along each enemy's
    //    measured velocity at the given lookaheadSeconds (catches boost
    //    cutters, snakes accelerating across our path).
    //  - Heading ghosts: forward-project each enemy head along its current
    //    `ang` (facing direction) by headExtensionFactor enemy-radii. This
    //    catches head-on collisions even when an enemy is barely moving so
    //    velocity tracking wouldn't fire a ghost.
    headLookaheadSeconds: [0.10, 0.20, 0.35, 0.55, 0.80],
    minThreatSpeed: 30,          // ignore truly stationary heads only
    headExtensionFactor: 4,      // forward-project enemy heads by N enemy-radii
    headHistoryStaleMs: 500,
  };

  // ---- IPv6 fast-fail + observability ------------------------------------
  // See RESEARCH.md "Findings from the live build" for why this exists.
  // Short version: loadSos walks IPv6 first; each timeout costs ~75s on
  // networks without IPv6 routing. Returning a fake socket that fires
  // error+close synchronously lets the game's own IPv4 fallback fire.
  function FakeWS(url) {
    this.url = url;
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.protocol = '';
    this.extensions = '';
    this.binaryType = 'blob';
    this.onopen = null; this.onerror = null; this.onmessage = null; this.onclose = null;
    this._listeners = { open: [], error: [], message: [], close: [] };
    const self = this;
    setTimeout(() => {
      self.readyState = 3;
      const errEv = { type: 'error', target: self };
      const closeEv = { type: 'close', code: 1006, reason: '', wasClean: false, target: self };
      if (self.onerror) { try { self.onerror(errEv); } catch (e) {} }
      self._listeners.error.forEach(fn => { try { fn(errEv); } catch (e) {} });
      if (self.onclose) { try { self.onclose(closeEv); } catch (e) {} }
      self._listeners.close.forEach(fn => { try { fn(closeEv); } catch (e) {} });
    }, 0);
  }
  FakeWS.prototype.send = function () {};
  FakeWS.prototype.close = function () { this.readyState = 3; };
  FakeWS.prototype.addEventListener = function (type, fn) {
    if (this._listeners[type]) this._listeners[type].push(fn);
  };
  FakeWS.prototype.removeEventListener = function () {};
  FakeWS.prototype.dispatchEvent = function () { return true; };
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;

  const seenSocketUrls = [];
  const blockedSocketUrls = [];
  const OrigWS = window.WebSocket;
  function WrappedWS(url, protocols) {
    seenSocketUrls.push(url);
    if (/^wss?:\/\/\[/i.test(url)) {
      blockedSocketUrls.push(url);
      return new FakeWS(url);
    }
    return new OrigWS(url, protocols);
  }
  WrappedWS.prototype = OrigWS.prototype;
  WrappedWS.CONNECTING = OrigWS.CONNECTING;
  WrappedWS.OPEN = OrigWS.OPEN;
  WrappedWS.CLOSING = OrigWS.CLOSING;
  WrappedWS.CLOSED = OrigWS.CLOSED;
  window.WebSocket = WrappedWS;

  const seenFetchUrls = [];
  const OrigFetch = window.fetch;
  if (OrigFetch) {
    window.fetch = function (input) {
      const u = typeof input === 'string' ? input : (input && input.url) || '';
      seenFetchUrls.push(u);
      return OrigFetch.apply(this, arguments);
    };
  }
  const OrigXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    seenFetchUrls.push(url);
    return OrigXHROpen.apply(this, arguments);
  };

  // ---- Auto nickname -----------------------------------------------------
  // Fills window.nick.value (the slither.io player-name input) so you don't
  // have to type it each round. Persisted in localStorage; change via
  // nr9k.setNick(name). Polls because the input doesn't exist until the
  // landing UI renders.
  function loadNick() {
    try { return localStorage.getItem('nr9k_nick') || CFG.nickDefault; }
    catch (e) { return CFG.nickDefault; }
  }
  function saveNick(name) {
    try { localStorage.setItem('nr9k_nick', name); } catch (e) {}
  }
  function tryAutoNick() {
    const input = window.nick;
    if (!input || typeof input.value !== 'string') return;
    if (input.value.length > 0) return;
    input.value = loadNick();
  }
  setInterval(tryAutoNick, CFG.autoNickPollMs);

  // ---- Game accessors ----------------------------------------------------
  // Modern slither.com/io renamed the snake globals: window.snake -> slither
  // and window.snakes -> slithers. window.foods and window.grd appear
  // unchanged. The accessors check both names so we degrade gracefully if
  // the rename reverts or if a sandbox uses the legacy globals.
  const getSnake = () => window.slither || window.snake;
  const getFoods = () => window.foods || [];
  const getSnakes = () => window.slithers || window.snakes || [];
  const getMapGrd = () => window.grd; // half-side of the square containing the map circle

  function snakeRadius(s) {
    if (s && typeof s.sc === 'number' && s.sc > 0) return 5.8 * s.sc;
    return CFG.fallbackRadius;
  }
  // Same formula but for an arbitrary snake object (used to size the
  // forward head-extension of enemies).
  function snakeRadiusOf(other) {
    if (other && typeof other.sc === 'number' && other.sc > 0) return 5.8 * other.sc;
    return CFG.fallbackRadius;
  }

  // ---- Geometry ----------------------------------------------------------
  const TAU = Math.PI * 2;
  function dist(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function angleBetween(a, b) {
    let d = ((b - a) % TAU + TAU) % TAU;
    if (d > Math.PI) d -= TAU;
    return d;
  }
  function blendAngles(a, b, t) {
    return a + angleBetween(a, b) * t;
  }

  // ---- Food selection ----------------------------------------------------
  // Weighted by size/dist so a slightly farther big food beats a tiny one.
  // foods past CFG.foodSearchRadius are ignored to keep the loop O(visible).
  function pickFood(s) {
    const foods = getFoods();
    let best = null, bestScore = -Infinity;
    const r2 = CFG.foodSearchRadius * CFG.foodSearchRadius;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (!f || f.eaten || typeof f.xx !== 'number') continue;
      const dx = f.xx - s.xx, dy = f.yy - s.yy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const size = typeof f.sz === 'number' ? f.sz : 1;
      const score = size / Math.max(1, Math.sqrt(d2));
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  // ---- Threat tracking --------------------------------------------------
  // Keep one frame of history per enemy snake (keyed by object identity, so
  // a missing `.id` doesn't break this). On each tick, compute the head's
  // velocity from the delta, then generate "ghost obstacles" at the
  // predicted positions along that velocity for a few lookahead times. The
  // ghosts feed into the same ray-clearance check as real body segments, so
  // a snake boosting across our path will register as a wall *before* it
  // arrives. headHistoryStaleMs drops stale entries so the Map can't grow
  // unbounded if snakes disappear from view.
  const headHistory = new Map();

  function updateHeadHistory(now) {
    const snakes = getSnakes();
    const seen = new Set();
    const velocities = [];
    for (let i = 0; i < snakes.length; i++) {
      const other = snakes[i];
      if (!other || typeof other.xx !== 'number') continue;
      seen.add(other);
      const last = headHistory.get(other);
      headHistory.set(other, { xx: other.xx, yy: other.yy, t: now });
      if (!last) continue;
      const dt = (now - last.t) / 1000;
      if (dt <= 0 || dt > 0.5) continue;
      const vx = (other.xx - last.xx) / dt;
      const vy = (other.yy - last.yy) / dt;
      velocities.push({ snake: other, vx, vy, speed: Math.sqrt(vx * vx + vy * vy) });
    }
    for (const key of headHistory.keys()) {
      if (!seen.has(key)) headHistory.delete(key);
    }
    return velocities;
  }

  function predictGhosts(s, velocities) {
    const ghosts = [];
    for (let i = 0; i < velocities.length; i++) {
      const v = velocities[i];
      if (v.snake === s) continue;
      if (v.speed < CFG.minThreatSpeed) continue;
      const lookaheads = CFG.headLookaheadSeconds;
      for (let k = 0; k < lookaheads.length; k++) {
        const t = lookaheads[k];
        ghosts.push({
          xx: v.snake.xx + v.vx * t,
          yy: v.snake.yy + v.vy * t,
        });
      }
    }
    return ghosts;
  }

  // ---- Obstacle collection ----------------------------------------------
  // For each enemy snake within range we collect:
  //   1. The head itself (`other.xx`/`other.yy`). The snake object holds
  //      the head position separately from `pts`; without this the bot was
  //      blind to enemy heads and would walk into a stationary opponent.
  //   2. Every body segment from `other.pts` inside the budget radius.
  // Self-exclusion uses object identity rather than `.id` so a missing id
  // field doesn't accidentally skip every snake (including the real
  // enemies).
  function collectObstacles(s, budgetRadius) {
    const out = [];
    const snakes = getSnakes();
    const b2 = budgetRadius * budgetRadius;
    for (let i = 0; i < snakes.length; i++) {
      const other = snakes[i];
      if (!other || other === s) continue;
      if (typeof other.xx === 'number' && typeof other.yy === 'number') {
        const dx = other.xx - s.xx, dy = other.yy - s.yy;
        if (dx * dx + dy * dy <= b2) {
          out.push({ xx: other.xx, yy: other.yy });
          // Forward-project the head along its current facing angle. This
          // creates a "head bubble" that the bot avoids even when the
          // enemy's measured velocity is too small to spawn a ghost. Head-
          // on collisions are the most common failure mode without this.
          if (typeof other.ang === 'number') {
            const er = snakeRadiusOf(other);
            const f = er * CFG.headExtensionFactor;
            out.push({ xx: other.xx + Math.cos(other.ang) * f, yy: other.yy + Math.sin(other.ang) * f });
          }
        }
      }
      const pts = other.pts;
      if (!pts) continue;
      for (let j = 0; j < pts.length; j++) {
        const p = pts[j];
        if (!p || p.dying || typeof p.xx !== 'number') continue;
        const dx = p.xx - s.xx, dy = p.yy - s.yy;
        if (dx * dx + dy * dy > b2) continue;
        out.push(p);
      }
    }
    return out;
  }

  // ---- Direction scoring ------------------------------------------------
  // Swept-ray check. Cast a ray from the head along the candidate heading
  // for projectDist units; for each obstacle, compute its along-ray
  // coordinate and reject anything outside [0, projectDist]. For the rest,
  // compute the perpendicular distance from the obstacle to the ray. The
  // minimum perpendicular distance is the clearance. This catches body
  // segments that cross the path between head and endpoint, which the
  // previous endpoint-only check missed. Anything closer to the ray than
  // dangerThreshold is rejected; among survivors, the angle nearest the
  // food direction wins.
  // Score = combined clearance + food bonus. Above the danger threshold,
  // we add a food-alignment bonus so we prefer the heading nearest to the
  // food. Below the threshold, we drop the bonus entirely and return raw
  // clearance, so when the whole arc is dangerous the bot picks the LEAST
  // bad option (highest clearance) instead of suiciding toward the food.
  // This is the v0.4.1 fix: previously sub-threshold angles returned
  // -Infinity and the picker fell back to the food angle, walking the
  // snake straight into whichever obstacle was on the food path.
  function scoreAngle(s, theta, foodAngle, projectDist, obstacles, dangerThreshold) {
    const dx = Math.cos(theta), dy = Math.sin(theta);
    let minClear = Infinity;
    for (let i = 0; i < obstacles.length; i++) {
      const p = obstacles[i];
      const ox = p.xx - s.xx, oy = p.yy - s.yy;
      const along = ox * dx + oy * dy;
      if (along < 0 || along > projectDist) continue;
      const perpX = ox - along * dx;
      const perpY = oy - along * dy;
      const perp = Math.sqrt(perpX * perpX + perpY * perpY);
      if (perp < minClear) minClear = perp;
    }
    if (minClear === Infinity) minClear = projectDist; // wide open
    if (minClear < dangerThreshold) return minClear;
    const alignment = 1 - Math.abs(angleBetween(theta, foodAngle)) / Math.PI;
    return minClear + CFG.foodAlignWeight * alignment * dangerThreshold;
  }

  function pickHeading(s, foodAngle, ghosts) {
    const r = snakeRadius(s);
    const projectDist = r * CFG.projectFactor;
    const dangerThreshold = r * CFG.dangerRadius;
    const obstacles = collectObstacles(s, projectDist + r * 4);
    for (let i = 0; i < ghosts.length; i++) obstacles.push(ghosts[i]);
    let bestTheta = foodAngle, bestScore = -Infinity;
    for (let i = 0; i < CFG.candidateAngles; i++) {
      const t = (i / (CFG.candidateAngles - 1)) - 0.5;
      const theta = foodAngle + t * CFG.candidateSpread;
      const score = scoreAngle(s, theta, foodAngle, projectDist, obstacles, dangerThreshold);
      if (score > bestScore) { bestScore = score; bestTheta = theta; }
    }
    return bestTheta;
  }

  // ---- Wall avoidance ---------------------------------------------------
  // Map is a circle of radius ~grd*0.98 centered at (grd, grd). When the
  // head gets close to the edge, blend a pull toward the center into the
  // chosen heading. Pull strength ramps as the buffer shrinks to zero.
  function applyWallSteering(s, heading) {
    const g = getMapGrd();
    if (typeof g !== 'number') return heading;
    const cx = g, cy = g;
    const mapR = g * 0.98;
    const d = dist(s.xx, s.yy, cx, cy);
    const slack = mapR - d;
    if (slack > CFG.wallBuffer) return heading;
    const toCenter = Math.atan2(cy - s.yy, cx - s.xx);
    const t = 1 - Math.max(0, slack) / CFG.wallBuffer;
    return blendAngles(heading, toCenter, t);
  }

  function steerTo(angle) {
    const scale = 200;
    window.xm = Math.round(Math.cos(angle) * scale);
    window.ym = Math.round(Math.sin(angle) * scale);
  }

  // ---- Steering loop -----------------------------------------------------
  // The head-history update runs every tick whether or not the bot is
  // driving, so when the user toggles the bot on it already has a fresh
  // velocity estimate for every visible snake. Without that, the first
  // tick after enable has zero ghosts and is exactly where a boost-cutter
  // would catch you.
  let botEnabled = false;
  let lastTickLog = 0;
  let lastGhostCount = 0;

  function tick() {
    const now = performance.now();
    const velocities = updateHeadHistory(now);
    if (!botEnabled) return;
    const s = getSnake();
    if (!s || typeof s.xx !== 'number') return;
    const ghosts = predictGhosts(s, velocities);
    lastGhostCount = ghosts.length;
    const food = pickFood(s);
    const foodAngle = food
      ? Math.atan2(food.yy - s.yy, food.xx - s.xx)
      : Math.atan2((getMapGrd() || 0) - s.yy, (getMapGrd() || 0) - s.xx);
    let heading = pickHeading(s, foodAngle, ghosts);
    heading = applyWallSteering(s, heading);
    steerTo(heading);

    const wallNow = Date.now();
    if (wallNow - lastTickLog > 2000) {
      lastTickLog = wallNow;
      log(`tick: pos=(${Math.round(s.xx)},${Math.round(s.yy)}) heading=${heading.toFixed(2)} food=${food ? `(${Math.round(food.xx)},${Math.round(food.yy)} sz=${food.sz})` : 'none'} foods=${getFoods().length} ghosts=${ghosts.length}`);
    }
  }
  setInterval(tick, Math.max(1, Math.round(1000 / CFG.tickHz)));

  // ---- Toggles -----------------------------------------------------------
  function toggleBot(val) {
    botEnabled = typeof val === 'boolean' ? val : !botEnabled;
    log('bot', botEnabled ? 'enabled' : 'disabled');
  }
  window.addEventListener('mousedown', function (e) {
    if (e.button !== 2 || !window.playing) return;
    e.stopImmediatePropagation();
    toggleBot();
  }, true);
  window.addEventListener('contextmenu', function (e) {
    if (window.playing) e.preventDefault();
  }, true);
  window.addEventListener('keydown', function (e) {
    if (e.code === 'KeyT' && window.playing) toggleBot();
  }, true);

  // ---- Console helpers ---------------------------------------------------
  window.nr9k = {
    snake: getSnake,
    foods: getFoods,
    snakes: getSnakes,
    enabled: () => botEnabled,
    toggle: (v) => toggleBot(v),
    cfg: CFG,
    nick: () => loadNick(),
    setNick: (name) => {
      if (typeof name !== 'string' || !name) { log('setNick: pass a non-empty string'); return; }
      saveNick(name);
      if (window.nick) window.nick.value = name;
      log('nick saved:', name);
    },
    state: () => {
      const s = getSnake();
      return {
        playing: window.playing,
        botEnabled,
        hasSnake: !!s,
        snakeXY: s ? [Math.round(s.xx), Math.round(s.yy)] : null,
        snakeSc: s ? s.sc : null,
        snakeAng: s ? s.ang : null,
        foodCount: getFoods().length,
        snakeCount: getSnakes().length,
        trackedHeads: headHistory.size,
        ghostsLastTick: lastGhostCount,
        mapGrd: getMapGrd(),
        xm: window.xm,
        ym: window.ym,
        nick: loadNick(),
      };
    },
    sockets: () => seenSocketUrls.slice(),
    blocked: () => blockedSocketUrls.slice(),
    fetches: () => seenFetchUrls.slice(),
    // findFoods/findSnakes both print one log line per candidate so the
    // output is readable in the console without expanding any collapsed
    // objects. Use these when the bot's tick log shows foods=0 or
    // ghosts=0 in a populated game (the live build probably renamed the
    // array). Each line: key, length, list of keys on a sample entry.
    findFoods: () => {
      const hits = Object.entries(window).filter(([k, v]) => {
        if (!Array.isArray(v) || v.length === 0) return false;
        return v.some(x => x && typeof x.xx === 'number' && typeof x.yy === 'number');
      });
      if (hits.length === 0) { log('findFoods: no candidates'); return []; }
      for (const [k, v] of hits) {
        const sample = v.find(x => x && typeof x.xx === 'number');
        const sk = sample ? Object.keys(sample).join(',') : '';
        log(`findFoods: window.${k} len=${v.length} sampleKeys=[${sk}]`);
      }
      return hits.map(([k, v]) => ({ key: k, len: v.length }));
    },
    findSnakes: () => {
      const hits = Object.entries(window).filter(([k, v]) => {
        if (!Array.isArray(v) || v.length === 0) return false;
        return v.some(x => x && typeof x.xx === 'number' && Array.isArray(x.pts));
      });
      if (hits.length === 0) { log('findSnakes: no candidates'); return []; }
      for (const [k, v] of hits) {
        const sample = v.find(x => x && Array.isArray(x.pts));
        const sk = sample ? Object.keys(sample).join(',') : '';
        log(`findSnakes: window.${k} len=${v.length} sampleKeys=[${sk}]`);
      }
      return hits.map(([k, v]) => ({ key: k, len: v.length }));
    },
    angleTo: (x, y) => {
      const s = getSnake();
      return s ? Math.atan2(y - s.yy, x - s.xx) : null;
    }
  };
  log('nr9k helper attached. Right-click or T to toggle. Set name with nr9k.setNick("YourName").');
})();
