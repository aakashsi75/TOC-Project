/**
 * Express Server for CFG Analysis Tool
 */

import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openLocalWorkspace, previewLocalWorkspace, applyLocalWorkspace } from './localWorkspace.js';
import { BASIC_GRAMMAR } from './core/commandGrammar.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseGrammar, formatGrammar } from './core/grammarParser.js';
import { simplifyGrammar, removeUselessSymbols, removeEpsilonProductions, removeUnitProductions } from './core/simplifier.js';
import { convertToCNF, isCNF } from './core/cnf.js';
import { cykParse } from './core/cyk.js';
import { analyzeAmbiguity } from './core/parseTrees.js';
import { analyzeRNA } from './core/rna.js';
import { simulateCommand, sampleWorkspace, COMMANDS, COMMAND_GRAMMAR, READ_ONLY_GRAMMAR, COPY_ONLY_GRAMMAR, TOKEN_CLASSES, FLAG_HELP } from './core/commandSimulator.js';
import { SAMPLE_GRAMMARS, MALFORMED_TEST_CASES } from './core/sampleGrammars.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use('/api/simulate', express.json({ limit: '2mb' }));
app.use(express.json());
app.get('/grammar.html', (req, res) => res.redirect('/#conversions'));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Browser-only local actions require a custom header (cross-origin preflights are
// denied) and a loopback connection. Folder and preview tokens are unguessable.
app.use('/api/local-folder', (req, res, next) => {
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) || req.get('X-Local-Workspace') !== '1') return res.status(403).json({ error: 'Local folder actions must come from this app.' });
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.get('host') || '')) return res.status(403).json({ error: 'Use localhost or 127.0.0.1 for local folder actions.' });
  const origin = req.get('Origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Cross-origin folder actions are blocked.' });
  next();
});
function localRoute(handler) {
  return async (req, res) => { try { res.json(await handler(req.body || {})); } catch (error) { res.status(400).json({ error: error.message }); } };
}
app.post('/api/local-folder/pick', localRoute(async () => {
  if (process.platform !== 'win32') throw new Error('Paste the folder path below on this platform.');
  const script = 'Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = "Choose a folder for Before You Run"; if ($picker.ShowDialog() -eq "OK") { [Console]::Write($picker.SelectedPath) }; $picker.Dispose()';
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, timeout: 60000 });
  return { path: stdout.trim() };
}));
app.post('/api/local-folder/open', localRoute(body => openLocalWorkspace(body.path)));
app.post('/api/local-folder/preview', localRoute(body => previewLocalWorkspace(body.workspaceId, body.command, body.grammarText, body.protectedPaths)));
app.post('/api/local-folder/apply', localRoute(body => applyLocalWorkspace(body.workspaceId, body.planId)));

// A larger JSON limit is scoped only to folder metadata for the simulator.
// The simulator never reads a host path or launches a process.
app.get('/api/simulator', (req, res) => {
  res.json({ workspace: sampleWorkspace(), commands: COMMANDS, flags: FLAG_HELP, grammar: BASIC_GRAMMAR, grammarPresets: { basic: BASIC_GRAMMAR, full: COMMAND_GRAMMAR, readonly: READ_ONLY_GRAMMAR, copy: COPY_ONLY_GRAMMAR }, tokenClasses: TOKEN_CLASSES });
});
app.post('/api/simulate', (req, res) => {
  try {
    const { command, workspace, protectedPaths, grammarText } = req.body || {};
    const result = simulateCommand(command, workspace, protectedPaths, grammarText);
    res.json(result);
  } catch (error) {
    res.status(400).json({ accepted: false, error: error.message, repairs: [] });
  }
});

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
    result.cnf = convertToCNF(result.simplification.final);
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

// API: Dedicated CNF endpoint (parse → simplify → CNF)
app.post('/api/cnf', (req, res) => {
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
  const cnf = convertToCNF(simplification.final);

  return res.json({
    success: true,
    grammar: parseResult.grammar,
    simplification,
    cnf
  });
});

// API: Dedicated CYK endpoint (parse → simplify → CNF → CYK parse)
app.post('/api/cyk', (req, res) => {
  const { grammar, grammarText, input, inputString, options, strict } = req.body;
  const rawGrammar = grammar !== undefined ? grammar : grammarText;

  if (rawGrammar === undefined) {
    return res.status(400).json({
      success: false,
      errors: [{ line: 0, message: 'Missing grammar in request body', snippet: '' }]
    });
  }

  // Accept inputString (primary) or input (legacy alias)
  const rawInput = inputString !== undefined ? inputString : input;
  if (rawInput === undefined || typeof rawInput !== 'string') {
    return res.status(400).json({ success: false, error: 'No input string provided' });
  }

  // Accept options object (primary) or flat strict flag (legacy)
  const resolvedOptions = options !== undefined
    ? options
    : (strict !== undefined ? { strictNonTerminals: Boolean(strict) } : {});

  const parseResult = parseGrammar(rawGrammar, resolvedOptions);
  if (!parseResult.success) {
    return res.json(parseResult);
  }

  const simplification = simplifyGrammar(parseResult.grammar);
  const cnf = convertToCNF(simplification.final);
  const cyk = cykParse(cnf.final, rawInput);
  const ambiguity = cyk.accepted ? analyzeAmbiguity(cyk, cnf.final, cnf.trace) : null;

  return res.json({
    success: true,
    grammar: parseResult.grammar,
    cnfGrammar: cnf.final,
    cnf,
    cyk,
    accepted: cyk.accepted,
    ambiguity
  });
});

// API: Dedicated Ambiguity and Parse Tree Analysis endpoint
app.post('/api/ambiguity', (req, res) => {
  const { grammar, grammarText, input, inputString, options, strict, limit } = req.body;
  const rawGrammar = grammar !== undefined ? grammar : grammarText;

  if (rawGrammar === undefined) {
    return res.status(400).json({
      success: false,
      errors: [{ line: 0, message: 'Missing grammar in request body', snippet: '' }]
    });
  }

  // Accept inputString (primary) or input (legacy alias)
  const rawInput = inputString !== undefined ? inputString : input;
  if (rawInput === undefined || typeof rawInput !== 'string') {
    return res.status(400).json({ success: false, error: 'No input string provided' });
  }

  // Accept options object (primary) or flat strict flag (legacy)
  const resolvedOptions = options !== undefined
    ? options
    : (strict !== undefined ? { strictNonTerminals: Boolean(strict) } : {});

  const parseResult = parseGrammar(rawGrammar, resolvedOptions);
  if (!parseResult.success) {
    return res.json(parseResult);
  }

  const simplification = simplifyGrammar(parseResult.grammar);
  const cnf = convertToCNF(simplification.final);
  const cyk = cykParse(cnf.final, rawInput);
  const treeLimit = typeof limit === 'number' ? limit : 10;
  const ambiguity = analyzeAmbiguity(cyk, cnf.final, cnf.trace, treeLimit);

  return res.json({
    success: true,
    accepted: cyk.accepted,
    ambiguity
  });
});

// API: Compare two grammars on a list of input strings (ambiguity resolution demo)
// POST /api/compare { grammarA, grammarB, inputStrings: string[], options? }
// Returns per-string, per-grammar results plus an equivalence summary.
app.post('/api/compare', (req, res) => {
  const { grammarA, grammarB, inputStrings, options } = req.body;
  if (!grammarA || !grammarB) {
    return res.status(400).json({ success: false, error: 'Both grammarA and grammarB are required.' });
  }
  if (!Array.isArray(inputStrings) || inputStrings.length === 0) {
    return res.status(400).json({ success: false, error: 'inputStrings must be a non-empty array.' });
  }

  const resolvedOptions = options || {};

  function normalizeGrammar(text) {
    if (!text || typeof text !== 'string') return text;
    const lines = text.split(/\r?\n/);
    const nts = [];
    for (const l of lines) {
      const parts = l.split(/->|→/);
      if (parts.length > 1) {
        const lhs = parts[0].trim();
        if (lhs && !nts.includes(lhs)) nts.push(lhs);
      }
    }
    let res = text;
    for (const nt of nts) {
      if (nt.length === 1 && /^[A-Z]$/.test(nt)) {
        res = res
          .replace(new RegExp('([a-z0-9])(' + nt + ')(?![a-zA-Z0-9_])', 'g'), '$1 $2')
          .replace(new RegExp('(^|[^a-zA-Z0-9_])(' + nt + ')([a-z0-9])', 'g'), '$1$2 $3');
      }
    }
    return res;
  }

  // Helper: run the full pipeline for one grammar text, return compiled CNF + trace or error.
  function compilePipeline(grammarText) {
    try {
      const normalized = normalizeGrammar(grammarText);
      const parsed = parseGrammar(normalized, resolvedOptions);
      if (!parsed.success) {
        return { error: parsed.errors.map(e => e.message).join('; ') };
      }
      const simplified = simplifyGrammar(parsed.grammar);
      const cnf = convertToCNF(simplified.final);
      return { cnf: cnf.final, trace: cnf.trace };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }

  // Helper: run CYK + ambiguity analysis for one string against a compiled pipeline.
  function runForString(compiled, inputStr) {
    if (compiled.error) {
      return { accepted: false, parseCount: 0, ambiguous: false, trees: [], error: compiled.error };
    }
    try {
      const cyk = cykParse(compiled.cnf, inputStr);
      if (cyk.error) {
        return { accepted: false, parseCount: 0, ambiguous: false, trees: [], error: cyk.error };
      }
      if (!cyk.accepted) {
        return { accepted: false, parseCount: 0, ambiguous: false, trees: [], error: null };
      }
      const amb = analyzeAmbiguity(cyk, compiled.cnf, compiled.trace, 10);
      return {
        accepted: true,
        parseCount: typeof amb.parseCount === 'bigint' ? Number(amb.parseCount) : amb.parseCount,
        ambiguous: amb.ambiguous,
        truncated: amb.truncated,
        trees: amb.trees || [],
        error: null
      };
    } catch (err) {
      return { accepted: false, parseCount: 0, ambiguous: false, trees: [], error: err.message || String(err) };
    }
  }

  const pipelineA = compilePipeline(grammarA);
  const pipelineB = compilePipeline(grammarB);

  const rows = inputStrings.map(str => {
    const a = runForString(pipelineA, str);
    const b = runForString(pipelineB, str);
    // Equivalence: same accepted/rejected verdict (not a language equality proof)
    const verdictMatch = (!a.error && !b.error) ? (a.accepted === b.accepted) : null;
    return { string: str, a, b, verdictMatch };
  });

  const testedCount = rows.filter(r => r.verdictMatch !== null).length;
  const matchCount  = rows.filter(r => r.verdictMatch === true).length;

  return res.json({
    success: true,
    rows,
    equivalence: {
      // NOTE: This checks only the tested strings — it is NOT a proof that L(A) = L(B).
      testedStrings: testedCount,
      matchingVerdicts: matchCount,
      allMatch: matchCount === testedCount && testedCount > 0,
      note: 'Checks only the tested strings; this is not a proof that the languages are equal.'
    }
  });
});

// API: Secondary RNA Folding Analysis endpoint
// POST /api/rna { sequence, preset?: "strict" | "permissive", grammarText?, options? }
app.post('/api/rna', (req, res) => {
  const { sequence, preset, grammarText, options } = req.body || {};
  if (sequence === undefined || typeof sequence !== 'string') {
    return res.status(400).json({ success: false, error: 'No sequence provided' });
  }
  if (preset !== undefined && preset !== 'strict' && preset !== 'permissive') {
    return res.status(400).json({ success: false, error: 'Preset must be "strict" or "permissive"' });
  }
  if (grammarText !== undefined && typeof grammarText !== 'string') {
    return res.status(400).json({ success: false, error: 'grammarText must be a string' });
  }
  const result = analyzeRNA(sequence, grammarText ?? preset ?? 'strict', options === undefined ? {} : options);
  return res.json({
    success: !result.error,
    ...result
  });
});

const server = app.listen(PORT, () => {
  console.log(`\n🚀 CFG Analysis Tool Server running at http://localhost:${server.address().port}`);
});

