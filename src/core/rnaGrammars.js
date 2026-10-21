/**
 * Preset CFG Grammar Texts for Secondary RNA Folding Analysis
 * 
 * Terminals: lowercase a, c, g, u
 * Non-terminals: uppercase S, L, N
 * Epsilon: 'eps'
 */

/**
 * STRICT Grammar:
 * One hairpin loop: outer bases pair, optional nested stem,
 * hairpin loop has at least 3 unpaired bases (NNN or NL).
 */
export const STRICT_RNA_GRAMMAR = `S -> a S u | u S a | g S c | c S g | g S u | u S g | a L u | u L a | g L c | c L g | g L u | u L g
L -> N N N | N L
N -> a | c | g | u`;

/**
 * PERMISSIVE Grammar:
 * Any nested folding: base pairs (a-u, u-a, g-c, c-g, g-u, u-g),
 * unpaired bases anywhere (aS, cS, gS, uS), branching (S S), and epsilon.
 */
export const PERMISSIVE_RNA_GRAMMAR = `S -> a S u | u S a | g S c | c S g | g S u | u S g | a S | c S | g S | u S | S S | eps`;

export const RNA_PRESETS = {
  strict: STRICT_RNA_GRAMMAR,
  permissive: PERMISSIVE_RNA_GRAMMAR
};
