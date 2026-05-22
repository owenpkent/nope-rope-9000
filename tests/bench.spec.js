// Multi-seed benchmark. Runs the bot in the sandbox across 10 seeds, samples
// state through each run, and reports aggregate scores. Slower than the
// smoke test (~3-4 min); intended to be run manually before/after a bot
// change to see the actual delta in median final mass.
//
// Writes a JSON dump to bench-results.json so the previous run can be
// compared against the current run by hand or by a future diff tool.

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SANDBOX_URL =
  'file:///' +
  path.resolve(__dirname, '..', 'tools', 'sandbox.html').replace(/\\/g, '/');

// 20 seeds at 20s each ~= 7 min wall-clock. Enough samples that the
// median is reasonably stable run-to-run; see bench-diff output for the
// observed noise floor.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const RUN_SECONDS = 20;
const SAMPLE_PERIOD_MS = 500;
const STUCK_DIST_THRESHOLD = 25; // <25u movement per 500ms = "stuck" sample

test('benchmark: 10 seeds, report aggregate scores', async ({ page }) => {
  test.setTimeout((RUN_SECONDS + 5) * 1000 * SEEDS.length + 30_000);

  const results = [];

  for (const seed of SEEDS) {
    await page.goto(`${SANDBOX_URL}?seed=${seed}`);
    await page.waitForFunction(
      () => !!window.__sandbox && window.__sandbox.ready && !!window.nr9k,
      null,
      { timeout: 5_000 }
    );
    await page.evaluate(() => {
      window.playing = true;
      window.nr9k.toggle(true);
    });
    await page.waitForFunction(() => window.nr9k.enabled() === true, null, { timeout: 2_000 });

    const initial = await page.evaluate(() => window.__sandbox.stats());

    const totalSamples = Math.floor((RUN_SECONDS * 1000) / SAMPLE_PERIOD_MS);
    let prev = { x: initial.x, y: initial.y };
    let stuckStreak = 0;
    let maxStuckStreak = 0;

    for (let i = 0; i < totalSamples; i++) {
      await page.waitForTimeout(SAMPLE_PERIOD_MS);
      const s = await page.evaluate(() => window.__sandbox.stats());
      const d = Math.hypot(s.x - prev.x, s.y - prev.y);
      if (d < STUCK_DIST_THRESHOLD) stuckStreak++;
      else stuckStreak = 0;
      if (stuckStreak > maxStuckStreak) maxStuckStreak = stuckStreak;
      prev = { x: s.x, y: s.y };
    }

    const final = await page.evaluate(() => window.__sandbox.stats());
    const moved = Math.hypot(final.x - initial.x, final.y - initial.y);

    results.push({
      seed,
      initialSct: initial.sct,
      finalSct: final.sct,
      growth: final.sct - initial.sct,
      finalLength: final.length,
      moved: Math.round(moved),
      maxStuckStreakSec: +(maxStuckStreak * SAMPLE_PERIOD_MS / 1000).toFixed(1),
    });
  }

  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  // Label this run via BENCH_LABEL env var so it can be looked up later.
  // bash:        BENCH_LABEL=foo npm run bench
  // PowerShell:  $env:BENCH_LABEL='foo'; npm run bench
  const label = (process.env.BENCH_LABEL || 'unlabeled').replace(/[^a-zA-Z0-9_-]/g, '-');
  const ts = new Date().toISOString();
  const summary = {
    timestamp: ts,
    label,
    seeds: SEEDS,
    runSeconds: RUN_SECONDS,
    medianFinalSct: med(results.map(r => r.finalSct)),
    medianGrowth: med(results.map(r => r.growth)),
    medianMoved: med(results.map(r => r.moved)),
    medianFinalLength: med(results.map(r => r.finalLength)),
    maxStuckStreakSec: Math.max(...results.map(r => r.maxStuckStreakSec)),
    perSeed: results,
  };

  const root = path.resolve(__dirname, '..');
  fs.writeFileSync(path.join(root, 'bench-results.json'), JSON.stringify(summary, null, 2));

  // Persistent history: archive the full result and append a one-line summary
  // so old experiments don't get overwritten by the next run. Filenames are
  // sortable (ISO timestamp first), colons replaced for Windows.
  const historyDir = path.join(root, 'bench-history');
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  const fileTs = ts.replace(/[:.]/g, '-');
  const historyPath = path.join(historyDir, `${fileTs}-${label}.json`);
  fs.writeFileSync(historyPath, JSON.stringify(summary, null, 2));

  fs.appendFileSync(
    path.join(root, 'bench-history.jsonl'),
    JSON.stringify({
      timestamp: ts,
      label,
      seeds: SEEDS.length,
      runSeconds: RUN_SECONDS,
      medianFinalLength: summary.medianFinalLength,
      medianFinalSct: summary.medianFinalSct,
      medianMoved: summary.medianMoved,
      file: path.relative(root, historyPath).replace(/\\/g, '/'),
    }) + '\n'
  );

  const fmt = (v, w) => String(v).padStart(w);
  console.log('\n=== BENCHMARK RESULTS ===');
  console.log(`seeds=${SEEDS.length}  runSeconds=${RUN_SECONDS}`);
  console.log('seed | initSct | finalSct | growth | length | moved | stuckS');
  for (const r of results) {
    console.log(
      `${fmt(r.seed, 4)} | ${fmt(r.initialSct, 7)} | ${fmt(r.finalSct, 8)} | ` +
      `${fmt(r.growth, 6)} | ${fmt(r.finalLength, 6)} | ${fmt(r.moved, 5)} | ` +
      `${r.maxStuckStreakSec.toFixed(1)}`
    );
  }
  console.log('---');
  console.log(`median finalSct:  ${summary.medianFinalSct}`);
  console.log(`median growth:    ${summary.medianGrowth}`);
  console.log(`median length:    ${summary.medianFinalLength}`);
  console.log(`median moved:     ${summary.medianMoved}`);
  console.log(`max stuck-streak: ${summary.maxStuckStreakSec.toFixed(1)}s`);
  console.log(`label: ${label}`);
  console.log(`written: bench-results.json`);
  console.log(`archived: bench-history/${fileTs}-${label}.json`);

  expect(results.length).toBe(SEEDS.length);
});
