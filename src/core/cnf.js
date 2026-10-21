/**
 * Chomsky Normal Form (CNF) Conversion Module
 * 
 * Converts a simplified Context-Free Grammar (free of useless symbols,
 * ε-productions, and unit productions) into Chomsky Normal Form.
 * 
 * Every production in CNF has one of two forms:
 *   1. A -> BC  (exactly two non-terminals)
 *   2. A -> a   (exactly one terminal)
 * Exception: S -> ε is permitted only if the start symbol never appears on any RHS.
 * 
 * The conversion follows 2 sequential stages:
 *   a) replaceTerminals: In productions of length >= 2, replaces each terminal
 *      with a dedicated non-terminal (A -> aB becomes A -> X_a B and X_a -> a).
 *   b) binarizeProductions: Breaks productions of length > 2 into binary chains
 *      using intermediate non-terminals (A -> BCD becomes A -> B Y1, Y1 -> CD).
 */

import { formatGrammar } from './grammarParser.js';

/**
 * Deduplicates an array of production alternatives (string[][]).
 * @param {string[][]} rules
 * @returns {string[][]}
 */
function deduplicateRules(rules) {
  const seen = new Set();
  const deduped = [];
  for (const rule of rules) {
    const key = rule.join('\u0000');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(rule);
    }
  }
  return deduped;
}

/**
 * Deep clones a grammar representation.
 * @param {Object} grammar
 * @returns {Object}
 */
function cloneGrammar(grammar) {
  if (!grammar) {
    return { nonTerminals: [], terminals: [], productions: {}, startSymbol: '' };
  }
  const clonedProds = {};
  for (const nt of (grammar.nonTerminals || [])) {
    clonedProds[nt] = (grammar.productions?.[nt] || []).map(r => [...r]);
  }
  if (grammar.productions) {
    for (const [lhs, rules] of Object.entries(grammar.productions)) {
      if (!clonedProds[lhs]) {
        clonedProds[lhs] = rules.map(r => [...r]);
      }
    }
  }
  return {
    nonTerminals: [...(grammar.nonTerminals || [])],
    terminals: [...(grammar.terminals || [])],
    productions: clonedProds,
    startSymbol: grammar.startSymbol || ''
  };
}

/**
 * Checks if start symbol derives ε and appears on the RHS of any production.
 * If so, introduces a fresh start symbol S0 -> S | ε to satisfy CNF rules.
 * 
 * @param {Object} grammar 
 * @param {Array} trace 
 * @returns {Object}
 */
function ensureStartEpsilonCNF(grammar, trace = []) {
  const S = grammar.startSymbol;
  if (!S || !grammar.productions || !grammar.productions[S]) {
    return grammar;
  }

  const sRules = grammar.productions[S] || [];
  const hasEps = sRules.some(r => r.length === 1 && r[0] === 'ε');
  if (!hasEps) {
    return grammar;
  }

  // Check if S appears on any RHS
  let appearsOnRHS = false;
  for (const nt of grammar.nonTerminals) {
    for (const rule of (grammar.productions[nt] || [])) {
      if (rule.includes(S)) {
        appearsOnRHS = true;
        break;
      }
    }
    if (appearsOnRHS) break;
  }

  if (!appearsOnRHS) {
    return grammar;
  }

  const existingSet = new Set(grammar.nonTerminals);
  let freshStart = 'S0';
  while (existingSet.has(freshStart)) {
    freshStart += "'";
  }
  existingSet.add(freshStart);

  const newProductions = {};
  for (const nt of grammar.nonTerminals) {
    newProductions[nt] = (grammar.productions[nt] || []).map(r => [...r]);
  }

  // Remove ε from original S
  newProductions[S] = newProductions[S].filter(r => !(r.length === 1 && r[0] === 'ε'));

  // S0 gets all productions of S plus ε
  newProductions[freshStart] = [
    ...newProductions[S].map(r => [...r]),
    ['ε']
  ];

  trace.push({
    name: freshStart,
    symbol: freshStart,
    production: `${freshStart} -> ${S} | ε`,
    reason: 'start symbol replacement'
  });

  return {
    nonTerminals: [freshStart, ...grammar.nonTerminals],
    terminals: [...grammar.terminals],
    productions: newProductions,
    startSymbol: freshStart
  };
}

/**
 * Step 1: Replace Terminals in productions of length >= 2.
 * Replaces each terminal with a dedicated non-terminal X_t and adds X_t -> t.
 * Reuses one X_ symbol per terminal across all productions.
 * Supports multi-character terminals (e.g. "id" -> X_id).
 * Leaves single-terminal productions (A -> a) untouched.
 * 
 * @param {Object} grammar - { nonTerminals, terminals, productions, startSymbol }
 * @returns {{
 *   grammar: Object,
 *   trace: Array<{ name: string, symbol: string, production: string, reason: string }>,
 *   formatted: string
 * }}
 */
export function replaceTerminals(grammar) {
  if (!grammar || !grammar.nonTerminals || grammar.nonTerminals.length === 0) {
    const empty = cloneGrammar(grammar);
    return { grammar: empty, trace: [], formatted: '' };
  }

  const nonTerminals = [...grammar.nonTerminals];
  const terminals = [...(grammar.terminals || [])];
  const startSymbol = grammar.startSymbol || '';
  const existingNTSet = new Set(nonTerminals);
  const originalNTSet = new Set(nonTerminals);

  const newProductions = {};
  for (const nt of nonTerminals) {
    newProductions[nt] = (grammar.productions[nt] || []).map(r => [...r]);
  }

  const terminalToNT = new Map();
  const trace = [];
  const addedNTs = [];

  function getOrAddTerminalNT(term, sourceProduction) {
    if (terminalToNT.has(term)) {
      return terminalToNT.get(term);
    }
    const base = `X_${term}`;
    let name = base;
    let counter = 1;
    while (existingNTSet.has(name)) {
      name = `${base}_${counter}`;
      counter++;
    }
    existingNTSet.add(name);
    terminalToNT.set(term, name);
    addedNTs.push(name);
    newProductions[name] = [[term]];

    trace.push({
      name,
      symbol: name,
      production: sourceProduction,
      reason: 'terminal replacement'
    });

    return name;
  }

  // Iterate over existing non-terminals
  for (const nt of nonTerminals) {
    const rules = newProductions[nt] || [];
    for (let rIdx = 0; rIdx < rules.length; rIdx++) {
      const rule = rules[rIdx];
      // Only productions of length >= 2 replace terminals
      if (rule.length >= 2) {
        const sourceProductionStr = `${nt} -> ${rule.join(' ')}`;
        for (let i = 0; i < rule.length; i++) {
          const sym = rule[i];
          // Check if sym is a terminal (not in original nonTerminals and not epsilon)
          if (sym !== 'ε' && !originalNTSet.has(sym)) {
            const replSym = getOrAddTerminalNT(sym, sourceProductionStr);
            rule[i] = replSym;
          }
        }
      }
    }
  }

  // Deduplicate all production lists
  for (const nt of Object.keys(newProductions)) {
    newProductions[nt] = deduplicateRules(newProductions[nt]);
  }

  const finalNonTerminals = [...nonTerminals, ...addedNTs];
  const resultGrammar = {
    nonTerminals: finalNonTerminals,
    terminals,
    productions: newProductions,
    startSymbol
  };

  return {
    grammar: resultGrammar,
    trace,
    formatted: formatGrammar(resultGrammar)
  };
}

/**
 * Step 2: Binarize Productions longer than 2 symbols.
 * Breaks productions of length > 2 into binary chains with intermediate non-terminals:
 *   A -> B C D  becomes  A -> B Y1, Y1 -> C D
 * 
 * @param {Object} grammar - { nonTerminals, terminals, productions, startSymbol }
 * @returns {{
 *   grammar: Object,
 *   trace: Array<{ name: string, symbol: string, production: string, reason: string }>,
 *   formatted: string
 * }}
 */
export function binarizeProductions(grammar) {
  if (!grammar || !grammar.nonTerminals || grammar.nonTerminals.length === 0) {
    const empty = cloneGrammar(grammar);
    return { grammar: empty, trace: [], formatted: '' };
  }

  const nonTerminals = [...grammar.nonTerminals];
  const terminals = [...(grammar.terminals || [])];
  const startSymbol = grammar.startSymbol || '';
  const existingNTSet = new Set(nonTerminals);

  const newProductions = {};
  const trace = [];
  const addedNTs = [];

  let yCounter = 1;
  function getNextYName() {
    let name = `Y${yCounter}`;
    while (existingNTSet.has(name)) {
      yCounter++;
      name = `Y${yCounter}`;
    }
    existingNTSet.add(name);
    yCounter++;
    addedNTs.push(name);
    newProductions[name] = [];
    return name;
  }

  for (const nt of nonTerminals) {
    newProductions[nt] = [];
    const rules = grammar.productions[nt] || [];

    for (const rule of rules) {
      if (rule.length <= 2) {
        newProductions[nt].push([...rule]);
      } else {
        // rule.length > 2: binarize into cascade
        const sourceProductionStr = `${nt} -> ${rule.join(' ')}`;
        let prevLHS = nt;

        for (let i = 0; i < rule.length - 2; i++) {
          const yName = getNextYName();
          trace.push({
            name: yName,
            symbol: yName,
            production: sourceProductionStr,
            reason: 'binarization'
          });

          if (i === 0) {
            newProductions[nt].push([rule[i], yName]);
          } else {
            newProductions[prevLHS].push([rule[i], yName]);
          }
          prevLHS = yName;
        }

        // The last pair goes into the last intermediate non-terminal
        newProductions[prevLHS].push([
          rule[rule.length - 2],
          rule[rule.length - 1]
        ]);
      }
    }
  }

  // Deduplicate all production lists
  for (const nt of Object.keys(newProductions)) {
    newProductions[nt] = deduplicateRules(newProductions[nt]);
  }

  const finalNonTerminals = [...nonTerminals, ...addedNTs];
  const resultGrammar = {
    nonTerminals: finalNonTerminals,
    terminals,
    productions: newProductions,
    startSymbol
  };

  return {
    grammar: resultGrammar,
    trace,
    formatted: formatGrammar(resultGrammar)
  };
}

/**
 * Validates whether a grammar is in Chomsky Normal Form (CNF).
 * Checks that every production is either:
 *   - A -> BC  (two non-terminals)
 *   - A -> a   (one terminal)
 *   - S -> ε   (allowed only if start symbol never appears on any RHS)
 * 
 * @param {Object} grammar
 * @returns {{
 *   valid: boolean,
 *   isCNF: boolean,
 *   offending: Array<{ lhs: string, rhs: string[], production: string, reason: string }>
 * }}
 */
export function isCNF(grammar) {
  if (!grammar || !grammar.nonTerminals || grammar.nonTerminals.length === 0) {
    return { valid: true, isCNF: true, offending: [] };
  }

  const nonTerminals = new Set(grammar.nonTerminals || []);
  const startSymbol = grammar.startSymbol;
  const offending = [];

  // Check if start symbol appears on any RHS
  let startOnRHS = false;
  for (const nt of grammar.nonTerminals) {
    for (const rule of (grammar.productions?.[nt] || [])) {
      if (rule.includes(startSymbol)) {
        startOnRHS = true;
        break;
      }
    }
    if (startOnRHS) break;
  }

  for (const nt of grammar.nonTerminals) {
    const rules = grammar.productions?.[nt] || [];
    for (const rule of rules) {
      const prodStr = `${nt} -> ${rule.join(' ')}`;

      // Length 0: Empty RHS
      if (rule.length === 0) {
        offending.push({
          lhs: nt,
          rhs: rule,
          production: prodStr,
          reason: 'Empty production RHS is not allowed in CNF'
        });
        continue;
      }

      // Length 1: ε
      if (rule.length === 1 && rule[0] === 'ε') {
        if (nt === startSymbol && !startOnRHS) {
          continue; // Valid CNF exception
        } else {
          offending.push({
            lhs: nt,
            rhs: rule,
            production: prodStr,
            reason: nt !== startSymbol
              ? "ε-production allowed only for start symbol"
              : "Start symbol derives ε but appears on the RHS of a production"
          });
          continue;
        }
      }

      // Length 1: single symbol
      if (rule.length === 1) {
        const sym = rule[0];
        if (!nonTerminals.has(sym)) {
          // Terminal symbol -> Valid CNF
          continue;
        } else {
          // Non-terminal symbol -> Unit production, NOT CNF
          offending.push({
            lhs: nt,
            rhs: rule,
            production: prodStr,
            reason: `Unit production '${prodStr}' is not allowed in CNF`
          });
          continue;
        }
      }

      // Length 2: must be two non-terminals
      if (rule.length === 2) {
        const [b, c] = rule;
        if (nonTerminals.has(b) && nonTerminals.has(c)) {
          // Two non-terminals -> Valid CNF
          continue;
        } else {
          const nonNTSyms = [b, c].filter(s => !nonTerminals.has(s));
          offending.push({
            lhs: nt,
            rhs: rule,
            production: prodStr,
            reason: `Production contains terminal(s) [${nonNTSyms.join(', ')}]. Length-2 productions must consist of two non-terminals.`
          });
          continue;
        }
      }

      // Length > 2: NOT CNF
      offending.push({
        lhs: nt,
        rhs: rule,
        production: prodStr,
        reason: `Production has ${rule.length} symbols. CNF rules must have length 1 (terminal) or 2 (non-terminals).`
      });
    }
  }

  const valid = offending.length === 0;
  return {
    valid,
    isCNF: valid,
    offending
  };
}

/**
 * Runs the full Chomsky Normal Form conversion pipeline:
 *   1. Ensures start symbol S -> ε rules satisfy CNF constraint
 *   2. Step 1: replaceTerminals
 *   3. Step 2: binarizeProductions
 *   4. Validates final grammar with isCNF
 * 
 * @param {Object} grammar - Simplified grammar object
 * @returns {{
 *   original: Object,
 *   step1: ReturnType<typeof replaceTerminals>,
 *   step2: ReturnType<typeof binarizeProductions>,
 *   final: Object,
 *   formattedFinal: string,
 *   trace: Array<{ name: string, symbol: string, production: string, reason: string }>,
 *   isCNF: ReturnType<typeof isCNF>
 * }}
 */
export function convertToCNF(grammar) {
  if (!grammar || !grammar.nonTerminals || grammar.nonTerminals.length === 0) {
    const empty = { nonTerminals: [], terminals: [], productions: {}, startSymbol: '' };
    return {
      original: grammar || empty,
      step1: { grammar: empty, trace: [], formatted: '' },
      step2: { grammar: empty, trace: [], formatted: '' },
      final: empty,
      formattedFinal: '',
      trace: [],
      isCNF: { valid: true, isCNF: true, offending: [] }
    };
  }

  const initialTrace = [];
  const normalizedGrammar = ensureStartEpsilonCNF(grammar, initialTrace);

  const step1 = replaceTerminals(normalizedGrammar);
  const step2 = binarizeProductions(step1.grammar);

  const fullTrace = [...initialTrace, ...step1.trace, ...step2.trace];
  const cnfValidation = isCNF(step2.grammar);

  return {
    original: grammar,
    step1,
    step2,
    final: step2.grammar,
    formattedFinal: step2.formatted,
    trace: fullTrace,
    isCNF: cnfValidation
  };
}
