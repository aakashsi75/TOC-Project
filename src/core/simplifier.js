/**
 * Context-Free Grammar (CFG) Simplification Module
 * 
 * Implements 3 incremental transformation steps:
 * 1. Remove Useless Symbols (non-generating and unreachable)
 * 2. Eliminate Epsilon-Productions (A -> ε)
 * 3. Eliminate Unit Productions (A -> B)
 */

import { formatGrammar } from './grammarParser.js';

/**
 * Step 1: Remove Useless Symbols
 * - Non-generating: Non-terminals that cannot derive any string of terminals.
 * - Unreachable: Symbols that cannot be reached from the start symbol.
 *
 * @param {Object} grammar - { nonTerminals, terminals, productions, startSymbol }
 * @returns {{
 *   grammar: Object,
 *   details: {
 *     generatingNT: string[],
 *     nonGeneratingNT: string[],
 *     reachableSymbols: string[],
 *     unreachableNT: string[],
 *     unreachableT: string[]
 *   },
 *   formatted: string
 * }}
 */
export function removeUselessSymbols(grammar) {
  const { nonTerminals = [], terminals = [], productions = {}, startSymbol } = grammar;

  // Clone productions
  const prodClone = {};
  for (const nt of nonTerminals) {
    prodClone[nt] = (productions[nt] || []).map(rule => [...rule]);
  }

  // --- Phase 1: Identify Generating Symbols ---
  const generating = new Set(terminals);
  generating.add('ε');

  let changed = true;
  while (changed) {
    changed = false;
    for (const nt of nonTerminals) {
      if (generating.has(nt)) continue;
      const rules = prodClone[nt] || [];
      for (const rule of rules) {
        if (rule.length === 0 || rule.every(sym => generating.has(sym))) {
          generating.add(nt);
          changed = true;
          break;
        }
      }
    }
  }

  const generatingNT = nonTerminals.filter(nt => generating.has(nt));
  const nonGeneratingNT = nonTerminals.filter(nt => !generating.has(nt));

  // Filter out productions referencing non-generating symbols
  const genProductions = {};
  for (const nt of generatingNT) {
    const rules = prodClone[nt] || [];
    genProductions[nt] = rules.filter(rule =>
      rule.every(sym => generating.has(sym))
    );
  }

  // If start symbol is non-generating, language is empty
  if (!generating.has(startSymbol)) {
    const emptyGrammar = {
      nonTerminals: [startSymbol],
      terminals: [],
      productions: { [startSymbol]: [] },
      startSymbol
    };
    return {
      grammar: emptyGrammar,
      details: {
        generatingNT: [],
        nonGeneratingNT,
        reachableSymbols: [startSymbol],
        unreachableNT: nonTerminals.filter(nt => nt !== startSymbol),
        unreachableT: [...terminals]
      },
      formatted: formatGrammar(emptyGrammar)
    };
  }

  // --- Phase 2: Identify Reachable Symbols ---
  const reachable = new Set();
  if (startSymbol) reachable.add(startSymbol);

  changed = true;
  while (changed) {
    changed = false;
    for (const sym of Array.from(reachable)) {
      if (generatingNT.includes(sym)) {
        const rules = genProductions[sym] || [];
        for (const rule of rules) {
          for (const s of rule) {
            if (s !== 'ε' && !reachable.has(s)) {
              reachable.add(s);
              changed = true;
            }
          }
        }
      }
    }
  }

  const finalNT = generatingNT.filter(nt => reachable.has(nt));
  const unreachableNT = nonTerminals.filter(nt => !finalNT.includes(nt));
  const finalT = terminals.filter(t => reachable.has(t));
  const unreachableT = terminals.filter(t => !finalT.includes(t));

  const finalProductions = {};
  for (const nt of finalNT) {
    finalProductions[nt] = (genProductions[nt] || []).filter(rule =>
      rule.every(sym => sym === 'ε' || reachable.has(sym))
    );
  }

  const simplifiedGrammar = {
    nonTerminals: finalNT,
    terminals: finalT,
    productions: finalProductions,
    startSymbol
  };

  return {
    grammar: simplifiedGrammar,
    details: {
      generatingNT,
      nonGeneratingNT,
      reachableSymbols: Array.from(reachable),
      unreachableNT,
      unreachableT
    },
    formatted: formatGrammar(simplifiedGrammar)
  };
}

/**
 * Step 2: Eliminate Epsilon Productions (A -> ε)
 * - Identifies all nullable non-terminals (A =>* ε).
 * - Substitutes nullable positions across all production rules.
 * - Preserves one ε at start symbol if the language contains the empty string.
 *
 * @param {Object} grammar - { nonTerminals, terminals, productions, startSymbol }
 * @returns {{
 *   grammar: Object,
 *   details: {
 *     nullableNT: string[],
 *     addedStartEps: boolean
 *   },
 *   formatted: string
 * }}
 */
export function removeEpsilonProductions(grammar) {
  const { nonTerminals = [], terminals = [], productions = {}, startSymbol } = grammar;

  // Phase 1: Find all Nullable Non-Terminals
  const nullable = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const nt of nonTerminals) {
      if (nullable.has(nt)) continue;
      const rules = productions[nt] || [];
      for (const rule of rules) {
        if ((rule.length === 1 && rule[0] === 'ε') || (rule.length > 0 && rule.every(sym => nullable.has(sym)))) {
          nullable.add(nt);
          changed = true;
          break;
        }
      }
    }
  }

  // Phase 2: Generate combinations of omitting nullable symbols
  const newProductions = {};
  for (const nt of nonTerminals) {
    newProductions[nt] = [];
    const rules = productions[nt] || [];

    for (const rule of rules) {
      if (rule.length === 1 && rule[0] === 'ε') continue;

      const combinations = generateNullableCombinations(rule, nullable);
      for (const combo of combinations) {
        if (combo.length === 0) continue; // Exclude empty string in general rules
        const exists = newProductions[nt].some(existing =>
          existing.length === combo.length && existing.every((t, i) => t === combo[i])
        );
        if (!exists) {
          newProductions[nt].push(combo);
        }
      }
    }
  }

  let finalStartSymbol = startSymbol;
  let finalNonTerminals = [...nonTerminals];
  let addedStartEps = false;

  // Phase 3: Preserve ε if start symbol is nullable
  if (nullable.has(startSymbol)) {
    addedStartEps = true;
    let freshStart = `S0`;
    while (finalNonTerminals.includes(freshStart)) {
      freshStart += "'";
    }
    finalNonTerminals.unshift(freshStart);
    newProductions[freshStart] = [[startSymbol], ['ε']];
    finalStartSymbol = freshStart;
  }

  const cleanedGrammar = {
    nonTerminals: finalNonTerminals,
    terminals: terminals.filter(t => t !== 'ε'),
    productions: newProductions,
    startSymbol: finalStartSymbol
  };

  return {
    grammar: cleanedGrammar,
    details: {
      nullableNT: Array.from(nullable),
      addedStartEps
    },
    formatted: formatGrammar(cleanedGrammar)
  };
}

function generateNullableCombinations(rule, nullableSet) {
  const results = [];

  function helper(index, current) {
    if (index === rule.length) {
      results.push(current);
      return;
    }

    const sym = rule[index];
    // Option 1: Keep sym
    helper(index + 1, [...current, sym]);

    // Option 2: If sym is nullable, also branch by omitting sym
    if (nullableSet.has(sym)) {
      helper(index + 1, current);
    }
  }

  helper(0, []);
  return results;
}

/**
 * Step 3: Eliminate Unit Productions (A -> B)
 * - Collapses unit production chains (e.g., A -> B -> C => A -> c).
 *
 * @param {Object} grammar - { nonTerminals, terminals, productions, startSymbol }
 * @returns {{
 *   grammar: Object,
 *   details: {
 *     unitPairs: Object.<string, string[]>,
 *     eliminatedUnits: Array<{ from: string, to: string }>
 *   },
 *   formatted: string
 * }}
 */
export function removeUnitProductions(grammar) {
  const { nonTerminals = [], terminals = [], productions = {}, startSymbol } = grammar;

  // Phase 1: Compute unit closure UNIT(A) for each non-terminal
  const unitPairs = {};
  const eliminatedUnits = [];

  for (const nt of nonTerminals) {
    unitPairs[nt] = new Set([nt]);
    const queue = [nt];
    const visited = new Set([nt]);

    while (queue.length > 0) {
      const current = queue.shift();
      const rules = productions[current] || [];
      for (const rule of rules) {
        if (rule.length === 1 && nonTerminals.includes(rule[0])) {
          const target = rule[0];
          eliminatedUnits.push({ from: current, to: target });
          if (!visited.has(target)) {
            visited.add(target);
            unitPairs[nt].add(target);
            queue.push(target);
          }
        }
      }
    }
  }

  // Phase 2: Build direct non-unit productions
  const newProductions = {};
  for (const nt of nonTerminals) {
    newProductions[nt] = [];
    const reachableNTs = unitPairs[nt];

    for (const b of reachableNTs) {
      const bRules = productions[b] || [];
      for (const rule of bRules) {
        const isUnit = rule.length === 1 && nonTerminals.includes(rule[0]);
        if (!isUnit) {
          const exists = newProductions[nt].some(existing =>
            existing.length === rule.length && existing.every((t, i) => t === rule[i])
          );
          if (!exists) {
            newProductions[nt].push([...rule]);
          }
        }
      }
    }
  }

  const serializableUnitPairs = {};
  for (const [k, v] of Object.entries(unitPairs)) {
    serializableUnitPairs[k] = Array.from(v);
  }

  const simplifiedGrammar = {
    nonTerminals: [...nonTerminals],
    terminals: [...terminals],
    productions: newProductions,
    startSymbol
  };

  return {
    grammar: simplifiedGrammar,
    details: {
      unitPairs: serializableUnitPairs,
      eliminatedUnits: Array.from(new Set(eliminatedUnits.map(u => `${u.from}->${u.to}`))).map(str => {
        const [from, to] = str.split('->');
        return { from, to };
      })
    },
    formatted: formatGrammar(simplifiedGrammar)
  };
}

/**
 * Executes full 3-step grammar simplification pipeline in order:
 * 1. Remove useless symbols
 * 2. Eliminate ε-productions
 * 3. Eliminate unit productions
 *
 * @param {Object} grammar - Initial parsed grammar object
 * @returns {{
 *   original: Object,
 *   step1: ReturnType<typeof removeUselessSymbols>,
 *   step2: ReturnType<typeof removeEpsilonProductions>,
 *   step3: ReturnType<typeof removeUnitProductions>,
 *   final: Object,
 *   formattedFinal: string
 * }}
 */
export function simplifyGrammar(grammar) {
  const step1 = removeUselessSymbols(grammar);
  const step2 = removeEpsilonProductions(step1.grammar);
  const step3 = removeUnitProductions(step2.grammar);

  return {
    original: grammar,
    step1,
    step2,
    step3,
    final: step3.grammar,
    formattedFinal: step3.formatted
  };
}
