# nope-rope-9000

A Slither.io bot, Tampermonkey userscript flavor. Approach selected from
[RESEARCH.md](./RESEARCH.md): a userscript that hooks the live game's
state and steers via `window.xm` / `window.ym`. Early versions vendored
`BlueCannonBall/Slither.io-ML-Bot` as a reference, but the modern
`slither.com/io` build renamed the player snake from `window.snake` to
`window.slither` and dropped fields the old code reads, making the fork
unsalvageable. The vendored copy has been removed; findings from picking
through it are recorded in `RESEARCH.md`.

## Layout

```
nope-rope-9000/
  README.md
  RESEARCH.md                       # approach comparison and live-build findings
  .gitignore
  package.json                      # npm scripts (test, bench, play, etc.)
  playwright.config.js              # three test projects: smoke, bench, realgame
  src/
    bot.user.js                     # the bot: IPv6 fast-fail + bucketed steering
  tools/
    sandbox.html                    # offline dev harness (open in browser)
    sandbox.js                      # mock world: player + dummies + food
    bench-diff.js                   # diff bench-results.json against a baseline or labeled history run
  src/lib/
    geometry.js                     # pure helpers exported for unit tests; duplicated in bot.user.js
  tests/
    smoke.spec.js                   # 30s sanity check; the only sandbox test still used
    bench.spec.js                   # 7-min 20-seed sandbox benchmark (demoted, see Status)
    play.spec.js                    # automated real-game runs on slither.io with rolling screenshots
    probe-realgame.spec.js          # discovery probe: load slither.io, dump globals + selectors
    unit/
      geometry.test.js              # tests for src/lib/geometry.js (Node's built-in test runner)
      sync-check.test.js            # verifies bot.user.js helpers match the lib copy
  bench-history/                    # per-run archives (sandbox + realgame) for `bench-diff --against`
  bench-history.jsonl               # one-line-per-run summary log
  play-deaths/                      # rolling per-game screenshots (gitignored)
```

## Develop offline (no slither.io connection needed)

Open `tools/sandbox.html` directly in a browser (double-click, or
`file:///.../tools/sandbox.html`). You get a tiny slither-shaped world with a
player snake, a handful of wandering dummies, and food pellets. Append
`?autostart=1` to flip `window.playing` true and turn the bot on
automatically; append `?seed=42` for a deterministic dummy and food layout
(mulberry32 PRNG).

**Sandbox vs. live drift.** The sandbox exposes the historical names
(`window.snake`, `window.snakes`, `window.foods`). The live build renamed
the player snake to `window.slither` (see `RESEARCH.md` → "Findings from
the live build" for the full diff). The bot reads `window.slither` first
and falls back to `window.snake`, so it does drive the sandbox. The
sandbox has no corpse piles, no active threats, and no death state, which
turns out to matter (see "Why the sandbox bench was demoted" below).

Bot steers by writing `window.xm` / `window.ym` each frame (offset from screen
center, like a virtual mouse). Mouse input still works by default; whatever
sets `xm`/`ym` last each frame wins.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge).
2. **On Chrome 120+ you must also enable "Allow User Scripts"** in
   `chrome://extensions/` → Tampermonkey → Details (turn on Developer mode
   first if the toggle is hidden). Without this, Tampermonkey loads the
   script but never injects it, and hotkeys silently do nothing.
3. Open the Tampermonkey dashboard, click **Create a new script**.
4. Paste the contents of `src/bot.user.js` and save.
5. Visit https://slither.io/ and start a game. Note that slither.io now
   redirects to `slither.com/io`; both `@match` patterns are included so
   the script loads on either.
6. Open devtools console (F12). The bot logs lines tagged `[nope-rope-9000]`
   and attaches a helper at `window.nr9k` so you can poke at game state:

```js
nr9k.snake()         // your snake (window.slither on modern builds)
nr9k.foods()         // food pellets in view
nr9k.snakes()        // all snakes (window.slithers on modern builds)
nr9k.length()        // slither's displayed length (not pts.length; uses fpsls/fmlts)
nr9k.angleTo(x, y)   // heading from snake to a world point
nr9k.enabled()       // is the bot driving right now?
nr9k.toggle()        // toggle bot on/off (same as right-click or T)
nr9k.overlay()       // toggle the visual debug overlay (same as H)
nr9k.state()         // playing, snake, food/snake counts, ghosts, boost, xm/ym, etc.
nr9k.cfg             // mutable tunables (bucket count, danger radii, boost gating, etc.)
nr9k.history()       // every recorded run from localStorage (capped at cfg.historyCap)
nr9k.summary(n)      // median/max length & sct over the last n runs (default 20)
nr9k.clearHistory()  // wipe the saved run history
nr9k.nick()          // current saved nickname
nr9k.setNick("name") // persist a nickname (auto-fills the input each game)
nr9k.findFoods()     // walk window for arrays matching food shape
nr9k.findSnakes()    // walk window for arrays of snake-shaped objects
nr9k.sockets()       // every WebSocket URL the page has dialed
nr9k.blocked()       // IPv6 dials the script short-circuited
nr9k.fetches()       // every fetch/XHR URL the page has touched
```

**Toggling the bot.** Default is off so the page is fully usable manually.
Right-click on the canvas during a game, or press T, to flip the bot on
and off. While on, a `tick:` log appears every ~2s with the chosen
heading, runLen (size of the open arc selected), food bucket, ghost
count, and current boost state.

**Debug overlay.** Press H during a game to toggle a visual overlay on
the canvas: each of the 16 angle buckets drawn as a wedge at its
clearance distance (green = safe, red = below danger threshold), the
chosen heading as a thick line, ghost obstacles as magenta dots, the
target food as a yellow ring. The overlay preference persists in
`localStorage`. Off by default to avoid distracting from normal play.

**Auto-nick.** Set once with `nr9k.setNick("YourName")` and it persists in
`localStorage`. The bot fills `window.nick.value` whenever the input is
empty (between rounds, on reload), so you don't have to retype each game.

## Testing and tuning

Four test layers, in increasing order of fidelity and cost. Run
`npm install && npx playwright install chromium` once.

**`npm run test:unit` — pure-helper unit tests, ~100 ms.**
Node's built-in test runner (no framework dependency). Covers the
geometric helpers: `firstHitTime`, `angleBetween`, `blendAngles`,
`bucketOf` / `bucketAngle` / `bucketDelta`, `findOpenRuns`. The
helpers live in [`src/lib/geometry.js`](src/lib/geometry.js) as a
CommonJS module **and** are duplicated inside the IIFE in
[`src/bot.user.js`](src/bot.user.js) (Tampermonkey can't import
modules). A sync-check test compares the two copies after whitespace +
comment normalization. **If you edit a helper, edit both files** — the
sync test will fail loudly otherwise.

Closure-coupled functions (`buildCollisionBuckets`, `pickHeadingTTC`,
`buildNearbyObstacles`, `updateHeadHistory`, etc.) are *not* unit-
tested; they reference `CFG`, `headHistory`, `getSnakes()`, etc. and
would need a refactor to be importable. They're covered end-to-end by
the smoke and play harnesses below.

**`npm test` — smoke test, 30 seconds.**
Loads the sandbox, enables the bot, asserts the snake moved >200u and
grew. Regression-only: catches "bot doesn't load / steer / crash."
Doesn't tune anything.

**`npm run bench` — sandbox benchmark, ~7 minutes.**
20 seeded sandbox runs at 20s each. Writes `bench-results.json` and a
labeled archive to `bench-history/`. Use `npm run bench:save` to snapshot
current results as `bench-baseline.json`, then `npm run bench:diff` to
compare the next run against it. Label runs with `BENCH_LABEL=foo` so
they can be recalled later via `npm run bench:diff -- --against foo`.

**Why the sandbox bench was demoted.** It produces clean signal that does
not transfer. Three reasons: no corpse piles (the food-bucket scoring
function `sz²/d` was tuned for them); no active threats (dummy snakes
wander but never pursue, encircle, or boost-cut); no death (the player
snake cannot collide lethally with anything in the sandbox, so survival
is not measured). Multiple sandbox-tuned CFG changes were strongly
positive on the bench and indistinguishable from noise on the real game.
Treat the bench like a unit test of the steering loop, not a benchmark.

**`npm run play` — real-game runs on slither.io, ~10-15 min for 15 games.**
Drives [https://slither.io](https://slither.io) with the bot injected via
`page.addInitScript`. Per game: clicks play via `window.connect()`,
enables the bot, waits for `window.playing` to flip false (death), reads
the run record from `nr9k.history()`, and takes a rolling buffer of
death-frame screenshots (the bot's debug overlay is forced on so the
screenshots show *what the bot was computing*: lethal/safe wedges, head
ghosts, food target, chosen heading). Defaults: 15 games, 180s cap each,
label `realgame`. Env vars:

```bash
RUN_COUNT=15 RUN_TIMEOUT_S=300 PLAY_LABEL=mychange npm run play
```

The summary captures `peakLength` (slither's displayed length, computed
via `slitherLength()` from `fpsls` / `fmlts`) and `peakLengthLegacy`
(the old `s.pts.length` for comparison against runs taken before the
metric fix). Median both ways. Aggregate results land in
`realgame-results.json`, `bench-history/<ts>-realgame-<label>.json`, and
a one-line summary in `bench-history.jsonl`.

**`npm run probe:realgame`** — discovery probe, ~12s. Loads slither.io,
dumps `window.connect` / `window.nick` / `window.slither` / etc. and a
screenshot. Use when the game DOM drifts and the play loop suddenly
fails.

## Tuning loop (the loop that actually matters)

```bash
RUN_COUNT=15 PLAY_LABEL=before npm run play         # baseline
# edit src/bot.user.js
RUN_COUNT=15 PLAY_LABEL=after npm run play          # candidate
# read summaries from bench-history.jsonl, compare medians by hand
```

n=5 is too small. The variance per game in real slither.io is enormous
(single games range 9s to 200s on the same config). At least n=15 is
needed for medians with statistical legs; n=20-30 if the candidate looks
borderline.

Compare on `peakLengthLegacy` against any past run taken before
2026-05-22; on `peakLength` against everything after. (`peakLength` is
3-5x the legacy number because slither's displayed length isn't the
segment array count.)

The screenshots in `play-deaths/<label>/run-N-tX.Xs.png` are *rolling
buffer per game* — the last three frames before death, ~2s apart. Open
them to see what was on the bot's screen as it died.

**Steering algorithm.** Each tick (200 Hz, `setInterval` at 5 ms):

1. Update head-position history per visible enemy snake and compute its
   velocity. Self-exclusion is by object identity. Runs whether or not
   the bot is driving so velocities are fresh the moment the bot turns on.
2. (Bot-enabled path only:) generate ghost obstacles. *Velocity ghosts*
   at 100, 200, 350, 550, and 800 ms ahead. *Heading ghosts* forward-
   project the enemy head along its `ang` by ~4× enemy radius (catches
   head-on threats even when the enemy is nearly stationary).
3. Aggregate visible food density into 16 angle buckets:
   `bucket_score[i] += sz² / dist` per food. Pick the highest-scoring
   bucket; the representative food in it becomes the target. This
   naturally homes on corpse piles (a dead snake leaves a dense ribbon
   of food at one angle), where single-food picking would pick whichever
   one pellet scores best in isolation.
4. **Continuous TTC heading sampler** (the actual steering decision).
   Build a pre-filtered list of nearby obstacles: enemy heads (each
   with current position + velocity) and enemy body segments (treated
   as static for the duration of the simulation). The bot's *own* body
   is NOT included — in slither.io your own snake is pass-through.
   Sample 32 candidate headings evenly around 360°. For each, simulate
   1.2s of forward motion at the bot's current speed; for each obstacle,
   solve the quadratic for first squared-distance equal to the safe
   radius (head-to-head circle intersection). Take min across obstacles
   — that's the heading's time-to-collision. Pick the heading with max
   TTC; tie-break by smallest angular distance to the food target.
5. Boost gate: if TTC has 90%+ of the horizon (i.e. headed into clear
   space) AND the target food has `sz ≥ cfg.boostFoodSize` AND the
   chosen heading is within `cfg.boostMaxAngleDelta` of the food angle,
   call `window.setAcceleration(1)`.
6. If the head is within `cfg.wallBuffer` of the map edge, blend a pull
   toward the map center into the chosen heading. Write `xm` / `ym` as
   a 200-px direction vector.

Step 3's 16 angle buckets are *also* computed each tick (along with
"head clearance" and "ghost obstacles" — head positions projected at
[100, 200, 350, 550, 800] ms ahead under linear motion), but only for
the debug overlay. The actual picker is the TTC sampler in step 4. The
buckets are kept around because the visual diagnosis they provide is
useful when looking at death screenshots, and because the next planned
work (multi-hypothesis ghost prediction) builds on the ghost structure.

`nr9k.state()` reports `trackedHeads`, `ghostsLastTick`, and `boosting`
so you can verify the predictor and boost gate. `nr9k.length()` returns
slither's displayed length (NOT `s.pts.length` — see the metric note
under Testing). `nr9k.summary()` returns median/max length and `sct`
over recent runs; runs are recorded automatically each time the game
ends and persisted to `localStorage`. For batch tuning prefer
`npm run play` over by-hand summaries — same data, larger N, screenshots.

## Known gotchas

- **IPv6 server timeouts.** The live client's `loadSos` iterates a server
  list, and the list now interleaves IPv6 (`ws://[ipv6...]/ptc`) and IPv4
  entries. On a network without working IPv6 routing, every IPv6 dial waits
  ~75s before timing out, so the loader hangs for minutes before the game
  reaches an IPv4 server. Mitigation: at script load the bot wraps
  `window.WebSocket` and short-circuits any `ws://[...]` URL by returning a
  fake socket that fires `error` + `close` on the next tick. The game's own
  fallback then moves straight to the next entry, so IPv4 servers are
  reached without delay. Check `nr9k.blocked()` for the list of IPv6 URLs
  that were short-circuited and `nr9k.sockets()` for everything dialed.
  (Historical note: the older fix was to call `window.forceServer(ip, port)`
  with a server from `/i33628.txt`. That URL now returns the homepage HTML,
  so the decoder path was removed. `nr9k.pickServer()` is still available
  as a manual override if `forceServer` is still wired in your build.)
- **Mirror domains.** `slither.com/io` serves the real game JS but other
  mirrors (skinned ad portals) may serve modified scripts. Stick to the
  official domains in `@match`.

## Status

v0.5.2-dev. 200 Hz steering tick. Continuous time-to-collision (TTC)
heading picker added 2026-05-22 — replaces the bucketed run-finder for
the actual steering decision. 32 candidate headings sampled around 360°;
for each, ~1.2s of forward motion is simulated against enemy bodies
(static) and enemy heads (linear motion); pick the heading with the
longest TTC, food alignment as tie-breaker. The 16-wedge map is still
computed each tick for the debug overlay (visual diagnosis), not for
steering. Self-body avoidance was removed (slither's own body is
pass-through). Boost only when TTC has slack and the food-distance/angle
gates pass. Visual debug overlay on canvas (H to toggle); shows wedge
clearances, ghost positions, food target, chosen heading, plus 32 TTC
sample rays colored red→green by their TTC ratio.

**Real-game results** (n=15 per row, 2026-05-22):

| Config | `peakLengthLegacy` | `peakLength` | duration | kills/15 | best run |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline (wedge picker, no-self-body) | 33 | ~107 | 24-27s | 1-3 | L75 / 125s |
| TTC picker | 32 | ~104 | 22.6s | 4 | L98 / 39.9s (real length 1378) |
| **TTC + curving ghosts** | **35** | **157** | **30.3s** | 0 | L39 / 48.5s |

**Tuning status:** TTC + multi-hypothesis curving ghosts is the
nominal best at n=15 (+6s median duration, +47% real length over
baseline). Two follow-up attempts to upgrade body collision modeling
both regressed by 6-7s median duration:

- `body-capsules`: full capsule (line-segment with radius) collision
  between consecutive `pts[i]` and `pts[i+1]`. Geometrically the right
  shape for slither's body tube, but median duration 24.2s vs the
  curve-ghosts 30.3s. Possibly compute cost (~3× per obstacle exceeds
  the 5 ms tick budget at 200 Hz), possibly false positives from
  over-precise coverage.
- `body-interp`: cheaper alternative; insert midpoint obstacles only
  when consecutive `pts[i]` spacing exceeds `otherR`. Median duration
  23.7s. Similar regression.

Both reverted. The discrete-point body collision is back. Open
question: was the original `curve-ghosts` batch (30.3s) the lucky one?
At n=15 a 6s median shift is right at the noise floor. Without
re-running curve-ghosts (or increasing sample size), the entire result
is provisional.

**Overlay positioning fix (2026-05-22):** the debug overlay was pinned
at document (0, 0), but slither's main canvas `mc` is often offset by
its container's CSS — so the radar wedges and TTC rays could drift up
to ~150 px from the rendered snake head, making screenshots hard to
interpret. `syncOverlaySize` now positions the overlay over `mc`'s
`getBoundingClientRect()`. Diagnostic only; doesn't affect steering.

The TTC picker alone produced the largest single run on record (real
length 1378) but bimodal outcomes (godlike or instant-death). Adding
curving ghosts pulled in the tails without giving up the median.

## Future directions

Loose roadmap, ordered by expected return on effort. Each one is
hypothesis-driven; verify via `npm run play` with n=15 batches before
locking in.

### Threat model improvements

- ~~**Continuous time-to-collision (TTC) heading sampling.**~~ Built
  2026-05-22. Replaced the bucketed picker for steering decisions.
  Median flat alone but enabled the next item to work.
- ~~**Multi-hypothesis ghost prediction.**~~ Built 2026-05-22. For each
  enemy moving above `minThreatSpeed`, project the enemy's position
  under several non-zero turn rates (`curveTurnRates`) at multiple
  lookahead times (`curveLookaheadSeconds`); add each as a static
  obstacle in the TTC pre-filter. First confirmed median improvement
  in the project: legacy length 33 → 35, duration 24s → 30s, real
  length 107 → 157, much tighter distribution. See Status.
- **Confirm or refute the curving-ghost win.** Highest priority. n=15
  is small; the +6s duration vs baseline could be noise. One more
  15-game batch with the same config either reproduces or doesn't.
  If it doesn't, we have no confirmed wins on the project to date.
- **Increase sample size.** n=30 batches take ~20 min and the median
  is materially more stable. Worth the extra wall time when we want a
  decisive answer on a candidate change.
- **Tune the curving-ghost CFG.** Currently `curveTurnRates` is
  `[-3, -1.5, 1.5, 3]` and `curveLookaheadSeconds` is `[0.4, 0.8, 1.2]`,
  picked off the cuff. Worth sweeping: more/fewer turn rates, different
  lookahead spacing. With ~60 extra obstacles per tick the density is
  already meaningful; could prune if it costs the TTC picker too much
  signal vs noise.
- **Better body modeling — revisit.** `firstHitCapsuleTime` is built
  and unit-tested in `src/lib/geometry.js` and `src/bot.user.js`, but
  not wired into the picker after `body-capsules` regressed. Worth
  another shot once we understand whether the regression was compute
  cost (try lower tick rate) or noise (try n=30).
- **Distinguish enemy intent.** Per-enemy classification ("hunting" =
  consistently turning toward us over the last ~500 ms vs. "passing").
  For hunters only, widen the safety margin or push their ghosts
  further into the future. Should reduce the false-positive "ghost
  wall" effect for snakes that are clearly going elsewhere.

### Survival (fewer deaths)

- **Side-circle food exclusion.** Reject foods inside two circles
  perpendicular to the neck (offset by ±snakeWidth along the normal).
  Stops the bot from veering sideways for a grazing pellet and over-
  rotating. ~20 lines. j-c-m's trick.
- **Front-cone filter.** Restrict bucket scoring to a 90° forward cone.
  Pairs with the existing bucketed map to keep "best open sector"
  search focused on directions we can actually steer toward. May
  become moot if the TTC picker lands.
- **Velocity-based front prediction.** Combine velocity ghosts with
  body-segment projection: where will the enemy's body BE in 1s, given
  the head is moving and the body is following the head's prior path?

### Score (eat more, kill more)

- **Boost out of encirclement.** When TTC drops fast across multiple
  headings simultaneously AND one heading still has long TTC, boost
  toward it. Coupling between threat detection and aggressive escape.
- **Self-tail-following at length 5000+.** j-c-m's lategame survival
  trick: chase your own tail at a fixed offset, treating the resulting
  body loop as a convex hull and using point-in-polygon to detect
  enemies that enter it. ~200 lines. Single biggest score lever once
  the bot routinely survives to lategame. Currently moot — the bot
  doesn't reach lategame.

### Done

- ~~**Headless harness.**~~ Built: Playwright `npm run bench` for the
  sandbox and `npm run play` for the real game. Per-run history
  archived to `bench-history/`. Death-frame screenshots captured.
- ~~**Sandbox parity.**~~ Not done in the sense originally intended;
  the sandbox now demoted to regression-only because it's
  unrepresentative even when wired up (no corpse piles, no real
  threats, no death).
- ~~**Length-metric bug.**~~ Fixed 2026-05-22. The bot was tracking
  `s.pts.length` (segment count); slither's displayed length is
  `slitherLength(s)` derived from `sct`, `fam`, `fpsls`, `fmlts`. The
  legacy metric is still tracked for comparison to pre-fix runs.

### Parked (long horizon)

- **RL agent.** The heuristic bot is the baseline. The
  `BabakAkbari/Slither.io-AI` Gym env (linked in `RESEARCH.md`) is the
  starting point; PPO is the standard algorithm. The 16-bucket
  clearance vectors made a clean observation space — if the picker is
  replaced with continuous TTC sampling, the observation space changes
  to per-heading TTC arrays, which is also clean.

## Licensing

Code under `src/` is currently unlicensed (default: all rights reserved).
Add a top-level LICENSE file before sharing.
