/**
 * CLI Test Runner for Ambiguity Resolution Demo & Grammar Comparison
 * 
 * Verifies:
 * 1. Arithmetic preset (A vs B):
 *    - "id+id*id" -> A: 2 parses, B: 1 parse
 *    - "id*id+id" -> A: 2, B: 1
 *    - "id+id+id" -> A: 2, B: 1
 *    - "id" -> A: 1, B: 1
 *    - Equivalence summary reports matching verdicts on all four
 * 2. Recursive preset (S -> aS | Sa | a vs S -> aS | a):
 *    - "aa" -> A: 2 parses, B: 1 parse
 *    - "a" -> A: 1, B: 1
 * 3. Invalid Grammar B returns an error for that side without crashing
 * 4. Prints formatted parse counts table
 */

import { parseGrammar } from './src/core/grammarParser.js';
import { simplifyGrammar } from './src/core/simplifier.js';
import { convertToCNF } from './src/core/cnf.js';
import { cykParse } from './src/core/cyk.js';
import { analyzeAmbiguity } from './src/core/parseTrees.js';

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

/**
 * Normalizes input CFG where single-letter non-terminals are concatenated with terminals (e.g. aS -> a S, Sa -> S a)
 */
function normalizeGrammar(grammarText) {
  if (!grammarText || typeof grammarText !== 'string') return grammarText;
  const lines = grammarText.split(/\r?\n/);
  const nts = [];
  for (const l of lines) {
    const parts = l.split(/->|→/);
    if (parts.length > 1) {
      const lhs = parts[0].trim();
      if (lhs && !nts.includes(lhs)) nts.push(lhs);
    }
  }
  let result = grammarText;
  for (const nt of nts) {
    if (nt.length === 1 && /^[A-Z]$/.test(nt)) {
      result = result
        .replace(new RegExp('([a-z0-9])(' + nt + ')(?![a-zA-Z0-9_])', 'g'), '$1 $2')
        .replace(new RegExp('(^|[^a-zA-Z0-9_])(' + nt + ')([a-z0-9])', 'g'), '$1$2 $3');
    }
  }
  return result;
}

/**
 * Executes the comparison logic matching /api/compare
 */
export function compareGrammars(grammarA, grammarB, inputStrings, options = {}) {
  function compilePipeline(grammarText) {
    try {
      const normalized = normalizeGrammar(grammarText);
      const parsed = parseGrammar(normalized, options);
      if (!parsed.success) {
        return { error: parsed.errors.map(e => e.message).join('; ') };
      }
      const simplified = simplifyGrammar(parsed.grammar);
      const cnf = convertToCNF(simplified.final);
      return { cnf: cnf.final, trace: cnf.trace };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }

  function runForString(compiled, inputStr) {
    if (compiled.error) {
      return { accepted: false, parseCount: 0, ambiguous: false, trees: [], error: compiled.error };
    }
    try {
      const cyk = cykParse(compiled.cnf, inputStr);
      if (cyk.error) {
        return { accepted: false, parseCount: 0, ambiguous: false, trees: [], error: cyk.error };
      }
      if (!cyk.accepted) {
        return { accepted: false, parseCount: 0, ambiguous: false, trees: [], error: null };
      }
      const amb = analyzeAmbiguity(cyk, compiled.cnf, compiled.trace, 10);
      return {
        accepted: true,
        parseCount: typeof amb.parseCount === 'bigint' ? Number(amb.parseCount) : amb.parseCount,
        ambiguous: amb.ambiguous,
        truncated: amb.truncated,
        trees: amb.trees || [],
        error: null
      };
    } catch (err) {
      return { accepted: false, parseCount: 0, ambiguous: false, trees: [], error: err.message || String(err) };
    }
  }

  const pipelineA = compilePipeline(grammarA);
  const pipelineB = compilePipeline(grammarB);

  const rows = inputStrings.map(str => {
    const a = runForString(pipelineA, str);
    const b = runForString(pipelineB, str);
    const verdictMatch = (!a.error && !b.error) ? (a.accepted === b.accepted) : null;
    return { string: str, a, b, verdictMatch };
  });

  const testedCount = rows.filter(r => r.verdictMatch !== null).length;
  const matchCount  = rows.filter(r => r.verdictMatch === true).length;

  return {
    rows,
    equivalence: {
      testedStrings: testedCount,
      matchingVerdicts: matchCount,
      allMatch: matchCount === testedCount && testedCount > 0
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Arithmetic Preset
// ─────────────────────────────────────────────────────────────────────────────
printDivider('Test 1: Arithmetic Preset (Ambiguous vs Layered Precedence)');

const arithA = `E -> E+E | E*E | id`;
const arithB = `E -> E+T | T
T -> T*F | F
F -> (E) | id`;

const arithStrings = ['id+id*id', 'id*id+id', 'id+id+id', 'id'];

const res1 = compareGrammars(arithA, arithB, arithStrings);

console.log(`${ANSI.bold}Parse Counts Table:${ANSI.reset}`);
console.log('----------------------------------------------------------------------');
console.log(`| ${'Input String'.padEnd(16)} | ${'Grammar A (Ambiguous)'.padEnd(22)} | ${'Grammar B (Resolved)'.padEnd(22)} |`);
console.log('----------------------------------------------------------------------');

for (const r of res1.rows) {
  const descA = r.a.error ? `Error: ${r.a.error}` : (!r.a.accepted ? 'rejected' : `${r.a.parseCount} parse${r.a.parseCount === 1 ? '' : 's'}${r.a.ambiguous ? ', ambiguous' : ''}`);
  const descB = r.b.error ? `Error: ${r.b.error}` : (!r.b.accepted ? 'rejected' : `${r.b.parseCount} parse${r.b.parseCount === 1 ? '' : 's'}${r.b.ambiguous ? ', ambiguous' : ''}`);
  console.log(`| ${r.string.padEnd(16)} | ${descA.padEnd(22)} | ${descB.padEnd(22)} |`);
}
console.log('----------------------------------------------------------------------\n');

assert(res1.rows[0].a.parseCount === 2 && res1.rows[0].a.ambiguous === true, '"id+id*id" in Grammar A has 2 parses (ambiguous)');
assert(res1.rows[0].b.parseCount === 1 && res1.rows[0].b.ambiguous === false, '"id+id*id" in Grammar B has 1 parse (unambiguous)');

assert(res1.rows[1].a.parseCount === 2 && res1.rows[1].a.ambiguous === true, '"id*id+id" in Grammar A has 2 parses (ambiguous)');
assert(res1.rows[1].b.parseCount === 1 && res1.rows[1].b.ambiguous === false, '"id*id+id" in Grammar B has 1 parse (unambiguous)');

assert(res1.rows[2].a.parseCount === 2 && res1.rows[2].a.ambiguous === true, '"id+id+id" in Grammar A has 2 parses (ambiguous)');
assert(res1.rows[2].b.parseCount === 1 && res1.rows[2].b.ambiguous === false, '"id+id+id" in Grammar B has 1 parse (unambiguous)');

assert(res1.rows[3].a.parseCount === 1 && res1.rows[3].a.ambiguous === false, '"id" in Grammar A has 1 parse (unambiguous)');
assert(res1.rows[3].b.parseCount === 1 && res1.rows[3].b.ambiguous === false, '"id" in Grammar B has 1 parse (unambiguous)');

assert(res1.equivalence.allMatch === true, 'Equivalence summary reports allMatch = true');
assert(res1.equivalence.matchingVerdicts === 4, 'Equivalence summary reports 4 matching verdicts');
assert(res1.equivalence.testedStrings === 4, 'Equivalence summary reports 4 tested strings');

// ─────────────────────────────────────────────────────────────────────────────
// 2. String Recursive Preset
// ─────────────────────────────────────────────────────────────────────────────
printDivider('Test 2: Linear Grammar Preset (S -> aS | Sa | a vs S -> aS | a)');

const linearA = `S -> aS | Sa | a`;
const linearB = `S -> aS | a`;
const linearStrings = ['a', 'aa', 'aaa'];

const res2 = compareGrammars(linearA, linearB, linearStrings);

console.log(`${ANSI.bold}Parse Counts Table:${ANSI.reset}`);
console.log('----------------------------------------------------------------------');
console.log(`| ${'Input String'.padEnd(16)} | ${'Grammar A (Ambiguous)'.padEnd(22)} | ${'Grammar B (Resolved)'.padEnd(22)} |`);
console.log('----------------------------------------------------------------------');
for (const r of res2.rows) {
  const descA = `${r.a.parseCount} parse${r.a.parseCount === 1 ? '' : 's'}${r.a.ambiguous ? ', ambiguous' : ''}`;
  const descB = `${r.b.parseCount} parse${r.b.parseCount === 1 ? '' : 's'}${r.b.ambiguous ? ', ambiguous' : ''}`;
  console.log(`| ${r.string.padEnd(16)} | ${descA.padEnd(22)} | ${descB.padEnd(22)} |`);
}
console.log('----------------------------------------------------------------------\n');

assert(res2.rows[0].a.parseCount === 1 && res2.rows[0].b.parseCount === 1, '"a" has 1 parse in both A and B');
assert(res2.rows[1].a.parseCount === 2 && res2.rows[1].a.ambiguous === true, '"aa" has 2 parses in A (ambiguous)');
assert(res2.rows[1].b.parseCount === 1 && res2.rows[1].b.ambiguous === false, '"aa" has 1 parse in B (unambiguous)');
assert(res2.rows[2].a.parseCount === 4 && res2.rows[2].b.parseCount === 1, '"aaa" has 4 parses in A and 1 in B');
assert(res2.equivalence.allMatch === true, 'Equivalence summary reports allMatch = true for linear grammars');

// ─────────────────────────────────────────────────────────────────────────────
// 3. Error Handling (Malformed Grammar & Unknown Symbols)
// ─────────────────────────────────────────────────────────────────────────────
printDivider('Test 3: Error Handling Without Crashing');

const invalidGrammarB = `-> invalid | missing LHS`;
const res3 = compareGrammars(arithA, invalidGrammarB, ['id+id', 'unknown!']);

assert(res3.rows[0].a.accepted === true, 'Grammar A still parses normally when Grammar B is invalid');
assert(Boolean(res3.rows[0].b.error), 'Grammar B returns error for invalid syntax without crashing');
assert(Boolean(res3.rows[1].a.error), 'Input with unknown symbol returns error without crashing');

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${ANSI.bold}--------------------------------------------------------------------------------${ANSI.reset}`);
console.log(`Total: ${totalAssertions} assertions, Passed: ${passedAssertions}, Failed: ${totalAssertions - passedAssertions}`);
if (passedAssertions === totalAssertions) {
  console.log(`${ANSI.green}${ANSI.bold}ALL TESTS PASSED!${ANSI.reset}\n`);
} else {
  console.error(`${ANSI.red}${ANSI.bold}SOME TESTS FAILED!${ANSI.reset}\n`);
  process.exit(1);
}
