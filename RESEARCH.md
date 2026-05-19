# Slither.io Bot: Approach Comparison

Researched 2026-05-16. Cross-check repos before cloning, since maintenance status can shift quickly.

## Pre-flight: is slither.io still alive?

Yes. As of mid-May 2026 the live site is operational with roughly 17k concurrent players and a 24h peak near 25k (per public status trackers and webgamedb). The protocol has historically shifted a few times, which kills stale bot forks, so always check the last-commit date on whichever userscript you pick.

## The three approaches

### 1. Browser userscript (Tampermonkey / Violentmonkey)

How it works: JavaScript injected into slither.io that hooks the game's own WebSocket frames and canvas, then drives the mouse-angle and boost variables the game already exposes on `window`. No screen capture, no computer vision.

- Effort to first run: low. 4 to 10 hours if a recent fork still parses the protocol, mostly reading other people's code.
- Skills: intermediate JS, devtools, reading minified game source, basic 2D geometry for collision avoidance.
- ToS / detection risk: medium. ToS prohibits automation, and protocol updates have quietly broken older bots in the past. No accounts means no account bans, but Cloudflare-style friction has appeared.
- Strengths: fastest path to "my snake plays itself," full game state for free.
- Weaknesses: brittle to game updates, you're building on someone else's reverse engineering.

Verified repos (all exist on GitHub as of this search; activity varies):

- `BlueCannonBall/Slither.io-ML-Bot`: actively maintained fork of the original Eskandary/Cailliau bot. Markets itself as "intelligent."
- `ermiyaeskandary/Slither.io-bot`: the 2016 original. Likely stale but the canonical reference implementation.
- `j-c-m/Slither.io-bot`: "Championship Edition" fork, historically the most-maintained successor.
- `nkalupahana/slither.io-bot`: a more aggressive ("anti-social") Tampermonkey variant.
- `iteacher/slither-bot`: modern UI mod with auto-eat, collision avoidance, scroll-zoom.

There is also a Greasy Fork "Slither.io auto play bot 2025" script (id 514745) that was working in early 2025. Useful as a sanity check that the protocol still works.

### 2. External vision-based bot (Python + OpenCV)

How it works: capture the game window with `mss`, segment the player snake, food, and enemies with OpenCV (HSV thresholds + contours), then steer with `pyautogui` or `pynput` mouse moves.

- Effort to first run: medium. Roughly 15 to 30 hours. Capture and mouse control are quick. Reliable segmentation is the time sink.
- Skills: Python, OpenCV basics, patience for threshold tuning.
- ToS / detection risk: low to medium. Pixels in, mouse out, so it's indistinguishable from a human at the network layer. Still violates ToS.
- Strengths: portable to any browser game, teaches real CV, survives protocol changes.
- Weaknesses: slow control loop (typically 15 to 30 Hz), fragile to resolution and skin changes, lots of manual tuning.
- Verified repos: no widely-cited CV-only slither bot turned up in this search. Expect to write your own. The agar.io CV-bot literature is the closest analogue.

### 3. Reinforcement learning agent

How it works: train a policy (PPO, DQN, A2C) inside a local slither clone, then optionally bridge the trained agent to the live game via approach 1 or 2.

- Effort to first run: high. 40 to 100+ hours to clear "doesn't immediately suicide." Competitive play is weeks of tuning.
- Skills: Python, PyTorch, RL fundamentals (reward shaping, observation design, PPO/DQN), patience with training.
- ToS / detection risk: none while training in a clone. Inherits approach 1/2 risk only if you deploy to the live site.
- Strengths: actually teaches RL, no dependency on the live protocol, the trained agent is yours.
- Weaknesses: slow feedback loop, painful to debug, sim-to-real transfer to the live game is nontrivial.

Verified repos:

- `JuiHsiu/Slither-DRL`: PG, DQN, AC, A2C implementations for slither.
- `zachabarnes/slither-rl-agent`: deep RL agent for slither.io.
- `BabakAkbari/Slither.io-AI`: an OpenAI Gym-style environment, useful as the training sim.
- `nikhilbarhate99/PPO-PyTorch`: minimal clipped-objective PPO in PyTorch, a clean reference to plug into the Gym env above.

There is also a Cal Poly senior project writeup ("Slither.io Deep Learning Bot," James Caudill) on digitalcommons.calpoly.edu that's a useful design reference.

## Recommendation

Start with approach 1 (userscript), then layer in approach 3 in parallel.

The userscript gets you a working bot in a weekend and forces you to read the game's actual state model, which is the best possible preparation for designing observations and rewards in approach 3. Approach 2 is the weakest pick for slither specifically: you'd be paying a CV tax for data the WebSocket already hands you for free. Save OpenCV for a game where you don't have protocol access.

### Suggested first week

Outdated. The original plan started by vendoring `BlueCannonBall/Slither.io-ML-Bot` as a reference; that fork doesn't run against the modern build (see "Findings from the live build" below). The current bot in `src/bot.user.js` is a from-scratch heuristic with weighted-food targeting, swept-ray collision avoidance, and threat-tracking ghosts. For where to take it next, see `README.md` → "Future directions".

## Findings from the live build (2026-05-18)

Confirmed at runtime against `slither.com/io` (the redirect target of
`slither.io`). Recording these because the 2016-2020 reference bots assume
an older protocol and shape that no longer match, which wasted a lot of
time before we realized it.

### Domain and game JS

- `slither.io` 301-redirects to `slither.com/io`. The userscript needs
  `@match` on both hosts.
- Game JS is served as `/game<n>.js` (e.g. `game1107249518.js`); the number
  rotates per build. References to it from old code or docs are stale.

### Server selection and the WebSocket layer

- The list URL documented at
  [ClitherProject/Slither.io-Protocol](https://github.com/ClitherProject/Slither.io-Protocol/blob/master/ServerList.md)
  (`http://slither.io/i33628.txt`) now returns the homepage HTML, not the
  encoded server list. Several Greasy Fork "server picker" scripts based on
  this URL are dead. The current list source is internal to `loadSos` and
  not visible at a stable URL we could find.
- `loadSos` still does the per-server probe pattern: it dials each entry at
  `ws://<host>:80/ptc`, watches for an open, then connects the real session
  at `ws://<host>:444/slither`. The probe URLs are interleaved IPv6 and
  IPv4. On a network without IPv6 routing, every `[ipv6...]` dial waits
  about 75 seconds for the OS-level timeout, so the spinner can hang for
  10+ minutes before the game reaches an IPv4 host. Wrapping `WebSocket`
  to return a fake socket that fires `error` + `close` synchronously on
  any `ws://[...]` URL collapses that delay to milliseconds and the game's
  built-in IPv4 fallback Just Works (no `forceServer()` call needed).
- `window.forceServer(ip, port)` is the historical override for picking a
  specific server. We left a passthrough in the bot helper but couldn't
  confirm the function still exists on every build, so don't rely on it.

### Player snake (the big one)

- `window.snake` is **gone** on the modern build. The player's snake is at
  **`window.slither`**.
- The 2016-era shape exposed lots of fields (`lnp` for last neck point,
  `alive_amt`, `ang`, `sp`, `fam`, etc.). The current `slither` object
  exposes `xx`, `yy`, `pts` (body segments, ~26 long at spawn, growing
  with food), `ang` (facing angle; confirmed working — our v0.4 heading
  ghosts read it on every enemy), `sc` (scale, used to compute snake
  radius as `5.8 * sc`), `dead_amt`, `kill_count`, and many others. Old
  fields the 2016-era bot reads do not exist; aliasing `window.snake ->
  window.slither` gets past the first crash but leads straight into the
  next one.
- This is the load-bearing reason the BlueCannonBall fork can't be revived
  with patches. The bot's `every()` and food-targeting code reach into
  `snake.lnp.xx`, `snake.alive_amt`, `snake.lnp.yy`, etc., and would need
  a full rewrite to map onto the new shape, not a few one-line fixes.

### Steering API

- `window.xm` and `window.ym` still drive the snake. Set them each frame
  to a screen-center-relative offset (any sensible magnitude works; the
  game cares about direction). Our v0.1 normalizes to length 200 and that
  is plenty.
- The user's mouse handler writes `xm`/`ym` too. Whoever writes last each
  frame wins. The current bot ticks at 200 Hz (`setInterval` at 5 ms),
  which dominates mouse input when enabled. If that ever becomes a
  problem, save and override `window.onmousemove` while enabled.

### Other globals (less verified)

- `window.playing` (boolean): still indicates an active game session.
- `window.foods`: still populated (the v0.1 bot's nearest-food targeting
  works against it). Each entry has `xx`, `yy`, and an `eaten` flag.
- `window.snakes` is **gone**; the enemies array is now `window.slithers`
  (parallels the `snake -> slither` rename, verified 2026-05-18). Each
  entry has the same shape as `window.slither`: `xx`, `yy`, `ang`, `pts`
  body array, `sc`, `dead_amt`, `kill_count`, etc. The player's own snake
  appears as one of the entries, so self-exclusion by object identity
  (`other === window.slither`) is necessary when iterating.
- The right-click toggle path is unreliable through the upstream bot's
  `e.which === 3` check. Capture-phase `addEventListener('mousedown', ...,
  true)` with `e.button === 2` and `stopImmediatePropagation()` is what
  works consistently.

### Userscript timing

- `@run-at document-start` is required to wrap `window.WebSocket` before
  `loadSos` runs. Userscripts that touch the DOM at top level (like the
  BlueCannonBall `canvasUtil` IIFE that reads `window.mc.width`) crash at
  document-start because the canvas doesn't exist yet. Bots that want both
  early hooks and DOM access need to split: do the network wraps at
  document-start, defer canvas/DOM work behind a `setInterval` that polls
  for the canvas to appear.
