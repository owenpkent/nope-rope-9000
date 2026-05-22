// Pure geometric helpers used by the bot. Extracted so they can be
// unit-tested independently of the Tampermonkey IIFE in bot.user.js.
//
// IMPORTANT: these functions are also defined inside the IIFE in
// src/bot.user.js (for runtime use as a userscript without a build step).
// The two copies must stay byte-identical (function body, not formatting).
// tests/unit/sync-check.test.js verifies this; if it fails after you
// change one copy, update the other.
//
// Keep these *truly pure*: no closure on CFG, no DOM access, no globals.
// Functions that depend on CFG or window state belong in bot.user.js only.

'use strict';

const TAU = Math.PI * 2;

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
// capsule defined as a line segment from P1 to P2 with surrounding
// radius rR (the swept disk along the segment). All inputs are in the
// moving point's local frame: P1 and P2 are obstacle positions relative
// to the moving point's current position.
//
// Returns 0 if already inside the capsule, Infinity if no future hit.
// The TTC is min(slab TTC, endpoint disk TTCs); the slab TTC is valid
// only when the contact point's projection lies within [0, L].
//
// This is the principled replacement for treating each body segment as
// an isolated point obstacle: it covers the continuous body tube
// between consecutive segment samples.
function firstHitCapsuleTime(p1x, p1y, p2x, p2y, vx, vy, rR) {
  const rR2 = rR * rR;
  const Lx = p2x - p1x;
  const Ly = p2y - p1y;
  const L2 = Lx * Lx + Ly * Ly;
  // Degenerate capsule (zero length): fall through to point disk TTC.
  if (L2 < 1e-9) {
    return firstHitTime(p1x, p1y, -vx, -vy, rR2);
  }
  // Initial-inside check: closest point on segment to origin.
  const t0 = ((-p1x) * Lx + (-p1y) * Ly) / L2;
  const ct = t0 < 0 ? 0 : (t0 > 1 ? 1 : t0);
  const cx = p1x + ct * Lx;
  const cy = p1y + ct * Ly;
  if (cx * cx + cy * cy <= rR2) return 0;

  // Endpoint disks.
  const tP1 = firstHitTime(p1x, p1y, -vx, -vy, rR2);
  const tP2 = firstHitTime(p2x, p2y, -vx, -vy, rR2);
  let best = tP1 < tP2 ? tP1 : tP2;

  // Slab between the two long sides of the capsule. Rotate into capsule
  // frame (D along p1->p2, N perpendicular). We hit the slab when |y|
  // first crosses rR moving inward AND x at that moment is in [0, L].
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

module.exports = {
  TAU,
  firstHitTime,
  firstHitCapsuleTime,
  angleBetween,
  blendAngles,
  bucketOf,
  bucketAngle,
  bucketDelta,
  findOpenRuns,
};
