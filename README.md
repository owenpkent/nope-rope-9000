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
  reference/
    blue-cannon-ball/               # vendored reference implementation
      bot.user.js                   # BlueCannonBall/Slither.io-ML-Bot @ develop
      LICENSE.md                    # MPL-2.0
      NOTICE.md                     # where it came from, how to refresh
      README.md
      DEVELOPER.md
```

## Install (either bot)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge).
2. Open the Tampermonkey dashboard, click **Create a new script**.
3. Paste the contents of either:
   - `src/bot.user.js` (our skeleton, only probes state, no steering)
   - `reference/blue-cannon-ball/bot.user.js` (working reference bot)
4. Save, then visit https://slither.io/ and start a game.
5. Open devtools console (F12). Our skeleton logs lines tagged `[nope-rope-9000]`
   and attaches a helper at `window.nr9k` so you can poke at game state:

```js
nr9k.snake()        // current snake (position, parts, fam, etc.)
nr9k.foods()        // food pellets in view
nr9k.snakes()       // all snakes in view
nr9k.angleTo(x, y)  // heading from current snake to a world point
```

## Status

Day 0 scaffold. The skeleton does not steer yet. Next: read the reference
bot's food-targeting and collision-avoidance functions, then implement a
first naive policy in `src/bot.user.js`.

## Licensing

The reference fork under `reference/blue-cannon-ball/` is MPL-2.0 and stays
that way. Our own code under `src/` is currently unlicensed (default: all
rights reserved); add a top-level LICENSE file before sharing.
