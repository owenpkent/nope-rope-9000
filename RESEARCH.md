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

1. Day 1: install Tampermonkey, drop in `BlueCannonBall/Slither.io-ML-Bot` (or the latest active fork from the list above), confirm it joins a game and steers. If it crashes on connect, the protocol shifted, try `j-c-m/Slither.io-bot` next.
2. Day 2: read the chosen bot's collision-avoidance and food-targeting code end to end. Write a one-page note on the observation space it uses.
3. Day 3: change one heuristic (food weighting or danger radius), measure score delta over 20 runs.
4. Day 4: clone `BabakAkbari/Slither.io-AI`, get Stable-Baselines3 PPO training a non-dying agent locally.
5. Day 5: port the userscript's observation features into the Gym env so the RL agent sees the same inputs your heuristic baseline sees.
6. Days 6 to 7: train PPO overnight, compare its score distribution against the day-3 heuristic baseline.

If the live site proves dead or hard-walled at any point in days 1 to 2, drop approach 1 and treat the clone as the whole project.
