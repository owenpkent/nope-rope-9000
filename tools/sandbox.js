// Minimal slither-shaped sandbox so we can develop bot logic without the real
// game being reachable. Field names mirror slither.io's: snake.xx/yy/ang/pts,
// food.xx/yy/sz, and steering via window.xm/window.ym. Anything you write
// against this should port to the real game with little change.

(function () {
  'use strict';

  window.SANDBOX = true;

  const W = 4000, H = 4000;
  const FOOD_TARGET = 220;
  const DUMMY_COUNT = 4;
  const PLAYER_SPEED = 3.5;
  const DUMMY_SPEED = 2.6;
  const HEAD_RADIUS = 12;
  const SEGMENT_GAP = 8;
  const FOOD_PICKUP_R = 18;

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const hud = document.getElementById('hud');

  let vw = 0, vh = 0;
  function resize() {
    vw = window.innerWidth; vh = window.innerHeight;
    cv.width = vw; cv.height = vh;
    window.mww2 = vw / 2;
    window.mhh2 = vh / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // Mouse offset from center, same semantics as slither's window.xm/window.ym.
  window.xm = 0;
  window.ym = 0;
  window.gsc = 1;
  window.addEventListener('mousemove', (e) => {
    // Only update from mouse if the bot has not taken over this frame.
    // We don't distinguish here; bot can just overwrite xm/ym after this.
    window.xm = e.clientX - vw / 2;
    window.ym = e.clientY - vh / 2;
  });

  function makeSnake(id, x, y, color, length) {
    const pts = [];
    for (let i = 0; i < length; i++) {
      pts.push({ xx: x, yy: y, dying: false });
    }
    return {
      id,
      xx: x,
      yy: y,
      ang: Math.random() * Math.PI * 2,
      sp: id === 0 ? PLAYER_SPEED : DUMMY_SPEED,
      sct: length,
      fam: 0,
      tl: 0,
      pts,
      _color: color,
      _wander: Math.random() * Math.PI * 2,
    };
  }

  const player = makeSnake(0, W / 2, H / 2, '#80ff80', 30);
  const snakes = [player];
  for (let i = 0; i < DUMMY_COUNT; i++) {
    snakes.push(makeSnake(
      i + 1,
      Math.random() * W,
      Math.random() * H,
      ['#ff6060', '#6090ff', '#ffd060', '#c060ff'][i % 4],
      20 + ((Math.random() * 30) | 0)
    ));
  }

  const foods = [];
  function spawnFood(x, y, sz) {
    foods.push({
      xx: x !== undefined ? x : Math.random() * W,
      yy: y !== undefined ? y : Math.random() * H,
      sz: sz !== undefined ? sz : 1 + ((Math.random() * 4) | 0),
    });
  }
  for (let i = 0; i < FOOD_TARGET; i++) spawnFood();

  // Expose the same globals the real game exposes.
  window.snake = player;
  window.snakes = snakes;
  window.foods = foods;

  function turnToward(curAng, targetAng, maxStep) {
    let d = targetAng - curAng;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (d > maxStep) d = maxStep;
    if (d < -maxStep) d = -maxStep;
    return curAng + d;
  }

  function stepSnake(s, dt) {
    let desiredAng;
    if (s.id === 0) {
      // Player snake steers toward (xm, ym) relative to center, same as slither.
      desiredAng = Math.atan2(window.ym, window.xm);
    } else {
      // Dummy snakes wander with smooth angle drift; reflect off edges.
      s._wander += (Math.random() - 0.5) * 0.15;
      desiredAng = s._wander;
      if (s.xx < 100) desiredAng = 0;
      else if (s.xx > W - 100) desiredAng = Math.PI;
      if (s.yy < 100) desiredAng = Math.PI / 2;
      else if (s.yy > H - 100) desiredAng = -Math.PI / 2;
      if (s.xx < 100 || s.xx > W - 100 || s.yy < 100 || s.yy > H - 100) {
        s._wander = desiredAng;
      }
    }

    s.ang = turnToward(s.ang, desiredAng, 0.08 * dt);

    const nx = s.xx + Math.cos(s.ang) * s.sp * dt;
    const ny = s.yy + Math.sin(s.ang) * s.sp * dt;
    s.xx = Math.max(20, Math.min(W - 20, nx));
    s.yy = Math.max(20, Math.min(H - 20, ny));

    // Body follow: each segment chases the previous with a fixed gap.
    let px = s.xx, py = s.yy;
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i];
      const dx = px - p.xx, dy = py - p.yy;
      const d = Math.hypot(dx, dy);
      if (d > SEGMENT_GAP) {
        const t = (d - SEGMENT_GAP) / d;
        p.xx += dx * t;
        p.yy += dy * t;
      }
      px = p.xx; py = p.yy;
    }
  }

  function eatFood(s) {
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      const dx = f.xx - s.xx, dy = f.yy - s.yy;
      if (dx * dx + dy * dy < FOOD_PICKUP_R * FOOD_PICKUP_R) {
        foods.splice(i, 1);
        s.sct += f.sz;
        // Grow body length proportionally; real slither uses a curve, this is fine for dev.
        if (s.pts.length < s.sct) {
          const tail = s.pts[s.pts.length - 1] || s;
          s.pts.push({ xx: tail.xx, yy: tail.yy, dying: false });
        }
      }
    }
    while (foods.length < FOOD_TARGET) spawnFood();
  }

  function render() {
    ctx.fillStyle = '#161c22';
    ctx.fillRect(0, 0, vw, vh);

    // Camera centers on player.
    const cx = vw / 2 - player.xx;
    const cy = vh / 2 - player.yy;

    // Faint world boundary.
    ctx.strokeStyle = 'rgba(120,130,180,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy, W, H);

    // Hex-ish dot grid for orientation.
    ctx.fillStyle = 'rgba(120,130,180,0.10)';
    const step = 80;
    const startX = Math.floor(-cx / step) * step;
    const startY = Math.floor(-cy / step) * step;
    for (let x = startX; x < startX + vw + step; x += step) {
      for (let y = startY; y < startY + vh + step; y += step) {
        ctx.beginPath();
        ctx.arc(x + cx, y + cy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Food.
    for (const f of foods) {
      const x = f.xx + cx, y = f.yy + cy;
      if (x < -10 || x > vw + 10 || y < -10 || y > vh + 10) continue;
      ctx.fillStyle = '#e8e060';
      ctx.beginPath();
      ctx.arc(x, y, 2 + f.sz * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snakes.
    for (const s of snakes) {
      ctx.fillStyle = s._color;
      for (let i = s.pts.length - 1; i >= 0; i--) {
        const p = s.pts[i];
        const x = p.xx + cx, y = p.yy + cy;
        if (x < -20 || x > vw + 20 || y < -20 || y > vh + 20) continue;
        ctx.beginPath();
        ctx.arc(x, y, HEAD_RADIUS * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      // Head on top, slightly larger.
      ctx.fillStyle = s._color;
      ctx.beginPath();
      ctx.arc(s.xx + cx, s.yy + cy, HEAD_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function hudText() {
    hud.textContent =
      'sandbox v0.1  |  drag mouse to steer (or set window.xm/window.ym from bot)\n' +
      'snake.xx=' + player.xx.toFixed(0) + ' yy=' + player.yy.toFixed(0) +
      ' ang=' + player.ang.toFixed(2) + ' sct=' + player.sct +
      ' parts=' + player.pts.length + '\n' +
      'snakes=' + snakes.length + ' foods=' + foods.length +
      '  xm=' + window.xm.toFixed(0) + ' ym=' + window.ym.toFixed(0);
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(3, (now - last) / 16.6);
    last = now;
    for (const s of snakes) stepSnake(s, dt);
    for (const s of snakes) eatFood(s);
    render();
    hudText();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
