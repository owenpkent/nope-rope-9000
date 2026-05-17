// ==UserScript==
// @name         nope-rope-9000
// @namespace    https://github.com/owenpkent/nope-rope-9000
// @version      0.0.1
// @description  Slither.io bot, from-scratch build. See README.
// @author       Owen
// @match        *://*.slither.io/*
// @match        *://*.slither.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[nope-rope-9000]';
  const log = (...args) => console.log(TAG, ...args);

  log('loaded, version 0.0.1');

  // The game exposes its state on `window` after it boots. Probe until
  // `window.snake` is populated, then wire up a debug helper. No steering yet.
  let booted = false;
  const probe = setInterval(() => {
    const s = window.snake;
    if (!s) return;
    booted = true;
    clearInterval(probe);

    log('game booted, snake detected', {
      id: s.id,
      x: s.xx,
      y: s.yy,
      parts: s.pts ? s.pts.length : null,
    });

    // Expose a console helper so we can poke at the game state during dev.
    // From devtools: nr9k.snake(), nr9k.foods(), nr9k.snakes()
    window.nr9k = {
      snake: () => window.snake,
      foods: () => window.foods,
      snakes: () => window.snakes,
      angleTo: (x, y) => {
        const s = window.snake;
        return Math.atan2(y - s.yy, x - s.xx);
      },
    };
    log('nr9k debug helper attached to window');
  }, 500);

  // Safety net: stop probing after 60s if the game never boots (page may not
  // be the game, e.g. landing page before clicking Play).
  setTimeout(() => {
    if (!booted) {
      clearInterval(probe);
      log('gave up waiting for window.snake after 60s');
    }
  }, 60000);
})();
