/**
 * CLI Test Runner for CFG Grammar Parser
 */

import { parseGrammar } from '../src/core/grammarParser.js';
import { SAMPLE_GRAMMARS, MALFORMED_TEST_CASES } from './fixtures/sampleGrammars.js';

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
  bgRed: '\x1b[41m\x1b[37m',
  bgGreen: '\x1b[42m\x1b[30m'
};

function printDivider(title) {
  console.log(`\n${ANSI.cyan}${ANSI.bold}================================================================================${ANSI.reset}`);
  console.log(`${ANSI.magenta}${ANSI.bold}  ${title.toUpperCase()}${ANSI.reset}`);
  console.log(`${ANSI.cyan}${ANSI.bold}================================================================================${ANSI.reset}\n`);
}

function runSampleTests() {
  printDivider('PART 1: PARSING VALID TEST GRAMMARS');

  Object.values(SAMPLE_GRAMMARS).forEach((sample, idx) => {
    console.log(`${ANSI.bold}${ANSI.yellow}[TEST GRAMMAR ${idx + 1}] ${sample.name}${ANSI.reset}`);
    console.log(`${ANSI.dim}Description: ${sample.description}${ANSI.reset}`);
    console.log(`\n${ANSI.blue}--- Raw Input Text ---${ANSI.reset}`);
    console.log(sample.text);
    console.log(`${ANSI.blue}-----------------------${ANSI.reset}\n`);

    const result = parseGrammar(sample.text);

    if (result.success) {
      console.log(`${ANSI.bgGreen} PARSE STATUS: SUCCESS ${ANSI.reset}`);
      console.log(`${ANSI.bold}Internal Grammar Object:${ANSI.reset}`);
      console.log(JSON.stringify(result.grammar, null, 2));
      console.log(`\n${ANSI.bold}Summary:${ANSI.reset}`);
      console.log(`  - Start Symbol  : ${ANSI.green}${result.grammar.startSymbol}${ANSI.reset}`);
      console.log(`  - Non-Terminals : [ ${result.grammar.nonTerminals.map(nt => `${ANSI.green}${nt}${ANSI.reset}`).join(', ')} ]`);
      console.log(`  - Terminals     : [ ${result.grammar.terminals.map(t => `${ANSI.yellow}${t}${ANSI.reset}`).join(', ')} ]`);
      console.log(`  - Productions   : ${Object.keys(result.grammar.productions).length} rules, ${Object.values(result.grammar.productions).reduce((acc, curr) => acc + curr.length, 0)} total alternatives`);
    } else {
      console.log(`${ANSI.bgRed} PARSE STATUS: FAILED ${ANSI.reset}`);
      console.log(result.errors);
    }
    console.log('\n' + '-'.repeat(80) + '\n');
  });
}

function runMalformedTests() {
  printDivider('PART 2: TESTING MALFORMED GRAMMAR INPUTS & VALIDATION');

  MALFORMED_TEST_CASES.forEach((testCase, idx) => {
    console.log(`${ANSI.bold}${ANSI.red}[MALFORMED CASE ${idx + 1}] ${testCase.name}${ANSI.reset}`);
    console.log(`${ANSI.dim}Scenario: ${testCase.description}${ANSI.reset}`);
    console.log(`\n${ANSI.blue}--- Input Text ---${ANSI.reset}`);
    console.log(testCase.text === '' || testCase.text.trim() === '' ? '(empty string)' : testCase.text);
    console.log(`${ANSI.blue}------------------${ANSI.reset}\n`);

    const result = parseGrammar(testCase.text, testCase.options || {});

    if (!result.success) {
      console.log(`${ANSI.bgRed} CAUGHT VALIDATION ERRORS (${result.errors.length}) ${ANSI.reset}`);
      result.errors.forEach((err, errIdx) => {
        console.log(`  ${ANSI.red}${errIdx + 1}. [Line ${err.line}] ${err.message}${ANSI.reset}`);
        if (err.snippet) {
          console.log(`     ${ANSI.dim}Snippet: "${err.snippet}"${ANSI.reset}`);
        }
      });
      console.log(`\n${ANSI.bold}Result Object (Clean Error Payload):${ANSI.reset}`);
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${ANSI.yellow}Parsed successfully without error${ANSI.reset}`);
      console.log(JSON.stringify(result.grammar, null, 2));
    }
    console.log('\n' + '-'.repeat(80) + '\n');
  });
}

// Execute tests
runSampleTests();
runMalformedTests();
