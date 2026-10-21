/**
 * CYK (Cocke-Younger-Kasami) Parsing Algorithm Module
 * 
 * Implements bottom-up dynamic programming parser for Context-Free Grammars
 * in Chomsky Normal Form (CNF).
 * 
 * DP Table Definition:
 *   table[i][len] = Set of non-terminals deriving the substring of length `len`
 *                   starting at token index `i` (0-indexed).
 * 
 * Derivations / Backpointers:
 *   For every non-terminal added to a cell, all derivation paths are preserved:
 *   { rule: "A -> B C", split: k, left: { i, len, symbol }, right: { i, len, symbol } }
 *   (or { rule: "A -> a", token: "a" } for the base case).
 */

/**
 * Tokenizes the input string using the grammar's terminals.
 * Uses a greedy longest-match-first strategy and skips whitespace.
 * 
 * @param {string} inputString - Input string to tokenize
 * @param {string[]} terminals - List of valid terminal strings from the grammar
 * @returns {{ tokens: string[], error: string | null }}
 */
export function tokenizeInput(inputString, terminals = []) {
  if (typeof inputString !== 'string') {
    return { tokens: [], error: 'Input must be a string' };
  }

  const trimmed = inputString.trim();
  if (trimmed === '') {
    return { tokens: [], error: null };
  }

  // Deduplicate and filter terminals, sorting descending by length (longest match first)
  const validTerminals = Array.from(new Set(terminals))
    .filter(t => t && t !== 'ε')
    .sort((a, b) => b.length - a.length);

  const tokens = [];
  let i = 0;

  while (i < inputString.length) {
    // Skip whitespace between tokens (supports space-separated inputs)
    if (/\s/.test(inputString[i])) {
      i++;
      continue;
    }

    // Try longest matching terminal
    let matched = null;
    for (const term of validTerminals) {
      if (inputString.startsWith(term, i)) {
        matched = term;
        break;
      }
    }

    if (matched !== null) {
      tokens.push(matched);
      i += matched.length;
    } else {
      // Unknown symbol encountered at position i
      const unknownChar = inputString[i];
      return {
        tokens: [],
        error: `Unknown symbol '${unknownChar}' at position ${i + 1}`
      };
    }
  }

  return { tokens, error: null };
}

/**
 * Creates a table cell that acts as an object mapping non-terminal -> derivations array,
 * while also supporting .has(), .includes(), and iteration for convenience.
 * 
 * @returns {Object}
 */
function createCell() {
  const cell = {};

  Object.defineProperty(cell, 'has', {
    value: function(sym) { return Boolean(this[sym]); },
    enumerable: false,
    writable: true
  });
  Object.defineProperty(cell, 'includes', {
    value: function(sym) { return Boolean(this[sym]); },
    enumerable: false,
    writable: true
  });
  Object.defineProperty(cell, 'symbols', {
    get: function() { return Object.keys(this); },
    enumerable: false
  });
  Object.defineProperty(cell, Symbol.iterator, {
    value: function*() { yield* Object.keys(this); },
    enumerable: false,
    writable: true
  });

  return cell;
}

/**
 * Adds a derivation to a cell under non-terminal A.
 * Avoids duplicate identical backpointers while preserving all distinct derivations.
 * 
 * @param {Object} cell
 * @param {string} A
 * @param {Object} derivation
 */
function addDerivation(cell, A, derivation) {
  if (!cell[A]) {
    cell[A] = [];
  }
  const isDuplicate = cell[A].some(existing => {
    if (existing.rule !== derivation.rule) return false;
    if (existing.split !== derivation.split) return false;
    return true;
  });
  if (!isDuplicate) {
    cell[A].push(derivation);
  }
}

/**
 * Executes CYK parsing algorithm on an input string given a CNF grammar.
 * 
 * @param {Object} cnfGrammar - Grammar in Chomsky Normal Form (from convertToCNF)
 * @param {string} inputString - Input string to parse
 * @returns {{
 *   accepted: boolean,
 *   tokens: string[],
 *   table: Object[][],
 *   steps: Array<Object>,
 *   startSymbol: string,
 *   error: string | null
 * }}
 */
export function cykParse(cnfGrammar, inputString) {
  const startSymbol = cnfGrammar?.startSymbol || '';

  // Collect all terminal symbols from the grammar
  const terminalSet = new Set(cnfGrammar?.terminals || []);
  if (cnfGrammar?.productions) {
    for (const rules of Object.values(cnfGrammar.productions)) {
      for (const rule of rules) {
        if (rule.length === 1 && rule[0] !== 'ε' && !cnfGrammar.nonTerminals?.includes(rule[0])) {
          terminalSet.add(rule[0]);
        }
      }
    }
  }

  // Step 1: Tokenize input string
  const { tokens, error } = tokenizeInput(inputString, Array.from(terminalSet));
  if (error) {
    return {
      accepted: false,
      tokens: [],
      table: [],
      steps: [],
      startSymbol,
      error
    };
  }

  const n = tokens.length;

  // Edge Case: Empty input string
  // Accepted only if the start symbol derives epsilon (S -> ε)
  if (n === 0) {
    const startRules = cnfGrammar?.productions?.[startSymbol] || [];
    const hasEpsilon = startRules.some(r => r.length === 1 && r[0] === 'ε');
    return {
      accepted: hasEpsilon,
      tokens: [],
      table: [],
      steps: [],
      startSymbol,
      error: null
    };
  }

  // Pre-index productions for fast O(1) reverse lookup:
  // 1. terminal -> [A, ...] where A -> a
  const terminalToLHS = new Map();
  // 2. "B C" -> [A, ...] where A -> B C
  const binaryToLHS = new Map();

  for (const [lhs, rules] of Object.entries(cnfGrammar?.productions || {})) {
    for (const rule of rules) {
      if (rule.length === 1 && rule[0] !== 'ε') {
        const term = rule[0];
        if (!terminalToLHS.has(term)) terminalToLHS.set(term, []);
        terminalToLHS.get(term).push(lhs);
      } else if (rule.length === 2) {
        const pairKey = `${rule[0]} ${rule[1]}`;
        if (!binaryToLHS.has(pairKey)) binaryToLHS.set(pairKey, []);
        binaryToLHS.get(pairKey).push(lhs);
      }
    }
  }

  // Initialize triangular DP table: table[i][len]
  // i: start position (0 .. n-1)
  // len: length of substring (1 .. n-i)
  const table = [];
  for (let i = 0; i < n; i++) {
    table[i] = [];
    for (let len = 1; len <= n - i; len++) {
      table[i][len] = createCell();
    }
  }

  const steps = [];

  // =========================================================================
  // BASE CASE (len = 1):
  // Check which non-terminals produce the single terminal token at index i
  // =========================================================================
  for (let i = 0; i < n; i++) {
    const token = tokens[i];
    const matchingLHS = terminalToLHS.get(token) || [];
    const cell = table[i][1];
    const added = [];

    for (const lhs of matchingLHS) {
      addDerivation(cell, lhs, {
        rule: `${lhs} -> ${token}`,
        token
      });
      added.push(lhs);
    }

    steps.push({
      cell: { i, len: 1 },
      i,
      len: 1,
      token,
      rulesTried: matchingLHS.map(lhs => `${lhs} -> ${token}`),
      added: Array.from(new Set(added))
    });
  }

  // =========================================================================
  // RECURSIVE CASE (len = 2 .. n):
  // For each substring length and starting index, try every split point k
  // =========================================================================
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i <= n - len; i++) {
      const cell = table[i][len];
      const splitsRecorded = [];
      const addedSymbols = new Set();

      // Loop through all split points: left part length k, right part length len - k
      for (let k = 1; k < len; k++) {
        const leftCell = table[i][k];
        const rightCell = table[i + k][len - k];

        const leftSymbols = Object.keys(leftCell);
        const rightSymbols = Object.keys(rightCell);
        const matchedRules = [];

        // Check all pairs (B, C) where B derives left part and C derives right part
        for (const B of leftSymbols) {
          for (const C of rightSymbols) {
            const pairKey = `${B} ${C}`;
            const matchingA = binaryToLHS.get(pairKey);

            if (matchingA && matchingA.length > 0) {
              for (const A of matchingA) {
                const ruleStr = `${A} -> ${B} ${C}`;
                addDerivation(cell, A, {
                  rule: ruleStr,
                  split: k,
                  left: { i, len: k, symbol: B },
                  right: { i: i + k, len: len - k, symbol: C }
                });
                addedSymbols.add(A);
                matchedRules.push(ruleStr);
              }
            }
          }
        }

        splitsRecorded.push({
          k,
          leftCell: { i, len: k },
          rightCell: { i: i + k, len: len - k },
          leftSymbols,
          rightSymbols,
          matchedRules
        });
      }

      steps.push({
        cell: { i, len },
        i,
        len,
        splits: splitsRecorded,
        added: Array.from(addedSymbols)
      });
    }
  }

  // Acceptance condition: Start symbol is in the top cell table[0][n]
  const topCell = table[0][n];
  const accepted = Boolean(topCell && (startSymbol in topCell || topCell.has?.(startSymbol)));

  return {
    accepted,
    tokens,
    table,
    steps,
    startSymbol,
    error: null
  };
}

/**
 * Formats the triangular CYK table into a clean string representation.
 * 
 * @param {Object} cykResult - Return value of cykParse
 * @returns {string}
 */
export function formatCYKTable(cykResult) {
  const { tokens = [], table = [], accepted, startSymbol, error } = cykResult;

  if (error) {
    return `CYK Parse Error: ${error}`;
  }

  const n = tokens.length;
  if (n === 0) {
    return `Empty string (Length 0) -> ${accepted ? 'Accepted (S -> ε)' : 'Rejected'}`;
  }

  const lines = [];
  lines.push(`Tokens (${n}): [ ${tokens.join(', ')} ]`);
  lines.push(`Start Symbol: ${startSymbol} | Accepted: ${accepted ? 'YES' : 'NO'}\n`);
  lines.push('Triangular CYK Table:');

  for (let len = n; len >= 1; len--) {
    const row = [];
    for (let i = 0; i <= n - len; i++) {
      const cell = table[i]?.[len] || {};
      const symbols = Object.keys(cell);
      const str = symbols.length > 0 ? `{ ${symbols.join(', ')} }` : '∅';
      row.push(`[${i}, len=${len}]: ${str}`);
    }
    lines.push(`  len = ${len} | ` + row.join('   '));
  }

  return lines.join('\n');
}
