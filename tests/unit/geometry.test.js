// Unit tests for src/lib/geometry.js. Run with `npm run test:unit`.
// Node's built-in test runner; no test framework dependency.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TAU,
  firstHitTime,
  firstHitCapsuleTime,
  angleBetween,
  blendAngles,
  bucketOf,
  bucketAngle,
  bucketDelta,
  findOpenRuns,
} = require('../../src/lib/geometry');

// ---- firstHitTime ----------------------------------------------------------
// Quadratic intersection: when does the squared distance between two
// circle centers, starting at (dx, dy) with relative velocity (vrx, vry),
// first equal safeR2? Tests the four early-exit branches plus the math.

test('firstHitTime: already inside safe radius returns 0', () => {
  // Centers at distance 5, safe radius 10 (safeR2 = 100). Already too close.
  assert.equal(firstHitTime(3, 4, 0, 0, 100), 0);
  assert.equal(firstHitTime(0, 0, 1, 1, 100), 0); // exactly at center
});

test('firstHitTime: no relative motion returns Infinity', () => {
  assert.equal(firstHitTime(100, 0, 0, 0, 1), Infinity);
});

test('firstHitTime: moving apart returns Infinity', () => {
  // At (100, 0), moving in +x direction. Squared distance grows.
  assert.equal(firstHitTime(100, 0, 1, 0, 1), Infinity);
  // At (100, 0), moving at (1, 0) — dot product with (dx, dy) is 100 > 0.
});

test('firstHitTime: head-on collision matches closed-form solution', () => {
  // At (100, 0), moving in -x at speed 1, safe radius 10.
  // Will be at (100 - t, 0). Squared distance = (100 - t)^2.
  // Equals 100 when 100 - t = 10, so t = 90.
  assert.equal(firstHitTime(100, 0, -1, 0, 100), 90);
});

test('firstHitTime: glancing pass that misses returns Infinity', () => {
  // Object at (0, 100), moving in +x at speed 1, safe radius 10.
  // Closest approach is at y=100, which exceeds the safe radius.
  // Discriminant should be negative.
  assert.equal(firstHitTime(0, 100, 1, 0, 100), Infinity);
});

test('firstHitTime: tangent path returns the tangent time', () => {
  // Object at (10, 100), moving in -y at speed 1, safe radius 10.
  // Closest approach: at t=100, position (10, 0), distance to origin = 10.
  // That's exactly tangent. Discriminant is 0.
  const t = firstHitTime(10, 100, 0, -1, 100);
  assert.equal(t, 100);
});

test('firstHitTime: oblique intersection', () => {
  // Object at (50, 50), moving at (-1, -1), safe radius sqrt(50) (safeR2 = 50).
  // Relative position along (-1,-1) direction: at time t, position is
  // (50 - t, 50 - t). Squared distance = 2*(50-t)^2 = 50 → 50-t = ±5 → t = 45 or 55.
  // First positive is 45.
  const t = firstHitTime(50, 50, -1, -1, 50);
  assert.equal(t, 45);
});

// ---- firstHitCapsuleTime ---------------------------------------------------
// A capsule is a line segment from P1 to P2 with surrounding radius rR.
// A moving point starts at the origin with velocity (vx, vy). Returns
// time of first contact with the capsule (0 if already inside, Infinity
// if no future hit).

test('firstHitCapsuleTime: degenerate (P1 == P2) falls back to disk', () => {
  // Capsule degenerates to a single point with radius 5.
  // Approaching from x=-100 at speed 1 in +x, P1 = P2 = (0, 0).
  // Should hit at t = 95 (95 units away, safe radius 5).
  const t = firstHitCapsuleTime(100, 0, 100, 0, 1, 0, 5);
  // We're at origin; obstacle disk at (100, 0); moving in +x at speed 1.
  // First contact when distance = 5: at x = 95. TTC = 95.
  assert.equal(t, 95);
});

test('firstHitCapsuleTime: already inside the capsule returns 0', () => {
  // Capsule from (-5, 0) to (5, 0), radius 2. Origin is at (0, 0).
  // Inside.
  const t = firstHitCapsuleTime(-5, 0, 5, 0, 0, 0, 2);
  assert.equal(t, 0);
});

test('firstHitCapsuleTime: hits the slab side, not an endpoint', () => {
  // Capsule from (10, 0) to (10, 10), radius 2. Origin at (0, 0).
  // Moving in +x at speed 1. The capsule is a vertical line segment;
  // hitting from the side. Contact when x = 10 - 2 = 8, at y = 0,
  // which is on the segment (y in [0, 10]). TTC = 8.
  const t = firstHitCapsuleTime(10, 0, 10, 10, 1, 0, 2);
  assert.equal(t, 8);
});

test('firstHitCapsuleTime: hits an endpoint disk when slab x is out of range', () => {
  // Capsule from (10, 5) to (10, 15), radius 2. Origin at (0, 0).
  // Moving in +x at speed 1. The slab is from y=5 to y=15; origin y=0
  // is below it. The bot will reach the endpoint at (10, 5) first.
  // Endpoint disk TTC: distance from (0,0) to (10,5) is sqrt(125),
  // moving in +x. First contact when distance from (10,5) = 2:
  // (10 - t)^2 + 25 = 4 → (10-t)^2 = -21 → no solution.
  // Actually we're too far below — y stays 0 forever; minimum distance
  // to disk center (10, 5) is 5, larger than radius 2. No hit.
  const t = firstHitCapsuleTime(10, 5, 10, 15, 1, 0, 2);
  assert.equal(t, Infinity);
});

test('firstHitCapsuleTime: moving away from capsule returns Infinity', () => {
  // Capsule from (10, 0) to (20, 0), radius 1. Origin at (0, 0).
  // Moving in -x (away). No future hit.
  const t = firstHitCapsuleTime(10, 0, 20, 0, -1, 0, 1);
  assert.equal(t, Infinity);
});

test('firstHitCapsuleTime: oblique approach through the side', () => {
  // Capsule from (0, 10) to (20, 10), horizontal segment at y=10,
  // radius 2. Origin at (0, 0). Moving at (1, 1) — diagonal up-right.
  // Velocity magnitude doesn't matter for the geometry; we want the
  // first y where the trajectory enters the slab (y = 10 - 2 = 8).
  // y(t) = t, so t = 8. At that moment x = 8, which is in [0, 20].
  // Should hit at t = 8.
  const t = firstHitCapsuleTime(0, 10, 20, 10, 1, 1, 2);
  assert.equal(t, 8);
});

test('firstHitCapsuleTime: slab and endpoint produce same TTC at the corner', () => {
  // Approach exactly at the endpoint such that slab and endpoint TTCs
  // agree. Capsule from (10, 0) to (10, 5), radius 2. Origin at (0, 0),
  // velocity (1, 0). Should hit at t = 8 via the slab side.
  const t = firstHitCapsuleTime(10, 0, 10, 5, 1, 0, 2);
  assert.equal(t, 8);
});

// ---- angleBetween ----------------------------------------------------------
// Returns the *signed* shortest rotation from a to b, in (-pi, pi].

test('angleBetween: same angle is 0', () => {
  assert.equal(angleBetween(1, 1), 0);
  assert.equal(angleBetween(0, 0), 0);
});

test('angleBetween: small positive rotation', () => {
  const d = angleBetween(0, 0.5);
  assert.ok(Math.abs(d - 0.5) < 1e-9);
});

test('angleBetween: wraparound short way', () => {
  // From 0.1 to 6.0 (just under 2pi). Short way is backward, ~-0.383.
  const d = angleBetween(0.1, 6.0);
  assert.ok(d < 0);
  assert.ok(Math.abs(d - (6.0 - 0.1 - TAU)) < 1e-9);
});

test('angleBetween: input angles outside [0, 2pi] still work', () => {
  // 5pi and pi are the same point modulo 2pi.
  const d = angleBetween(5 * Math.PI, Math.PI);
  assert.ok(Math.abs(d) < 1e-9);
});

// ---- blendAngles -----------------------------------------------------------

test('blendAngles: t=0 returns a', () => {
  assert.equal(blendAngles(1.2, 0.4, 0), 1.2);
});

test('blendAngles: t=1 returns b (along shortest path)', () => {
  const r = blendAngles(1.2, 0.4, 1);
  assert.ok(Math.abs(r - 0.4) < 1e-9);
});

test('blendAngles: t=0.5 is the midpoint along shortest path', () => {
  // From 0 to pi/2, midpoint is pi/4.
  const r = blendAngles(0, Math.PI / 2, 0.5);
  assert.ok(Math.abs(r - Math.PI / 4) < 1e-9);
});

// ---- bucketOf / bucketAngle / bucketDelta ----------------------------------

test('bucketOf: angle 0 falls in bucket 0', () => {
  assert.equal(bucketOf(0, 16), 0);
});

test('bucketOf: 2pi wraps to bucket 0', () => {
  assert.equal(bucketOf(TAU, 16), 0);
});

test('bucketOf: negative angle wraps correctly', () => {
  // -pi/16 lies in the second half of bucket 15 (which covers [15pi/8, 2pi)).
  // Note: -pi/8 is the *boundary* between buckets 14 and 15 and is float-
  // unstable, so test with a value clearly inside bucket 15.
  assert.equal(bucketOf(-Math.PI / 16, 16), 15);
});

test('bucketOf: angle pi/8 (half a bucket) is in bucket 0', () => {
  // Bucket width is 2pi/16 = pi/8. Angles in [0, pi/8) are bucket 0.
  assert.equal(bucketOf(Math.PI / 16, 16), 0);
});

test('bucketAngle: returns bucket center, not edge', () => {
  // Bucket 0 spans [0, pi/8). Center is pi/16.
  assert.equal(bucketAngle(0, 16), Math.PI / 16);
});

test('bucketAngle and bucketOf are mutual inverses at centers', () => {
  for (let i = 0; i < 16; i++) {
    const a = bucketAngle(i, 16);
    assert.equal(bucketOf(a, 16), i, `bucket ${i} centered at ${a}`);
  }
});

test('bucketDelta: same bucket is 0', () => {
  assert.equal(bucketDelta(5, 5, 16), 0);
});

test('bucketDelta: respects wraparound', () => {
  // Bucket 1 and bucket 15 in a 16-bucket map are 2 apart, not 14.
  assert.equal(bucketDelta(1, 15, 16), 2);
});

test('bucketDelta: opposite sides equals n/2', () => {
  assert.equal(bucketDelta(0, 8, 16), 8);
});

// ---- findOpenRuns ----------------------------------------------------------
// Maximal contiguous runs of true in a circular boolean array. The order
// of runs in the output doesn't matter to the bot's picker, but the
// content does.

function runsByStart(arr) {
  return [...arr].sort((a, b) => a.start - b.start);
}

test('findOpenRuns: all safe is one run covering the whole circle', () => {
  const r = findOpenRuns([true, true, true, true]);
  assert.deepEqual(r, [{ start: 0, length: 4 }]);
});

test('findOpenRuns: all unsafe is no runs', () => {
  const r = findOpenRuns([false, false, false, false]);
  assert.deepEqual(r, []);
});

test('findOpenRuns: single contiguous run', () => {
  // 4 safe in the middle of 8 unsafe.
  const safe = [false, false, true, true, true, true, false, false];
  const runs = findOpenRuns(safe);
  assert.deepEqual(runsByStart(runs), [{ start: 2, length: 4 }]);
});

test('findOpenRuns: wraparound run', () => {
  // Safe at the end and start; unsafe in the middle.
  const safe = [true, true, false, false, false, false, true, true];
  const runs = findOpenRuns(safe);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].length, 4);
  // The run spans indices 6, 7, 0, 1. Start is wherever the impl chose to
  // anchor; what matters is the total length and that we get exactly one run.
});

test('findOpenRuns: multiple disjoint runs', () => {
  // Two runs of 2, separated by unsafe.
  const safe = [true, true, false, false, true, true, false, false];
  const runs = findOpenRuns(safe);
  assert.equal(runs.length, 2);
  for (const r of runs) assert.equal(r.length, 2);
});

test('findOpenRuns: alternating produces n/2 runs of length 1', () => {
  const safe = [true, false, true, false, true, false, true, false];
  const runs = findOpenRuns(safe);
  assert.equal(runs.length, 4);
  for (const r of runs) assert.equal(r.length, 1);
});

test('findOpenRuns: single safe bucket', () => {
  const safe = [false, false, true, false];
  const runs = findOpenRuns(safe);
  assert.deepEqual(runsByStart(runs), [{ start: 2, length: 1 }]);
});
