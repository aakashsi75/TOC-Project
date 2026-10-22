/**
 * CLI Test Runner for Chomsky Normal Form (CNF) Conversion Module
 * 
 * Verifies CNF conversion on:
 * 1. Arithmetic Expression Grammar
 * 2. Unit & Useless Symbols Grammar
 * 3. Long Production Grammar (S -> aSbSc | a)
 */

import { parseGrammar, formatGrammar } from '../src/core/grammarParser.js';
import { simplifyGrammar } from '../src/core/simplifier.js';
import { convertToCNF, isCNF } from '../src/core/cnf.js';
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

const testGrammars = [
  {
    id: 'arithmetic',
    name: '1) Arithmetic Expression Grammar',
    text: SAMPLE_GRAMMARS.arithmetic.text
  },
  {
    id: 'simplification',
    name: '2) Unit & Useless Grammar',
    text: SAMPLE_GRAMMARS.simplification.text
  },
  {
    id: 'long_production',
    name: '3) Long Production Grammar (S -> aSbSc | a)',
    text: `S -> a S b S c | a`
  }
];

let allPassed = true;

testGrammars.forEach((test, idx) => {
  printDivider(`TEST CASE ${idx + 1}: ${test.name}`);

  console.log(`${ANSI.bold}Raw Input Grammar:${ANSI.reset}`);
  console.log(test.text);
  console.log();

  // 1. Parse
  const parsed = parseGrammar(test.text);
  if (!parsed.success) {
    console.error(`${ANSI.bgRed} PARSE FAILED ${ANSI.reset}`, parsed.errors);
    allPassed = false;
    return;
  }

  // 2. Simplify
  const simplified = simplifyGrammar(parsed.grammar);
  console.log(`${ANSI.bold}Simplified Grammar (Free of Useless/Eps/Unit rules):${ANSI.reset}`);
  console.log(simplified.formattedFinal || '(Empty)');
  console.log();

  // 3. Convert to CNF
  const cnfResult = convertToCNF(simplified.final);

  console.log(`${ANSI.bold}--- Step 1: Replace Terminals (Length >= 2) ---${ANSI.reset}`);
  console.log(cnfResult.step1.formatted || '(No changes)');
  console.log();

  console.log(`${ANSI.bold}--- Step 2: Binarize Productions (Length > 2) ---${ANSI.reset}`);
  console.log(cnfResult.step2.formatted || '(No changes)');
  console.log();

  console.log(`${ANSI.bold}--- Final CNF Grammar ---${ANSI.reset}`);
  console.log(cnfResult.formattedFinal);
  console.log();

  // 4. Trace
  console.log(`${ANSI.bold}--- Conversion Trace (New Non-Terminals) ---${ANSI.reset}`);
  if (cnfResult.trace.length === 0) {
    console.log(`${ANSI.dim}  (No new non-terminals introduced; grammar was already in CNF)${ANSI.reset}`);
  } else {
    console.table(cnfResult.trace.map(t => ({
      'New Symbol': t.name,
      'Source Production': t.production,
      'Reason': t.reason
    })));
  }
  console.log();

  // 5. Validation Assert
  const validation = isCNF(cnfResult.final);
  if (validation.valid) {
    console.log(`${ANSI.bgGreen} VALIDATION: Valid Chomsky Normal Form (CNF) ${ANSI.reset}`);
  } else {
    allPassed = false;
    console.log(`${ANSI.bgRed} VALIDATION FAILED: Not in CNF ${ANSI.reset}`);
    console.log('Offending productions:', validation.offending);
  }
  console.log();
});

if (allPassed) {
  console.log(`${ANSI.green}${ANSI.bold}🎉 ALL CNF TESTS PASSED SUCCESSFULLY!${ANSI.reset}\n`);
} else {
  console.error(`${ANSI.red}${ANSI.bold}❌ SOME CNF TESTS FAILED.${ANSI.reset}\n`);
  process.exit(1);
}