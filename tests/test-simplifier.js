/**
 * CLI Test Runner for Grammar Simplification Module
 * Demonstrates incremental 3-step transformation on the "Unit & Useless" test grammar.
 */

import { parseGrammar, formatGrammar } from '../src/core/grammarParser.js';
import {
  removeUselessSymbols,
  removeEpsilonProductions,
  removeUnitProductions,
  simplifyGrammar
} from '../src/core/simplifier.js';
import { SAMPLE_GRAMMARS } from './fixtures/sampleGrammars.js';

console.log('================================================================================');
console.log('       CONTEXT-FREE GRAMMAR SIMPLIFICATION — INCREMENTAL 3-STEP PIPELINE       ');
console.log('================================================================================\n');

// 1. Load the "Unit & Useless" test grammar
const sampleKey = 'simplification';
const sample = SAMPLE_GRAMMARS[sampleKey];

console.log(`[TARGET GRAMMAR]: ${sample.name}`);
console.log(`[DESCRIPTION]   : ${sample.description}\n`);

const parsed = parseGrammar(sample.text);
if (!parsed.success) {
  console.error('Failed to parse initial grammar:', parsed.errors);
  process.exit(1);
}

const initialGrammar = parsed.grammar;

console.log('--------------------------------------------------------------------------------');
console.log('ORIGINAL GRAMMAR:');
console.log('--------------------------------------------------------------------------------');
console.log(formatGrammar(initialGrammar));
console.log(`\n  Non-Terminals (VN) : { ${initialGrammar.nonTerminals.join(', ')} }`);
console.log(`  Terminals     (VT) : { ${initialGrammar.terminals.join(', ')} }`);
console.log(`  Start Symbol  (S)  : ${initialGrammar.startSymbol}`);
console.log('\n================================================================================\n');

// STEP 1: Remove Useless Symbols
console.log('--------------------------------------------------------------------------------');
console.log('STEP 1: REMOVE USELESS SYMBOLS');
console.log('  1a. Non-generating symbols (cannot derive terminal string)');
console.log('  1b. Unreachable symbols (cannot be reached from start symbol S)');
console.log('--------------------------------------------------------------------------------');
const step1Result = removeUselessSymbols(initialGrammar);

console.log('Transformation Summary:');
console.log(`  - Non-Generating NT removed : ${step1Result.details.nonGeneratingNT.length > 0 ? step1Result.details.nonGeneratingNT.join(', ') : 'None'}`);
console.log(`  - Unreachable NT removed    : ${step1Result.details.unreachableNT.length > 0 ? step1Result.details.unreachableNT.join(', ') : 'None'}`);
console.log(`  - Unreachable T removed     : ${step1Result.details.unreachableT.length > 0 ? step1Result.details.unreachableT.join(', ') : 'None'}`);
console.log('\nGrammar after Step 1:');
console.log(step1Result.formatted);
console.log('\n================================================================================\n');

// STEP 2: Eliminate Epsilon Productions
console.log('--------------------------------------------------------------------------------');
console.log('STEP 2: ELIMINATE EPSILON PRODUCTIONS (A -> ε)');
console.log('  2a. Find all nullable non-terminals (A =>* ε)');
console.log('  2b. Substitute nullable positions across productions');
console.log('  2c. Preserve ε at start symbol only if language contains empty string');
console.log('--------------------------------------------------------------------------------');
const step2Result = removeEpsilonProductions(step1Result.grammar);

console.log('Transformation Summary:');
console.log(`  - Nullable Non-Terminals    : ${step2Result.details.nullableNT.length > 0 ? step2Result.details.nullableNT.join(', ') : 'None (no ε-productions in this grammar)'}`);
console.log(`  - Start Symbol ε added      : ${step2Result.details.addedStartEps ? 'Yes (S0 -> S | ε)' : 'No'}`);
console.log('\nGrammar after Step 2:');
console.log(step2Result.formatted);
console.log('\n================================================================================\n');

// STEP 3: Eliminate Unit Productions
console.log('--------------------------------------------------------------------------------');
console.log('STEP 3: ELIMINATE UNIT PRODUCTIONS (A -> B)');
console.log('  3a. Compute unit closure UNIT(A) for each non-terminal');
console.log('  3b. Replace unit rules with direct non-unit productions (collapsing chains)');
console.log('--------------------------------------------------------------------------------');
const step3Result = removeUnitProductions(step2Result.grammar);

console.log('Transformation Summary:');
console.log('  - Unit Closures UNIT(A):');
for (const [nt, targets] of Object.entries(step3Result.details.unitPairs)) {
  console.log(`      UNIT(${nt}) = { ${targets.join(', ')} }`);
}
console.log(`  - Unit Productions Eliminated : ${step3Result.details.eliminatedUnits.map(u => `${u.from} -> ${u.to}`).join(', ')}`);
console.log('\nGrammar after Step 3 (Final Simplified Grammar):');
console.log(step3Result.formatted);
console.log('\n================================================================================\n');

// Also verify the all-in-one simplifyGrammar function
console.log('--------------------------------------------------------------------------------');
console.log('ALL-IN-ONE simplifyGrammar() PIPELINE VERIFICATION:');
console.log('--------------------------------------------------------------------------------');
const pipelineResult = simplifyGrammar(initialGrammar);
console.log(`Pipeline matched step-by-step output: ${pipelineResult.formattedFinal === step3Result.formatted ? 'YES (SUCCESS)' : 'NO'}`);
console.log('\nFinal Simplified Grammar:');
console.log(pipelineResult.formattedFinal);
console.log('\n================================================================================');
