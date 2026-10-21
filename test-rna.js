/**
 * CLI Test Runner for Secondary RNA Folding Analysis
 * 
 * Verifies:
 * 1. Hand-checkable cases:
 *    STRICT:
 *      - "gaaac"   -> accepted, 1 fold "(...)"
 *      - "gaac"    -> rejected (loop too short)
 *      - "aaaa"    -> rejected (ends cannot pair)
 *      - "gaaauc"  -> accepted, 1 fold "(....)"
 *      - "ggaaacc" -> accepted, exactly 2 folds "((...))" and "(.....)"
 *    PERMISSIVE:
 *      - "gc" -> distinct folds exactly {"()", ".."}
 *      - "au" -> distinct folds exactly {"()", ".."}
 *      - "ga" -> distinct folds exactly {".."}
 *      - "gg" -> distinct folds exactly {".."}
 * 2. Error handling:
 *    - "gxc" returns an error naming x at position 2
 *    - 16-base sequence returns clear length error
 * 3. Properties:
 *    - For EVERY sequence of length <= 5 on PERMISSIVE preset:
 *      validateFold passes for every fold, and when not truncated distinctFoldCount <= parseCount
 *    - 50 random sequences of length 6 to 12 on PERMISSIVE preset satisfy the same properties
 * 4. Prints parse trees vs distinct folds table for:
 *    - "ggaaacc" (strict)
 *    - "gcgc" (permissive)
 *    - "gggaaaccc" (permissive)
 */

import {
  normalizeSequence,
  isLegalPair,
  treeToDotBracket,
  validateFold,
  analyzeRNA
} from './src/core/rna.js';
import { STRICT_RNA_GRAMMAR } from './src/core/rnaGrammars.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m'
};

function printDivider(title) {
  console.log(`\n${ANSI.cyan}${ANSI.bold}================================================================================${ANSI.reset}`);
  console.log(`${ANSI.magenta}${ANSI.bold}  ${title.toUpperCase()}${ANSI.reset}`);
  console.log(`${ANSI.cyan}${ANSI.bold}================================================================================${ANSI.reset}\n`);
}

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ${ANSI.green}✓${ANSI.reset} ${message}`);
  } else {
    console.error(`  ${ANSI.red}✗ FAIL:${ANSI.reset} ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: HAND-CHECKABLE STRICT CASES
// ─────────────────────────────────────────────────────────────────────────────
printDivider('Part 1: Strict Hairpin Grammar Test Cases');

// 1. "gaaac" -> accepted, 1 fold "(...)"
const r1 = analyzeRNA('gaaac', 'strict');
assert(r1.accepted === true, '"gaaac" is accepted by strict grammar');
assert(r1.distinctFoldCount === 1, '"gaaac" yields exactly 1 distinct fold');
assert(r1.folds[0]?.dotBracket === '(...)', '"gaaac" fold is "(...)"');

// 2. "gaac" -> rejected (loop too short, length 2 < 3)
const r2 = analyzeRNA('gaac', 'strict');
assert(r2.accepted === false, '"gaac" is rejected (hairpin loop too short)');

// 3. "aaaa" -> rejected (ends cannot pair)
const r3 = analyzeRNA('aaaa', 'strict');
assert(r3.accepted === false, '"aaaa" is rejected (outer bases cannot pair)');

// 4. "gaaauc" -> accepted, 1 fold "(....)"
const r4 = analyzeRNA('gaaauc', 'strict');
assert(r4.accepted === true, '"gaaauc" is accepted by strict grammar');
assert(r4.distinctFoldCount === 1, '"gaaauc" yields exactly 1 distinct fold');
assert(r4.folds[0]?.dotBracket === '(....)', '"gaaauc" fold is "(....)"');

// 5. "ggaaacc" -> accepted, exactly 2 folds "((...))" and "(.....)"
const r5 = analyzeRNA('ggaaacc', 'strict');
assert(r5.accepted === true, '"ggaaacc" is accepted by strict grammar');
assert(r5.distinctFoldCount === 2, '"ggaaacc" yields exactly 2 distinct folds');
const folds5 = new Set(r5.folds.map(f => f.dotBracket));
assert(folds5.has('((...))'), '"ggaaacc" includes fold "((...))"');
assert(folds5.has('(.....)'), '"ggaaacc" includes fold "(.....)"');

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: HAND-CHECKABLE PERMISSIVE CASES
// ─────────────────────────────────────────────────────────────────────────────
printDivider('Part 2: Permissive Folding Grammar Test Cases');

function getFoldSet(res) {
  return new Set(res.folds.map(f => f.dotBracket));
}

// 1. "gc" -> exactly {"()", ".."}
const p1 = analyzeRNA('gc', 'permissive');
assert(p1.accepted === true, '"gc" is accepted by permissive grammar');
assert(p1.distinctFoldCount === 2, '"gc" has exactly 2 distinct folds');
const s_gc = getFoldSet(p1);
assert(s_gc.has('()') && s_gc.has('..') && s_gc.size === 2, '"gc" folds are exactly {"()", ".."}');

// 2. "au" -> exactly {"()", ".."}
const p2 = analyzeRNA('au', 'permissive');
assert(p2.accepted === true, '"au" is accepted by permissive grammar');
assert(p2.distinctFoldCount === 2, '"au" has exactly 2 distinct folds');
const s_au = getFoldSet(p2);
assert(s_au.has('()') && s_au.has('..') && s_au.size === 2, '"au" folds are exactly {"()", ".."}');

// 3. "ga" -> exactly {".."}
const p3 = analyzeRNA('ga', 'permissive');
assert(p3.accepted === true, '"ga" is accepted by permissive grammar');
assert(p3.distinctFoldCount === 1, '"ga" has exactly 1 distinct fold');
assert(p3.folds[0]?.dotBracket === '..', '"ga" fold is exactly ".."');

// 4. "gg" -> exactly {".."}
const p4 = analyzeRNA('gg', 'permissive');
assert(p4.accepted === true, '"gg" is accepted by permissive grammar');
assert(p4.distinctFoldCount === 1, '"gg" has exactly 1 distinct fold');
assert(p4.folds[0]?.dotBracket === '..', '"gg" fold is exactly ".."');

// ─────────────────────────────────────────────────────────────────────────────
// PART 3: ERROR HANDLING & INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
printDivider('Part 3: Error Handling & Validation');

const errUnknown = normalizeSequence('gxc');
assert(errUnknown.success === false, '"gxc" triggers normalization error');
assert(
  Boolean(errUnknown.error && errUnknown.error.includes('x') && errUnknown.error.includes('2')),
  `"gxc" error names 'x' at position 2: "${errUnknown.error}"`
);

const seq16 = 'acguacguacguacgu'; // 16 bases
const errLength = normalizeSequence(seq16);
assert(errLength.success === false, '16-base sequence triggers error');
assert(
  Boolean(errLength.error && (errLength.error.includes('16') || errLength.error.includes('15'))),
  `16-base sequence error clearly indicates length violation: "${errLength.error}"`
);

const rnaApiErr = analyzeRNA('gxc', 'strict');
assert(rnaApiErr.accepted === false && Boolean(rnaApiErr.error), 'analyzeRNA surfaces invalid nucleotide error');

const rnaApiLen = analyzeRNA(seq16, 'permissive');
assert(rnaApiLen.accepted === false && Boolean(rnaApiLen.error), 'analyzeRNA surfaces length limit error');
assert(normalizeSequence(' \tG A\nA A C ').sequence === 'gaaac', 'Uppercase and whitespace normalize correctly');
assert(analyzeRNA('gaaac', STRICT_RNA_GRAMMAR).folds[0]?.dotBracket === '(...)', 'Custom grammar text uses the existing pipeline');
assert(Boolean(analyzeRNA('gc', 'invalid grammar').error), 'Malformed grammar returns an error');
assert(Boolean(analyzeRNA('gc', '').error), 'Empty custom grammar returns an error');
for (const maxTrees of [0, -1, 1.5, NaN, Infinity, '5']) {
  assert(Boolean(analyzeRNA('gc', 'permissive', { maxTrees }).error), `Invalid maxTrees (${maxTrees}) returns an error`);
}
const capped = analyzeRNA('gc', 'permissive', { maxTrees: 1 });
assert(capped.enumeratedTrees === 1 && capped.truncated && /lower bound/.test(capped.note), 'Truncation respects maxTrees and labels fold count as a lower bound');
assert(capped.folds.reduce((sum, fold) => sum + fold.treeCount, 0) === 1, 'Fold treeCount counts enumerated trees');
assert(analyzeRNA('', 'strict').accepted === false, 'Strict grammar rejects the empty sequence');
const empty = analyzeRNA('', 'permissive');
assert(empty.accepted && empty.parseCount === '1' && empty.folds[0]?.dotBracket === '' && validateFold('', empty.folds[0]).valid, 'Permissive epsilon yields one valid empty fold');

const terminal = symbol => ({ symbol, terminal: true });
const sampleTree = { symbol: 'S', children: [terminal('g'), { symbol: 'L', children: [terminal('a'), terminal('a'), terminal('a')] }, terminal('c')] };
const originalTree = JSON.stringify(sampleTree);
const sampleFold = treeToDotBracket(sampleTree, 5);
assert(sampleFold.dotBracket === '(...)' && JSON.stringify(sampleTree) === originalTree, 'Tree conversion finds endpoint pairs without mutating the tree');
assert(validateFold('gaaac', sampleFold, sampleTree).valid, 'validateFold accepts a legal hairpin');
assert(!validateFold('gaaau', sampleFold, sampleTree).valid, 'validateFold rejects incorrect tree leaves');
assert(!validateFold('gaaac', { dotBracket: '....', pairs: [] }, sampleTree).valid, 'validateFold rejects incorrect dot-bracket length');
assert(!validateFold('gaaac', { dotBracket: '.(..)', pairs: [[1, 4]] }, sampleTree).valid, 'validateFold rejects illegal pairs');
assert(!validateFold('ggcc', { dotBracket: '(())', pairs: [[0, 2], [1, 3]] }, sampleTree).valid, 'validateFold rejects crossing pairs');
assert(!validateFold('gaaac', { dotBracket: '(...)', pairs: [] }, sampleTree).valid, 'validateFold rejects missing pairs');
assert(!validateFold('gaaac', { dotBracket: '.....', pairs: [] }).valid, 'validateFold requires a tree to check its leaves');

// ─────────────────────────────────────────────────────────────────────────────
// PART 4: PROPERTY VERIFICATION (LENGTH <= 5 EXHAUSTIVE + 50 RANDOM)
// ─────────────────────────────────────────────────────────────────────────────
printDivider('Part 4: Invariant & Property Tests');

const bases = ['a', 'c', 'g', 'u'];
let exhaustiveCount = 0;
let exhaustiveValidFolds = 0;
let boundChecksPassed = true;
let allFoldsValid = true;

function checkSequenceProperty(seq) {
  exhaustiveCount++;
  const res = analyzeRNA(seq, 'permissive');
  if (!res.accepted || res.error || res.folds.length === 0) {
    allFoldsValid = false;
    console.error(`Permissive grammar unexpectedly rejected ${JSON.stringify(seq)}: ${res.error}`);
    return;
  }
  if (res.folds.reduce((sum, fold) => sum + fold.treeCount, 0) !== res.enumeratedTrees) boundChecksPassed = false;

  const parseCountNum = BigInt(res.parseCount);
  if (!res.truncated && BigInt(res.distinctFoldCount) > parseCountNum) {
    boundChecksPassed = false;
    console.error(`Bound failed on ${seq}: distinctFoldCount=${res.distinctFoldCount} > parseCount=${res.parseCount}`);
  }

  for (const f of res.folds) {
    exhaustiveValidFolds++;
    const v = validateFold(seq, f, f.tree);
    if (!v.valid) {
      allFoldsValid = false;
      console.error(`validateFold failed on ${seq} with fold ${f.dotBracket}: ${v.error}`);
    }
  }
}

function generateAllPermutations(targetLen, current = '') {
  if (current.length === targetLen) {
    checkSequenceProperty(current);
    return;
  }
  for (const b of bases) {
    generateAllPermutations(targetLen, current + b);
  }
}

console.log(`${ANSI.dim}  Testing all sequences of length 0 to 5 on PERMISSIVE preset (1365 sequences)...${ANSI.reset}`);
const startExhaustive = Date.now();
for (let len = 0; len <= 5; len++) {
  generateAllPermutations(len);
}
const elapsedExhaustive = Date.now() - startExhaustive;

assert(exhaustiveCount === 1365, `Checked all 1,365 sequences of length 0..5 (elapsed: ${elapsedExhaustive}ms)`);
assert(allFoldsValid, `validateFold passed for every single fold across all 1,365 sequences (${exhaustiveValidFolds} fold evaluations)`);
assert(boundChecksPassed, 'distinctFoldCount <= parseCount held for every non-truncated sequence');

// 50 random sequences of length 6 to 12
console.log(`\n${ANSI.dim}  Testing 50 random sequences of length 6 to 12 on PERMISSIVE preset...${ANSI.reset}`);
let randomValid = true;
let randomBounds = true;
// Seeded pseudo-random cases keep failures reproducible.
let randomSeed = 20261020;
function random() {
  randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0;
  return randomSeed / 0x100000000;
}

for (let i = 0; i < 50; i++) {
  const len = Math.floor(random() * 7) + 6; // 6 to 12
  let seq = '';
  for (let j = 0; j < len; j++) {
    seq += bases[Math.floor(random() * bases.length)];
  }

  const res = analyzeRNA(seq, 'permissive', { maxTrees: 100 });
  if (!res.accepted || res.error || !res.folds.length) randomValid = false;
  if (res.accepted) {
    const parseCountBig = BigInt(res.parseCount);
    if (!res.truncated && BigInt(res.distinctFoldCount) > parseCountBig) {
      randomBounds = false;
    }
    for (const f of res.folds) {
      const v = validateFold(seq, f, f.tree);
      if (!v.valid) {
        randomValid = false;
        console.error(`validateFold failed on random seq ${seq}: ${v.error}`);
      }
    }
  }
}

assert(randomValid, 'validateFold passed for all folds across 50 random sequences of length 6..12');
assert(randomBounds, 'distinctFoldCount <= parseCount held for all 50 random sequences');

// ─────────────────────────────────────────────────────────────────────────────
// PART 5: TABLE OF PARSE TREES VS DISTINCT FOLDS
// ─────────────────────────────────────────────────────────────────────────────
printDivider('Part 5: Parse Trees vs. Distinct Secondary Folds');

const tableCases = [
  { preset: 'strict', seq: 'ggaaacc' },
  { preset: 'permissive', seq: 'gcgc' },
  { preset: 'permissive', seq: 'gggaaaccc' }
];

console.log('------------------------------------------------------------------------------------------------');
console.log(`| ${'Preset'.padEnd(12)} | ${'Sequence'.padEnd(12)} | ${'Total Parse Trees'.padEnd(19)} | ${'Distinct Folds'.padEnd(15)} | ${'Dot-Bracket Folds'.padEnd(25)} |`);
console.log('------------------------------------------------------------------------------------------------');

for (const tc of tableCases) {
  const res = analyzeRNA(tc.seq, tc.preset, { maxTrees: 500 });
  const foldsStr = res.folds.map(f => f.dotBracket).slice(0, 3).join(', ') + (res.folds.length > 3 ? ', ...' : '');
  const truncNote = res.truncated ? ` (${res.enumeratedTrees} enum)` : '';
  const foldCountLabel = res.truncated ? `>= ${res.distinctFoldCount}` : String(res.distinctFoldCount);
  console.log(
    `| ${tc.preset.padEnd(12)} | ${tc.seq.padEnd(12)} | ${(res.parseCount + truncNote).padEnd(19)} | ${foldCountLabel.padEnd(15)} | ${foldsStr.padEnd(25)} |`
  );
}
console.log('------------------------------------------------------------------------------------------------\n');

printDivider('Part 6: HTTP Endpoint Tests');
// Reserve a free local port before starting an isolated server process.
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = spawn(process.execPath, ['src/server.js'], {
  cwd: new URL('.', import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });
const baseURL = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(`${baseURL}/api/samples`)).ok;
    } catch { /* Wait for the child server to bind. */ }
    if (ready || server.exitCode !== null) break;
    await delay(50);
  }
  if (!ready) throw new Error(`Test server did not start: ${serverOutput}`);
  async function post(route, body) {
    const response = await fetch(`${baseURL}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }
  for (const preset of ['strict', 'permissive']) {
    const sequence = preset === 'strict' ? 'ggaaacc' : 'gc';
    const response = await post('/api/rna', { sequence, preset });
    const { success, ...result } = response.body;
    assert(response.status === 200 && success && JSON.stringify(result) === JSON.stringify(analyzeRNA(sequence, preset)), `/api/rna returns the analyzeRNA result (${preset})`);
  }
  const custom = await post('/api/rna', { sequence: 'gaaac', preset: 'permissive', grammarText: STRICT_RNA_GRAMMAR });
  assert(custom.body.folds[0]?.dotBracket === '(...)', '/api/rna honors custom grammar over preset');
  for (const body of [{}, { sequence: 123 }, { sequence: 'gc', preset: 'typo' }, { sequence: 'gc', grammarText: 123 }]) {
    const response = await post('/api/rna', body);
    assert(response.status === 400 && Boolean(response.body.error), '/api/rna rejects malformed request fields');
  }
  for (const sequence of ['gxc', seq16]) {
    const response = await post('/api/rna', { sequence });
    assert(response.body.success === false && Boolean(response.body.error), `/api/rna surfaces sequence error (${sequence})`);
  }
  const rejected = await post('/api/rna', { sequence: 'gaac', preset: 'strict' });
  assert(rejected.body.success && !rejected.body.accepted && rejected.body.parseCount === '0', '/api/rna distinguishes grammar rejection from invalid input');
  const legacy = await post('/api/cyk', { grammarText: 'S -> a', inputString: 'a' });
  assert(legacy.body.success && legacy.body.accepted && legacy.body.ambiguity.parseCount === 1, 'Existing /api/cyk response still works');
} finally {
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log(`${ANSI.bold}--------------------------------------------------------------------------------${ANSI.reset}`);
console.log(`Total: ${totalAssertions} assertions, Passed: ${passedAssertions}, Failed: ${totalAssertions - passedAssertions}`);
if (passedAssertions === totalAssertions) {
  console.log(`${ANSI.green}${ANSI.bold}ALL RNA FOLDING TESTS PASSED!${ANSI.reset}\n`);
} else {
  console.error(`${ANSI.red}${ANSI.bold}SOME TESTS FAILED!${ANSI.reset}\n`);
  process.exit(1);
}
