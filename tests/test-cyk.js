/**
 * CLI Test Runner for CYK (Cocke-Younger-Kasami) Parsing Module
 * 
 * Verifies CYK parsing on:
 * 1. Arithmetic Grammar (Accepts: "id+id*id", "(id+id)*id", "id"; Rejects: "id+*id", "(id", "id id", "")
 * 2. Ambiguous Grammar (Accepts: "id+id*id", "id+id+id"; Rejects: "id+")
 * 3. Unit & Useless Grammar (Accepts: "a", "c"; Rejects: "d", "e")
 * 4. Unknown Symbol Input (Asserts clear error message and no crash)
 * 5. Detailed Triangular CYK Table Printout for "id+id*id"
 */

import { parseGrammar } from '../src/core/grammarParser.js';
import { simplifyGrammar } from '../src/core/simplifier.js';
import { convertToCNF } from '../src/core/cnf.js';
import { cykParse, formatCYKTable } from '../src/core/cyk.js';
import { SAMPLE_GRAMMARS } from './fixtures/sampleGrammars.js';

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

function prepareCNFGrammar(grammarText) {
  const parsed = parseGrammar(grammarText);
  if (!parsed.success) {
    throw new Error(`Failed to parse grammar: ${JSON.stringify(parsed.errors)}`);
  }
  const simplified = simplifyGrammar(parsed.grammar);
  const cnf = convertToCNF(simplified.final);
  return cnf.final;
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

console.log('================================================================================');
console.log('         CYK (COCKE-YOUNGER-KASAMI) PARSING ALGORITHM TEST SUITE                ');
console.log('================================================================================');

// ============================================================================
// PART 1: ARITHMETIC GRAMMAR
// ============================================================================
printDivider('Part 1: Arithmetic Expression Grammar');
const arithmeticCNF = prepareCNFGrammar(SAMPLE_GRAMMARS.arithmetic.text);

const arithmeticAcceptTests = [
  'id+id*id',
  '(id+id)*id',
  'id'
];

const arithmeticRejectTests = [
  'id+*id',
  '(id',
  'id id',
  ''
];

console.log(`${ANSI.bold}Testing Strings to ACCEPT:${ANSI.reset}`);
for (const input of arithmeticAcceptTests) {
  const res = cykParse(arithmeticCNF, input);
  assert(res.accepted === true, `Arithmetic grammar accepted "${input}"`);
}

console.log(`\n${ANSI.bold}Testing Strings to REJECT:${ANSI.reset}`);
for (const input of arithmeticRejectTests) {
  const res = cykParse(arithmeticCNF, input);
  assert(res.accepted === false, `Arithmetic grammar rejected "${input}"`);
}

// ============================================================================
// PART 2: AMBIGUOUS GRAMMAR
// ============================================================================
printDivider('Part 2: Classic Ambiguous Grammar (E -> E+E | E*E | id)');
const ambiguousCNF = prepareCNFGrammar(SAMPLE_GRAMMARS.ambiguous.text);

const ambiguousAcceptTests = [
  'id+id*id',
  'id+id+id'
];

const ambiguousRejectTests = [
  'id+'
];

console.log(`${ANSI.bold}Testing Strings to ACCEPT:${ANSI.reset}`);
for (const input of ambiguousAcceptTests) {
  const res = cykParse(ambiguousCNF, input);
  assert(res.accepted === true, `Ambiguous grammar accepted "${input}"`);
}

console.log(`\n${ANSI.bold}Testing Strings to REJECT:${ANSI.reset}`);
for (const input of ambiguousRejectTests) {
  const res = cykParse(ambiguousCNF, input);
  assert(res.accepted === false, `Ambiguous grammar rejected "${input}"`);
}

// ============================================================================
// PART 3: UNIT & USELESS GRAMMAR
// ============================================================================
printDivider('Part 3: Unit & Useless Grammar (S -> a | c)');
const unitUselessCNF = prepareCNFGrammar(SAMPLE_GRAMMARS.simplification.text);

const unitAcceptTests = ['a', 'c'];
const unitRejectTests = ['d', 'e'];

console.log(`${ANSI.bold}Testing Strings to ACCEPT (Useful terminal strings):${ANSI.reset}`);
for (const input of unitAcceptTests) {
  const res = cykParse(unitUselessCNF, input);
  assert(res.accepted === true, `Unit & Useless grammar accepted "${input}"`);
}

console.log(`\n${ANSI.bold}Testing Strings to REJECT (Removed useless symbols):${ANSI.reset}`);
for (const input of unitRejectTests) {
  const res = cykParse(unitUselessCNF, input);
  assert(res.accepted === false, `Unit & Useless grammar rejected "${input}" (removed during simplification)`);
}

// ============================================================================
// PART 4: UNKNOWN SYMBOL TEST
// ============================================================================
printDivider('Part 4: Unknown Symbol Error Handling');
const unknownInput = 'id + @ * id';
console.log(`Input with unknown symbol: "${unknownInput}"`);
const unknownRes = cykParse(arithmeticCNF, unknownInput);

assert(unknownRes.accepted === false, 'Parser rejected input with unknown symbol');
assert(typeof unknownRes.error === 'string', 'Parser returned an error message');
assert(unknownRes.error.includes('@'), `Error correctly names unknown symbol '@': "${unknownRes.error}"`);
assert(unknownRes.error.includes('position 6'), `Error correctly pinpoints position 6: "${unknownRes.error}"`);

// ============================================================================
// PART 5: FILLED CYK TABLE FOR "id+id*id" ON ARITHMETIC GRAMMAR
// ============================================================================
printDivider('Part 5: Filled Triangular CYK Table for "id+id*id"');
const targetInput = 'id+id*id';
const targetResult = cykParse(arithmeticCNF, targetInput);

console.log(`${ANSI.bold}Target Input:${ANSI.reset} "${targetInput}"`);
console.log(`${ANSI.bold}CNF Start Symbol:${ANSI.reset} ${targetResult.startSymbol}`);
console.log(`${ANSI.bold}Accepted:${ANSI.reset} ${targetResult.accepted ? ANSI.green + 'YES' : ANSI.red + 'NO'}${ANSI.reset}\n`);

console.log(formatCYKTable(targetResult));
console.log();

// Display cell derivations breakdown
console.log(`${ANSI.bold}Detailed Top Cell [0, len=5] Derivations:${ANSI.reset}`);
const topDerivations = targetResult.table[0][5]?.['E'] || [];
console.log(`Total derivations for Start Symbol E in table[0][5]: ${topDerivations.length}`);
topDerivations.forEach((d, idx) => {
  console.log(`  Derivation ${idx + 1}: ${d.rule} (split at token index k = ${d.split})`);
  console.log(`    - Left  : [${d.left.i}, len=${d.left.len}] -> ${d.left.symbol}`);
  console.log(`    - Right : [${d.right.i}, len=${d.right.len}] -> ${d.right.symbol}`);
});

console.log(`ALL ${passedAssertions}/${totalAssertions} CYK ASSERTIONS PASSED SUCCESSFULLY!`);
