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
  src/
    bot.user.js                     # the bot: IPv6 fast-fail + weighted-food steering
  tools/
    sandbox.html                    # offline dev harness (open in browser)
    sandbox.js                      # mock world: player + dummies + food
```

## Develop offline (no slither.io connection needed)

Open `tools/sandbox.html` directly in a browser (double-click, or
`file:///.../tools/sandbox.html`). You get a tiny slither-shaped world with a
player snake, a handful of wandering dummies, and food pellets.

**Sandbox vs. live drift.** The sandbox exposes the historical names
(`window.snake`, `window.snakes`, `window.foods`). The live build at
`slither.com/io` renamed the player snake to `window.slither` (see
`RESEARCH.md` → "Findings from the live build" for the full diff). The bot
reads `window.slither`, so the v0.1 nearest-food logic does not currently
fire in the sandbox without aliasing. If you want the sandbox to exercise
the steering code, either rename the sandbox global to `window.slither` or
alias `window.slither = window.snake` in `sandbox.js`. Steering math itself
(reading head coords, writing `xm`/`ym`) is identical on both.

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
nr9k.angleTo(x, y)   // heading from snake to a world point
nr9k.enabled()       // is the bot driving right now?
nr9k.toggle()        // toggle bot on/off (same as right-click or T)
nr9k.state()         // playing, snake, food/snake counts, ghosts, xm/ym, etc.
nr9k.cfg             // mutable tunables (sampling, danger radius, etc.)
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
heading, target food, and food count.

**Auto-nick.** Set once with `nr9k.setNick("YourName")` and it persists in
`localStorage`. The bot fills `window.nick.value` whenever the input is
empty (between rounds, on reload), so you don't have to retype each game.

**Steering algorithm (v0.4.1).** Each tick (200 Hz, `setInterval` at 5 ms):

1. Update head-position history per visible enemy snake and compute its
   velocity from the position delta. Self-exclusion is by object identity,
   not `.id`. Runs whether or not the bot is driving, so velocities are
   fresh the instant the bot is enabled.
2. (Bot-enabled path only:) generate "ghost" obstacles per enemy snake.
   *Velocity ghosts* at 100, 200, 350, 550, and 800 ms ahead along the
   enemy's measured velocity (catches boost-cutters). *Heading ghosts*
   forward-project the enemy's head along its current `ang` by `~4×`
   enemy radius (catches head-on threats even when an enemy is barely
   moving and wouldn't trigger velocity tracking).
3. Pick a target food weighted by `size / distance`, so a fatter pellet
   beats a marginally closer crumb.
4. Sample `cfg.candidateAngles` (48) directions across a 270° arc around
   the food direction. For each, cast a ray forward by `~10×` snake
   radius and compute the minimum perpendicular distance from any
   obstacle (enemy heads, body segments, both kinds of ghosts) to the
   ray. Above the danger threshold the score is `clearance + food-
   alignment bonus`; below it the score is raw clearance with no bonus.
   The best score wins. When every forward arc is dangerous, this picks
   the least-bad heading instead of falling back to the food angle —
   the fallback bug was the real reason the bot kept walking into people
   through v0.4.0.
5. If the head is within `cfg.wallBuffer` of the map edge (circle of
   radius `~grd × 0.98` centered at `(grd, grd)`), blend a pull toward
   the map center into the chosen heading.
6. Write `xm` / `ym` as a 200-px direction vector.

`nr9k.state()` reports `trackedHeads` and `ghostsLastTick` so you can
verify the predictor is engaging when enemies are visible. If
`ghostsLastTick` stays at 0 in a busy server, threat tracking is off and
the bot is back to static-body-only behavior. Use `nr9k.cfg.dangerRadius`
to widen the safety buffer, or lower `nr9k.cfg.foodAlignWeight` to weight
survival more heavily against food chasing.

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

v0.4.1. 200 Hz steering tick. Per tick: weighted food selection, 48
swept-ray clearance samples across a 270° arc, enemy heads inflated
with heading-based forward projection plus velocity ghosts, map-edge
pull, least-bad fallback when every forward arc is blocked. Auto-fills
nickname between rounds. Reads `window.slither` / `window.slithers`
(renamed from the 2016-era `window.snake` / `window.snakes`). Right-
click or T toggles, default off. See "Future directions" for what's
next.

## Future directions

Loose roadmap, ordered by expected return on effort. Most items are
independent so they can be picked off in any order.

### Survival (fewer deaths)

- **Visual debug overlay.** Draw the candidate ray fan, ghost
  obstacles, and chosen heading onto the canvas each frame. The
  collision bugs we hit through v0.3 and v0.4 would have been obvious
  in seconds with this; right now we're debugging blind from text logs.
  Probably 50-80 lines using the page's existing 2D context.
- **Threat-weighted danger radius.** Today every obstacle uses the
  same `dangerRadius`. A big fast snake's head is much more dangerous
  than a small drifter or a static body segment. Inflate the radius
  per-obstacle proportional to enemy length and speed.
- **Death-cause logging.** When `slither.dead_amt` flips (or the
  snake disappears from `slithers`), snapshot the nearest obstacle,
  chosen heading, clearance, and a few frames of head history. Surfaces
  concrete patterns ("dies head-on coming from N") instead of guessing.

### Score (eat more, kill more)

- **Boost.** Two policies: opportunistic when path is wide open and
  length is healthy, defensive when clearance drops below a panic
  threshold. Verify `window.setAcceleration(1|0)` works on the live
  build; if not, dispatch `W` keydown/keyup events as fallback.
- **Corpse-pile targeting.** When a snake dies it drops a high-value
  food cluster along its body. Detect by watching for entries leaving
  `window.slithers` while their `pts` was long, then prioritize the
  resulting cluster (ideally with boost to outrace other claimants).
  Biggest single score lever in slither.
- **Encirclement.** When meaningfully larger than a nearby snake, plan
  a curving path to loop around them and force a body collision.
  Requires multi-step path planning rather than per-tick steering.
  Significant work; this is what separates "doesn't die" from "wins".

### Diagnostics and infrastructure

- **Sandbox parity.** `tools/sandbox.js` still exposes the legacy
  `window.snake` / `window.snakes` globals. Add `slither` / `slithers`
  aliases so the bot actually drives in the sandbox. Unblocks offline
  tuning of every other item on this list.
- **Score tracker.** Find the per-round score (likely `slither.sct` or
  similar; probe to confirm) and log a summary on death. Combined with
  death-cause logging this enables A/B testing of config changes.
- **Headless harness.** Run the bot against the sandbox without a
  browser (Node + canvas shim or no rendering at all). Lets us run
  thousands of rounds overnight to tune `cfg`. The only path to
  statistical comparisons between algorithm changes.

### Parked (long horizon)

- **RL agent.** Once headless plus sandbox parity plus a score tracker
  exist, the heuristic bot becomes the baseline. The `BabakAkbari/
  Slither.io-AI` Gym env (linked in `RESEARCH.md`) is the obvious
  starting point; PPO is the standard algorithm. The current clearance
  vector (48 angles × clearance) makes a fine observation space.

## Licensing

Code under `src/` is currently unlicensed (default: all rights reserved).
Add a top-level LICENSE file before sharing.
