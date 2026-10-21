/**
 * CLI Test Runner for Ambiguity Detection & Parse Tree Reconstruction
 * 
 * Tests:
 * 1. Ambiguous Grammar (E -> E+E | E*E | id)
 *    - "id" -> 1 parse, not ambiguous
 *    - "id+id" -> 1 parse, not ambiguous
 *    - "id+id*id" -> 2 parses, ambiguous
 *    - "id*id+id" -> 2 parses, ambiguous
 *    - "id+id+id" -> 2 parses, ambiguous
 *    - "id+id+id+id" -> 5 parses (Catalan number), ambiguous
 * 2. Arithmetic Grammar (E -> E+T | T, T -> T*F | F, F -> (E) | id)
 *    - "id+id*id" -> exactly 1 parse, not ambiguous
 *    - "(id+id)*id" -> exactly 1 parse, not ambiguous
 *    - "id+id+id" -> exactly 1 parse, not ambiguous
 * 3. Rejected string "id+*id" -> parseCount 0, no trees, no crash
 * 4. Structural Invariants:
 *    - Leaves of every tree equal the input tokens
 *    - Every node's children match a valid production of the simplified grammar
 * 5. Bracket notation printout for "id+id*id" on the ambiguous grammar
 */

import { parseGrammar } from './src/core/grammarParser.js';
import { simplifyGrammar } from './src/core/simplifier.js';
import { convertToCNF } from './src/core/cnf.js';
import { cykParse } from './src/core/cyk.js';
import {
  countParses,
  buildTrees,
  collapseCNFArtifacts,
  analyzeAmbiguity,
  treeToBracket,
  treeToString
} from './src/core/parseTrees.js';
import { SAMPLE_GRAMMARS } from './src/core/sampleGrammars.js';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m'
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
    console.log(`  ${ANSI.green}✓ PASS:${ANSI.reset} ${message}`);
  } else {
    console.error(`  ${ANSI.red}✗ FAIL:${ANSI.reset} ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Extracts leaf symbols from a tree in left-to-right order.
 */
function getLeaves(node) {
  if (!node) return [];
  if (node.terminal) return [node.symbol];
  const leaves = [];
  for (const child of (node.children || [])) {
    leaves.push(...getLeaves(child));
  }
  return leaves;
}

/**
 * Validates that every non-terminal node in the collapsed tree matches
 * a production in the simplified grammar.
 */
function validateTreeAgainstGrammar(node, simplifiedGrammar) {
  if (!node || node.terminal) return;

  const lhs = node.symbol;
  const validProductions = simplifiedGrammar.productions[lhs] || [];
  const rhsSymbols = (node.children || []).map(c => c.symbol);

  const matches = validProductions.some(rule => {
    if (rule.length !== rhsSymbols.length) return false;
    return rule.every((sym, idx) => sym === rhsSymbols[idx]);
  });

  if (!matches) {
    throw new Error(
      `Node '${lhs} -> ${rhsSymbols.join(' ')}' does not match any production of '${lhs}' in simplified grammar! ` +
      `Valid rules for ${lhs}: ${validProductions.map(r => r.join(' ')).join(' | ')}`
    );
  }

  for (const child of node.children) {
    if (!child.terminal) {
      validateTreeAgainstGrammar(child, simplifiedGrammar);
    }
  }
}

function processGrammarPipeline(grammarText) {
  const parsed = parseGrammar(grammarText);
  if (!parsed.success) {
    throw new Error(`Parse failed: ${JSON.stringify(parsed.errors)}`);
  }
  const simplified = simplifyGrammar(parsed.grammar);
  const cnf = convertToCNF(simplified.final);
  return {
    simplifiedGrammar: simplified.final,
    cnfGrammar: cnf.final,
    trace: cnf.trace
  };
}

console.log('================================================================================');
console.log('       AMBIGUITY DETECTION & PARSE TREE RECONSTRUCTION TEST SUITE               ');
console.log('================================================================================');

// ============================================================================
// PART 1: AMBIGUOUS GRAMMAR (E -> E+E | E*E | id)
// ============================================================================
printDivider('Part 1: Classic Ambiguous Grammar (E -> E+E | E*E | id)');
const ambiguousPipeline = processGrammarPipeline(SAMPLE_GRAMMARS.ambiguous.text);

const ambiguousTestCases = [
  { input: 'id',          expectedCount: 1, expectedAmbiguous: false },
  { input: 'id+id',       expectedCount: 1, expectedAmbiguous: false },
  { input: 'id+id*id',    expectedCount: 2, expectedAmbiguous: true },
  { input: 'id*id+id',    expectedCount: 2, expectedAmbiguous: true },
  { input: 'id+id+id',    expectedCount: 2, expectedAmbiguous: true },
  { input: 'id+id+id+id', expectedCount: 5, expectedAmbiguous: true }
];

for (const tc of ambiguousTestCases) {
  const cykRes = cykParse(ambiguousPipeline.cnfGrammar, tc.input);
  const ambig = analyzeAmbiguity(cykRes, ambiguousPipeline.cnfGrammar, ambiguousPipeline.trace);

  console.log(`${ANSI.bold}Input: "${tc.input}"${ANSI.reset}`);
  assert(ambig.accepted === true, `String accepted by CYK`);
  assert(ambig.parseCount === tc.expectedCount, `Expected ${tc.expectedCount} parse(s), got ${ambig.parseCount}`);
  assert(ambig.ambiguous === tc.expectedAmbiguous, `Expected ambiguous=${tc.expectedAmbiguous}, got ${ambig.ambiguous}`);

  // Tree structural invariant checks
  for (const tree of ambig.trees) {
    const leaves = getLeaves(tree);
    assert(
      leaves.join(' ') === cykRes.tokens.join(' '),
      `Tree leaves match input tokens [${leaves.join(' ')}]`
    );
    validateTreeAgainstGrammar(tree, ambiguousPipeline.simplifiedGrammar);
  }
  assert(true, `All ${ambig.trees.length} collapsed trees adhere to simplified grammar productions`);
  console.log();
}

// ============================================================================
// PART 2: ARITHMETIC GRAMMAR (Unambiguous)
// ============================================================================
printDivider('Part 2: Unambiguous Arithmetic Grammar');
const arithmeticPipeline = processGrammarPipeline(SAMPLE_GRAMMARS.arithmetic.text);

const arithmeticTestCases = [
  { input: 'id+id*id',   expectedCount: 1 },
  { input: '(id+id)*id', expectedCount: 1 },
  { input: 'id+id+id',   expectedCount: 1 }
];

for (const tc of arithmeticTestCases) {
  const cykRes = cykParse(arithmeticPipeline.cnfGrammar, tc.input);
  const ambig = analyzeAmbiguity(cykRes, arithmeticPipeline.cnfGrammar, arithmeticPipeline.trace);

  console.log(`${ANSI.bold}Input: "${tc.input}"${ANSI.reset}`);
  assert(ambig.accepted === true, `String accepted by CYK`);
  assert(ambig.parseCount === tc.expectedCount, `Expected exactly ${tc.expectedCount} parse, got ${ambig.parseCount}`);
  assert(ambig.ambiguous === false, `Grammar is unambiguous for "${tc.input}" (parseCount = 1)`);

  for (const tree of ambig.trees) {
    const leaves = getLeaves(tree);
    assert(
      leaves.join(' ') === cykRes.tokens.join(' '),
      `Tree leaves match input tokens [${leaves.join(' ')}]`
    );
    validateTreeAgainstGrammar(tree, arithmeticPipeline.simplifiedGrammar);
  }
  assert(true, `Tree matches simplified grammar productions`);
  console.log();
}

// ============================================================================
// PART 3: REJECTED STRING (No crash, count 0, no trees)
// ============================================================================
printDivider('Part 3: Rejected String Error Handling');
const rejectedInput = 'id+*id';
console.log(`${ANSI.bold}Rejected Input: "${rejectedInput}"${ANSI.reset}`);
const rejectedCYK = cykParse(arithmeticPipeline.cnfGrammar, rejectedInput);
const rejectedAmbig = analyzeAmbiguity(rejectedCYK, arithmeticPipeline.cnfGrammar, arithmeticPipeline.trace);

assert(rejectedAmbig.accepted === false, `Rejected string accepted=false`);
assert(rejectedAmbig.parseCount === 0, `Rejected string parseCount=0`);
assert(rejectedAmbig.ambiguous === false, `Rejected string ambiguous=false`);
assert(rejectedAmbig.trees.length === 0, `No parse trees generated for rejected string`);
assert(rejectedAmbig.cnfTrees.length === 0, `No CNF parse trees generated for rejected string`);
console.log();

// ============================================================================
// PART 4: BRACKET NOTATION PRINTOUT FOR "id+id*id" (AMBIGUOUS GRAMMAR)
// ============================================================================
printDivider('Part 4: Bracket Notation of Both Parse Trees for "id+id*id"');
const targetInput = 'id+id*id';
const targetCYK = cykParse(ambiguousPipeline.cnfGrammar, targetInput);
const targetAmbig = analyzeAmbiguity(targetCYK, ambiguousPipeline.cnfGrammar, ambiguousPipeline.trace);

console.log(`${ANSI.bold}Target Input:${ANSI.reset} "${targetInput}"`);
console.log(`${ANSI.bold}Parse Count :${ANSI.reset} ${targetAmbig.parseCount}`);
console.log(`${ANSI.bold}Ambiguous   :${ANSI.reset} ${targetAmbig.ambiguous ? ANSI.yellow + 'YES' : 'NO'}${ANSI.reset}\n`);

targetAmbig.trees.forEach((tree, idx) => {
  const bracket = treeToBracket(tree);
  console.log(`${ANSI.bold}--- Parse Tree ${idx + 1} ---${ANSI.reset}`);
  console.log(`${ANSI.cyan}Bracket Notation:${ANSI.reset} ${bracket}`);
  console.log(`${ANSI.dim}Indented Text Rendering:${ANSI.reset}`);
  console.log(treeToString(tree));
  console.log();
});

assert(targetAmbig.trees.length === 2, `Reconstructed exactly 2 distinct trees`);
const bracket1 = treeToBracket(targetAmbig.trees[0]);
const bracket2 = treeToBracket(targetAmbig.trees[1]);
assert(bracket1 !== bracket2, `The 2 trees have distinct bracket structures`);

console.log(`${ANSI.bgGreen} 🎉 ALL ${passedAssertions}/${totalAssertions} AMBIGUITY ASSERTIONS PASSED SUCCESSFULLY! ${ANSI.reset}\n`);
