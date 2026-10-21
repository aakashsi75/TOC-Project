/**
 * CLI Test Runner for Pure SVG Parse Tree Renderer
 * 
 * Verifies:
 * 1. Valid SVG output for both trees of "id+id*id" on the Ambiguous Grammar.
 * 2. Number of leaf text elements in SVG equals token count (5).
 * 3. Left-to-right leaf text order in SVG matches input tokens exactly.
 * 4. 1-node tree rendering support.
 * 5. getTreeDimensions helper correctness.
 */

import { parseGrammar } from './src/core/grammarParser.js';
import { simplifyGrammar } from './src/core/simplifier.js';
import { convertToCNF } from './src/core/cnf.js';
import { cykParse } from './src/core/cyk.js';
import { analyzeAmbiguity, treeToBracket } from './src/core/parseTrees.js';
import { renderTree, getTreeDimensions, deriveGrouping } from './src/core/treeRenderer.js';
import { SAMPLE_GRAMMARS } from './src/core/sampleGrammars.js';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bgGreen: '\x1b[42m\x1b[30m'
};

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

function extractLeafTexts(svgString) {
  const regex = /<text[^>]*class="leaf-text"[^>]*>([^<]+)<\/text>/g;
  const leaves = [];
  let match;
  while ((match = regex.exec(svgString)) !== null) {
    leaves.push(match[1]);
  }
  return leaves;
}

console.log('================================================================================');
console.log('                 PURE SVG TREE RENDERER TEST SUITE                              ');
console.log('================================================================================\n');

// 1. Setup Ambiguous grammar on "id+id*id"
const parsed = parseGrammar(SAMPLE_GRAMMARS.ambiguous.text);
const simplified = simplifyGrammar(parsed.grammar);
const cnf = convertToCNF(simplified.final);
const inputString = 'id+id*id';
const cykRes = cykParse(cnf.final, inputString);
const ambigRes = analyzeAmbiguity(cykRes, cnf.final, cnf.trace);

console.log(`${ANSI.bold}Ambiguous Grammar Test: "${inputString}"${ANSI.reset}`);
assert(ambigRes.accepted === true, 'Input accepted by CYK');
assert(ambigRes.trees.length === 2, `Expected 2 distinct parse trees, got ${ambigRes.trees.length}`);
console.log();

// 2. Validate Tree 1 and Tree 2 SVG rendering
ambigRes.trees.forEach((tree, idx) => {
  console.log(`${ANSI.bold}Evaluating Tree ${idx + 1}:${ANSI.reset} ${treeToBracket(tree)}`);

  const dims = getTreeDimensions(tree);
  assert(dims.width > 0 && dims.height > 0, `Tree ${idx + 1} dimensions computed: ${dims.width}x${dims.height}`);
  assert(dims.leafCount === cykRes.tokens.length, `Leaf count ${dims.leafCount} equals token count ${cykRes.tokens.length}`);

  const svg = renderTree(tree);
  assert(typeof svg === 'string', `Tree ${idx + 1} rendered as string`);
  assert(svg.startsWith('<svg') && svg.endsWith('</svg>'), `Tree ${idx + 1} contains valid SVG wrapper`);
  assert(svg.includes('viewBox='), `Tree ${idx + 1} includes responsive viewBox`);

  const leaves = extractLeafTexts(svg);
  assert(
    leaves.length === cykRes.tokens.length,
    `Leaf text elements count (${leaves.length}) equals token count (${cykRes.tokens.length})`
  );
  assert(
    leaves.join(' ') === cykRes.tokens.join(' '),
    `Leaf text order in SVG [${leaves.join(' ')}] matches tokens [${cykRes.tokens.join(' ')}]`
  );

  const grouping = deriveGrouping(tree);
  console.log(`  Derived grouping: ${grouping || '(none)'}`);
  console.log();
});

// 3. Test 1-node tree rendering
console.log(`${ANSI.bold}Evaluating 1-Node Tree Rendering:${ANSI.reset}`);
const singleLeafNode = { symbol: 'id', terminal: true };
const singleLeafDims = getTreeDimensions(singleLeafNode);
const singleLeafSvg = renderTree(singleLeafNode);

assert(singleLeafDims.leafCount === 1, '1-node leaf dimension has leafCount=1');
assert(singleLeafSvg.startsWith('<svg') && singleLeafSvg.endsWith('</svg>'), '1-node leaf renders valid SVG');
const singleLeaves = extractLeafTexts(singleLeafSvg);
assert(singleLeaves.length === 1 && singleLeaves[0] === 'id', '1-node leaf text correctly extracted as "id"');

// 1-node tree with single non-terminal parent
const singleParentNode = { symbol: 'E', children: [{ symbol: 'id', terminal: true }] };
const singleParentSvg = renderTree(singleParentNode);
assert(singleParentSvg.includes('nonterminal-node') && singleParentSvg.includes('leaf-text'), '1-parent tree renders both non-terminal and terminal leaf');
console.log();

// Leaf ranges are opt-in and must preserve the renderer's default markup.
const rangeTree = { symbol: 'S', children: [
  { symbol: 'g', terminal: true },
  { symbol: 'L', children: [{ symbol: 'a', terminal: true }, { symbol: 'c', terminal: true }] }
] };
const { renderTree: renderBrowserTree } = await import('./public/treeRenderer.js');
for (const renderer of [renderTree, renderBrowserTree]) {
  const ordinary = renderer(structuredClone(rangeTree));
  const ranged = renderer(structuredClone(rangeTree), { includeLeafRange: true });
  assert(!ordinary.includes('data-leaf-start'), 'Default tree output omits optional leaf ranges');
  assert(ranged.replace(/ data-leaf-(?:start|end)="\d+"/g, '') === ordinary, 'Optional ranges leave all other SVG markup unchanged');
  assert(ranged.includes('data-leaf-start="0" data-leaf-end="2"'), 'Root range covers all sequence bases');
  assert(ranged.includes('data-leaf-start="1" data-leaf-end="2"'), 'Subtree range covers exactly its descendant bases');
  assert((ranged.match(/data-leaf-start=/g) || []).length === 5, 'Every SVG node exposes a leaf index range');
}

// 4. Test deriveGrouping helper
const group1 = deriveGrouping(ambigRes.trees[0]);
const group2 = deriveGrouping(ambigRes.trees[1]);
assert(Boolean(group1 && group2), 'deriveGrouping successfully produced expressions for both trees');
console.log(`Tree 1 grouping: ${group1}`);
console.log(`Tree 2 grouping: ${group2}`);
assert(group1 !== group2, 'Trees have distinct groupings');
console.log();

console.log(`${ANSI.bgGreen} 🎉 ALL ${passedAssertions}/${totalAssertions} TREE RENDERER ASSERTIONS PASSED! ${ANSI.reset}\n`);
