/**
 * Sample Test Grammars for CFG Analysis Tool
 */

export const SAMPLE_GRAMMARS = {
  // Test Grammar 1: Arithmetic Expression Grammar
  arithmetic: {
    id: 'arithmetic',
    name: '1) Arithmetic Expression Grammar',
    description: 'Standard unambiguous grammar for arithmetic expressions with operator precedence and associativity.',
    text: `E -> E+T | T
T -> T*F | F
F -> (E) | id`
  },

  // Test Grammar 2: Grammar with Useless Symbols and Unit Productions
  simplification: {
    id: 'simplification',
    name: '2) Useless Symbols & Unit Productions',
    description: 'Contains unit productions (S -> A | B, B -> C), unreachable symbol D, and non-generating symbol E for simplification.',
    text: `S -> A | B
A -> a
B -> C
C -> c
D -> d
E -> E e`
  },

  // Test Grammar 3: Classic Ambiguous Grammar
  ambiguous: {
    id: 'ambiguous',
    name: '3) Classic Ambiguous Grammar',
    description: 'Classic grammar exhibiting shift/reduce and precedence ambiguities for arithmetic expressions.',
    text: `E -> E+E | E*E | id`
  }
};

export const MALFORMED_TEST_CASES = [
  {
    name: 'Missing Arrow (->)',
    description: 'A rule missing the production arrow operator',
    text: `E E+T | T
T -> T*F | F
F -> (E) | id`
  },
  {
    name: 'Missing Left-Hand Side (LHS)',
    description: 'A rule starting directly with -> without a non-terminal',
    text: `-> E+T | T
T -> T*F | F`
  },
  {
    name: 'Empty Production Alternative (Trailing Pipe)',
    description: 'A rule with a dangling pipe without an alternative',
    text: `E -> E+T |
T -> T*F | F`
  },
  {
    name: 'Undefined Non-Terminal (Strict Check)',
    description: 'Right-hand side references non-terminal B with no corresponding production rule',
    text: `S -> A B
A -> a`,
    options: { strictNonTerminals: true }
  },
  {
    name: 'Empty Grammar Input',
    description: 'Empty or whitespace-only input string',
    text: `   `
  }
];
