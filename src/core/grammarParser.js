/**
 * Context-Free Grammar (CFG) Parser and Validator Module
 */

/**
 * Tokenizes a single production RHS alternative string into individual symbols.
 * Handles both space-separated (e.g., "E + T") and compact expressions (e.g., "E+T", "(E)", "id").
 *
 * @param {string} rhsText - The RHS alternative string
 * @param {Set<string>} knownNonTerminals - Set of defined non-terminals in the grammar
 * @returns {string[]} Array of token strings
 */
export function tokenizeRHS(rhsText, knownNonTerminals = new Set()) {
  const trimmed = rhsText.trim();
  if (!trimmed) return [];

  // If explicit whitespace separation is present throughout
  const spaceTokens = trimmed.split(/\s+/);
  
  // If user used spaces, check if tokens are already well-formed
  const hasSpaces = /\s+/.test(trimmed);
  if (hasSpaces) {
    // If every space token is clean, return space-split tokens
    const isCleanSpaceSeparated = spaceTokens.every(t => t.length > 0);
    if (isCleanSpaceSeparated && spaceTokens.length > 1) {
      return spaceTokens;
    }
  }

  // Tokenize using regex matching known non-terminals, identifiers, operators, and symbols
  // Sort known non-terminals by length descending so longer non-terminal names match first
  const sortedNT = Array.from(knownNonTerminals).sort((a, b) => b.length - a.length);
  const ntPattern = sortedNT.length > 0
    ? sortedNT.map(nt => escapeRegex(nt)).join('|') + '|'
    : '';

  // Matches:
  // 1. Quoted literals ('+' or "id")
  // 2. Known non-terminals
  // 3. Multi-char words/identifiers like 'id', 'num', 'eps', 'epsilon'
  // 4. Special epsilon symbol 'ε' or '^'
  // 5. Individual non-whitespace symbols (+, *, (, ), -, /, etc.)
  const tokenRegex = new RegExp(
    `'[^']+'|"[^"]+"|(?:${ntPattern})[a-zA-Z_][a-zA-Z0-9_]*|ε|\\^|\\S`,
    'g'
  );

  const tokens = [];
  let match;
  while ((match = tokenRegex.exec(trimmed)) !== null) {
    let token = match[0];
    // Remove enclosing quotes if quoted literal
    if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
      token = token.slice(1, -1);
    }
    tokens.push(token);
  }

  return tokens.length > 0 ? tokens : spaceTokens;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses CFG text into an internal representation and performs full input validation.
 *
 * @param {string} input - Raw CFG text input
 * @param {Object} options - Parser options
 * @param {boolean} [options.strictNonTerminals=false] - Whether uppercase symbols without LHS are flagged as undefined non-terminals
 * @returns {{
 *   success: boolean,
 *   grammar?: {
 *     nonTerminals: string[],
 *     terminals: string[],
 *     productions: Object.<string, string[][]>,
 *     startSymbol: string
 *   },
 *   errors?: Array<{ line: number, message: string, snippet: string }>
 * }}
 */
export function parseGrammar(input, options = {}) {
  const errors = [];

  if (typeof input !== 'string' || input.trim() === '') {
    return {
      success: false,
      errors: [{ line: 0, message: 'Grammar input is empty. Please provide at least one production rule.', snippet: '' }]
    };
  }

  const lines = input.split(/\r?\n/);
  const rawRules = [];
  const nonTerminalSet = new Set();
  const nonTerminalOrder = [];

  // Pass 1: Syntax & Line-by-line structural check (extract LHS symbols)
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmedLine = rawLine.trim();

    // Skip empty lines and comment lines (starting with // or #)
    if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('#')) {
      return;
    }

    // Check for production arrow '->' or alternative arrow '→'
    const arrowMatch = trimmedLine.match(/->|→/);
    if (!arrowMatch) {
      errors.push({
        line: lineNumber,
        message: `Missing production arrow '->' in rule. Expected format: 'LHS -> RHS'`,
        snippet: trimmedLine
      });
      return;
    }

    const arrowIndex = arrowMatch.index;
    const lhs = trimmedLine.slice(0, arrowIndex).trim();
    const rhs = trimmedLine.slice(arrowIndex + arrowMatch[0].length).trim();

    if (!lhs) {
      errors.push({
        line: lineNumber,
        message: `Missing Left-Hand Side (LHS) non-terminal before '${arrowMatch[0]}'`,
        snippet: trimmedLine
      });
      return;
    }

    // Check for invalid LHS (must not contain pipe '|' or spaces suggesting multiple symbols on LHS in CFG)
    if (/\s/.test(lhs) || lhs.includes('|')) {
      errors.push({
        line: lineNumber,
        message: `Invalid LHS '${lhs}'. In a Context-Free Grammar, the LHS must be a single non-terminal symbol.`,
        snippet: trimmedLine
      });
      return;
    }

    if (!rhs) {
      errors.push({
        line: lineNumber,
        message: `Empty Right-Hand Side (RHS) for '${lhs}'. Use 'ε' or 'eps' if you intended an empty/epsilon production.`,
        snippet: trimmedLine
      });
      return;
    }

    // Check for empty alternatives (e.g. "E -> E+T | " or "E -> | T" or "E -> A || B")
    const rawAlternatives = rhs.split('|');
    for (let i = 0; i < rawAlternatives.length; i++) {
      if (rawAlternatives[i].trim() === '') {
        errors.push({
          line: lineNumber,
          message: `Empty production alternative found at position ${i + 1} for '${lhs}'. Use 'ε' or 'eps' for epsilon productions.`,
          snippet: trimmedLine
        });
      }
    }

    if (!nonTerminalSet.has(lhs)) {
      nonTerminalSet.add(lhs);
      nonTerminalOrder.push(lhs);
    }

    rawRules.push({ lineNumber, lhs, rhs, rawAlternatives, snippet: trimmedLine });
  });

  // If syntax errors occurred during Pass 1, return them immediately
  if (errors.length > 0) {
    return { success: false, errors };
  }

  if (rawRules.length === 0) {
    return {
      success: false,
      errors: [{ line: 0, message: 'No valid production rules found.', snippet: '' }]
    };
  }

  const startSymbol = nonTerminalOrder[0];
  const productions = {};
  const terminalSet = new Set();
  const referencedNonTerminals = new Set();

  // Initialize productions map for all declared non-terminals
  nonTerminalOrder.forEach(nt => {
    productions[nt] = [];
  });

  // Pass 2: Tokenize RHS alternatives and categorize Terminals vs Non-Terminals
  for (const rule of rawRules) {
    const { lhs, rawAlternatives, lineNumber, snippet } = rule;

    for (const altStr of rawAlternatives) {
      const altTrimmed = altStr.trim();
      if (!altTrimmed) continue;

      let tokens = tokenizeRHS(altTrimmed, nonTerminalSet);

      if (tokens.length === 0) {
        errors.push({
          line: lineNumber,
          message: `Could not parse tokens in RHS alternative '${altStr}' for non-terminal '${lhs}'`,
          snippet
        });
        continue;
      }

      // Check tokens and categorize
      const processedTokens = tokens.map(token => {
        // Epsilon representations normalize to 'ε'
        if (token === 'ε' || token === 'eps' || token === 'epsilon' || token === '^') {
          return 'ε';
        }

        if (nonTerminalSet.has(token)) {
          referencedNonTerminals.add(token);
          return token;
        }

        // Check if strict mode is enabled and token looks like an undeclared non-terminal (single uppercase letter)
        if (options.strictNonTerminals && /^[A-Z]$/.test(token) && !nonTerminalSet.has(token)) {
          errors.push({
            line: lineNumber,
            message: `Undefined non-terminal '${token}' referenced on RHS of '${lhs}'.`,
            snippet
          });
        }

        // Otherwise it is a terminal symbol
        terminalSet.add(token);
        return token;
      });

      productions[lhs].push(processedTokens);
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const terminals = Array.from(terminalSet);

  return {
    success: true,
    grammar: {
      nonTerminals: nonTerminalOrder,
      terminals,
      productions,
      startSymbol
    }
  };
}

/**
 * Formats a parsed grammar object back into a readable multiline CFG string.
 *
 * @param {Object} grammar - The parsed grammar object
 * @returns {string}
 */
export function formatGrammar(grammar) {
  if (!grammar || !grammar.productions) return '';
  const lines = [];

  for (const nt of grammar.nonTerminals) {
    const alts = grammar.productions[nt] || [];
    const rhsString = alts.map(alt => alt.join(' ')).join(' | ');
    lines.push(`${nt} -> ${rhsString}`);
  }

  return lines.join('\n');
}
