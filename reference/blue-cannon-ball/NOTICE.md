# Vendored reference: BlueCannonBall/Slither.io-ML-Bot

This directory is a verbatim copy of files from:

- Upstream: https://github.com/BlueCannonBall/Slither.io-ML-Bot
- Branch fetched: `develop`
- Fetched on: 2026-05-16
- Files copied: `bot.user.js`, `LICENSE.md`, `README.md`, `DEVELOPER.md`

## Why it's here

It's a reference implementation to read and learn from. The bot we write
lives in `../../src/bot.user.js`. You can install either in Tampermonkey
to compare behavior.

## License

The original code is licensed under the Mozilla Public License 2.0. See
`LICENSE.md` in this directory for the full text. Per MPL-2.0:

- Each MPL-licensed source file remains MPL-2.0 even when included here.
- Modifications to the MPL files (if we make any) must also be MPL-2.0.
- This restriction does NOT apply to the code we write from scratch in
  `src/`, which is under whatever license we choose for this project.

## Lineage credit

The bot has a long history. Copyright headers in `bot.user.js`:

- 2016: Ermiya Eskandary & Theophile Cailliau (original)
- 2020 onwards: BlueCannonBall (aka OpTiMaL)

## Updating

To pull a newer version, re-run the fetch:

```sh
BASE="https://raw.githubusercontent.com/BlueCannonBall/Slither.io-ML-Bot/develop"
for f in bot.user.js LICENSE.md README.md DEVELOPER.md; do
  curl -fsSL "$BASE/$f" -o "reference/blue-cannon-ball/$f"
done
```

Then update the "Fetched on" date above.
