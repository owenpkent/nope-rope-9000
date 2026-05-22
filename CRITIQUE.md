# Algorithm critique (2026-05-22)

First-principles tear-down of the steering algorithm as of v0.5.2. Recorded
here so the next set of changes can be evaluated against a written baseline
instead of remembered intent. The follow-up section at the bottom captures
which items have been acted on (v0.6.0) and which are still open.

## What the bot actually is

A pure obstacle-avoider with food as a tiebreaker. Each 5 ms tick:

- Build a flat obstacle list: enemy heads (linear-motion circles), body
  points (static), and 12 curving-ghost points per fast enemy.
- Sample 32 fixed headings evenly around 360 degrees. For each, simulate
  1.2 s of straight motion at our current speed against that flat list,
  take min-TTC.
- Pick max-TTC. Food angle breaks ties only when TTC is within 10 ms.

Everything else (16 buckets, 5 linear ghosts, food bucketing) is
decoration: only the bucket-builder's `collision[]` is reused, by the
boost gate.

## Major flaws

### 1. The planner is holonomic; the snake is not

The picker treats the action space as "pick any of 32 angles, teleport
velocity to it." A real slither head has a bounded turn rate (about
3 rad/s). If the picker chooses 270 degrees while you are heading 0,
the snake sweeps through 90 / 180 / etc. over ~0.5 s. Threats in the
sweep are not in the cost. This is the single biggest gap between the
model and the world, and it shows up exactly as the death pattern the
README calls out (bimodal outcomes: godlike or instant death) and the
"ghost wall" effect. Curving ghosts model enemy turns. The bot never
modeled its own.

### 2. Enemy bodies are static, but enemies are not

`buildNearbyObstacles` pushes every `pts[j]` with `ovx=0, ovy=0`. A
200 px/s enemy traveling for 1.2 s moves 240 units. Their body trails
them. So you are computing TTC against where the tail *was*, not where
the body *will be*. False positives (think there is a wall where the
tail will have moved away) and false negatives (think it is clear where
the head will drag the body through). Curving ghosts patch the head but
not the body.

### 3. Food is a tiebreaker, not a goal

`if (ttc > bestTTC + 0.01 || (|ttc - bestTTC| <= 0.01 && foodOffset < bestFoodOffset))`.
Food only influences the pick when TTC ties within 10 ms. With a
continuous obstacle field and 32 samples, that is almost never. So in
cluttered space (where food piles live, where score happens) the bot
is food-blind. The bucket map's `sz^2 / d` scoring picks corpse piles
correctly, but the steering layer ignores its output unless the field
is uniformly clear. Real-game behavior: tick 1 picks 90 degrees, tick
2 picks 110 degrees, they trade off, the snake never commits to any
food.

### 4. min-TTC throws away the shape of the danger

Heading A with one threat at TTC=1.1 s and 31 obstacles at TTC=5 s
scores the same as heading B with all 32 obstacles at TTC=1.1 s. B
is much more constrained (more directions become unsafe as you turn)
but the cost function cannot see it. You want a robustness margin:
integral of `1/TTC` along the path, count of obstacles below some
risk threshold, or at least the second-min as well as the first. The
bench history shows what this costs: `body-capsules` (geometrically
more correct than the point baseline) regressed by 6 s of median
duration, almost certainly because more-precise body coverage closes
more headings, and the picker has no way to grade headings beyond
min-TTC. It gets pushed into worse cells.

### 5. 200 Hz is theater

Slither's state updates at the network frame rate (~30 Hz physics).
Computing TTC at 200 Hz means re-evaluating the same input 6-7 times.
Worse, since there is no hysteresis or commitment to a heading,
micro-disagreements between near-identical inputs make xm/ym
oscillate, which burns turn-rate budget the snake does not have. A
30-60 Hz tick with an explicit "stick with last heading unless it
costs more than epsilon" rule would steer harder, not softer.

### 6. The boost gate is wired to the wrong signal

`clearance = min(buckets.collision[fb], buckets.headClearance[fb])`
checks the food's *bucket* (22.5 degrees wide, min-distance across the
whole arc), not clearance toward the food itself. Bucket's nearest
body point can be 22 degrees off the food angle and you will deny a
clear boost; equally, bucket's nearest obstacle can be in your face
just outside the bucket boundary and you will boost into it. The
picker already has `ttcByIndex`. Use the TTC at the sample nearest the
food angle.

### 7. Curving ghosts are a parameter sweep without a model

`[-3, -1.5, 1.5, 3]` rad/s x `[0.4, 0.8, 1.2]` s = 12 points per fast
enemy. Eight enemies = 96 static dots scattered around real enemies.
They are not weighted by likelihood; the picker treats a 3 rad/s curve
hypothesis with the same severity as the current heading. This is the
ghost wall effect: they sterilize huge swaths of angle space. It is
the reason `curve-ghosts` looked great at n=15 (it survived by sitting
still in the one clean lane) and the reason `body-capsules` regressed
on top of it (combined obstacle density tipped past usable).

### 8. estimateOwnSpeed underestimates when boosting

`estimateOwnSpeed` falls back to 200 px/s, and the velocity tracker
measures historic speed. When you initiate boost (~280 px/s), the
velocity history still has you at ~200 until boost stabilizes. The
reach budget is `myR + mySpeed * horizon + 100`. With mySpeed=200 and
horizon=1.2, that excludes obstacles past ~340 units while you are
actually traveling at ~336 u/sec. The first moments of boost are
blind to anything beyond ~340 units. Consistent with boost-cut deaths.

## Smaller issues

- **Food picker picks the brightest pellet in the best bucket**, not
  the centroid. Aiming at the edge of a corpse ribbon means swerving
  toward a pile instead of through it.
- **`findOpenRuns` and `pickHeadingFromBuckets` are dead code in the
  steering path** but still computed every tick for the overlay. Fine
  for debugging, but the tick path pays full cost.
- **11.25 degree sample spacing**: at horizon (240 u out), adjacent
  rays are ~47 u apart while a snake-pair safe radius is ~60 u.
  Tight legitimate gaps fall *between* samples and look blocked on
  both sides.
- **10 ms TTC epsilon plus strict min**: a heading that misses by
  10 ms looks the same as one that misses by 1.2 s. No continuous
  danger gradient.
- **Wall blending is post-hoc**. Heading is picked, then pulled toward
  center. The wall is not a TTC participant, so a heading that walks
  you into the wall can win TTC, get pulled inward, and end up at an
  angle the picker never evaluated.
- **`headHistory` keyed by object identity** is correct against
  slither's stable refs, but is GC-leak-shaped: enemies despawning out
  of view stick around until the next visible-snake update reaps them.

## Action plan (priority order)

The first three are batched into v0.6.0 (see below). Items 4 onwards
are open.

1. **Food as a cost, not a tiebreak.** `score = ttc - lambda * foodOffset`,
   tuned so a 10 degree offset costs ~50 ms of TTC. The bot should be
   willing to trade some safety for direction toward score.
2. **Model your own turn arc.** When evaluating heading theta, simulate
   a smooth turn from current heading to theta at ~3 rad/s, then
   forward motion. Drop teleport-to-heading entirely.
3. **Drop the tick to 60 Hz, add inertia.** Penalize `|theta - last_theta|`
   so the picker has to earn a course change. Fixes oscillation and
   frees compute for items 1-2.
4. **Replace min-TTC with a percentile or sum.** `risk = sum(exp(-ttc / tau))`
   is a clean continuous penalty that punishes corridors with many
   near-miss obstacles, not just the closest one.
5. **Make enemy bodies follow their heads.** Even a simple translate
   "body segment j moves with the head's velocity for the horizon"
   is closer to truth than zero.
6. Re-wire the boost gate to consult the food-direction TTC sample
   rather than the bucket clearance.
7. Prune the curving-ghost ladder, or weight ghosts by likelihood.

## Implemented in v0.6.0 (2026-05-22 follow-up)

### 1. Food as a tiebreak with a wide safety band (v0.6.1)

**First attempt (v0.6.0, since reverted):** continuous penalty
`score = ttc - foodWeight * foodOffset`. The picker traded TTC for
food alignment. Even with subsequent clamps (`foodOffsetCap = pi/3`,
`foodSafetyFloorS = 0.5`) the structure still let food shift the pick
across candidates with different TTC. The v0.6.0 n=15 batch produced
the highest median peakLength on record (170) but four runs died in
under 13 s, the signature of "food on the other side of an enemy"
deaths.

**Why that was wrong-headed:** slither has no starve mechanic. Length
is monotonic non-decreasing while alive (boost-cost aside). Food is
upside only. Trading any survivability for food is therefore strictly
worse in expectation than a strict survival-first policy. The right
shape was the one v0.5.2 had: food as a pure tiebreak. Its bug was
the 10 ms tie band, which almost never fired in practice.

**v0.6.1:** two-stage lexicographic. Pass 1 finds `maxTTC`. Pass 2
restricts to candidates with `ttc >= maxTTC - foodSafetyBandS` and
picks the one with the lowest `foodOffset + inertiaWeight * inertiaOffset`.
Food cannot pull the picker outside the band, so survival is never
traded for it. Default `foodSafetyBandS = 100 ms`, ten times the old
v0.5.2 band, enough that the tiebreak actually fires in open space
where many candidates share `maxTTC`.

Live-tunable via `nr9k.cfg.foodSafetyBandS`. Removed CFG keys:
`foodWeight`, `foodOffsetCap`, `foodSafetyFloorS`.

### 2. Own turn arc in the TTC sim

`pickHeadingTTC` now simulates a kinematic turn from the current
heading toward the candidate at `CFG.botTurnRate` rad/s, then linear
motion at the candidate heading. Position is integrated analytically
over the arc (closed-form sin/cos of accumulated heading). Substep
collision check at 50 ms intervals over the 1.2 s horizon, against
obstacles whose positions also evolve linearly with their tracked
velocities. Substep grid is 24 steps; at the new 60 Hz tick rate the
budget is well under one millisecond per tick.

Behavior change: a 180 degree reversal costs ~1 s of turning time,
during which the bot is moving on an arc through the obstacle field.
The TTC score for that candidate now reflects what is on the arc, not
just what is past it. Forward-ish headings are correspondingly cheaper.

### 3. 60 Hz tick and inertia tiebreak (v0.6.1)

`CFG.tickHz` dropped from 200 to 60. No responsiveness benefit was
being earned by faster than the network frame rate, and the resulting
oscillation was burning turn budget.

Inertia in v0.6.0 was a continuous cost on the global score; in
v0.6.1 it moved into the safety-band tiebreak alongside food (see
item 1). Functionally similar in clear space; correctly bounded by
survival in cluttered space. `CFG.inertiaWeight = 0.1` is the weight
of inertia relative to food offset within the band.

`lastChosenHeading` is reset on game start, game end, and bot toggle
off so a re-enable starts fresh.

### 5. Enemy body segments use per-segment tangent velocity (revised in v0.6.2)

**v0.6.0 first attempt:** body segments translated rigidly under the parent head's velocity. This was the "head velocity for the entire body" model and it had a visible failure mode in live play: against bigger snakes mid-turn, the picker predicted the body sweeping along with the head's new direction, but in reality the body lags the head's turn (the chain follows the path the head traced, not the head's instantaneous heading). The bot dodged the predicted head path into a body that didn't actually move out of the way.

**v0.6.2 fix:** each body segment moves toward the position of the segment ahead of it (or the head, for `pts[0]`) at the enemy's tracked speed. For a straight-moving snake this degenerates to head velocity (every segment's tangent points along the head's heading). For a curving snake, each segment's tangent points along the local body curve, so the body's predicted motion sweeps through its own path rather than the head's destination. One normalize per segment; cheap. Earlier `body-capsules` and `body-interp` attempts upgraded body *coverage* and both regressed; this upgrade is to body *motion*, which is the orthogonal axis.

## v0.6.1 (food as tiebreak, not continuous cost)

See item 1 above. v0.6.0's continuous food cost was wrong-headed. v0.6.1 reverted to a lexicographic picker: max safety wins absolutely, food and inertia tiebreak only within a 100 ms band of the max. Slither has no starve, so survival is never traded for food.

## v0.6.2 (DWA scoring framework, probe, overlay defaults, tangent body velocity)

- **DWA-style weighted safety score** replacing min-TTC as the safety scalar. Defaults preserve v0.6.1 behavior (`wMean = 0, wCritical = 0`); flipping the weights enables danger-shape sensitivity per item 4. Per-candidate substep loop tracks per-obstacle TTC and aggregates after, rather than breaking on the first collision.
- **`nr9k.probe()` helper** with auto-fire on the first toggle-bot-on per game. Logs which modern-build fields are exposed (`sp`, `wang`, `lnp`, etc.). Unblocks several findings that depend on knowing what's readable; see [research/FINDINGS.md](research/FINDINGS.md).
- **Per-segment tangent body velocity** (item 5 revision above).
- **Overlay default-on at `overlayScale = 0.5`.** Visible without smothering the canvas; H or `nr9k.overlay(false)` to hide.
- **Screenshot machinery removed** from the play harness. lastSnapshot fields in `realgame-results.json` already carry the death-frame data that was actually being used.

## Still open after v0.6.2

- **DWA weight sweep.** v0.6.2 ships the framework with default weights that preserve v0.6.1. The win lands when we sweep `(wMean, wCritical)` and find a config that materially shifts the median. n=25+ per setting, ideally. n=15 is at the noise floor: three batches of the same picker spanned medianPeakLength 126 to 299.
- Item 6: re-wire boost gate to consult the food-direction TTC sample instead of the food bucket's clearance.
- Item 7: prune or likelihood-weight the curving-ghost ladder.
- Open findings in [research/FINDINGS.md](research/FINDINGS.md): encirclement detector, closed-form leading-offset disk to replace curving ghosts, side-circle food exclusion, sector-box cull, lateral-cut kill primitive.
