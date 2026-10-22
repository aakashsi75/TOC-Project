/**
 * Express server for CmdPrelude
 */

import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openLocalWorkspace, previewLocalWorkspace, applyLocalWorkspace } from './localWorkspace.js';
import { BASIC_GRAMMAR } from './core/commandGrammar.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { simulateCommand, sampleWorkspace, COMMANDS, COMMAND_GRAMMAR, READ_ONLY_GRAMMAR, COPY_ONLY_GRAMMAR, TOKEN_CLASSES, FLAG_HELP } from './core/commandSimulator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use('/api/simulate', express.json({ limit: '2mb' }));
app.use(express.json());
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


const server = app.listen(PORT, () => {
  console.log(`CmdPrelude server running at http://localhost:${server.address().port}`);
});
