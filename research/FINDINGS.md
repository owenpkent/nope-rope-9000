# Distilled findings

Ranked list of techniques and ideas mined from sources in [`sources.md`](./sources.md). Each entry follows the structure in [`distill-template.md`](./distill-template.md). Status legend: `idea` (recorded only), `prototype` (code exists on a branch), `landed` (in `main` and CFG-tunable), `rejected` (tried or argued out, with reason).

Ordering is by expected impact per unit of effort, ties broken by lowest risk of regression. The list is reordered freely as evidence accumulates; per-entry status and date tracks history.

## Pipeline pass 1 (2026-05-22)

Seven parallel agents across two rounds: j-c-m/Slither.io-bot, robotics planners (VO/ORCA/DWA/Dubins), agar.io ecosystem, ClitherProject slither protocol, plus a second wave on BlueCannonBall (confirmed dead), kill-targeting heuristics across public bots, and RL reward/observation design in published slither agents.

### Landed in v0.6.2 (2026-05-22)

- Finding 1 (DevTools probe) shipped as `nr9k.probe()` plus auto-fire on first toggle-bot-on per game.
- Finding 2 (DWA weighted safety score) shipped with default weights `wMean = 0, wCritical = 0` preserving v0.6.1 min-TTC-only behavior. Weight sweep pending.
- Per-segment tangent body velocity (CRITIQUE item 5 revision, not a numbered finding above) shipped as the principled fix to the head-velocity body model that produced visible "dodge into the bigger snake's body" deaths.

---

## 1. DevTools probe of `window.slither` / `window.slithers` keys

- **Source**: [ClitherProject/Slither.io-Protocol](https://github.com/ClitherProject/Slither.io-Protocol/blob/master/Protocol.md). Field names: `sp` (speed), `wang` (wanted angle), `ehang` (eye-heading), `tsp` (target speed).
- **Mechanism**: Five-minute probe in DevTools during a live game. Run `console.log(Object.keys(window.slither))` and `console.log(Object.keys(window.slithers[1] || {}))`. Diff against the protocol field list. Confirms whether the modern minified build still exposes server-truth speed and intent fields, or whether they have been renamed/dropped.
- **Failure mode addressed**: Every Part 1 protocol finding below is gated on this probe. Until it runs, server-truth speed (`sp`) and wanted-angle (`wang`) integrations are speculative.
- **Applicability**: Yes, trivially.
- **Estimated effort**: 5 minutes manual; automated as `nr9k.probe()` plus an auto-fire on the first tick the bot sees enemies in a live game.
- **Expected impact**: high (gates other high-value findings).
- **Risks**: none.
- **Status**: landed (2026-05-22, v0.6.2). [src/bot.user.js probe()](../src/bot.user.js). Output dumps to console.log as `[nope-rope-9000] probe: {...}` so `npm run play` logs capture it automatically.

## 2. DWA-style weighted multi-statistic safety score

- **Source**: Dynamic Window Approach ([Wikipedia](https://en.wikipedia.org/wiki/Dynamic_window_approach)). Closest robotics analog to our picker shape. Cross-confirmed by RL research (finding 14): no published RL agent has a continuous-risk term, so this is genuinely novel.
- **Mechanism**: Replaced `safety = min(TTC over obstacles)` with `safety = wMin * minTTC + wMean * meanTTC - wCritical * count(TTC < dangerThreshold)`. The count term captures the "shape of the danger field" that min-TTC throws away. Per-candidate substep loop now tracks per-obstacle TTC (allocated once, reused) instead of breaking on first collision; aggregations are computed after the substep loop. Defaults: `wMin = 1.0`, `wMean = 0.0`, `wCritical = 0.0`, `dangerThreshold = 0.3s`, so v0.6.1 behavior is exactly preserved out of the box. Flipping wMean and wCritical to non-zero enables the danger-shape sensitivity.
- **Failure mode addressed**: CRITIQUE item 4 (min-TTC throws away danger shape). Bimodal deaths where the picker walks into a heading with one obstacle near TTC=1.1 and dozens more behind it because min-TTC sees it the same as a heading with one obstacle at TTC=1.1 alone.
- **Applicability**: Direct.
- **Estimated effort**: landed as ~50 LoC restructure of pass 1 in `pickHeadingTTC`. Plus 4 CFG knobs (`safetyWeightMin`, `safetyWeightMean`, `safetyWeightCritical`, `safetyDangerThreshold`). Compatible with the lexicographic food-band tiebreak; band is now in score-units which equal seconds when only wMin is non-zero.
- **Expected impact**: medium on median, high on duration variance once weights are tuned. Default weights preserve current behavior so the v0.6.2 baseline doesn't shift; the win materializes when we sweep weights.
- **Risks**: weight tuning. Recommend starting with `wMean = 0.3, wCritical = 0.2` as a first sweep point. n=15 batches per weight setting; could blow a half-day. The safe rollout (wMean=0, wCritical=0 default) means a bad sweep doesn't break the baseline.
- **Status**: landed (2026-05-22, v0.6.2). Weight sweeps pending. [src/bot.user.js pickHeadingTTC](../src/bot.user.js).

## 3. Encirclement detector

- **Source**: j-c-m/Slither.io-bot `checkEncircle()` (lines 856-925); independently re-derived in agar.io bot folklore as "coordinated-team detection."
- **Mechanism**: Bin all visible enemy bodies into 16 angle buckets around the head. Trigger emergency state if (a) any single enemy fills more than 9 of 16 buckets, or (b) more than N total buckets are filled within radius 20 * snakeRadius. When triggered, override the picker: steer to the midpoint of the largest open arc and boost.
- **Failure mode addressed**: Slow-closing pincers that no single-frame TTC threshold ever trips. Our picker reasons locally per-candidate; encirclement is a global topology fact.
- **Applicability**: Direct. We already compute nearest body points per enemy. Adds an angle-coverage pass and a "widest open arc" picker as the fallback heading source when triggered.
- **Estimated effort**: ~60 LoC plus 3 CFG knobs (`enCircleSingleThreshold`, `enCircleAllThreshold`, `enCircleDistanceMult`). New top-level branch in `tick()` that gates the normal picker.
- **Expected impact**: medium on duration (mid/late game), high on variance (kills the "boxed in" deaths that drop the bimodal tail).
- **Risks**: false positives near the wall (j-c-m treats the wall as a fake snake id with threshold-counted buckets; we'd want the same). Picker fallback is widest-gap which ignores TTC entirely; correct when surrounded but bad if mis-triggered.
- **Status**: idea (2026-05-22).

## 4. Replace curving-ghost ladder with closed-form leading-offset disk

- **Source**: j-c-m/Slither.io-bot lines 707-713 (enemy head leading-offset). Borrowed from agar threat-circle scaling.
- **Mechanism**: Per enemy head, compute one shifted disk at `enemy.xx + cos(enemy.ang) * sRadius * min(1, sp/5.78 - 1) * radiusMult / 2`. The shift inflates only for boosting enemies (sp > base). Replaces our 96-dot curving-ghost cloud with one analytical projection per enemy.
- **Failure mode addressed**: CRITIQUE item 7 (curving-ghost ladder is unprincipled, density-driven, washes out picker decisions). Our current 12-ghosts-per-fast-enemy ladder creates the "ghost wall" effect.
- **Applicability**: Direct, modulo confirming `sp` is exposed (gated on finding 1). If not, finite-difference speed works as a degraded substitute.
- **Estimated effort**: ~10 LoC swap. Deletes the curving-ghost loop in `buildNearbyObstacles`. Adds one new "leading-offset enemy head" obstacle per visible enemy.
- **Expected impact**: medium on median, medium on compute budget (recovers ~96 obstacle checks per tick).
- **Risks**: under-projects threats from enemies in tight turns (j-c-m's formula is linear). Mitigation: keep one or two curving-ghost samples for enemies whose `|ang - ang_lastTick|` is large, drop the rest.
- **Status**: idea (2026-05-22). Removing the curving-ghost ladder is a v0.6.0 reversal; need to verify on n=15 before committing.

## 5. Side-circle food exclusion

- **Source**: j-c-m/Slither.io-bot `computeFoodGoal` (lines 1438-1451) plus side-circle construction at 1550-1568.
- **Mechanism**: Two circles of radius `snakeWidth * speedMult` are placed perpendicular to the head, centered offset by `snakeWidth` along the neck normal. Any food intersecting either disk is excluded from food bucketing. Prevents the bot chasing food it would have to cut hard across its own neck to grab; at boost speed the bot cannot turn tight enough and clips its own neck.
- **Failure mode addressed**: Grazing self-kill when food sits 90 degrees off heading just behind the head.
- **Applicability**: Direct. We have head pos, ang, sct -> radius. We don't track `lnp` (last neck point) but `pts[0]` or last-frame `xx,yy` is equivalent.
- **Estimated effort**: ~25 LoC plus 1 CFG knob. Pure filter on the food pool before bucketing in `buildFoodBuckets`.
- **Expected impact**: low to medium on median (some short-death runs are grazing kills), low on variance.
- **Risks**: at cruise speed, disk radius `speedMult * snakeWidth` discards close legitimate food. Scale by `max(1, speedMult)` to keep cruise behavior unchanged.
- **Status**: idea (2026-05-22).

## 6. Wall-perpendicular escape

- **Source**: Apostolique/Agar.io-bot issues #7 and #17.
- **Mechanism**: Treat the map boundary as an infinite-radius threat. When inside `wallBuffer` of the wall, project all candidate headings onto the wall tangent and bias scoring toward the inward-tangent component instead of the head-toward-center pull we currently use.
- **Failure mode addressed**: Being herded into the world circle. Our v0.6.1 `applyWallSteering` does a linear blend toward the map center, which can fight the picker's choice and produce a heading the picker never evaluated.
- **Applicability**: Direct. The wall enters the picker as just another obstacle type with `safeR = mapRadius - head_radius` to the world-circle origin.
- **Estimated effort**: ~30 LoC. Replaces `applyWallSteering`. Adds the world-circle as a synthetic moving obstacle (radius = mapRadius, velocity = 0, position = world center, sign flipped so closer-to-center = safer).
- **Expected impact**: low to medium on duration (rarely hit the wall in early game).
- **Risks**: Wall-as-obstacle math is sign-tricky. Confirm with an offline unit test before wiring into the picker.
- **Status**: idea (2026-05-22).

## 7. Sector-box body-segment culling

- **Source**: j-c-m/Slither.io-bot lines 729-735, 1521-1525. Reads `window.sectors` and `window.sector_size`.
- **Mechanism**: Skip body segments outside a square box centered on the head of side `sqrt(sectors.length) * sector_size`. Slither already exposes the sector grid; this is a free O(1) per-segment early-out before the per-candidate TTC inner loop.
- **Failure mode addressed**: 60 Hz compute budget. With 8 enemies at 30-100 segments each we evaluate 240-800 body obstacles per candidate, 32 candidates per tick. Most are far enough away to be irrelevant.
- **Applicability**: Direct, gated on `window.sectors` existing in the modern build (high-confidence; add to the probe in finding 1).
- **Estimated effort**: ~5 LoC in `buildNearbyObstacles`.
- **Expected impact**: low on quality, medium on headroom (frees compute we can spend on items 2 and 3).
- **Risks**: none material.
- **Status**: idea (2026-05-22).

## 8. Inflated head circle with boost-forward bias

- **Source**: j-c-m/Slither.io-bot lines 1537-1543.
- **Mechanism**: Hazard radius around enemy heads is `5 * snakeRadius`, not the head radius itself. The center is offset forward by `min(1, speedMult - 1) * radiusMult / 2 * snakeRadius`, so boosting enemies have their danger sphere extended ahead of their actual head.
- **Failure mode addressed**: Pure-geometry head-on-head deaths where the picker thinks it can squeeze past an oncoming boosting enemy because TTC against a tight head disk says clear at the last sample.
- **Applicability**: Direct. Already the structure of our enemy-head obstacle, just under-sized.
- **Estimated effort**: ~5 LoC. Inflate the `safeR2` for enemy heads in `buildNearbyObstacles`; bias the head position forward when speed exceeds base.
- **Expected impact**: medium on duration variance (head-on deaths are concentrated in the short-tail).
- **Risks**: too aggressive, picker over-avoids head-ons and pays survival cost in other directions. Tune `radiusMult` on the harness.
- **Status**: idea (2026-05-22).

## 9. Boost-when-fleeing-from-boosting-enemy

- **Source**: j-c-m/Slither.io-bot line 842.
- **Mechanism**: While the picker is dodging (TTC below threshold) AND the highest-threat obstacle is a boosting enemy head, boost in the dodge direction. Asymmetric reaction: don't initiate, but match aggression.
- **Failure mode addressed**: Boost-cut deaths. A boosting enemy traverses ~2x the distance per frame; our cruise-speed dodge can't outrun them.
- **Applicability**: Direct, gated on knowing enemy `sp` (finding 1).
- **Estimated effort**: ~10 LoC plus 1 CFG knob (`fearBoostSpThreshold`).
- **Expected impact**: medium on duration variance.
- **Risks**: burns length on every false alarm. The gate has to be tight.
- **Status**: idea (2026-05-22).

## 10. Action-cadence hysteresis (commit to dodge headings)

- **Source**: j-c-m/Slither.io-bot knobs `actionFrames: 2` (re-target every 2 frames) and `collisionDelay: 10` (under dodge, re-target every 10 frames).
- **Mechanism**: When the picker emits a heading that's a large delta from the last (i.e., we're committing to a dodge), freeze the picker output for N frames and only allow override on a sharp TTC drop. Below that, the inertia term in our existing tiebreak band is a small bias; a dodge commit is a hard hysteresis.
- **Failure mode addressed**: Picker chatter mid-dodge. Our current inertia term is small enough to be overridden by tiny TTC differences; this means we sometimes flinch out of a committed dodge.
- **Applicability**: Direct. Wrap the picker output in a "if last dodge committed N frames ago and TTC has not dropped > delta, return last heading" check.
- **Estimated effort**: ~15 LoC plus 2 CFG knobs.
- **Expected impact**: low to medium on variance. Marginal on its own; layers cleanly with item 8 (committed head-on dodges).
- **Risks**: locking into a stale dodge after the threat moves. Override condition is load-bearing.
- **Status**: idea (2026-05-22).

## 11. Lead-the-target boost-cut kill primitive

- **Source**: agar.io standard split-targeting heuristic. Documented across Apostolique, junxiaosong, ogario.
- **Mechanism**: For each enemy whose heading variance over the last ~10 frames is low (predictable), compute lead point `enemy.xx + enemy.vx * t_cut, enemy.yy + enemy.vy * t_cut` where `t_cut` is the time our boosted head reaches the perpendicular intercept of their predicted path. Fire only if our boost reserve (length) survives `t_cut + safety_margin` AND our TTC against every other obstacle remains above survival floor during the cut.
- **Failure mode addressed**: Zero kills in 15 games. Today the bot has no offensive primitive.
- **Applicability**: Requires per-enemy heading-variance estimate (cheap; we already track velocity), boost duration model, and a per-candidate TTC re-check during the cut. The TTC machinery is in place; the rest is glue.
- **Estimated effort**: ~80 LoC plus 3-4 CFG knobs (`leadHeadingVarianceMax`, `leadMinBoostReserve`, `leadSafetyFloor`, `leadAngleWindow`). New entry point in `tick()` that proposes a kill heading and competes with the survive picker on score.
- **Expected impact**: medium on kills (currently 0). Low on median peakLength until the kill rate is high enough to materially increase corpse-pile encounters.
- **Risks**: a kill that fails is usually a death. The gating needs n=15 validation before each tuning change. Highest risk item in this batch.
- **Status**: idea (2026-05-22). Sequence after items 1-3 land and survival stabilizes.

## 12. Stuck-on-food blacklist

- **Source**: ermiyaeskandary/Slither.io-bot. Documented in their README and the NickBusey writeup.
- **Mechanism**: Track current food target. If it has been the same target for more than N frames AND head distance to it has not decreased monotonically, blacklist that food for M seconds.
- **Failure mode addressed**: At length > 150 the turn rate cannot catch tight food; the bot winds around it indefinitely.
- **Applicability**: Direct. Need to expose the current food target to the picker state (already in `currentRun.lastSnapshot.foodTargetXY`).
- **Estimated effort**: ~20 LoC plus 2 CFG knobs.
- **Expected impact**: low.
- **Risks**: none material; conservative timeout (~M = 2s) keeps the blacklist sparse.
- **Status**: idea (2026-05-22).

## 13. Cluster-value food selection with boost trigger

- **Source**: Apostolique/Agar.io-bot wiki: Algorithms. Mirrored as `addFoodAngle` / `foodAccelSz = 200` in j-c-m.
- **Mechanism**: Group nearby food into clusters (mean position, sum size). Rank by `value / distance^k`. Below a size threshold, walk; above it, boost. Reframes the food problem from "pick the best bucket" to "score clusters then boost-or-walk."
- **Failure mode addressed**: Memory note "food bucket weighting local optimum". Bucket scoring captures angular density but conflates two things: where the food is, and how big the cluster is.
- **Applicability**: Direct. Adds a clustering pass before the bucket map; output feeds both the food-target picker and the boost gate.
- **Estimated effort**: ~50 LoC plus 2-3 CFG knobs.
- **Expected impact**: low to medium on median (the current bucket scoring already handles most cases reasonably).
- **Risks**: clustering is brittle near corpse piles. Validate on the harness.
- **Status**: idea (2026-05-22).

## 14. RL reward designs validate the lexicographic structure (and the DWA safety idea)

- **Source**: Synthesis of BabakAkbari/Slither.io-AI, JuiHsiu/Slither-DRL, zachabarnes/slither-rl-agent, Caudill Cal Poly thesis. See [research/sources.md](./sources.md).
- **Mechanism**: All four published RL projects use a near-identical reward function: `r = delta_length_this_step` with a one-time death penalty (range -10 to -50 across sources). No published source penalizes boost, rewards kills, uses rank/leaderboard, or rewards rate-of-length-gain over instantaneous gain. zach's observation-space `features` mode uses only 5 scalars: own-area, free-space-frac, food-frac, min-enemy-dist, min-food-dist. JuiHsiu-DQN is the only source with anything resembling a continuous-risk term: it retroactively stamps `-10` on the last 30 transitions before death, as a credit-assignment hack.
- **Implications for our heuristic bot**:
  - Our lexicographic max-TTC structure (TTC absolutely beats food; food beats inertia) implicitly treats death as infinite cost, which is *strictly stronger* than any of these RL papers' hand-tuned penalties (-10 to -50 against +1 per food).
  - **Nobody penalizes boost.** Our boost gate is opportunistic; this confirms we don't need to add a length-cost penalty to it.
  - **Nobody uses kills as reward.** With our 0 kills/15 we are in line with all published RL work. This is not by itself a problem to solve; do not promote kill-bonuses to a primary objective.
  - **The DWA continuous-risk term is novel.** No published RL agent has a clean continuous-risk feature in observation or reward. JuiHsiu-DQN's retroactive-stamp hack is weak evidence in favor of the idea but is not equivalent. Our DWA safety score (finding 2) is the strongest implementation of this concept in any public slither agent.
  - The 5-feature symbolic template (zach) is the prior art for any future learned component. Our heuristic picker already computes richer state than this. If we ever bridge to RL, the 5 features are the minimum observation space to start with.
- **Failure mode addressed**: None directly. This is calibration: it tells us which DESIGN choices to NOT make based on published evidence.
- **Applicability**: meta. Affects what we don't do.
- **Status**: idea / cross-reference (2026-05-22). Acts as the "do not pursue" signal for findings that the RL literature evidence argues against: per-kill rewards, boost-cost penalties, rank-driven steering.

## 15. Lateral-cut kill primitive (synthesized, no public bot has it)

- **Source**: Synthesized from the kill-targeting research. nkalupahana is purely defensive ("anti-social" is meaningless marketing). NickBusey's Kamikaze is the only public offensive code in any slither bot and it's a head-rammer that loses every engagement.
- **Mechanism**: After the lexicographic safety pick, scan enemies with `pts.length < my pts.length * 0.7` (smaller; in any head-on, the bigger snake's body wins). For each candidate enemy, compute the perpendicular distance from my heading-line to the enemy's predicted head position (`enemy.xx + enemy.vx * lookahead, enemy.yy + enemy.vy * lookahead`). If the perpendicular distance is less than `snakeWidth * 1.5` AND the time-to-intersect is strictly less than the safe-TTC the v0.6.2 picker returned for the safety pick, promote the cut heading and call `setAcceleration(1)`. Abort if any of: TTC against any obstacle drops below the picker's survive floor, enemy `ang` changes by more than 0.4 rad (they noticed), or our `fam` is too low to boost without crossing the kill-threshold ratio.
- **Failure mode addressed**: Zero kills per 15 games. We have no offensive primitive at all.
- **Applicability**: Direct. All the math is already in `velocities` (finite-difference vx/vy per enemy) plus the picker's TTC machinery. The lateral-cut just runs the picker a second time with a different target.
- **Estimated effort**: ~80 LoC plus 4 CFG knobs (`killMinLengthRatio = 0.7`, `killLeadSeconds`, `killAbortAngleDelta = 0.4`, `killMinFamRatio`). New code path that competes with the safety pick on score; safety always wins on disagreement.
- **Expected impact**: medium on kills/15 (expect 1 to 3). Low to neutral on median peakLength (kills produce corpse piles, but the boost-cost subtracts some length). The abort condition is the same safety floor that governs survival, so worst case degrades to current behavior.
- **Risks**: a failed cut is usually a death. The abort gating is load-bearing. Cross-confirmed by RL research (finding 14): kills are not a useful primary objective; this is for showmanship/corpse-pile-creation, not for moving the median.
- **Status**: idea (2026-05-22). Sequence after weights for finding 2 are tuned and survival is stable.

## Rejected / parked

### Velocity Obstacles (VO) as hard infeasibility
Parked. The cone-as-soft-penalty form is subsumed by finding 2 (DWA weighted score), which is cheaper to implement and captures the multi-obstacle composition insight without new geometry.

### ORCA / RVO (reciprocal collision avoidance)
Rejected for now. Reciprocity assumption is fundamentally violated by slither enemies. The asymmetric variant (HRVO) is technically adaptable but requires an LP solver and a full picker rewrite. Revisit if min-TTC plateaus after items 2 and 3 land.

### Dubins paths
Rejected. Solves go-from-pose-A-to-pose-B optimally; we have a reactive collision-avoidance problem. The kinematics fit, but the problem doesn't.

### Self-tail-following at L5000+
Parked. j-c-m's `followCircleSelf` is ~250 LoC and a full second picker. The bot doesn't reach length 5000 today (current median: 170). Reconsider when the median crosses ~1000 and lategame survival becomes the bottleneck. Also: the function reads slither fields (`lnp`, `fx`, `fy`) that may not exist on the modern build; would need a probe first.

### Trick-split / boost-feint baiting
Rejected for now. Translates to slither only loosely (no discrete split, only continuous boost-with-length-cost). Requires per-enemy intent tracking we don't have. Marginal expected impact for the effort.

### BlueCannonBall/Slither.io-ML-Bot ("ML" claim)
Rejected (2026-05-22). The "ML" label is marketing. Total diff vs. its parent (ermiyaeskandary 2016) is 102 lines: a broken `newDna()` function that resamples `bot.opt.*` to uniform-random values every 15 mass units with no fitness function, no selection, no persistence (`pastDna` is declared and never appended to). The `ml5.js` integration was added and removed the same afternoon. There is no model file, no Python, no training loop. Anything in this fork that's useful is also in j-c-m, and j-c-m has four more years of real work on it.

### nkalupahana/slither.io-bot ("anti-social")
Rejected (2026-05-22). 84-line file. The entire "anti-social" behavior is `if (closestEnemyBody < 550) steer_away_from(closest_enemy_pt)`. The boost block is literally commented out. Strictly worse than v0.6.2.

### NickBusey Kamikaze
Rejected for porting (2026-05-22), but useful as a negative baseline. Naive "L1-distance to nearest enemy head, steer at it, no boost, no abort" loses 100% of head-to-heads. Confirms that any offensive primitive needs prediction, length-comparison, and abort logic (see finding 15).

## Sequencing recommendation

Updated 2026-05-22 with v0.6.2 landed.

Done:
- Finding 1 (DevTools probe) — landed as `nr9k.probe()` + auto-fire.
- Finding 2 (DWA weighted safety) — landed with defaults preserving v0.6.1 behavior. Weight sweep pending.

Next:
1. **Sweep DWA weights.** n=15 batches at `(wMean, wCritical)` combos like `(0.3, 0)`, `(0, 0.2)`, `(0.3, 0.2)` and `(0.5, 0.4)`. This is the test that turns finding 2 into actual median improvement.
2. **Finding 3 (Encirclement detector).** Targets the bimodal short-death tail.
3. **Finding 4 (Closed-form head leading-offset disk).** Replace the 96-dot curving-ghost ladder with one analytical disk per enemy. Recovers compute that the DWA aggregations and the encirclement detector will spend.
4. **Finding 5 (Side-circle food exclusion)** + **Finding 8 (Inflated head circle)** + **Finding 7 (Sector-box cull)** as a single small PR.
5. **Finding 6 (Wall as obstacle)** if wall deaths show up in n=15 lastSnapshot data.
6. **Finding 15 (Lateral-cut kill primitive)** after survival is locked in. Or finding 11 (the agar-derived version) — both describe the same primitive, finding 15 is the more concrete synthesis. Treat them as one item.

The auto-probe from finding 1 will dump field info to the `npm run play` logs on the next batch; check those logs before doing finding 4 (the leading-offset disk needs `sp` exposed, and we now have a clean way to verify).
