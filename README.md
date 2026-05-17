# nope-rope-9000

A Slither.io bot, Tampermonkey userscript flavor. Approach selected from
[RESEARCH.md](./RESEARCH.md): start with a userscript, read a maintained
reference implementation, build our own alongside it.

## Layout

```
nope-rope-9000/
  README.md
  RESEARCH.md                       # approach comparison and recommendation
  .gitignore
  src/
    bot.user.js                     # our bot (skeleton, probes game state)
  tools/
    sandbox.html                    # offline dev harness (open in browser)
    sandbox.js                      # mock world: player + dummies + food
  reference/
    blue-cannon-ball/               # vendored reference implementation
      bot.user.js                   # BlueCannonBall/Slither.io-ML-Bot @ develop
      LICENSE.md                    # MPL-2.0
      NOTICE.md                     # where it came from, how to refresh
      README.md
      DEVELOPER.md
```

## Develop offline (no slither.io connection needed)

Open `tools/sandbox.html` directly in a browser (double-click, or
`file:///.../tools/sandbox.html`). You get a tiny slither-shaped world with a
player snake, a handful of wandering dummies, and food pellets. The mock sets
the same globals the real game does (`window.snake`, `window.snakes`,
`window.foods`, `window.xm`, `window.ym`), so steering code written here
ports to the real game. `src/bot.user.js` is loaded by the page, so its
`nr9k.snake()` etc. helpers work in the sandbox console.

Bot steers by writing `window.xm` / `window.ym` each frame (offset from screen
center, like a virtual mouse). Mouse input still works by default; whatever
sets `xm`/`ym` last each frame wins.

## Install (either bot)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge).
2. **On Chrome 120+ you must also enable "Allow User Scripts"** in
   `chrome://extensions/` → Tampermonkey → Details (turn on Developer mode
   first if the toggle is hidden). Without this, Tampermonkey loads the
   script but never injects it, and hotkeys silently do nothing.
3. Open the Tampermonkey dashboard, click **Create a new script**.
4. Paste the contents of either:
   - `src/bot.user.js` (our skeleton, only probes state, no steering)
   - `reference/blue-cannon-ball/bot.user.js` (working reference bot)
5. Save, then visit https://slither.io/ and start a game. Note that slither.io
   now redirects to `slither.com/io`; both `@match` patterns are included so
   the script loads on either.
6. Open devtools console (F12). Our skeleton logs lines tagged `[nope-rope-9000]`
   and attaches a helper at `window.nr9k` so you can poke at game state:

```js
nr9k.snake()        // current snake (position, parts, fam, etc.)
nr9k.foods()        // food pellets in view
nr9k.snakes()       // all snakes in view
nr9k.angleTo(x, y)  // heading from current snake to a world point
```

## Known gotchas

- **IPv6-only server pool.** The live client frequently dials only IPv6
  WebSocket endpoints (`ws://[ipv6...]/ptc`). On a network without working
  IPv6 routing to those hosts, every connection attempt fails and the game
  never enters a session (spinning loader, no menu, no leaderboard). The bot
  loads fine; there's just no game to drive. Workaround: develop against
  `tools/sandbox.html` instead, or play through a VPN, or disable IPv6 on
  the active network adapter and refresh.
- **Mirror domains.** `slither.com/io` serves the real game JS but other
  mirrors (skinned ad portals) may serve modified scripts. Stick to the
  official domains in `@match`.

## Status

Day 0 scaffold. The skeleton does not steer yet. Offline sandbox is in place
so steering work doesn't depend on slither.io being reachable. Next: read the
reference bot's food-targeting and collision-avoidance functions, then
implement a first naive policy in `src/bot.user.js`.

## Licensing

The reference fork under `reference/blue-cannon-ball/` is MPL-2.0 and stays
that way. Our own code under `src/` is currently unlicensed (default: all
rights reserved); add a top-level LICENSE file before sharing.
