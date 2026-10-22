import { parseGrammar, formatGrammar } from './grammarParser.js';
import { simplifyGrammar } from './simplifier.js';
import { convertToCNF } from './cnf.js';

export const COMMAND_GRAMMAR = `S -> PIPELINE | S and PIPELINE | S or PIPELINE
PIPELINE -> FACTOR | PIPELINE pipe FACTOR
FACTOR -> COMMAND | lparen S rparen
COMMAND -> COPY | MOVE | DELETE | MAKE_DIR | TOUCH | LIST | PRINT_DIR | CHANGE_DIR | ECHO | READ | FILTER
COPY -> cp COPY_OPTIONS SOURCE DESTINATION
MOVE -> mv END_OPTIONS SOURCE DESTINATION
DELETE -> rm REMOVE_OPTIONS PATH
MAKE_DIR -> mkdir MAKE_OPTIONS PATH
TOUCH -> touch END_OPTIONS PATH
LIST -> ls LIST_OPTIONS | ls LIST_OPTIONS PATH
PRINT_DIR -> pwd END_OPTIONS
CHANGE_DIR -> cd END_OPTIONS PATH
ECHO -> echo ECHO_OPTIONS | echo ECHO_OPTIONS WORDS
READ -> cat END_OPTIONS | cat END_OPTIONS PATH
FILTER -> grep FILTER_OPTIONS PATTERN | grep FILTER_OPTIONS PATTERN PATH
SOURCE -> path
DESTINATION -> path
PATH -> path
PATTERN -> pattern
WORDS -> TEXT | TEXT WORDS
TEXT -> text
END_OPTIONS -> endopts | eps
COPY_OPTIONS -> COPY_FLAGS END_OPTIONS | END_OPTIONS
COPY_FLAGS -> copyflag | copyflag COPY_FLAGS
REMOVE_OPTIONS -> REMOVE_FLAGS END_OPTIONS | END_OPTIONS
REMOVE_FLAGS -> removeflag | removeflag REMOVE_FLAGS
MAKE_OPTIONS -> MAKE_FLAGS END_OPTIONS | END_OPTIONS
MAKE_FLAGS -> makeflag | makeflag MAKE_FLAGS
LIST_OPTIONS -> LIST_FLAGS END_OPTIONS | END_OPTIONS
LIST_FLAGS -> listflag | listflag LIST_FLAGS
ECHO_OPTIONS -> ECHO_FLAGS END_OPTIONS | END_OPTIONS
ECHO_FLAGS -> echoflag | echoflag ECHO_FLAGS
FILTER_OPTIONS -> FILTER_FLAGS END_OPTIONS | END_OPTIONS
FILTER_FLAGS -> filterflag | filterflag FILTER_FLAGS`;

export const READ_ONLY_GRAMMAR = COMMAND_GRAMMAR.replace(
  /^COMMAND ->.*$/m, 'COMMAND -> LIST | PRINT_DIR | ECHO | READ | FILTER'
);
export const COPY_ONLY_GRAMMAR = `COPY -> cp SOURCE DESTINATION
SOURCE -> path
DESTINATION -> path`;

export const TOKEN_CLASSES = {
  cp: 'cp at the start of a simple command', mv: 'mv at the start of a simple command',
  rm: 'rm at the start of a simple command', mkdir: 'mkdir at the start of a simple command',
  touch: 'touch at the start of a simple command', ls: 'ls at the start of a simple command',
  pwd: 'pwd at the start of a simple command', cd: 'cd at the start of a simple command',
  echo: 'echo at the start of a simple command', cat: 'cat at the start of a simple command',
  grep: 'grep at the start of a simple command',
  path: 'A literal path argument; existence is checked by the interpreter',
  text: 'An echo argument (including quoted/escaped text)',
  pattern: 'The first non-option grep argument; a literal substring',
  copyflag: 'cp flags containing only r/R', removeflag: 'rm flags containing only r/R/f',
  makeflag: 'mkdir flags containing only p', listflag: 'ls flags containing only a/l',
  echoflag: 'echo flags containing only n', filterflag: 'grep flags containing only i/v',
  endopts: '-- ends option processing', and: '&&', or: '||', pipe: '|',
  lparen: '( opens a nested command group', rparen: ') closes a nested command group',
  unknown: 'An unsupported command name; it can be parsed by a custom rule, but never executed',
  badflag: 'An unsupported flag; accepting it does not enable its behavior'
};

const cache = new Map();
export function compileCommandGrammar(text = COMMAND_GRAMMAR) {
  if (typeof text !== 'string' || !text.trim() || text.length > 8000) {
    return { error: 'Provide a non-empty command grammar (maximum 8,000 characters).', grammarErrors: [] };
  }
  if (cache.has(text)) return cache.get(text);
  const parsed = parseGrammar(text, { strictNonTerminals: true });
  if (!parsed.success) return { error: parsed.errors.map(error => `Line ${error.line}: ${error.message}`).join(' '), grammarErrors: parsed.errors };
  const grammar = parsed.grammar;
  const rules = Object.values(grammar.productions).flat();
  if (grammar.nonTerminals.length > 48 || rules.length > 120 || rules.some(rule => rule.length > 6)) {
    return { error: 'Grammar limit: 48 non-terminals, 120 alternatives, and 6 symbols per alternative.', grammarErrors: [] };
  }
  const unsupported = grammar.terminals.filter(terminal => terminal !== 'ε' && !Object.hasOwn(TOKEN_CLASSES, terminal));
  if (unsupported.length) return { error: `Unknown token class: ${unsupported.join(', ')}. Use the token-class reference below the editor.`, grammarErrors: [] };
  const simplified = simplifyGrammar(grammar);
  if (!simplified.final.productions[simplified.final.startSymbol]?.length) return { error: 'The start symbol cannot produce a supported token string.', grammarErrors: [] };
  if (Object.values(simplified.final.productions).flat().length > 600) return { error: 'The simplified grammar is too large (maximum 600 alternatives).', grammarErrors: [] };
  const cnf = convertToCNF(simplified.final);
  const compiled = { original: grammar, simplified: simplified.final, cnf, stages: {
    original: formatGrammar(grammar),
    useful: simplified.step1.formatted,
    epsilon: simplified.step2.formatted,
    simplified: formatGrammar(simplified.final),
    cnf: formatGrammar(cnf.final),
    helpers: cnf.trace,
    counts: { authored: rules.length, simplified: Object.values(simplified.final.productions).flat().length, cnf: Object.values(cnf.final.productions).flat().length }
  } };
  // Bounded cache: editing the grammar cannot grow process memory indefinitely.
  if (cache.size >= 8) cache.delete(cache.keys().next().value);
  cache.set(text, compiled);
  return compiled;
}
export const BASIC_GRAMMAR = `COMMAND -> LIST | MAKE | COPY | MOVE | DELETE
LIST -> ls | ls PATH
MAKE -> mkdir PATH
COPY -> cp PATH PATH
MOVE -> mv PATH PATH
DELETE -> rm PATH
PATH -> path`;

