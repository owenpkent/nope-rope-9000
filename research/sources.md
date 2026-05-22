# Source catalog

One row per source. Status legend: `pending` (not started), `in-progress` (agent dispatched), `done` (findings written), `dead` (URL gone or content not useful).

## Slither.io and adjacent-game bots

| Source | URL | Status | Last checked | Why |
| --- | --- | --- | --- | --- |
| j-c-m/Slither.io-bot (Championship Edition) | https://github.com/j-c-m/Slither.io-bot | done | 2026-05-22 | Project README flags this as the only worth-mining slither bot. Confirmed: side-circle food exclusion, encirclement detection, head-circle inflation, sector-box culling all live and lift cleanly. Self-tail-following at L5000+ is the headline technique. |
| BlueCannonBall/Slither.io-ML-Bot | https://github.com/BlueCannonBall/Slither.io-ML-Bot | pending | 2026-05-22 | Vendored once, removed (can't run on modern build). Worth re-checking for the heuristic layer underneath. |
| ermiyaeskandary/Slither.io-bot (original 2016) | https://github.com/ermiyaeskandary/Slither.io-bot | done | 2026-05-22 | The canonical reference. Stale but the core geometric scoring functions are timeless. Stuck-on-food blacklist found here. |
| nkalupahana/slither.io-bot ("anti-social") | https://github.com/nkalupahana/slither.io-bot | pending | 2026-05-22 | More aggressive kill-oriented behavior; we score 0 kills/15. Could lift its kill-targeting heuristic. |
| Agar.io bot ecosystem (Apostolique, ogario, etc.) | varies | done | 2026-05-22 | Closely related game (round head, growth, body collision). Bigger bot scene than slither's. Confirmed transfers: threat-circle scaling, cluster-value food selection, wall-perpendicular escape, predictive lead-the-target boost-cuts. |

## Robotics / planning literature

| Source | URL | Status | Last checked | Why |
| --- | --- | --- | --- | --- |
| Velocity Obstacles (Fiorini & Shiller 1998) | https://en.wikipedia.org/wiki/Velocity_obstacle | done | 2026-05-22 | The principled name for what our TTC picker is approximating. Useful as a soft penalty, not as hard infeasibility. |
| ORCA / RVO (van den Berg et al.) | https://gamma.cs.unc.edu/ORCA/ | done | 2026-05-22 | Reciprocity assumption breaks for slither. The asymmetric/non-reciprocal variant is in principle adaptable but the LP refactor is heavy. Park. |
| Dynamic Window Approach (Fox, Burgard, Thrun) | https://en.wikipedia.org/wiki/Dynamic_window_approach | done | 2026-05-22 | Closest match to our picker shape. Weighted-objective insight is the highest-leverage cheap adaptation we have. |
| Dubins paths | https://en.wikipedia.org/wiki/Dubins_path | done | 2026-05-22 | Solves the wrong problem (optimal path A to B, not reactive avoidance). Park. |

## Game state / protocol research

| Source | URL | Status | Last checked | Why |
| --- | --- | --- | --- | --- |
| ClitherProject/Slither.io-Protocol | https://github.com/ClitherProject/Slither.io-Protocol | done | 2026-05-22 | Decoded WebSocket frame schemas (stale, protocol 11). Highest-value untapped fields: `snake.sp` (server-truth speed), `snake.wang` (wanted angle, intent signal). Both need a DevTools probe to confirm the modern build still exposes them. |

## RL / ML

| Source | URL | Status | Last checked | Why |
| --- | --- | --- | --- | --- |
| BabakAkbari/Slither.io-AI (Gym env) | https://github.com/BabakAkbari/Slither.io-AI | pending | 2026-05-22 | Local sim with reward shaping. Not immediately bot code, but the reward function design is itself a data point on "what to optimize for." |
| Cal Poly "Slither.io Deep Learning Bot" (Caudill) | https://digitalcommons.calpoly.edu/ | pending | 2026-05-22 | Senior project writeup. Useful for observation-space design rather than weights. |

## Method ideas (no external source, but adopt the pipeline)

| Source | URL | Status | Last checked | Why |
| --- | --- | --- | --- | --- |
| Self-replay death classification | (internal) | pending | 2026-05-22 | Cluster the ~100 historical run snapshots in `bench-history/` by death mode (corpse-dive, boost-cut, encirclement, wall, self). Tells us which failure mode to chase next. Uses our own data, no external dep. |
| Adversarial unit tests | (internal) | pending | 2026-05-22 | Hand-construct slither states that match each death mode and pin the picker's expected heading. Catches regressions on specific scenarios that bench medians smooth over. |
| DevTools probe of `window.slither` / `window.slithers` keys | (internal) | pending | 2026-05-22 | Five-minute task that unlocks every Part 1 finding from the protocol research. Run `console.log(Object.keys(window.slither))` in a live game and diff against ClitherProject's field list. |

## How to add a source

Append a row to the table that fits best, set status `pending` and the date you found it. When investigation starts, change to `in-progress`. When findings land in [`FINDINGS.md`](./FINDINGS.md), flip to `done` and update the date.

If a source is genuinely dead (URL 404, repo deleted, content unrelated after a skim), mark `dead` with a short note in the Why column rather than removing the row, so we don't re-add it later.
