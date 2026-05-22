// Tampermonkey can't import modules, so the pure helpers in
// src/lib/geometry.js are also duplicated inside the IIFE of
// src/bot.user.js. This test verifies the two copies haven't drifted.
//
// Compares function bodies (whitespace-normalized) after extracting each
// function declaration. If a test fails, sync the two copies manually.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const libPath = path.resolve(__dirname, '..', '..', 'src', 'lib', 'geometry.js');
const botPath = path.resolve(__dirname, '..', '..', 'src', 'bot.user.js');

const lib = fs.readFileSync(libPath, 'utf8');
const bot = fs.readFileSync(botPath, 'utf8');

// Extract a function body by name. Naive but good enough: matches
// `function NAME(...) { ... }` with balanced braces from the opening one.
// Returns the body string (everything between the outermost braces),
// whitespace-normalized, or null if not found.
function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(source);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  return normalize(source.slice(start, i));
}

function normalize(s) {
  // Strip comments (// and /* */), collapse whitespace, remove trailing
  // whitespace per line. Good enough to ignore formatting drift between
  // the two copies but catch actual code differences.
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SHARED = [
  'firstHitTime',
  'firstHitCapsuleTime',
  'angleBetween',
  'blendAngles',
  'bucketOf',
  'bucketAngle',
  'bucketDelta',
  'findOpenRuns',
];

for (const name of SHARED) {
  test(`sync: ${name} body matches between lib and bot`, () => {
    const fromLib = extractFunctionBody(lib, name);
    const fromBot = extractFunctionBody(bot, name);
    assert.ok(fromLib, `${name} not found in src/lib/geometry.js`);
    assert.ok(fromBot, `${name} not found in src/bot.user.js`);
    assert.equal(
      fromBot, fromLib,
      `${name} has drifted between src/bot.user.js and src/lib/geometry.js. ` +
      `Make them match.`
    );
  });
}
