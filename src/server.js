/**
 * Express Server for CFG Analysis Tool
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseGrammar, formatGrammar } from './core/grammarParser.js';
import { simplifyGrammar, removeUselessSymbols, removeEpsilonProductions, removeUnitProductions } from './core/simplifier.js';
import { SAMPLE_GRAMMARS, MALFORMED_TEST_CASES } from './core/sampleGrammars.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API: Parse CFG grammar and include simplification steps
app.post('/api/parse', (req, res) => {
  const { grammarText, options } = req.body;
  if (grammarText === undefined) {
    return res.status(400).json({
      success: false,
      errors: [{ line: 0, message: 'Missing grammarText in request body', snippet: '' }]
    });
  }

  const result = parseGrammar(grammarText, options || {});
  if (result.success) {
    result.simplification = simplifyGrammar(result.grammar);
  }
  return res.json(result);
});

// API: Dedicated Simplify Endpoint
app.post('/api/simplify', (req, res) => {
  const { grammarText, options } = req.body;
  if (grammarText === undefined) {
    return res.status(400).json({
      success: false,
      errors: [{ line: 0, message: 'Missing grammarText in request body', snippet: '' }]
    });
  }

  const parseResult = parseGrammar(grammarText, options || {});
  if (!parseResult.success) {
    return res.json(parseResult);
  }

  const simplification = simplifyGrammar(parseResult.grammar);
  return res.json({
    success: true,
    grammar: parseResult.grammar,
    simplification
  });
});

// API: Get sample test grammars & malformed cases
app.get('/api/samples', (req, res) => {
  res.json({
    samples: SAMPLE_GRAMMARS,
    malformed: MALFORMED_TEST_CASES
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 CFG Analysis Tool Server running at http://localhost:${PORT}`);
});
