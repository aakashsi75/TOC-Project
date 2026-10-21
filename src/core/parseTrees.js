/**
 * Ambiguity Detection and Parse Tree Reconstruction Module
 * 
 * Built on top of CYK dynamic programming table and backpointers.
 * 
 * Features:
 * 1. countParses: Dynamic programming parse counting (using BigInt) without tree enumeration.
 * 2. buildTrees: Reconstructs up to `limit` distinct parse trees as nested objects.
 * 3. collapseCNFArtifacts: Flattens CNF intermediate binarization nodes (Y1, Y2...) and
 *    restores terminal-replacement nodes (X_+, X_id...) back to clean grammar productions.
 * 4. analyzeAmbiguity: Orchestrates parse counting, tree reconstruction, and ambiguity detection.
 * 5. treeToString / treeToBracket: Textual and bracket notation formatters for trees.
 */

/**
 * Counts the distinct parse trees for the start symbol using dynamic programming
 * over the CYK backpointers.
 * 
 * DP Relation:
 *   count(i, len, A) = sum over derivations of (count(left) * count(right))
 *   Base case (len = 1): count = 1
 * 
 * Uses BigInt to prevent overflow on highly ambiguous inputs (Catalan numbers, etc.).
 * 
 * @param {Object} cykResult - Return value of cykParse
 * @returns {number}
 */
export function countParses(cykResult) {
  if (!cykResult || !cykResult.accepted) {
    return 0;
  }

  const tokens = cykResult.tokens || [];
  const n = tokens.length;

  // Empty string accepted via S -> ε
  if (n === 0) {
    return 1;
  }

  const table = cykResult.table;
  const startSymbol = cykResult.startSymbol;
  const memo = new Map();

  function getCount(i, len, symbol) {
    const key = `${i},${len},${symbol}`;
    if (memo.has(key)) {
      return memo.get(key);
    }

    const cell = table[i]?.[len];
    const derivations = cell?.[symbol];

    // If no derivations exist for this symbol in this cell
    if (!derivations || derivations.length === 0) {
      memo.set(key, 0n);
      return 0n;
    }

    // Base case: length 1 terminal match
    if (len === 1) {
      memo.set(key, 1n);
      return 1n;
    }

    // Recursive case: sum over all binary split derivations
    let total = 0n;
    for (const d of derivations) {
      const leftCount = getCount(d.left.i, d.left.len, d.left.symbol);
      const rightCount = getCount(d.right.i, d.right.len, d.right.symbol);
      total += leftCount * rightCount;
    }

    memo.set(key, total);
    return total;
  }

  const totalParses = getCount(0, n, startSymbol);
  return totalParses > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(totalParses);
}

/**
 * Reconstructs up to `limit` distinct parse trees from the CYK table.
 * Returns nested objects: { symbol, children: [...] }
 * Leaves are: { symbol: "id", terminal: true }
 * 
 * @param {Object} cykResult - Return value of cykParse
 * @param {number} [limit=10] - Maximum number of distinct trees to generate
 * @returns {Array<Object>}
 */
export function buildTrees(cykResult, limit = 10) {
  if (!cykResult || !cykResult.accepted) {
    return [];
  }

  const tokens = cykResult.tokens || [];
  const n = tokens.length;
  const startSymbol = cykResult.startSymbol;

  // Empty string accepted
  if (n === 0) {
    return [{ symbol: startSymbol, children: [{ symbol: 'ε', terminal: true }] }];
  }

  const table = cykResult.table;
  const memo = new Map();

  function generateTrees(i, len, symbol, maxTrees) {
    const key = `${i},${len},${symbol}`;
    if (memo.has(key)) {
      return memo.get(key).slice(0, maxTrees);
    }

    const cell = table[i]?.[len];
    const derivations = cell?.[symbol];
    if (!derivations || derivations.length === 0) {
      return [];
    }

    // Base case: length 1 leaf
    if (len === 1) {
      const token = tokens[i];
      const leafTree = [{ symbol, children: [{ symbol: token, terminal: true }] }];
      memo.set(key, leafTree);
      return leafTree;
    }

    const results = [];
    const seenBrackets = new Set();

    for (const d of derivations) {
      if (results.length >= maxTrees) break;
      const remaining = maxTrees - results.length;

      const leftSubtrees = generateTrees(d.left.i, d.left.len, d.left.symbol, remaining);
      const rightSubtrees = generateTrees(d.right.i, d.right.len, d.right.symbol, remaining);

      for (const left of leftSubtrees) {
        for (const right of rightSubtrees) {
          const candidate = { symbol, children: [left, right] };
          const bracketKey = treeToBracket(candidate);

          if (!seenBrackets.has(bracketKey)) {
            seenBrackets.add(bracketKey);
            results.push(candidate);
            if (results.length >= maxTrees) break;
          }
        }
        if (results.length >= maxTrees) break;
      }
    }

    memo.set(key, results);
    return results;
  }

  return generateTrees(0, n, startSymbol, limit);
}

/**
 * Collapses CNF helper artifacts back into original/simplified grammar productions:
 * 1. Replaces terminal-replacement nodes (e.g. X_+, X_id...) with plain terminal leaves.
 * 2. Splices out binarization nodes (e.g. Y1, Y2...) by merging their children into the parent.
 * 
 * @param {Object} tree - Raw CNF tree
 * @param {Array<Object>} [trace=[]] - CNF conversion trace
 * @returns {Object}
 */
export function collapseCNFArtifacts(tree, trace = []) {
  if (!tree) return null;

  const binarizationSymbols = new Set();
  const terminalReplSymbols = new Set();

  for (const item of (trace || [])) {
    const name = item.name || item.symbol;
    if (!name) continue;
    if (item.reason === 'binarization') {
      binarizationSymbols.add(name);
    } else if (item.reason === 'terminal replacement') {
      terminalReplSymbols.add(name);
    }
  }

  function collapseNode(node) {
    if (node.terminal) {
      return { symbol: node.symbol, terminal: true };
    }

    // Check if node is a terminal replacement symbol (e.g. X_+ or X_id)
    const isTerminalHelper = terminalReplSymbols.has(node.symbol) || node.symbol.startsWith('X_');
    if (isTerminalHelper) {
      const terminalChild = (node.children || []).find(c => c.terminal);
      if (terminalChild) {
        return { symbol: terminalChild.symbol, terminal: true };
      }
      return { symbol: node.symbol.replace(/^X_/, ''), terminal: true };
    }

    // Recursively collapse all children
    const newChildren = [];
    for (const child of (node.children || [])) {
      const collapsedChild = collapseNode(child);

      // Check if child is a binarization helper symbol (e.g. Y1, Y2)
      const isBinarizeHelper = binarizationSymbols.has(collapsedChild.symbol) || /^Y\d+$/.test(collapsedChild.symbol);
      if (isBinarizeHelper) {
        // Splice children into current parent
        if (collapsedChild.children) {
          newChildren.push(...collapsedChild.children);
        }
      } else {
        newChildren.push(collapsedChild);
      }
    }

    return {
      symbol: node.symbol,
      children: newChildren
    };
  }

  return collapseNode(tree);
}

/**
 * Produces a clean bracket notation rendering of a parse tree.
 * Example: E(E(id) + E(E(id) * E(id)))
 * 
 * @param {Object} tree
 * @returns {string}
 */
export function treeToBracket(tree) {
  if (!tree) return '';
  if (tree.terminal) {
    return tree.symbol;
  }
  const childrenStr = (tree.children || [])
    .map(child => treeToBracket(child))
    .join(' ');
  return `${tree.symbol}(${childrenStr})`;
}

/**
 * Produces an indented multiline textual rendering of a parse tree.
 * 
 * @param {Object} tree
 * @param {number} [indent=0]
 * @returns {string}
 */
export function treeToString(tree, indent = 0) {
  if (!tree) return '';
  const prefix = '  '.repeat(indent);
  if (tree.terminal) {
    return `${prefix}${tree.symbol}`;
  }
  let result = `${prefix}${tree.symbol}`;
  for (const child of (tree.children || [])) {
    result += '\n' + treeToString(child, indent + 1);
  }
  return result;
}

/**
 * Analyzes ambiguity and reconstructs parse trees for a given CYK parse result.
 * 
 * @param {Object} cykResult - Return value of cykParse
 * @param {Object} cnfGrammar - Grammar in CNF
 * @param {Array<Object>} [trace=[]] - Trace array from convertToCNF
 * @param {number} [limit=10] - Maximum parse trees to reconstruct
 * @returns {{
 *   accepted: boolean,
 *   parseCount: number,
 *   ambiguous: boolean,
 *   trees: Array<Object>,
 *   cnfTrees: Array<Object>,
 *   truncated: boolean
 * }}
 */
export function analyzeAmbiguity(cykResult, cnfGrammar, trace = [], limit = 10) {
  if (!cykResult || !cykResult.accepted) {
    return {
      accepted: false,
      parseCount: 0,
      ambiguous: false,
      trees: [],
      cnfTrees: [],
      truncated: false
    };
  }

  const parseCount = countParses(cykResult);
  const rawTrees = buildTrees(cykResult, limit);
  const collapsedTrees = rawTrees.map(t => collapseCNFArtifacts(t, trace));

  return {
    accepted: true,
    parseCount,
    ambiguous: parseCount > 1,
    trees: collapsedTrees,
    cnfTrees: rawTrees,
    truncated: parseCount > limit
  };
}
