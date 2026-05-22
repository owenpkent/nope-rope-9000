// ==UserScript==
// @name         nope-rope-9000
// @namespace    https://github.com/owenpkent/nope-rope-9000
// @version      0.6.2
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

  log('loaded, version 0.6.2');

  // ---- Tunables ----------------------------------------------------------
  const CFG = {
    // 200 Hz was theater: slither's physics updates at ~30 Hz and the
    // resulting micro-oscillation in xm/ym was burning turn-rate budget.
    // 60 Hz matches typical browser frame pacing and leaves headroom
    // for the substep TTC simulation below.
    tickHz: 60,
    nickDefault: 'nope-rope',
    foodSearchRadius: 1500,
    // Angle quantization shared by steering and food. 16 buckets = ~22.5 deg
    // each. Matches j-c-m Championship Edition; coarse but enough to find
    // wide-open arcs without paying for a 48-ray sweep.
    bucketCount: 16,
    projectFactor: 12,           // obstacle search budget as snake-radii
    minScanRadius: 600,          // floor on obstacle search; the radii-based budget is tiny at spawn (sc=1 -> ~70u)
    dangerRadius: 1.8,           // body danger threshold as snake-radii
    minDangerRadius: 30,         // floor on danger threshold; ditto
    headDangerMult: 3.0,         // enemy heads count this much more dangerous
    warningMult: 2.5,            // overlay yellow tier kicks in at danger * this
    fallbackRadius: 25,
    wallBuffer: 250,
    headLookaheadSeconds: [0.10, 0.20, 0.35, 0.55, 0.80],
    minThreatSpeed: 30,
    headExtensionFactor: 4,
    // Multi-hypothesis ghost prediction for the TTC picker. Adds curving
    // ghosts of fast-moving enemies as static obstacles; the linear (zero-
    // turn) hypothesis is already covered by the head's moving-obstacle
    // entry in the TTC pre-filter. Skipping 0 in turn rates avoids a
    // division-by-zero in the arc formula.
    curveTurnRates: [-3.0, -1.5, 1.5, 3.0],
    curveLookaheadSeconds: [0.4, 0.8, 1.2],
    autoNickPollMs: 500,
    // Run-scoring weights when picking which open arc to aim at.
    // Width dominates: a 5-bucket open arc 4 buckets off from food beats a
    // 1-bucket open arc directly at food. Without that, the bot dives into
    // narrow cracks that close on it.
    runWidthWeight: 4,
    // TTC picker scoring. Two-stage lexicographic: maximum safety
    // score first (see DWA-style weights below), then food alignment
    // (and inertia) as tiebreakers among candidates within
    // foodSafetyBandS of the max. Slither has no starve mechanic, so
    // food is pure upside; survival must never be traded for it.
    foodSafetyBandS: 0.1,
    // Inertia tiebreak weight, applied alongside food alignment within
    // the safety band. Low because it is meant to break ties, not steer.
    inertiaWeight: 0.1,
    // DWA-style safety score weights. Score is:
    //   safety = wMin * minTTC + wMean * meanTTC - wCritical * critCount
    // wMean and wCritical default to 0, so out-of-the-box behavior is
    // identical to v0.6.1 (pure min-TTC). Flip wMean and wCritical to
    // non-zero to bring in the shape of the danger field: a heading
    // with one obstacle near TTC=1.1 should beat one with thirty.
    // Suggested first-pass: wMean = 0.3, wCritical = 0.2, danger 0.3 s.
    safetyWeightMin: 1.0,
    safetyWeightMean: 0.0,
    safetyWeightCritical: 0.0,
    safetyDangerThreshold: 0.3,
    // Assumed bot turn rate for the own-arc kinematic model in the TTC
    // picker. Roughly matches observed slither head behavior; the
    // picker is not very sensitive to this within +/- 50%.
    botTurnRate: 3.0,
    // Boost gating
    boostFoodSize: 25,           // sz threshold to consider boosting
    boostClearanceMargin: 1.6,   // clearance toward food must exceed foodDist * this
    boostMaxAngleDelta: Math.PI / 2,
    // History
    historyCap: 200,
    historyKey: 'nr9k_history',
    // Debug overlay
    overlayKey: 'nr9k_overlay',
    // Visual scale for the overlay. 1.0 = wedges/rays drawn at their
    // true world-scaled radii. 0.5 shrinks the entire radar uniformly
    // around the snake head; useful when the full-size overlay covers
    // too much of the play area. Diagnostic only; does not affect
    // steering decisions.
    overlayScale: 0.5,
  };

  // ---- IPv6 fast-fail + observability ------------------------------------
  // See RESEARCH.md "Findings from the live build" for why this exists.
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
  const getSnake = () => window.slither || window.snake;
  const getFoods = () => window.foods || [];
  const getSnakes = () => window.slithers || window.snakes || [];
  const getMapGrd = () => window.grd;

  function snakeRadius(s) {
    if (s && typeof s.sc === 'number' && s.sc > 0) return 5.8 * s.sc;
    return CFG.fallbackRadius;
  }
  function snakeRadiusOf(other) {
    if (other && typeof other.sc === 'number' && other.sc > 0) return 5.8 * other.sc;
    return CFG.fallbackRadius;
  }

  // slither.io's displayed length is derived from sct + fam through two
  // per-score lookup tables (fpsls, fmlts) the game exposes globally. The
  // bot previously used s.pts.length, which is just the segment array
  // count: it lags behind real length and undercounts by 2x+ at scale.
  // We saw a death screen show length 55 while the bot recorded 25.
  function slitherLength(s) {
    if (!s || typeof s.sct !== 'number') return 0;
    const fpsls = window.fpsls, fmlts = window.fmlts;
    if (!Array.isArray(fpsls) || !Array.isArray(fmlts)) {
      return (s.pts && s.pts.length) || 0;
    }
    const sct = Math.min(s.sct, fpsls.length - 1, fmlts.length - 1);
    const fam = typeof s.fam === 'number' ? s.fam : 0;
    return Math.floor(15 * (fpsls[sct] + fam / fmlts[sct] - 1) - 5);
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
  function bucketOf(angle, n) {
    const a = ((angle % TAU) + TAU) % TAU;
    return Math.floor(a / (TAU / n)) % n;
  }
  function bucketAngle(i, n) {
    return (i + 0.5) * (TAU / n);
  }
  function bucketDelta(a, b, n) {
    const d = Math.abs(a - b);
    return Math.min(d, n - d);
  }

  // ---- Threat tracking ---------------------------------------------------
  // headHistory keyed by object identity so a missing `.id` doesn't break us.
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

  // ---- Bucket builders ---------------------------------------------------
  // Single pass over obstacles into a 16-bucket angle quantization. We keep
  // two parallel distance arrays: `collision` (everything, including body
  // segments) and `headClearance` (enemy heads and forward-projected head
  // ghosts only). A bucket is "safe" only when both clear their respective
  // danger thresholds, so the head check is strictly stricter than body. This
  // is what fixes the "sidestepped the body, walked into the head" deaths.
  function buildCollisionBuckets(s, ghosts) {
    const n = CFG.bucketCount;
    const r = snakeRadius(s);
    const projectDist = Math.max(r * CFG.projectFactor, CFG.minScanRadius);
    const dangerThreshold = Math.max(r * CFG.dangerRadius, CFG.minDangerRadius);
    const headDanger = dangerThreshold * CFG.headDangerMult;
    const collision = new Array(n).fill(Infinity);
    const headClearance = new Array(n).fill(Infinity);
    const budget = projectDist;
    const b2 = budget * budget;
    const snakes = getSnakes();
    for (let i = 0; i < snakes.length; i++) {
      const other = snakes[i];
      if (!other || other === s) continue;
      if (typeof other.xx === 'number' && typeof other.yy === 'number') {
        const dx = other.xx - s.xx, dy = other.yy - s.yy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= b2) {
          const d = Math.sqrt(d2);
          const b = bucketOf(Math.atan2(dy, dx), n);
          if (d < collision[b]) collision[b] = d;
          if (d < headClearance[b]) headClearance[b] = d;
          if (typeof other.ang === 'number') {
            const er = snakeRadiusOf(other);
            const f = er * CFG.headExtensionFactor;
            const px = other.xx + Math.cos(other.ang) * f - s.xx;
            const py = other.yy + Math.sin(other.ang) * f - s.yy;
            const pd2 = px * px + py * py;
            if (pd2 <= b2) {
              const pd = Math.sqrt(pd2);
              const pb = bucketOf(Math.atan2(py, px), n);
              if (pd < collision[pb]) collision[pb] = pd;
              if (pd < headClearance[pb]) headClearance[pb] = pd;
            }
          }
        }
      }
      const pts = other.pts;
      if (!pts) continue;
      for (let j = 0; j < pts.length; j++) {
        const p = pts[j];
        if (!p || p.dying || typeof p.xx !== 'number') continue;
        const dx = p.xx - s.xx, dy = p.yy - s.yy;
        const d2 = dx * dx + dy * dy;
        if (d2 > b2) continue;
        const d = Math.sqrt(d2);
        const b = bucketOf(Math.atan2(dy, dx), n);
        if (d < collision[b]) collision[b] = d;
      }
    }
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      const dx = g.xx - s.xx, dy = g.yy - s.yy;
      const d2 = dx * dx + dy * dy;
      if (d2 > b2) continue;
      const d = Math.sqrt(d2);
      const b = bucketOf(Math.atan2(dy, dx), n);
      if (d < collision[b]) collision[b] = d;
      if (d < headClearance[b]) headClearance[b] = d;
    }
    // Self-body avoidance was previously here. Removed: in slither.io your
    // own body is pass-through, NOT lethal. The original code was based on
    // a wrong assumption ("Without this the bot will happily curl into
    // itself on a hairpin" — yes, and curling into itself is fine). With
    // a coiled snake of 50+ segments, this was sterilizing a large
    // fraction of the visible wedge space and forcing the picker to
    // choose narrower paths that often went into real (enemy) obstacles.
    return { collision, headClearance, dangerThreshold, headDanger, projectDist, ourRadius: r };
  }

  // Aggregate food density per bucket: a bucket's score is sum of sz^2 / dist
  // across all visible foods in it. Targets corpse piles (a dead snake leaves
  // a dense ribbon along one angle) instead of single-pellet greed. We also
  // remember the highest-scoring single food in each bucket so the boost
  // gate has a concrete (xx, yy, sz) to inspect.
  function buildFoodBuckets(s) {
    const n = CFG.bucketCount;
    const r2 = CFG.foodSearchRadius * CFG.foodSearchRadius;
    const scores = new Array(n).fill(0);
    const best = new Array(n).fill(null);
    const bestVal = new Array(n).fill(-Infinity);
    const foods = getFoods();
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (!f || f.eaten || typeof f.xx !== 'number') continue;
      const dx = f.xx - s.xx, dy = f.yy - s.yy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.max(1, Math.sqrt(d2));
      const sz = typeof f.sz === 'number' ? f.sz : 1;
      const v = (sz * sz) / d;
      const b = bucketOf(Math.atan2(dy, dx), n);
      scores[b] += v;
      if (v > bestVal[b]) { bestVal[b] = v; best[b] = f; }
    }
    let bi = -1, bv = 0;
    for (let i = 0; i < n; i++) if (scores[i] > bv) { bv = scores[i]; bi = i; }
    return { scores, best, bestBucket: bi };
  }

  // ---- Heading from buckets ----------------------------------------------
  function findOpenRuns(safe) {
    const n = safe.length;
    if (safe.every(v => v)) return [{ start: 0, length: n }];
    if (safe.every(v => !v)) return [];
    let anchor = -1;
    for (let i = 0; i < n; i++) {
      if (!safe[i] && safe[(i + 1) % n]) { anchor = (i + 1) % n; break; }
    }
    if (anchor === -1) anchor = 0;
    const runs = [];
    let i = 0;
    while (i < n) {
      const idx = (anchor + i) % n;
      if (!safe[idx]) { i++; continue; }
      const start = idx;
      let len = 0;
      while (len < n && safe[(anchor + i + len) % n]) len++;
      runs.push({ start, length: len });
      i += len;
    }
    return runs;
  }

  function pickHeadingFromBuckets(buckets, desiredAngle) {
    const n = CFG.bucketCount;
    const { collision, headClearance, dangerThreshold, headDanger } = buckets;
    const safe = new Array(n);
    for (let i = 0; i < n; i++) {
      safe[i] = collision[i] >= dangerThreshold && headClearance[i] >= headDanger;
    }
    if (safe.every(v => v)) {
      return { bucket: bucketOf(desiredAngle, n), angle: desiredAngle, runLen: n, allBlocked: false };
    }
    const runs = findOpenRuns(safe);
    if (runs.length === 0) {
      let bi = 0, bv = -Infinity;
      for (let i = 0; i < n; i++) {
        const c = Math.min(collision[i], headClearance[i]);
        if (c > bv) { bv = c; bi = i; }
      }
      return { bucket: bi, angle: bucketAngle(bi, n), runLen: 0, allBlocked: true };
    }
    const desiredBucket = bucketOf(desiredAngle, n);
    let bestRun = null, bestMid = 0, bestScore = -Infinity;
    for (const run of runs) {
      const midF = run.start + (run.length - 1) / 2;
      const offsetFromDesired = bucketDelta(midF, desiredBucket, n);
      const score = run.length * CFG.runWidthWeight - offsetFromDesired;
      if (score > bestScore) { bestScore = score; bestRun = run; bestMid = midF; }
    }
    return {
      bucket: Math.round(bestMid) % n,
      angle: bucketAngle(bestMid, n),
      runLen: bestRun.length,
      allBlocked: false,
    };
  }

  // ---- Continuous time-to-collision picker -------------------------------
  // Replaces the wedge-based heading picker. The wedge approach lost too
  // much information: 22.5° per bucket meant we couldn't tell where in the
  // bucket the obstacle was, and the bucket recorded only the nearest
  // obstacle so deeper bodies hid behind closer ones. The picker also
  // assessed danger on the current state and committed to full-speed
  // motion without asking "where will I be when this obstacle is in front
  // of me?"
  //
  // The TTC picker samples continuous headings and, for each, simulates
  // forward motion against (a) static enemy body segments and (b) enemy
  // heads under linear motion. It picks the heading with the longest
  // time-to-collision, with food alignment as a tie-breaker. Sample count
  // is 32 (11.25° resolution) and the horizon is 1.2 seconds.

  // Quadratic intersection between two moving circles. Given initial
  // relative position (dx, dy), relative velocity (vrx, vry), and a safe
  // squared radius safeR2, returns the time at which the squared distance
  // first equals safeR2 (i.e., we collide), or Infinity if no collision
  // in the future. Returns 0 if already inside the safe radius.
  function firstHitTime(dx, dy, vrx, vry, safeR2) {
    const c = dx * dx + dy * dy - safeR2;
    if (c <= 0) return 0;
    const a = vrx * vrx + vry * vry;
    if (a < 1e-9) return Infinity;
    const b = 2 * (dx * vrx + dy * vry);
    if (b >= 0) return Infinity; // moving apart
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 ? t : Infinity;
  }

  // First time a point at origin moving with velocity (vx, vy) enters a
  // capsule (line segment from P1 to P2 with radius rR). P1 and P2 are
  // relative to the moving point's position. See lib/geometry.js for the
  // expanded docstring and tests.
  function firstHitCapsuleTime(p1x, p1y, p2x, p2y, vx, vy, rR) {
    const rR2 = rR * rR;
    const Lx = p2x - p1x;
    const Ly = p2y - p1y;
    const L2 = Lx * Lx + Ly * Ly;
    if (L2 < 1e-9) {
      return firstHitTime(p1x, p1y, -vx, -vy, rR2);
    }
    const t0 = ((-p1x) * Lx + (-p1y) * Ly) / L2;
    const ct = t0 < 0 ? 0 : (t0 > 1 ? 1 : t0);
    const cx = p1x + ct * Lx;
    const cy = p1y + ct * Ly;
    if (cx * cx + cy * cy <= rR2) return 0;
    const tP1 = firstHitTime(p1x, p1y, -vx, -vy, rR2);
    const tP2 = firstHitTime(p2x, p2y, -vx, -vy, rR2);
    let best = tP1 < tP2 ? tP1 : tP2;
    const L = Math.sqrt(L2);
    const invL = 1 / L;
    const dxN = Lx * invL;
    const dyN = Ly * invL;
    const nxN = -dyN;
    const nyN = dxN;
    const rx = -p1x;
    const ry = -p1y;
    const y0 = rx * nxN + ry * nyN;
    const x0 = rx * dxN + ry * dyN;
    const vyR = vx * nxN + vy * nyN;
    const vxR = vx * dxN + vy * dyN;
    if (Math.abs(y0) >= rR && Math.abs(vyR) >= 1e-9) {
      const targetY = y0 > 0 ? rR : -rR;
      const t = (targetY - y0) / vyR;
      if (t >= 0 && t < best) {
        const xAt = x0 + vxR * t;
        if (xAt >= 0 && xAt <= L) best = t;
      }
    }
    return best;
  }

  // Estimate snake speed from the velocity tracker. updateHeadHistory
  // already computes vx/vy for every snake including the player; we just
  // look it up. Falls back to a conservative ~200 px/sec if no velocity
  // is recorded yet (first tick after spawn).
  function estimateOwnSpeed(s, velocities) {
    for (let i = 0; i < velocities.length; i++) {
      if (velocities[i].snake === s) return velocities[i].speed;
    }
    return 200;
  }

  // Pre-filter all enemy heads and body segments into a flat obstacle
  // list. Each entry holds (dx, dy, ovx, ovy, safeR2) so the per-heading
  // loop can compute relative velocity cheaply.
  function buildNearbyObstacles(s, velocities, horizonS, mySpeed) {
    const myR = snakeRadius(s);
    const reach = myR + mySpeed * horizonS + 100; // 100px slack
    const reach2 = reach * reach;
    const out = [];
    const snakes = getSnakes();
    // Velocity lookup
    const velByOther = new Map();
    for (let i = 0; i < velocities.length; i++) {
      velByOther.set(velocities[i].snake, velocities[i]);
    }
    for (let i = 0; i < snakes.length; i++) {
      const other = snakes[i];
      if (!other || other === s) continue;
      const otherR = snakeRadiusOf(other);
      const safeR = myR + otherR;
      const safeR2 = safeR * safeR;
      // Enemy head (moving)
      if (typeof other.xx === 'number') {
        const dx = other.xx - s.xx;
        const dy = other.yy - s.yy;
        if (dx * dx + dy * dy <= reach2) {
          const v = velByOther.get(other);
          out.push({
            dx, dy,
            ovx: v ? v.vx : 0,
            ovy: v ? v.vy : 0,
            safeR2,
          });
        }
      }
      // Enemy body segments as discrete points with per-segment
      // tangent velocity. Slither's body is a chain that follows the
      // head's traced path; segment j's instantaneous motion is along
      // the direction (pts[j-1] - pts[j]) at the enemy's speed.
      //
      // Earlier iterations treated bodies as either static (which
      // false-positived where the tail had already moved on) or rigid
      // head-velocity translation (which false-negatived for big
      // curving snakes: the model said the body swept with the head's
      // new direction, but reality is the body lags the head's turn,
      // so the bot dodged into a body that didn't actually move out
      // of the way). Per-segment tangent gets both regimes right:
      // straight snake -> every segment's tangent is the head heading
      // (identical to head velocity); curving snake -> each segment
      // moves along the local body curve, not where the head is now.
      const headVel = velByOther.get(other);
      const enemySpeed = headVel ? headVel.speed : 0;
      const pts = other.pts;
      if (pts) {
        for (let j = 0; j < pts.length; j++) {
          const p = pts[j];
          if (!p || p.dying || typeof p.xx !== 'number') continue;
          const dx = p.xx - s.xx;
          const dy = p.yy - s.yy;
          if (dx * dx + dy * dy > reach2) continue;
          let segVx = 0, segVy = 0;
          if (enemySpeed > 0) {
            // For j=0 the "segment ahead" is the head itself. For
            // j>0 it is pts[j-1]. Either way we walk from the
            // current segment toward the one ahead in the chain.
            const aheadX = j === 0 ? other.xx : pts[j - 1] && pts[j - 1].xx;
            const aheadY = j === 0 ? other.yy : pts[j - 1] && pts[j - 1].yy;
            if (typeof aheadX === 'number' && typeof aheadY === 'number') {
              const tdx = aheadX - p.xx;
              const tdy = aheadY - p.yy;
              const tlen = Math.sqrt(tdx * tdx + tdy * tdy);
              if (tlen > 1e-6) {
                segVx = (tdx / tlen) * enemySpeed;
                segVy = (tdy / tlen) * enemySpeed;
              }
            }
          }
          out.push({ dx, dy, ovx: segVx, ovy: segVy, safeR2 });
        }
      }

      // Multi-hypothesis curving ghosts. Project enemy position under
      // several non-zero turn rates and lookahead times; add each
      // resulting point as a static obstacle. The zero-turn linear case
      // is already covered by the moving head obstacle above. Only
      // applied to enemies moving fast enough to be a real threat.
      const v = velByOther.get(other);
      if (v && v.speed >= CFG.minThreatSpeed && typeof other.xx === 'number') {
        const heading = Math.atan2(v.vy, v.vx);
        const speed = v.speed;
        const sinH = Math.sin(heading);
        const cosH = Math.cos(heading);
        for (let ti = 0; ti < CFG.curveTurnRates.length; ti++) {
          const omega = CFG.curveTurnRates[ti];
          const invOmega = 1 / omega;
          for (let li = 0; li < CFG.curveLookaheadSeconds.length; li++) {
            const t = CFG.curveLookaheadSeconds[li];
            const turn = omega * t;
            // Arc displacement under constant turn rate omega, integrated
            // from 0 to t, starting from current heading and speed.
            const offX = speed * invOmega * (Math.sin(heading + turn) - sinH);
            const offY = speed * invOmega * (-Math.cos(heading + turn) + cosH);
            const dx = (other.xx + offX) - s.xx;
            const dy = (other.yy + offY) - s.yy;
            if (dx * dx + dy * dy > reach2) continue;
            out.push({ dx, dy, ovx: 0, ovy: 0, safeR2 });
          }
        }
      }
    }
    return out;
  }

  // Substep-simulated TTC picker with own-arc kinematics and a
  // continuous score function. See CRITIQUE.md for the rationale.
  //
  // For each of TTC_SAMPLES candidate headings, simulate a turn from
  // the current heading toward the candidate at CFG.botTurnRate, then
  // straight-line motion at the candidate heading. Position along the
  // arc is closed-form (integrated sin/cos). Obstacles evolve linearly
  // with their tracked velocities; we sample bot vs. obstacle distance
  // every SUBSTEP_DT seconds and call it a hit when squared distance
  // first falls below the obstacle's safeR2. The substep grid is
  // coarse (50 ms) so TTC resolution is +/- 50 ms; that is well below
  // both the scoring epsilons and the 10 ms food-tiebreak threshold
  // the old picker used.
  //
  // Score is `ttc - foodWeight * foodOffset - inertiaWeight * inertiaOffset`.
  // Food is no longer a tie-break: small misalignments cost real TTC
  // budget, so the bot will choose a slightly-less-safe heading that
  // actually points at the food. Inertia term keeps the picker from
  // oscillating between near-equal candidates.
  const TTC_SAMPLES = 32;
  const TTC_HORIZON_S = 1.2;
  const SUBSTEP_DT = 0.05;
  const NUM_SUBSTEPS = Math.ceil(TTC_HORIZON_S / SUBSTEP_DT);

  let lastChosenHeading = null;

  function pickHeadingTTC(s, velocities, foodTarget) {
    const mySpeed = estimateOwnSpeed(s, velocities);
    const turnRate = CFG.botTurnRate;
    const currentHeading = typeof s.ang === 'number' ? s.ang : 0;
    const nearby = buildNearbyObstacles(s, velocities, TTC_HORIZON_S, mySpeed);
    const foodAng = foodTarget
      ? Math.atan2(foodTarget.yy - s.yy, foodTarget.xx - s.xx)
      : null;

    const ttcByIndex = new Array(TTC_SAMPLES);
    const safetyByIndex = new Array(TTC_SAMPLES);
    const thetaByIndex = new Array(TTC_SAMPLES);
    let maxSafety = -Infinity;
    // Per-obstacle TTC scratch, reused across candidates to avoid
    // per-candidate allocation churn.
    const obstacleTTCs = nearby.length > 0 ? new Array(nearby.length) : null;

    // Pass 1: simulate each candidate; compute DWA-style weighted safety
    // score from per-obstacle TTCs. The substep loop tracks min-TTC for
    // legacy semantics and overlay color, plus the full per-obstacle TTC
    // vector for mean and critical-count aggregations. Default weights
    // (wMean=0, wCritical=0) preserve v0.6.1 min-TTC-only behavior.
    for (let k = 0; k < TTC_SAMPLES; k++) {
      const theta = (k / TTC_SAMPLES) * TAU;
      thetaByIndex[k] = theta;
      const dHeading = angleBetween(currentHeading, theta);
      const absDHeading = Math.abs(dHeading);
      const turnDir = dHeading >= 0 ? 1 : -1;
      const omegaSigned = turnDir * turnRate;
      const tTurn = absDHeading / turnRate;

      // Arc endpoint: where the bot is when the turn completes. After
      // that the bot moves linearly at heading theta.
      let xAtTurn = 0, yAtTurn = 0;
      if (absDHeading > 1e-6) {
        xAtTurn = (mySpeed / omegaSigned) * (Math.sin(currentHeading + dHeading) - Math.sin(currentHeading));
        yAtTurn = (mySpeed / omegaSigned) * (-Math.cos(currentHeading + dHeading) + Math.cos(currentHeading));
      }
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      if (obstacleTTCs) {
        for (let i = 0; i < nearby.length; i++) obstacleTTCs[i] = TTC_HORIZON_S;
      }
      let minTTC = TTC_HORIZON_S;
      // step=0 catches "already inside an obstacle" at the start.
      for (let step = 0; step <= NUM_SUBSTEPS; step++) {
        const t = step * SUBSTEP_DT;
        let myX, myY;
        if (t <= tTurn) {
          // Still turning. Closed-form arc position from t=0.
          if (absDHeading > 1e-6) {
            myX = (mySpeed / omegaSigned) * (Math.sin(currentHeading + omegaSigned * t) - Math.sin(currentHeading));
            myY = (mySpeed / omegaSigned) * (-Math.cos(currentHeading + omegaSigned * t) + Math.cos(currentHeading));
          } else {
            // Heading change is essentially zero. Treat as linear.
            myX = cosTheta * mySpeed * t;
            myY = sinTheta * mySpeed * t;
          }
        } else {
          // Turn complete. Linear from arc endpoint at heading theta.
          const dt = t - tTurn;
          myX = xAtTurn + cosTheta * mySpeed * dt;
          myY = yAtTurn + sinTheta * mySpeed * dt;
        }

        if (obstacleTTCs) {
          for (let i = 0; i < nearby.length; i++) {
            if (obstacleTTCs[i] < TTC_HORIZON_S) continue;
            const o = nearby[i];
            const ox = o.dx + o.ovx * t;
            const oy = o.dy + o.ovy * t;
            const dx = myX - ox;
            const dy = myY - oy;
            if (dx * dx + dy * dy <= o.safeR2) {
              obstacleTTCs[i] = t;
              if (t < minTTC) minTTC = t;
            }
          }
        }
        // If already inside an obstacle, no point integrating further;
        // the candidate is already dead per the lexicographic order.
        if (minTTC <= 0) break;
      }

      let safety;
      if (obstacleTTCs && nearby.length > 0) {
        let sumTTC = 0;
        let criticalCount = 0;
        for (let i = 0; i < nearby.length; i++) {
          const t = obstacleTTCs[i];
          sumTTC += t;
          if (t < CFG.safetyDangerThreshold) criticalCount++;
        }
        const meanTTC = sumTTC / nearby.length;
        safety = CFG.safetyWeightMin * minTTC
               + CFG.safetyWeightMean * meanTTC
               - CFG.safetyWeightCritical * criticalCount;
      } else {
        // No obstacles in range: max-safety is just the weighted horizon.
        safety = CFG.safetyWeightMin * TTC_HORIZON_S
               + CFG.safetyWeightMean * TTC_HORIZON_S;
      }
      ttcByIndex[k] = minTTC;
      safetyByIndex[k] = safety;
      if (safety > maxSafety) maxSafety = safety;
    }

    // Pass 2: among candidates within foodSafetyBandS of maxSafety,
    // pick the one with the lowest tiebreak cost (food alignment plus
    // inertia). Tiebreak cost has no impact on which candidates enter
    // the band, so food can never push the picker into a less-safe
    // candidate. Slither has no starve, so this is the correct shape:
    // survive first, then aim at food. Band units are score-units,
    // which equal seconds when only wMin is non-zero (default).
    const safetyThreshold = maxSafety - CFG.foodSafetyBandS;
    let bestAng = lastChosenHeading != null ? lastChosenHeading : currentHeading;
    let bestTTC = -1;
    let bestCost = Infinity;
    for (let k = 0; k < TTC_SAMPLES; k++) {
      const safety = safetyByIndex[k];
      if (safety < safetyThreshold) continue;
      const theta = thetaByIndex[k];
      const foodOffset = foodAng === null ? 0 : Math.abs(angleBetween(theta, foodAng));
      const inertiaOffset = lastChosenHeading === null
        ? 0
        : Math.abs(angleBetween(theta, lastChosenHeading));
      const cost = foodOffset + CFG.inertiaWeight * inertiaOffset;
      if (cost < bestCost) {
        bestCost = cost;
        bestAng = theta;
        bestTTC = ttcByIndex[k];
      }
    }
    if (bestTTC < 0) bestTTC = ttcByIndex[0] || 0;

    lastChosenHeading = bestAng;
    return {
      angle: bestAng,
      ttc: bestTTC,
      blocked: bestTTC <= 0.05, // less than 50 ms, basically dead
      obstacleCount: nearby.length,
      ttcByIndex,
    };
  }

  function resetSteeringMemory() {
    lastChosenHeading = null;
  }

  // ---- Game-state probe --------------------------------------------------
  // Dumps the field shape of window.slither and a representative enemy plus
  // a presence check for globals we don't currently read. Used to confirm
  // which protocol-doc fields (sp, wang, ehang, lnp, fx, fy, alive_amt,
  // boost, ...) the live build actually exposes today, so we can build on
  // them instead of assuming. See research/FINDINGS.md item 1.
  function probe() {
    const out = {
      version: '0.6.2',
      slitherKeys: window.slither ? Object.keys(window.slither).sort() : null,
      enemyKeys: null,
      suspectFields: null,
      globals: {
        slither: !!window.slither,
        slithers: Array.isArray(window.slithers) ? window.slithers.length : null,
        foods: Array.isArray(window.foods) ? window.foods.length : null,
        preys: Array.isArray(window.preys) ? window.preys.length : null,
        sectors: Array.isArray(window.sectors) ? window.sectors.length : (typeof window.sectors),
        sector_size: typeof window.sector_size === 'number' ? window.sector_size : null,
        grd: typeof window.grd === 'number' ? window.grd : null,
        gsc: typeof window.gsc === 'number' ? window.gsc : null,
        view_xx: typeof window.view_xx === 'number',
        view_yy: typeof window.view_yy === 'number',
        leaderboard: Array.isArray(window.leaderboard) ? window.leaderboard.length : (Array.isArray(window.lbs) ? window.lbs.length : null),
        setAcceleration: typeof window.setAcceleration === 'function',
        forceServer: typeof window.forceServer === 'function',
        fpsls: Array.isArray(window.fpsls) ? window.fpsls.length : null,
        fmlts: Array.isArray(window.fmlts) ? window.fmlts.length : null,
      },
    };
    if (Array.isArray(window.slithers)) {
      const enemy = window.slithers.find(o => o && o !== window.slither);
      if (enemy) {
        out.enemyKeys = Object.keys(enemy).sort();
        // Spot-check the high-value fields the protocol docs name. typeof
        // returns 'undefined' if the field is gone; 'number' / 'object'
        // confirms it. This is the fastest way to know what we can read
        // server-truth instead of estimating.
        out.suspectFields = {
          sp: typeof enemy.sp,           // speed (server-truth)
          wang: typeof enemy.wang,       // wanted angle (intent)
          ehang: typeof enemy.ehang,     // eye-heading angle
          tsp: typeof enemy.tsp,         // target speed
          alive_amt: typeof enemy.alive_amt,
          lnp: typeof enemy.lnp,         // last neck point
          fx: typeof enemy.fx,
          fy: typeof enemy.fy,
          boost: typeof enemy.boost,
          fam: typeof enemy.fam,
          sct: typeof enemy.sct,
        };
      }
    }
    log('probe:', JSON.stringify(out));
    return out;
  }
  let hasProbed = false;

  // ---- Wall avoidance ----------------------------------------------------
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

  // ---- Boost gating ------------------------------------------------------
  // Boost is the cheapest score multiplier in the game when the path is
  // clear, and the fastest way to die when it isn't. We trigger only when
  // (1) the target food is big enough to be worth burning length on,
  // (2) the collision bucket toward that food has clearance well beyond the
  // food's distance (the food itself sits inside an open arc), and (3) the
  // chosen heading is not pulling us far off-axis from the food.
  let boostActive = false;
  let setAccelMissingWarned = false;
  function setBoost(on) {
    if (on === boostActive) return;
    boostActive = on;
    if (typeof window.setAcceleration === 'function') {
      try { window.setAcceleration(on ? 1 : 0); } catch (e) {}
    } else if (!setAccelMissingWarned) {
      setAccelMissingWarned = true;
      log('setAcceleration() missing on this build; boost disabled.');
    }
  }
  function shouldBoost(s, food, chosenAngle, buckets) {
    if (!food) return false;
    const sz = typeof food.sz === 'number' ? food.sz : 0;
    if (sz < CFG.boostFoodSize) return false;
    const dx = food.xx - s.xx, dy = food.yy - s.yy;
    const foodDist = Math.sqrt(dx * dx + dy * dy);
    const foodAngle = Math.atan2(dy, dx);
    if (Math.abs(angleBetween(chosenAngle, foodAngle)) > CFG.boostMaxAngleDelta) return false;
    const fb = bucketOf(foodAngle, CFG.bucketCount);
    const clearance = Math.min(buckets.collision[fb], buckets.headClearance[fb]);
    return clearance > foodDist * CFG.boostClearanceMargin;
  }

  // ---- Death and score logging ------------------------------------------
  // We can't read snake stats after death (window.slither goes null), so we
  // refresh a "current run" snapshot every tick while playing and finalize
  // it on the playing -> not-playing transition. The snapshot is loose:
  // capture everything that's likely a score signal and let post-hoc
  // analysis decide which fields are real.
  function loadHistory() {
    try {
      const raw = localStorage.getItem(CFG.historyKey);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveHistory(arr) {
    try { localStorage.setItem(CFG.historyKey, JSON.stringify(arr)); } catch (e) {}
  }
  let currentRun = null;
  let wasPlaying = false;
  function snapshotRun(s, ctx) {
    if (!s) return;
    currentRun = currentRun || {
      startTime: Date.now(),
      botEnabled: botEnabled,
      cfgSnapshot: Object.assign({}, CFG),
      peakLength: 0,
      peakLengthLegacy: 0,
      peakSct: 0,
    };
    // Track both the real displayed length (slitherLength) and the legacy
    // segment-count metric so the new runs stay comparable to the n=15
    // baseline taken before the bug fix.
    const len = slitherLength(s);
    const lenLegacy = (s.pts && s.pts.length) || 0;
    if (len > currentRun.peakLength) currentRun.peakLength = len;
    if (lenLegacy > (currentRun.peakLengthLegacy || 0)) currentRun.peakLengthLegacy = lenLegacy;
    if (typeof s.sct === 'number' && s.sct > currentRun.peakSct) currentRun.peakSct = s.sct;
    currentRun.lastSnapshot = {
      t: Date.now(),
      xx: s.xx, yy: s.yy,
      length: len,
      lengthLegacy: lenLegacy,
      sct: s.sct,
      fam: s.fam,
      kill_count: s.kill_count,
      sc: s.sc,
      ang: s.ang,
      rank: typeof window.rank === 'string' || typeof window.rank === 'number' ? window.rank : null,
      heading: ctx.heading,
      foodTargetXY: ctx.foodTarget ? [Math.round(ctx.foodTarget.xx), Math.round(ctx.foodTarget.yy), ctx.foodTarget.sz] : null,
      runLen: ctx.runLen,
      allBlocked: ctx.allBlocked,
      ghosts: ctx.ghosts,
      snakeCount: ctx.snakeCount,
      boosting: boostActive,
    };
  }
  function finalizeRun() {
    if (!currentRun) return;
    const final = currentRun;
    final.endTime = Date.now();
    final.durationMs = final.endTime - final.startTime;
    const hist = loadHistory();
    hist.push(final);
    while (hist.length > CFG.historyCap) hist.shift();
    saveHistory(hist);
    log(`run ended: ${(final.durationMs / 1000).toFixed(1)}s, peakLength=${final.peakLength}, peakSct=${final.peakSct}, botEnabled=${final.botEnabled}`);
    currentRun = null;
  }

  // ---- Debug overlay -----------------------------------------------------
  // Drawn on a transparent canvas layered over the game's mc canvas. We can't
  // safely interleave with the game's own render (it owns mc), so the
  // overlay is a separate element with pointer-events:none. World-to-screen
  // is snake-centric: slither sits at the canvas center modulo a small
  // camera lag we ignore.
  let overlayCanvas = null;
  let overlayCtx = null;
  // Overlay defaults to ON. Respects an explicit '0' in localStorage if the
  // user has toggled it off (H key or nr9k.overlay(false)). Drawn at
  // CFG.overlayScale (default 0.5) so it's visible without smothering the
  // play area.
  let overlayEnabled = (() => {
    try {
      const v = localStorage.getItem(CFG.overlayKey);
      return v === null ? true : v === '1';
    } catch (e) { return true; }
  })();
  let lastDebugState = null;

  function ensureOverlay() {
    if (overlayCanvas) return;
    const mc = window.mc;
    if (!mc) return;
    const c = document.createElement('canvas');
    c.id = 'nr9k-overlay';
    c.style.position = 'fixed';
    c.style.left = '0';
    c.style.top = '0';
    c.style.pointerEvents = 'none';
    c.style.zIndex = '99999';
    document.body.appendChild(c);
    overlayCanvas = c;
    overlayCtx = c.getContext('2d');
    syncOverlaySize();
    window.addEventListener('resize', syncOverlaySize);
  }
  function syncOverlaySize() {
    const mc = window.mc;
    if (!mc || !overlayCanvas) return;
    overlayCanvas.width = mc.width;
    overlayCanvas.height = mc.height;
    // Position our overlay exactly over mc. Previously the overlay was
    // pinned at document (0, 0), which only matches if mc is also at the
    // document origin. On builds where mc is centered, padded, or pushed
    // down by an ad bar, the overlay ends up misaligned -- the wedges and
    // TTC rays radiate from the canvas geometric center while the game
    // draws the snake offset by however far mc is shifted in the DOM.
    const rect = mc.getBoundingClientRect();
    overlayCanvas.style.left = rect.left + 'px';
    overlayCanvas.style.top = rect.top + 'px';
    overlayCanvas.style.width = rect.width + 'px';
    overlayCanvas.style.height = rect.height + 'px';
  }
  function worldToScreen(s, x, y) {
    const mc = window.mc;
    const gsc = typeof window.gsc === 'number' ? window.gsc : 1;
    // Slither uses a smoothed camera (view_xx/yy) that lags behind the
    // snake's world position. Using s.xx/yy here makes the overlay arcs
    // drift from the rendered snake head every time the camera lags.
    // Use the game's own camera if exposed; fall back to s.xx/yy for the
    // sandbox where there's no smoothing.
    const viewX = typeof window.view_xx === 'number' ? window.view_xx : s.xx;
    const viewY = typeof window.view_yy === 'number' ? window.view_yy : s.yy;
    const cx = typeof window.mww2 === 'number' ? window.mww2 : mc.width / 2;
    const cy = typeof window.mhh2 === 'number' ? window.mhh2 : mc.height / 2;
    return [(x - viewX) * gsc + cx, (y - viewY) * gsc + cy];
  }
  function drawOverlay() {
    if (!overlayEnabled) return;
    ensureOverlay();
    if (!overlayCtx) return;
    syncOverlaySize();
    const s = getSnake();
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!s || !lastDebugState) return;
    const gsc = typeof window.gsc === 'number' ? window.gsc : 1;
    const scl = typeof CFG.overlayScale === 'number' ? CFG.overlayScale : 1;
    const gscS = gsc * scl;
    const [hx, hy] = worldToScreen(s, s.xx, s.yy);
    const n = CFG.bucketCount;
    const { collision, headClearance, dangerThreshold, headDanger, projectDist } = lastDebugState.buckets;
    const warnThreshold = dangerThreshold * CFG.warningMult;
    const headWarn = headDanger * CFG.warningMult;
    const bucketRad = TAU / n;
    for (let i = 0; i < n; i++) {
      const d = Math.min(collision[i], projectDist);
      const lethal = collision[i] < dangerThreshold || headClearance[i] < headDanger;
      const warn = !lethal && (collision[i] < warnThreshold || headClearance[i] < headWarn);
      const aStart = i * bucketRad;
      const aEnd = aStart + bucketRad;
      overlayCtx.beginPath();
      overlayCtx.moveTo(hx, hy);
      overlayCtx.arc(hx, hy, d * gscS, aStart, aEnd);
      overlayCtx.closePath();
      const fill = lethal ? 'rgba(255,60,60,0.28)' : warn ? 'rgba(240,200,40,0.22)' : 'rgba(80,220,120,0.12)';
      const stroke = lethal ? 'rgba(255,60,60,0.7)' : warn ? 'rgba(240,200,40,0.6)' : 'rgba(80,220,120,0.45)';
      overlayCtx.fillStyle = fill;
      overlayCtx.strokeStyle = stroke;
      overlayCtx.lineWidth = 1;
      overlayCtx.fill();
      overlayCtx.stroke();
    }
    // Danger-threshold ring so it's obvious how close "lethal" actually is.
    overlayCtx.strokeStyle = 'rgba(255,80,80,0.4)';
    overlayCtx.lineWidth = 1;
    overlayCtx.beginPath();
    overlayCtx.arc(hx, hy, dangerThreshold * gscS, 0, TAU);
    overlayCtx.stroke();
    if (lastDebugState.ghosts) {
      overlayCtx.fillStyle = 'rgba(220,80,220,0.9)';
      for (const g of lastDebugState.ghosts) {
        const [gx, gy] = worldToScreen(s, g.xx, g.yy);
        // Pull world-anchored markers in toward the snake by overlayScale
        // so they stay consistent with the shrunk wedges.
        const sx = hx + (gx - hx) * scl;
        const sy = hy + (gy - hy) * scl;
        overlayCtx.beginPath();
        overlayCtx.arc(sx, sy, 3, 0, TAU);
        overlayCtx.fill();
      }
    }
    if (lastDebugState.foodTarget) {
      const [fx, fy] = worldToScreen(s, lastDebugState.foodTarget.xx, lastDebugState.foodTarget.yy);
      const sx = hx + (fx - hx) * scl;
      const sy = hy + (fy - hy) * scl;
      overlayCtx.strokeStyle = 'rgba(255,200,40,0.9)';
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.arc(sx, sy, 8, 0, TAU);
      overlayCtx.stroke();
    }
    // TTC sample rays. Each candidate heading drawn as a line whose
    // length is proportional to its time-to-collision (capped at the
    // wedge scan radius for visual scale). Color reflects TTC: red
    // for ~0 (about to die that way), green for full horizon.
    if (Array.isArray(lastDebugState.ttcByIndex)) {
      const samples = lastDebugState.ttcByIndex;
      const maxRayLen = projectDist * gscS * 0.95;
      for (let k = 0; k < samples.length; k++) {
        const ttc = samples[k];
        const ratio = Math.max(0, Math.min(1, ttc / TTC_HORIZON_S));
        const theta = (k / samples.length) * TAU;
        const len = maxRayLen * (0.1 + 0.9 * ratio);
        const ex = hx + Math.cos(theta) * len;
        const ey = hy + Math.sin(theta) * len;
        // Hue from red (0) through yellow to green (1).
        const r = ratio < 0.5 ? 255 : Math.round(255 * (1 - (ratio - 0.5) * 2));
        const g = ratio < 0.5 ? Math.round(255 * ratio * 2) : 255;
        overlayCtx.strokeStyle = `rgba(${r},${g},60,0.55)`;
        overlayCtx.lineWidth = 1;
        overlayCtx.beginPath();
        overlayCtx.moveTo(hx, hy);
        overlayCtx.lineTo(ex, ey);
        overlayCtx.stroke();
      }
    }
    if (typeof lastDebugState.heading === 'number') {
      const len = projectDist * gscS;
      const ex = hx + Math.cos(lastDebugState.heading) * len;
      const ey = hy + Math.sin(lastDebugState.heading) * len;
      overlayCtx.strokeStyle = lastDebugState.boosting ? 'rgba(255,80,80,0.9)' : 'rgba(120,255,140,0.95)';
      overlayCtx.lineWidth = 3;
      overlayCtx.beginPath();
      overlayCtx.moveTo(hx, hy);
      overlayCtx.lineTo(ex, ey);
      overlayCtx.stroke();
    }
    overlayCtx.fillStyle = 'rgba(255,255,255,0.85)';
    overlayCtx.font = '12px monospace';
    overlayCtx.fillText(
      `nr9k v0.5.2  bot:${botEnabled ? 'ON' : 'off'}  boost:${boostActive ? 'ON' : 'off'}  ` +
      `ttc:${typeof lastDebugState.ttc === 'number' ? lastDebugState.ttc.toFixed(2) : '-'}s` +
      `${lastDebugState.blocked ? ' BLOCKED' : ''}  obs:${lastDebugState.obstacleCount || 0}`,
      10, 16
    );
  }
  function rafLoop() {
    drawOverlay();
    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);

  // ---- Steering loop -----------------------------------------------------
  let botEnabled = false;
  let lastTickLog = 0;
  let lastGhostCount = 0;

  function tick() {
    const now = performance.now();
    const velocities = updateHeadHistory(now);
    const playingNow = !!window.playing;
    const s = getSnake();
    if (playingNow && s && typeof s.xx === 'number') {
      if (!wasPlaying) {
        currentRun = null;
        resetSteeringMemory();
        hasProbed = false; // re-probe on each new game so we see field shape per-session
      }
      wasPlaying = true;
    } else if (wasPlaying) {
      finalizeRun();
      setBoost(false);
      resetSteeringMemory();
      wasPlaying = false;
    }
    if (!botEnabled || !playingNow || !s || typeof s.xx !== 'number') return;
    const ghosts = predictGhosts(s, velocities);
    lastGhostCount = ghosts.length;
    // Buckets still computed for the debug overlay and per-tick log; the
    // actual steering decision comes from the TTC picker below.
    const collisionBuckets = buildCollisionBuckets(s, ghosts);
    const foodBuckets = buildFoodBuckets(s);
    const foodTarget = foodBuckets.bestBucket >= 0 ? foodBuckets.best[foodBuckets.bestBucket] : null;

    const ttcChoice = pickHeadingTTC(s, velocities, foodTarget);
    let heading = ttcChoice.angle;
    heading = applyWallSteering(s, heading);
    steerTo(heading);
    // Boost only when the chosen heading has plenty of TTC slack and the
    // existing boost gate's distance/angle checks also pass.
    const ttcSafe = ttcChoice.ttc >= TTC_HORIZON_S * 0.9;
    const boostNow = ttcSafe && shouldBoost(s, foodTarget, heading, collisionBuckets);
    setBoost(boostNow);
    snapshotRun(s, {
      heading,
      foodTarget,
      ttc: ttcChoice.ttc,
      blocked: ttcChoice.blocked,
      ghosts: ghosts.length,
      snakeCount: getSnakes().length,
      obstacleCount: ttcChoice.obstacleCount,
    });
    lastDebugState = {
      buckets: collisionBuckets,
      ghosts: ghosts,
      foodTarget,
      heading,
      boosting: boostNow,
      ttc: ttcChoice.ttc,
      blocked: ttcChoice.blocked,
      ttcByIndex: ttcChoice.ttcByIndex,
      obstacleCount: ttcChoice.obstacleCount,
    };
    const wallNow = Date.now();
    if (wallNow - lastTickLog > 2000) {
      lastTickLog = wallNow;
      log(`tick: pos=(${Math.round(s.xx)},${Math.round(s.yy)}) heading=${heading.toFixed(2)} ttc=${ttcChoice.ttc.toFixed(2)}${ttcChoice.blocked ? ' BLOCKED' : ''} obs=${ttcChoice.obstacleCount} foodB=${foodBuckets.bestBucket} ghosts=${ghosts.length} boost=${boostNow}`);
    }
  }
  setInterval(tick, Math.max(1, Math.round(1000 / CFG.tickHz)));

  // ---- Toggles -----------------------------------------------------------
  function toggleBot(val) {
    botEnabled = typeof val === 'boolean' ? val : !botEnabled;
    if (!botEnabled) {
      setBoost(false);
      resetSteeringMemory();
    } else if (!hasProbed) {
      // Fire the state probe at the moment the bot is enabled, not
      // gated on a particular tick / snake count. Try/catch so a
      // throw inside Object.keys or JSON.stringify gets surfaced
      // instead of silently disabling probe forever.
      try { probe(); } catch (e) { log('probe threw:', e && e.message || e); }
      hasProbed = true;
    }
    log('bot', botEnabled ? 'enabled' : 'disabled');
  }
  function toggleOverlay(val) {
    overlayEnabled = typeof val === 'boolean' ? val : !overlayEnabled;
    try { localStorage.setItem(CFG.overlayKey, overlayEnabled ? '1' : '0'); } catch (e) {}
    if (!overlayEnabled && overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    log('overlay', overlayEnabled ? 'enabled' : 'disabled');
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
    if (!window.playing) return;
    if (e.code === 'KeyT') toggleBot();
    else if (e.code === 'KeyH') toggleOverlay();
  }, true);

  // ---- Console helpers ---------------------------------------------------
  function historySummary(history, lastN) {
    const items = history.slice(-lastN);
    if (items.length === 0) return { count: 0 };
    const lens = items.map(r => r.peakLength || 0).filter(v => v > 0).sort((a, b) => a - b);
    const scts = items.map(r => r.peakSct || 0).filter(v => v > 0).sort((a, b) => a - b);
    const durs = items.map(r => r.durationMs || 0).filter(v => v > 0).sort((a, b) => a - b);
    const median = arr => arr.length ? arr[Math.floor(arr.length / 2)] : 0;
    return {
      count: items.length,
      medianLength: median(lens),
      maxLength: lens.length ? lens[lens.length - 1] : 0,
      medianSct: median(scts),
      maxSct: scts.length ? scts[scts.length - 1] : 0,
      medianDurationS: median(durs) / 1000,
      botEnabledCount: items.filter(r => r.botEnabled).length,
    };
  }

  window.nr9k = {
    snake: getSnake,
    foods: getFoods,
    snakes: getSnakes,
    length: () => slitherLength(getSnake()),
    enabled: () => botEnabled,
    toggle: (v) => toggleBot(v),
    overlay: (v) => toggleOverlay(v),
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
        boosting: boostActive,
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
        overlayEnabled,
      };
    },
    history: () => loadHistory(),
    summary: (lastN) => historySummary(loadHistory(), lastN || 20),
    clearHistory: () => { saveHistory([]); log('history cleared'); },
    sockets: () => seenSocketUrls.slice(),
    blocked: () => blockedSocketUrls.slice(),
    fetches: () => seenFetchUrls.slice(),
    probe: () => probe(),
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
  log('nr9k helper attached. Right-click or T to toggle bot. H toggles debug overlay. Set name with nr9k.setNick("YourName").');
})();
