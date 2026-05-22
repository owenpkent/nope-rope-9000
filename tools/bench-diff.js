#!/usr/bin/env node
// Compare bench-results.json (latest run) against bench-baseline.json
// (committed reference). Shows per-seed and aggregate deltas so you can
// see whether a CFG change actually helped or just shifted noise around.
//
// Workflow:
//   npm run bench           -> writes bench-results.json
//   npm run bench:save      -> snapshots current results as the baseline
//   <edit src/bot.user.js>
//   npm run bench           -> writes new bench-results.json
//   npm run bench:diff      -> prints delta vs baseline

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const currentPath = path.join(root, 'bench-results.json');

function readJson(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`missing ${label}: ${p}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// `--against <label>` pulls the most-recent matching run from bench-history/
// instead of using bench-baseline.json. Filenames are timestamp-prefixed,
// so lexicographic sort = chronological sort.
let againstLabel = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--against' && i + 1 < argv.length) {
    againstLabel = argv[i + 1];
    break;
  }
}

let baselinePath;
if (againstLabel) {
  const dir = path.join(root, 'bench-history');
  if (!fs.existsSync(dir)) {
    console.error('no bench-history/ directory yet; run a labeled bench first.');
    process.exit(1);
  }
  const matches = fs.readdirSync(dir).filter((f) => f.endsWith(`-${againstLabel}.json`));
  if (matches.length === 0) {
    console.error(`no history matching label "${againstLabel}". try one of:`);
    const labels = new Set(
      fs.readdirSync(dir).map((f) => f.replace(/^.*?-([^-]+)\.json$/, '$1'))
    );
    for (const l of labels) console.error(`  ${l}`);
    process.exit(1);
  }
  matches.sort().reverse();
  baselinePath = path.join(dir, matches[0]);
  console.error(`comparing against: bench-history/${matches[0]}`);
} else {
  baselinePath = path.join(root, 'bench-baseline.json');
  if (!fs.existsSync(baselinePath)) {
    console.error('no baseline at bench-baseline.json');
    console.error('run `npm run bench` then `npm run bench:save` to create one,');
    console.error('or pass `--against <label>` to diff against a labeled history run.');
    process.exit(1);
  }
}

if (!fs.existsSync(currentPath)) {
  console.error('no current results at bench-results.json. run `npm run bench` first.');
  process.exit(1);
}

const baseline = readJson(baselinePath, 'baseline');
const current = readJson(currentPath, 'current');

const indexBy = (arr, key) => Object.fromEntries(arr.map((r) => [r[key], r]));
const bSeeds = indexBy(baseline.perSeed, 'seed');
const cSeeds = indexBy(current.perSeed, 'seed');
const allSeeds = Array.from(
  new Set([...Object.keys(bSeeds), ...Object.keys(cSeeds)].map(Number))
).sort((a, b) => a - b);

function delta(cur, base) {
  if (typeof cur !== 'number' || typeof base !== 'number') return '   .';
  const d = cur - base;
  if (d === 0) return '   =';
  const sign = d > 0 ? '+' : '';
  return `${sign}${d}`;
}

function pad(s, w) { return String(s).padStart(w); }

function labelOf(r) { return r.label ? ` [${r.label}]` : ''; }
console.log('=== BENCH DIFF ===');
console.log(`baseline: ${baseline.timestamp}${labelOf(baseline)}  seeds=${baseline.seeds.length}  runSeconds=${baseline.runSeconds}`);
console.log(`current:  ${current.timestamp}${labelOf(current)}  seeds=${current.seeds.length}  runSeconds=${current.runSeconds}`);
console.log('');
console.log('seed | base sct -> cur sct (Δ) | base mov -> cur mov (Δ) | base len -> cur len (Δ)');
for (const seed of allSeeds) {
  const b = bSeeds[seed] || {};
  const c = cSeeds[seed] || {};
  console.log(
    `${pad(seed, 4)} | ${pad(b.finalSct ?? '-', 8)} -> ${pad(c.finalSct ?? '-', 7)} (${pad(delta(c.finalSct, b.finalSct), 5)}) ` +
    `| ${pad(b.moved ?? '-', 8)} -> ${pad(c.moved ?? '-', 7)} (${pad(delta(c.moved, b.moved), 6)}) ` +
    `| ${pad(b.finalLength ?? '-', 8)} -> ${pad(c.finalLength ?? '-', 7)} (${pad(delta(c.finalLength, b.finalLength), 5)})`
  );
}
console.log('---');

function row(label, baseVal, curVal) {
  console.log(`${label.padEnd(20)} ${pad(baseVal, 7)} -> ${pad(curVal, 7)}  (${delta(curVal, baseVal)})`);
}
// length is the headline metric: it tracks food eaten but is smoothed by
// the snake's body-growth queue, so it shrugs off the per-frame jitter
// that makes finalSct noisy. moved is shown for completeness but is
// dominated by wall-clock variance and shouldn't be used to judge changes.
row('median length',    baseline.medianFinalLength, current.medianFinalLength);
row('median finalSct',  baseline.medianFinalSct,    current.medianFinalSct);
row('median growth',    baseline.medianGrowth,      current.medianGrowth);
row('median moved',     baseline.medianMoved,       current.medianMoved);
row('max stuck-streak', baseline.maxStuckStreakSec, current.maxStuckStreakSec);

// Net signal: count seeds whose finalLength moved in each direction. Ties
// don't count either way. A change is "real" when better >> worse; a
// roughly even split is the noise floor talking.
let better = 0, worse = 0, tied = 0;
for (const seed of allSeeds) {
  const b = bSeeds[seed], c = cSeeds[seed];
  if (!b || !c) continue;
  if (c.finalLength > b.finalLength) better++;
  else if (c.finalLength < b.finalLength) worse++;
  else tied++;
}
console.log('');
console.log(`per-seed finalLength: better=${better}  worse=${worse}  tied=${tied}`);
