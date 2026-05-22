// Headless smoke test: load the sandbox with a fixed seed, enable the bot,
// let it run, assert it actually drove the snake somewhere and grew it.
//
// This is a *behavior* check, not a unit test. If this fails, the bot has
// regressed badly enough that mass acquisition and steering aren't working
// at all. Finer-grained assertions belong in unit tests on extracted helpers.

const { test, expect } = require('@playwright/test');
const path = require('path');

const SANDBOX_URL =
  'file:///' +
  path.resolve(__dirname, '..', 'tools', 'sandbox.html').replace(/\\/g, '/');

test('bot grows the snake and moves over 30 seconds', async ({ page }) => {
  // Surface console errors so a broken bot doesn't fail silently.
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(`${SANDBOX_URL}?seed=42`);

  // Wait for both IIFEs to finish wiring globals.
  await page.waitForFunction(
    () => !!window.__sandbox && window.__sandbox.ready && !!window.nr9k,
    null,
    { timeout: 5_000 }
  );

  // Drive the bot ourselves; don't rely on the sandbox autostart hook so
  // the test is the single source of truth for "playing + bot on".
  await page.evaluate(() => {
    window.playing = true;
    window.nr9k.toggle(true);
  });
  await page.waitForFunction(
    () => window.playing === true && window.nr9k.enabled() === true,
    null,
    { timeout: 2_000 }
  );

  const initial = await page.evaluate(() => window.__sandbox.stats());
  expect(initial.botEnabled).toBe(true);
  expect(initial.playing).toBe(true);

  // Let the bot drive for 30s of wall clock. headless Chromium ticks RAF at
  // ~60fps without a display, so this is real gameplay time, not stalled.
  await page.waitForTimeout(30_000);

  const final = await page.evaluate(() => window.__sandbox.stats());

  // Snake should still exist and have moved meaningfully from spawn.
  const dx = final.x - initial.x;
  const dy = final.y - initial.y;
  const moved = Math.hypot(dx, dy);
  expect(moved).toBeGreaterThan(200);

  // Snake should have eaten *something*. Initial sct is 30 (see sandbox).
  expect(final.sct).toBeGreaterThan(initial.sct);

  // Sanity: no JS errors blew up during the run.
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);

  // Useful when the test passes but you want to eyeball the numbers.
  console.log('smoke result:', { initial, final, moved });
});
