/**
 * Secondary RNA Folding Analysis Module
 * 
 * Reuses core CFG pipeline:
 * parseGrammar -> simplifyGrammar -> convertToCNF -> cykParse -> countParses/buildTrees -> collapseCNFArtifacts
 */

import { parseGrammar } from './grammarParser.js';
import { simplifyGrammar } from './simplifier.js';
import { convertToCNF } from './cnf.js';
import { cykParse } from './cyk.js';
import { countParses, buildTrees, collapseCNFArtifacts } from './parseTrees.js';
import { STRICT_RNA_GRAMMAR, PERMISSIVE_RNA_GRAMMAR } from './rnaGrammars.js';

// Cache compiled CNF grammars for instant repeated analysis
const cnfCache = new Map();

function getCompiledGrammar(grammarText) {
  if (cnfCache.has(grammarText)) {
    return cnfCache.get(grammarText);
  }
  const parsed = parseGrammar(grammarText);
  if (!parsed.success) {
    return { error: parsed.errors.map(e => e.message).join('; ') };
  }
  const simplified = simplifyGrammar(parsed.grammar);
  const cnf = convertToCNF(simplified.final);
  const compiled = { cnf: cnf.final, trace: cnf.trace };
  // Only retain the two presets; custom API inputs must not grow a global cache.
  if (grammarText === STRICT_RNA_GRAMMAR || grammarText === PERMISSIVE_RNA_GRAMMAR) {
    cnfCache.set(grammarText, compiled);
  }
  return compiled;
}

/**
 * Normalizes an RNA sequence string:
 * - Trims and lowercases
 * - Strips all whitespace
 * - Checks maximum length (<= 15)
 * - Validates allowed nucleotides: 'a', 'c', 'g', 'u'
 * 
 * @param {string} str
 * @returns {{ success: boolean, sequence: string|null, error: string|null }}
 */
export function normalizeSequence(str) {
  if (typeof str !== 'string') {
    return { success: false, sequence: null, error: 'Sequence must be a string' };
  }
  const cleaned = str.trim().toLowerCase().replace(/\s+/g, '');

  if (cleaned.length > 15) {
    return {
      success: false,
      sequence: null,
      error: `Sequence length ${cleaned.length} exceeds maximum limit of 15 nucleotides`
    };
  }

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch !== 'a' && ch !== 'c' && ch !== 'g' && ch !== 'u') {
      return {
        success: false,
        sequence: null,
        error: `Unknown symbol '${ch}' at position ${i + 1}. Expected one of: a, c, g, u`
      };
    }
  }

  return { success: true, sequence: cleaned, error: null };
}

/**
 * Checks whether two bases form a legal secondary-structure pair:
 * Watson-Crick (A-U, U-A, G-C, C-G) or Wobble (G-U, U-G).
 * 
 * @param {string} x
 * @param {string} y
 * @returns {boolean}
 */
export function isLegalPair(x, y) {
  if (typeof x !== 'string' || typeof y !== 'string') return false;
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  return (
    (a === 'a' && b === 'u') ||
    (a === 'u' && b === 'a') ||
    (a === 'g' && b === 'c') ||
    (a === 'c' && b === 'g') ||
    (a === 'g' && b === 'u') ||
    (a === 'u' && b === 'g')
  );
}

/**
 * Converts a collapsed CFG parse tree into a standard dot-bracket notation and pair list.
 * 
 * Assigns each leaf its left-to-right index (0 to n-1) by in-order traversal.
 * A node is a pairing node when its RHS has length >= 2 and its first and last
 * children are terminals that form a legal base pair: marks those two leaf indices
 * with '(' and ')'. All other leaves remain '.'.
 * 
 * @param {Object} tree - Collapsed parse tree
 * @param {number} [n] - Sequence length
 * @returns {{ dotBracket: string, pairs: Array<[number, number]> }}
 */
export function treeToDotBracket(tree, n) {
  if (!tree) {
    return { dotBracket: '', pairs: [] };
  }

  let leafIdx = 0;
  const leafIndices = new WeakMap();
  function assignLeafIndices(node) {
    if (node.terminal) {
      // Epsilon denotes an empty yield, not a nucleotide position.
      if (node.symbol !== 'ε') leafIndices.set(node, leafIdx++);
      return;
    }
    for (const child of node.children || []) {
      assignLeafIndices(child);
    }
  }
  assignLeafIndices(tree);

  const totalLeaves = n !== undefined ? n : leafIdx;
  const pairs = [];

  function findPairs(node) {
    if (!node || node.terminal || !node.children) return;

    if (node.children.length >= 2) {
      const firstChild = node.children[0];
      const lastChild = node.children[node.children.length - 1];

      if (
        firstChild.terminal &&
        lastChild.terminal &&
        isLegalPair(firstChild.symbol, lastChild.symbol)
      ) {
        pairs.push([leafIndices.get(firstChild), leafIndices.get(lastChild)]);
      }
    }

    for (const child of node.children) {
      findPairs(child);
    }
  }
  findPairs(tree);

  const chars = new Array(totalLeaves).fill('.');
  for (const [i, j] of pairs) {
    if (i < totalLeaves && j < totalLeaves) {
      chars[i] = '(';
      chars[j] = ')';
    }
  }

  pairs.sort((a, b) => a[0] - b[0]);
  return { dotBracket: chars.join(''), pairs };
}

/**
 * Validates a secondary structure fold against structural invariants:
 * 1. Dot-bracket length equals sequence length.
 * 2. Every pair is a legal Watson-Crick or Wobble base pair.
 * 3. Base pairs never cross (strictly well-nested parenthesization).
 * 4. The tree's leaves read left-to-right equal the sequence.
 * 
 * @param {string} sequence
 * @param {{ dotBracket: string, pairs: Array<[number, number]> }} fold
 * @param {Object} [tree] - Collapsed parse tree
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateFold(sequence, fold, tree) {
  if (!fold || typeof fold.dotBracket !== 'string') {
    return { valid: false, error: 'Missing fold object or dotBracket string' };
  }

  // 1. Length check
  if (fold.dotBracket.length !== sequence.length) {
    return {
      valid: false,
      error: `dotBracket length ${fold.dotBracket.length} does not match sequence length ${sequence.length}`
    };
  }

  if (!Array.isArray(fold.pairs) || fold.pairs.some(pair =>
    !Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isInteger))) {
    return { valid: false, error: 'Pairs must be arrays of two integer indices' };
  }

  // 2. Legal pair check and bracket agreement
  for (const [i, j] of fold.pairs) {
    if (i < 0 || j >= sequence.length || i >= j) {
      return { valid: false, error: `Invalid pair indices [${i}, ${j}] for sequence length ${sequence.length}` };
    }
    if (!isLegalPair(sequence[i], sequence[j])) {
      return { valid: false, error: `Illegal base pair '${sequence[i]}'-'${sequence[j]}' at indices [${i}, ${j}]` };
    }
    if (fold.dotBracket[i] !== '(' || fold.dotBracket[j] !== ')') {
      return { valid: false, error: `Pair indices [${i}, ${j}] do not match brackets in "${fold.dotBracket}"` };
    }
  }

  // 3. Nested well-formedness: pairs never cross (stack check)
  const stack = [];
  const derivedPairs = [];
  for (let idx = 0; idx < fold.dotBracket.length; idx++) {
    const ch = fold.dotBracket[idx];
    if (ch === '(') {
      stack.push(idx);
    } else if (ch === ')') {
      if (stack.length === 0) {
        return { valid: false, error: `Unmatched closing bracket ')' at index ${idx}` };
      }
      const openIdx = stack.pop();
      derivedPairs.push([openIdx, idx]);
    } else if (ch !== '.') {
      return { valid: false, error: `Invalid character '${ch}' in dot-bracket string` };
    }
  }
  if (stack.length > 0) {
    return { valid: false, error: `Unclosed open bracket '(' at index ${stack[0]}` };
  }

  derivedPairs.sort((a, b) => a[0] - b[0]);
  const sortedPairs = [...fold.pairs].sort((a, b) => a[0] - b[0]);
  if (derivedPairs.length !== sortedPairs.length) {
    return { valid: false, error: `Derived pair count ${derivedPairs.length} does not match pair array count ${sortedPairs.length}` };
  }
  for (let k = 0; k < derivedPairs.length; k++) {
    if (derivedPairs[k][0] !== sortedPairs[k][0] || derivedPairs[k][1] !== sortedPairs[k][1]) {
      return { valid: false, error: `Pair mismatch between dot-bracket brackets and pairs array` };
    }
  }

  // 4. Tree leaves equal sequence
  tree = tree || fold.tree;
  if (!tree) {
    return { valid: false, error: 'Missing parse tree for leaf validation' };
  }
  {
    const leaves = [];
    function collectLeaves(n) {
      if (n.terminal) {
        if (n.symbol !== 'ε') leaves.push(n.symbol);
        return;
      }
      for (const c of n.children || []) collectLeaves(c);
    }
    collectLeaves(tree);
    const leafSeq = leaves.join('');
    if (leafSeq !== sequence) {
      return { valid: false, error: `Tree leaves "${leafSeq}" do not match sequence "${sequence}"` };
    }
  }

  return { valid: true, error: null };
}

/**
 * Performs full secondary RNA folding analysis on a sequence using the CFG pipeline.
 * 
 * @param {string} sequence
 * @param {"strict"|"permissive"|string} [presetOrGrammarText="strict"]
 * @param {Object} [options={}]
 * @param {number} [options.maxTrees=500]
 * @returns {{
 *   accepted: boolean,
 *   parseCount: string,
 *   enumeratedTrees: number,
 *   truncated: boolean,
 *   folds: Array<{ dotBracket: string, pairs: Array<[number, number]>, treeCount: number, tree: Object }>,
 *   distinctFoldCount: number,
 *   note: string,
 *   error?: string
 * }}
 */
export function analyzeRNA(sequence, presetOrGrammarText = 'strict', options = {}) {
  const failure = error => ({
    accepted: false, error, parseCount: '0', enumeratedTrees: 0,
    truncated: false, folds: [], distinctFoldCount: 0, note: error
  });
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return failure('Options must be an object');
  }
  const maxTrees = options.maxTrees === undefined ? 500 : options.maxTrees;
  if (!Number.isSafeInteger(maxTrees) || maxTrees < 1) {
    return failure('maxTrees must be a positive safe integer');
  }
  if (typeof presetOrGrammarText !== 'string') {
    return failure('Preset or grammar text must be a string');
  }

  // 1. Normalize sequence
  const norm = normalizeSequence(sequence);
  if (!norm.success) {
    return {
      accepted: false,
      error: norm.error,
      parseCount: '0',
      enumeratedTrees: 0,
      truncated: false,
      folds: [],
      distinctFoldCount: 0,
      note: norm.error
    };
  }
  const seq = norm.sequence;

  // 2. Resolve grammar
  let grammarText = STRICT_RNA_GRAMMAR;
  if (presetOrGrammarText === 'permissive') {
    grammarText = PERMISSIVE_RNA_GRAMMAR;
  } else if (presetOrGrammarText !== 'strict') {
    grammarText = presetOrGrammarText;
  }

  const compiled = getCompiledGrammar(grammarText);
  if (compiled.error) {
    return {
      accepted: false,
      error: compiled.error,
      parseCount: '0',
      enumeratedTrees: 0,
      truncated: false,
      folds: [],
      distinctFoldCount: 0,
      note: compiled.error
    };
  }

  // 3. CYK Parse
  const cyk = cykParse(compiled.cnf, seq);
  if (cyk.error) {
    return {
      accepted: false,
      error: cyk.error,
      parseCount: '0',
      enumeratedTrees: 0,
      truncated: false,
      folds: [],
      distinctFoldCount: 0,
      note: cyk.error
    };
  }

  if (!cyk.accepted) {
    return {
      accepted: false,
      error: null,
      parseCount: '0',
      enumeratedTrees: 0,
      truncated: false,
      folds: [],
      distinctFoldCount: 0,
      note: 'Sequence rejected: cannot be derived by the RNA folding grammar.'
    };
  }

  // 4. Parse count via DP
  const totalParses = countParses(cyk);
  // The existing counter saturates at MAX_SAFE_INTEGER. Never present that
  // sentinel as an exact count for an unusually ambiguous custom grammar.
  if (totalParses === Number.MAX_SAFE_INTEGER) {
    return failure('Parse count reaches the existing pipeline counting limit; an exact count is unavailable.');
  }
  const parseCountStr = totalParses.toString();

  // 5. Enumerate parse trees up to maxTrees
  const rawTrees = buildTrees(cyk, maxTrees);
  const enumeratedTrees = rawTrees.length;
  const truncated = BigInt(totalParses) > BigInt(enumeratedTrees);

  // 6. Collapse trees, compute dot-bracket, and deduplicate into distinct folds
  const foldMap = new Map();
  for (const t of rawTrees) {
    const collapsed = collapseCNFArtifacts(t, compiled.trace);
    const { dotBracket, pairs } = treeToDotBracket(collapsed, seq.length);
    const validation = validateFold(seq, { dotBracket, pairs }, collapsed);
    if (!validation.valid) {
      return failure(`Invalid RNA fold from parse tree: ${validation.error}`);
    }

    if (!foldMap.has(dotBracket)) {
      foldMap.set(dotBracket, {
        dotBracket,
        pairs,
        treeCount: 1,
        tree: collapsed
      });
    } else {
      foldMap.get(dotBracket).treeCount++;
    }
  }

  const folds = Array.from(foldMap.values()).sort((a, b) => b.treeCount - a.treeCount);
  const distinctFoldCount = folds.length;

  let note = '';
  if (truncated) {
    note = `Enumerated ${enumeratedTrees} of ${parseCountStr} total parse trees (truncated at limit ${maxTrees}). Distinct fold count (${distinctFoldCount}) is a lower bound; treeCount counts only enumerated trees.`;
  } else {
    note = `Enumerated all ${enumeratedTrees} parse trees into ${distinctFoldCount} distinct secondary fold(s).`;
  }

  return {
    accepted: true,
    error: null,
    parseCount: parseCountStr,
    enumeratedTrees,
    truncated,
    folds,
    distinctFoldCount,
    note
  };
}
