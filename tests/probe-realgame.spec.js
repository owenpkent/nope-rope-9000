// Discovery probe: open slither.com/io with the bot injected via Playwright,
// inspect what loaded and what's interactive. We don't try to play yet — we
// just want to know:
//   (1) does the page load in Playwright Chromium at all?
//   (2) does the bot's IIFE execute (window.nr9k present)?
//   (3) what's the current play-button selector and game-global shape?
//   (4) is Cloudflare or some other gate blocking us?
//
// Run with: npm run probe:realgame
// Output: console JSON + screenshot at test-results/probe-realgame.png

const { test } = require('@playwright/test');
const path = require('path');

const BOT_PATH = path.resolve(__dirname, '..', 'src', 'bot.user.js');
// slither.com is connection-refused from this network (observed 2026-05-22);
// the memory note "slither.io redirects to slither.com/io" is stale or
// geo-dependent. slither.io serves directly via Cloudflare on this network,
// so default to it. Override with TARGET_URL=... if needed.
const TARGET_URL = process.env.TARGET_URL || 'https://slither.io';

test('probe: load slither.com and inspect what we got', async ({ page }) => {
  test.setTimeout(90_000);

  page.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
  page.on('pageerror', (err) => console.log('[pageerror]', String(err)));
  page.on('requestfailed', (req) =>
    console.log('[reqfailed]', req.url(), req.failure() && req.failure().errorText)
  );

  // Inject the userscript at document-start. Slither sets globals during
  // its own bootstrap; the bot's IIFE needs to run before then to wrap
  // WebSocket. addInitScript runs before any page script.
  await page.addInitScript({ path: BOT_PATH });

  console.log(`navigating to ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  console.log('waiting 10s for game scripts and assets to settle...');
  await page.waitForTimeout(10_000);

  await page.screenshot({ path: 'test-results/probe-realgame.png', fullPage: false });
  console.log('screenshot saved: test-results/probe-realgame.png');

  const probe = await page.evaluate(() => {
    const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
    return {
      title: document.title,
      url: location.href,
      // Bot presence + what it observed
      botLoaded: !!window.nr9k,
      botSocketsSeen: safe(() => window.nr9k && window.nr9k.sockets(), null),
      botBlockedSockets: safe(() => window.nr9k && window.nr9k.blocked(), null),
      // Modern slither game globals
      hasConnect: typeof window.connect,
      hasNickElement: !!window.nick && (window.nick.tagName + '#' + window.nick.id),
      nickValue: safe(() => window.nick && window.nick.value, null),
      typeofPlaying: typeof window.playing,
      playingValue: window.playing,
      hasSlither: !!window.slither,
      hasSnake: !!window.snake,
      hasMc: !!window.mc,
      typeofGrd: typeof window.grd,
      foodsLen: Array.isArray(window.foods) ? window.foods.length : 'not array',
      snakesLen: Array.isArray(window.snakes) ? window.snakes.length : 'not array',
      slithersLen: Array.isArray(window.slithers) ? window.slithers.length : 'not array',
      // What's clickable
      buttons: Array.from(document.querySelectorAll('button')).slice(0, 15).map(b => ({
        text: b.textContent.trim().slice(0, 60),
        id: b.id,
        className: b.className,
        visible: b.offsetParent !== null,
      })),
      inputs: Array.from(document.querySelectorAll('input')).slice(0, 10).map(i => ({
        id: i.id, name: i.name, type: i.type, placeholder: i.placeholder,
        visible: i.offsetParent !== null,
      })),
      // Heuristic play-button candidates from common slither selectors
      playCandidates: Array.from(document.querySelectorAll(
        '.nsi, .sosbutton, .nsidiv, [id*="play"], [class*="play" i], [onclick*="connect"]'
      )).slice(0, 15).map(e => ({
        tag: e.tagName,
        id: e.id,
        className: e.className,
        text: e.textContent.trim().slice(0, 60),
        visible: e.offsetParent !== null,
        onclick: !!e.onclick,
      })),
      // Cloudflare / anti-bot signals
      hasChallenge: !!document.querySelector('#challenge-running, .cf-challenge, [class*="cloudflare" i]'),
      bodyTextPreview: document.body && document.body.textContent.trim().slice(0, 400),
    };
  });

  console.log('\n=== PROBE RESULTS ===');
  console.log(JSON.stringify(probe, null, 2));
});
