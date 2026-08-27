import { parseGrammar } from './src/core/grammarParser.js';

const input = `E E+T | T
T -> T*F | F
F -> (E) | id`;

console.log("Testing invalid grammar input:");
console.log(input);
console.log("\nParser output:");
console.log(parseGrammar(input));
