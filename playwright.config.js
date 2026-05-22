// Playwright config. JS (not TS) so the project stays toolchain-free.
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const sandboxUrl = 'file:///' + path
  .resolve(__dirname, 'tools/sandbox.html')
  .replace(/\\/g, '/');

// Two projects so `npm test` (smoke only) stays fast and `npm run bench`
// targets the slow benchmark explicitly.
const sharedUse = {
  baseURL: sandboxUrl,
  headless: true,
  viewport: { width: 1024, height: 768 },
  actionTimeout: 5_000,
  trace: 'retain-on-failure',
  ...devices['Desktop Chrome'],
};

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 5_000 },
  retries: 0,
  reporter: [['list']],
  projects: [
    {
      name: 'smoke',
      testMatch: ['**/smoke.spec.js'],
      use: sharedUse,
    },
    {
      name: 'bench',
      testMatch: ['**/bench.spec.js'],
      timeout: 600_000,
      use: sharedUse,
    },
    {
      // Real-game tests connect to slither.com servers and play live games.
      // Headed by default so visual problems (cloudflare, WebGL) are obvious.
      name: 'realgame',
      testMatch: ['**/{probe-realgame,play}.spec.js'],
      timeout: 600_000,
      use: { ...sharedUse, headless: false, viewport: { width: 1280, height: 800 } },
    },
  ],
});
