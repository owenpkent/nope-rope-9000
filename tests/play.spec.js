// Automated runs against the real slither.io game. Injects the bot,
// drives the click-play loop, captures per-run stats from nr9k.history()
// (recorded by the bot to localStorage on each death).
//
// Usage:
//   npm run play                      # 5 runs, default
//   RUN_COUNT=10 npm run play          # override count
//   RUN_TIMEOUT_S=180 npm run play     # cap each game at N seconds
//   PLAY_LABEL=mychange npm run play   # tag this batch for later diff
//
// Notes:
//   - Each game is a real multiplayer session. 5 runs at the 180s cap is
//     ~15 min of wall clock worst-case; deaths usually happen faster.
//   - The bot's IPv6 fast-fail (see src/bot.user.js) is what makes this
//     usable on networks where IPv6 ws endpoints are unreachable.

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BOT_PATH = path.resolve(__dirname, '..', 'src', 'bot.user.js');
const TARGET_URL = process.env.TARGET_URL || 'https://slither.io';
const RUN_COUNT = parseInt(process.env.RUN_COUNT || '15', 10);
const RUN_TIMEOUT_MS = parseInt(process.env.RUN_TIMEOUT_S || '180', 10) * 1000;
const SHOT_INTERVAL_MS = 2000;
const SHOT_BUFFER_SIZE = 3;
const NICK = process.env.NICK || 'nope-rope';
const LABEL = (process.env.PLAY_LABEL || 'realgame').replace(/[^a-zA-Z0-9_-]/g, '-');

test('automated slither.io play loop', async ({ page }) => {
  // 90s headroom per game: connect + play + timeout + UI settle.
  test.setTimeout((RUN_TIMEOUT_MS + 90_000) * RUN_COUNT + 60_000);

  const browserLogs = [];
  page.on('console', (msg) => {
    const text = `[browser:${msg.type()}] ${msg.text()}`;
    browserLogs.push(text);
    // Forward only meaningful bot lifecycle events. The 2Hz `tick:` log
    // is useful when debugging interactively but is just noise here.
    const t = msg.text();
    if (
      t.includes('[nope-rope-9000]') &&
      !t.includes('tick:') &&
      !t.includes('setAcceleration')
    ) {
      console.log(text);
    }
  });
  page.on('pageerror', (err) => console.log('[pageerror]', String(err)));

  // Pre-seed the nick so the bot's autonick poll fills it on the first
  // page paint, no race with manual interaction.
  await page.addInitScript((nick) => {
    try { localStorage.setItem('nr9k_nick', nick); } catch (e) {}
  }, NICK);
  await page.addInitScript({ path: BOT_PATH });

  console.log(`navigating to ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  console.log('waiting for game scripts to bootstrap (window.connect + window.nick)...');
  await page.waitForFunction(
    () => typeof window.connect === 'function' && !!window.nick && window.nick.value,
    null,
    { timeout: 30_000 }
  );
  console.log('game ready, bot loaded:', await page.evaluate(() => !!window.nr9k));

  const runs = [];
  for (let i = 0; i < RUN_COUNT; i++) {
    console.log(`\n=== run ${i + 1}/${RUN_COUNT} ===`);

    // Snapshot history length so we can detect the new entry after death.
    const historyBefore = await page.evaluate(
      () => (window.nr9k.history() || []).length
    );

    // Click play. window.connect() is slither's own entry point.
    await page.evaluate(() => window.connect());

    // Wait for the game to actually start. Some lobbies take a few seconds.
    try {
      await page.waitForFunction(() => window.playing === true, null, { timeout: 30_000 });
    } catch (e) {
      console.log('  connect() did not lead to a playing state in 30s; retrying after pause');
      await page.waitForTimeout(3_000);
      i--; // retry this slot
      continue;
    }

    console.log('  game started, enabling bot');
    await page.evaluate(() => {
      window.nr9k.toggle(true);
      // Force the debug overlay on so death screenshots show what the bot
      // was actually computing: lethal/warn arcs, head ghosts, food target,
      // chosen heading. Without this, screenshots are just gameplay frames
      // with no insight into the bot's decision state.
      window.nr9k.overlay(true);
    });

    // Wait for death or timeout via polling, capturing rolling screenshots.
    // window.playing flipping false comes AFTER the game's death animation
    // starts, so a single screenshot taken at that point only shows the
    // post-death menu. Instead we shoot every SHOT_INTERVAL_MS and keep
    // only the most recent SHOT_BUFFER_SIZE files — when the loop exits,
    // those are the last few frames before death.
    const shotDir = path.resolve(__dirname, '..', 'play-deaths', LABEL);
    fs.mkdirSync(shotDir, { recursive: true });
    const startedAt = Date.now();
    let died = false;
    const shotBuffer = [];
    let nextShotAt = startedAt + SHOT_INTERVAL_MS;

    while (Date.now() - startedAt < RUN_TIMEOUT_MS) {
      const stillPlaying = await page.evaluate(() => window.playing);
      if (!stillPlaying) {
        died = true;
        break;
      }
      if (Date.now() >= nextShotAt) {
        const ageS = ((Date.now() - startedAt) / 1000).toFixed(1);
        const shotFile = path.join(shotDir, `run-${i + 1}-t${ageS}s.png`);
        try {
          await page.screenshot({ path: shotFile, fullPage: false });
          shotBuffer.push(shotFile);
          while (shotBuffer.length > SHOT_BUFFER_SIZE) {
            const old = shotBuffer.shift();
            try { fs.unlinkSync(old); } catch (e) {}
          }
        } catch (e) {
          // Page may be transitioning; skip this tick.
        }
        nextShotAt = Date.now() + SHOT_INTERVAL_MS;
      }
      await page.waitForTimeout(200);
    }

    if (!died) console.log(`  hit ${RUN_TIMEOUT_MS / 1000}s timeout, ending run`);
    const wallSec = (Date.now() - startedAt) / 1000;

    // Disable bot before next iteration so it doesn't immediately steer on
    // the next game's first frame.
    await page.evaluate(() => window.nr9k.toggle(false));

    // Pull the run record the bot wrote into history. If we timed out
    // mid-game, no entry exists; capture current snapshot manually.
    const historyNow = await page.evaluate(() => window.nr9k.history() || []);
    let entry;
    if (historyNow.length > historyBefore) {
      entry = historyNow[historyNow.length - 1];
      entry._timedOut = !died;
    } else {
      // Bot didn't finalize a run (e.g., we timed out and the game is
      // still alive). Try to capture current state directly.
      entry = await page.evaluate(() => {
        const s = window.nr9k.snake();
        return {
          _timedOut: true,
          _noFinalizedRun: true,
          startTime: Date.now(),
          peakLength: s && s.pts ? s.pts.length : 0,
          peakSct: s && typeof s.sct === 'number' ? s.sct : 0,
          lastSnapshot: s ? {
            xx: s.xx, yy: s.yy, sct: s.sct, sc: s.sc,
            kill_count: s.kill_count, fam: s.fam,
          } : null,
        };
      });
    }

    console.log(
      `  died=${died}  wallSec=${wallSec.toFixed(1)}  ` +
      `peakLength=${entry.peakLength}  peakLengthLegacy=${entry.peakLengthLegacy || 0}  ` +
      `peakSct=${entry.peakSct}  ` +
      `kills=${entry.lastSnapshot && entry.lastSnapshot.kill_count}`
    );
    runs.push({ ...entry, wallSec });

    // Brief settle: the death overlay needs a moment, and hammering
    // connect() right away occasionally fails.
    await page.waitForTimeout(3_000);
  }

  // --- Aggregate -----------------------------------------------------------
  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const lengths = runs.map(r => r.peakLength || 0).filter(v => v > 0);
  const lengthsLegacy = runs.map(r => r.peakLengthLegacy || 0).filter(v => v > 0);
  const scts = runs.map(r => r.peakSct || 0).filter(v => v > 0);
  const durs = runs.map(r => r.durationMs || (r.wallSec * 1000) || 0).filter(v => v > 0);
  const kills = runs.map(r => (r.lastSnapshot && r.lastSnapshot.kill_count) || 0);

  const summary = {
    timestamp: new Date().toISOString(),
    label: LABEL,
    source: 'realgame',
    targetUrl: TARGET_URL,
    runCount: runs.length,
    medianPeakLength: med(lengths),
    medianPeakLengthLegacy: med(lengthsLegacy),
    medianPeakSct: med(scts),
    medianDurationS: med(durs) / 1000,
    medianKills: med(kills),
    timeouts: runs.filter(r => r._timedOut).length,
    runs,
  };

  const root = path.resolve(__dirname, '..');
  fs.writeFileSync(path.join(root, 'realgame-results.json'), JSON.stringify(summary, null, 2));

  // Drop into the same history infrastructure so play data and bench data
  // sit side by side.
  const historyDir = path.join(root, 'bench-history');
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  const fileTs = summary.timestamp.replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(historyDir, `${fileTs}-realgame-${LABEL}.json`),
    JSON.stringify(summary, null, 2)
  );
  fs.appendFileSync(
    path.join(root, 'bench-history.jsonl'),
    JSON.stringify({
      timestamp: summary.timestamp,
      label: `realgame-${LABEL}`,
      source: 'realgame',
      runCount: summary.runCount,
      medianPeakLength: summary.medianPeakLength,
      medianPeakSct: summary.medianPeakSct,
      medianDurationS: summary.medianDurationS,
      medianKills: summary.medianKills,
      timeouts: summary.timeouts,
    }) + '\n'
  );

  console.log('\n=== REAL-GAME SUMMARY ===');
  console.log(`runs:                     ${runs.length}  (timeouts: ${summary.timeouts})`);
  console.log(`median peakLength:        ${summary.medianPeakLength}  (slither's displayed length)`);
  console.log(`median peakLengthLegacy:  ${summary.medianPeakLengthLegacy}  (s.pts.length, for comparison to pre-fix baseline)`);
  console.log(`median peakSct:           ${summary.medianPeakSct}`);
  console.log(`median duration:          ${summary.medianDurationS.toFixed(1)}s`);
  console.log(`median kills:             ${summary.medianKills}`);
  console.log(`label:                    realgame-${LABEL}`);
  console.log(`written:                  realgame-results.json`);

  expect(runs.length).toBe(RUN_COUNT);
});
