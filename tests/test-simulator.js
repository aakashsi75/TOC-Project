import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { simulateCommand, parseCommand, lexCommand, resolvePath, sampleWorkspace, validateWorkspace, COMMAND_GRAMMAR, READ_ONLY_GRAMMAR } from '../src/core/commandSimulator.js';
import { compileCommandGrammar } from '../src/core/commandGrammar.js';
import { metadataSnapshot, scanDirectoryMetadata } from '../public/workspaceImport.js';

const entry = (result, path) => result.after.entries.find(item => item.path === path);
const run = command => simulateCommand(command);

test('existing CFG pipeline parses token classes, source spans, and an unambiguous tree', () => {
  const result = parseCommand('cp "notes.txt" backup/');
  assert.equal(result.accepted, true);
  assert.equal(result.parseCount, '1');
  assert.deepEqual(result.ast.words, ['cp', 'notes.txt', 'backup/']);
  assert.deepEqual(result.tokens.map(t => [t.start, t.end]), [[0, 2], [3, 14], [15, 22]]);
  const leaves = [];
  function visit(node) { if (node.terminal) leaves.push(node.symbol); else node.children.forEach(visit); }
  visit(result.tree);
  assert.deepEqual(leaves, ['cp', '"notes.txt"', 'backup/']);
  assert.ok(result.steps.length > 0);
  assert.equal(result.normalized, 'cp path path');
  assert.ok(JSON.stringify(result.tree).includes('SOURCE'));
  assert.ok(JSON.stringify(result.tree).includes('DESTINATION'));
});

test('recursive groups use the existing CFG tree and restore all original terminal occurrences', () => {
  const command = 'mkdir archive && (cp notes.txt archive/ || (echo "Copy failed"))';
  const result = run(command);
  assert.equal(result.accepted, true); assert.equal(result.parseCount, '1');
  assert.equal(result.exitCode, 0); assert.ok(entry(result, '/archive/notes.txt'));
  assert.equal(result.ast.right.type, 'group');
  assert.equal(result.ast.right.body.right.type, 'group');
  assert.equal(result.trace.at(-1).skipped, true);
  const leaves = [];
  const visit = node => node.terminal ? leaves.push(node.symbol) : node.children.forEach(visit);
  visit(result.tree);
  assert.deepEqual(leaves, result.tokens.map(token => token.raw));
  assert.match(result.normalized, /lparen.*lparen.*rparen rparen/);
});

test('grouping changes conditional evaluation and maintains left association outside groups', () => {
  assert.equal(run('echo left || echo middle && echo right').stdout, 'left\nright\n');
  assert.equal(run('echo left || (echo middle && echo right)').stdout, 'left\n');
  assert.equal(run('(cat missing || echo recovered) && echo done').stdout, 'recovered\ndone\n');
  assert.equal(run('(cat missing || echo recovered) && echo done').exitCode, 0);
});

test('groups isolate cwd, retain file changes, inherit pipe input and can produce pipeline output', () => {
  const cwd = run('(cd src && (cd .. && pwd) && pwd) && pwd');
  assert.equal(cwd.stdout, '/\n/src\n/\n'); assert.equal(cwd.after.cwd, '/');
  assert.ok(entry(run('(mkdir archive && cp notes.txt archive/)'), '/archive/notes.txt'));
  assert.equal(run('cat notes.txt | (grep report || echo missing)').stdout, 'Finish TOC report\n');
  assert.equal(run('(echo hello && echo world) | grep world').stdout, 'world\n');
});

test('empty, adjacent, unbalanced and incomplete groups are rejected while literal parentheses remain words', () => {
  for (const command of ['()', '(echo hi', 'echo hi)', '(echo hi)(echo bye)', 'echo (hi)', '(echo hi &&)', '((pwd)']) assert.equal(run(command).accepted, false, command);
  assert.equal(run('echo "(hello)"').stdout, '(hello)\n');
  assert.equal(run('echo \\(hello\\)').stdout, '(hello)\n');
  assert.equal(run('((echo hi))').stdout, 'hi\n');
});

test('repairs balance recursive groups, verify with CYK, and explain missing operands without inventing paths', () => {
  const rejected = run('mkdir archive && (cp notes.txt archive/ || (echo failed)');
  const correction = rejected.repairs.find(repair => repair.explanation.includes('Balance'));
  assert.ok(correction); assert.equal(run(correction.command).exitCode, 0);
  assert.ok(rejected.repairs.every(repair => parseCommand(repair.command).accepted));
  assert.match(run('cp notes.txt').syntaxHelp, /source and one destination/);
  assert.equal(run('cp notes.txt').repairs.length, 0);
  assert.ok(run('echo hello)').repairs.some(repair => parseCommand(repair.command).accepted));
});

test('quote concatenation, escaped spaces, empty strings, and quoted operators are literals', () => {
  for (const [command, expected] of [
    ['echo "a b"', 'a b\n'], ["echo '&&'", '&&\n'], ['echo a\\ b', 'a b\n'],
    ['echo "" tail', ' tail\n'], ["echo ab'cd'", 'abcd\n'], ["echo '$HOME'", '$HOME\n']
  ]) assert.equal(run(command).stdout, expected, command);
});

test('unsupported syntax is rejected rather than interpreted or partially executed', () => {
  for (const command of ['rm *', 'echo $HOME', 'echo "$(pwd)"', 'echo `pwd`', 'echo a > file', 'ls; pwd', 'ls &', 'ls\npwd', 'echo #hi', 'ls (src)']) {
    assert.equal(run(command).accepted, false, command);
  }
  assert.equal(lexCommand('x'.repeat(513)).tokens.length, 0);
  assert.equal(parseCommand(Array(42).fill('echo').join(' ')).accepted, false);
});

test('invalid syntax has bounded, CYK-verified repair suggestions', () => {
  for (const command of ['cp notes.txt backup/ &&', 'echo "hello', 'ls | | grep x']) {
    const result = run(command);
    assert.equal(result.accepted, false);
    assert.ok(result.repairs.length > 0, command);
    assert.ok(result.repairs.every(repair => parseCommand(repair.command).accepted));
    assert.ok(result.repairs.length <= 3);
  }
});

test('copy previews one new file without mutating its input snapshot', () => {
  const workspace = sampleWorkspace(); const initial = structuredClone(workspace);
  const result = simulateCommand('cp notes.txt backup/', workspace);
  assert.equal(result.exitCode, 0);
  assert.equal(entry(result, '/backup/notes.txt').content, entry(result, '/notes.txt').content);
  assert.deepEqual(result.changes.map(c => [c.action, c.path]), [['created', '/backup/notes.txt']]);
  assert.deepEqual(workspace, initial);
});

test('recursive deletion lists every affected entry and warns on protected paths', () => {
  const result = simulateCommand('rm -rf src', sampleWorkspace(), ['/src']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.changes.length, 3);
  assert.equal(result.warnings.length, 3);
  assert.equal(entry(result, '/src'), undefined);
  assert.ok(entry(result, '/build'));
  assert.ok(run('rm /').stderr.includes('root'));
  assert.equal(run('rm src').exitCode, 1);
  assert.equal(run('rm -f absent').exitCode, 0);
});

test('mkdir -p, touch, and relative paths compose across virtual states', () => {
  const a = run('mkdir -p work/notes');
  const b = simulateCommand('cd work && touch notes/today.txt', a.after);
  assert.equal(b.exitCode, 0);
  assert.equal(b.after.cwd, '/work');
  assert.equal(entry(b, '/work/notes/today.txt').content, '');
  assert.equal(resolvePath('../src/./app.js', '/work'), '/src/app.js');
  assert.equal(resolvePath('../../../src', '/'), '/src');
});

test('moves retain contents, report both paths, and reject recursive self-copy', () => {
  const result = run('mv notes.txt backup/renamed.txt');
  assert.equal(result.exitCode, 0);
  assert.equal(entry(result, '/notes.txt'), undefined);
  assert.ok(entry(result, '/backup/renamed.txt').content.includes('TOC'));
  assert.equal(result.changes.length, 2);
  assert.equal(run('cp -r src src/nested').exitCode, 1);
  assert.equal(run('cp notes.txt notes.txt').exitCode, 1);
  assert.equal(run('cp src backup/').exitCode, 1);
  const recursive = run('cp -r src backup/');
  assert.equal(recursive.exitCode, 0);
  assert.ok(entry(recursive, '/backup/src/app.js'));
});

test('overwrites are modifications; unsupported flags and directory merges fail atomically', () => {
  const overwritten = run('cp notes.txt README.md');
  assert.deepEqual(overwritten.changes.map(c => c.action), ['modified']);
  assert.equal(run('rm --mystery notes.txt').changes.length, 0);
  const failure = run('mkdir -p src/app.js/folder');
  assert.equal(failure.exitCode, 1);
  assert.deepEqual(failure.changes, []);
  assert.equal(run('cp notes.txt missing/').exitCode, 1);
  assert.equal(run('cp -r src /').exitCode, 1);
});

test('&& and || short-circuit with equal precedence and left association', () => {
  const failed = run('cat missing && rm -rf src');
  assert.equal(failed.exitCode, 1); assert.equal(failed.trace[1].skipped, true);
  assert.ok(entry(failed, '/src'));
  const recovered = run('cat missing || echo recovered');
  assert.equal(recovered.exitCode, 0); assert.equal(recovered.stdout, 'recovered\n');
  const chain = run('echo a || echo b && echo c');
  assert.equal(chain.stdout, 'a\nc\n'); assert.equal(chain.trace[1].skipped, true);
});

test('pipes bind tighter and transport stdout while keeping stderr separate', () => {
  assert.equal(run('cat notes.txt | grep report').stdout, 'Finish TOC report\n');
  assert.equal(run('cat notes.txt | grep -i TOC').stdout, 'Finish TOC report\n');
  assert.equal(run('cat notes.txt | grep -v report').stdout, 'Review parser tests\nPrepare demo\n');
  const result = run('cat missing | cat || echo fallback');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, ''); // last pipeline stage succeeds
  assert.ok(result.stderr.includes('missing'));
  assert.equal(result.trace.at(-1).skipped, true);
  const precedence = run('echo hello && echo world | grep world');
  assert.equal(precedence.stdout, 'hello\nworld\n');
  assert.equal(run('echo hello | grep absent || echo fallback').stdout, 'fallback\n');
});

test('pipeline cd does not leak while normal cd changes the virtual directory', () => {
  assert.equal(run('cd src | pwd').stdout, '/\n');
  assert.equal(run('cd src | cat').after.cwd, '/');
  assert.equal(run('cd src && pwd').stdout, '/src\n');
  assert.equal(run('cd src && rm -rf /src').exitCode, 1);
});

test('listing, --, unsupported executables, and literal grep have explicit behavior', () => {
  assert.equal(run('ls').stdout.includes('.gitignore'), false);
  assert.equal(run('ls -a').stdout.includes('.gitignore'), true);
  assert.equal(run('pwd').stdout, '/\n');
  const named = run('touch -- -notes');
  assert.ok(entry(named, '/-notes'));
  assert.equal(run('sudo rm -rf src').accepted, false);
  assert.equal(run('echo abc | grep "a.*"').exitCode, 1);
});

test('imported folder snapshots contain metadata only and preserve empty directories', () => {
  const snapshot = metadataSnapshot([{ path: 'empty', type: 'directory' }, { path: 'src/app.js', type: 'file', size: 123 }], 'real-folder');
  assert.ok(snapshot.entries.some(e => e.path === '/empty'));
  assert.equal(snapshot.entries.find(e => e.path === '/src/app.js').content, null);
  assert.doesNotThrow(() => validateWorkspace(snapshot));
  const result = simulateCommand('cp src/app.js copy.js', snapshot);
  assert.equal(result.exitCode, 0); assert.equal(entry(result, '/copy.js').size, 123);
  assert.equal(entry(result, '/copy.js').content, null);
  assert.ok(simulateCommand('cat src/app.js', snapshot).stderr.includes('not imported'));
  assert.equal(snapshot.entries.some(e => e.path === '/copy.js'), false);
});

test('malformed and oversized snapshots are rejected before simulation', () => {
  assert.throws(() => metadataSnapshot([{ path: '../escape', type: 'file' }]), /unsupported path/);
  assert.equal(simulateCommand('ls', { entries: [] }).accepted, false);
  assert.equal(simulateCommand('ls', { entries: [{ path: '/', type: 'directory' }, { path: '/a/b', type: 'file' }] }).accepted, false);
  assert.equal(simulateCommand('ls', { entries: [{ path: '/', type: 'directory' }, { path: '/x', type: 'file', content: 'a'.repeat(256001) }] }).accepted, false);
  assert.throws(() => metadataSnapshot(Array.from({ length: 1500 }, (_, i) => ({ path: `file${i}`, type: 'file' }))), /too large/);
});

test('native directory traversal reads metadata only, preserves empty folders, and skips excluded subtrees', async () => {
  let reads = 0;
  const file = { kind: 'file', async getFile() { reads++; return { size: 87, text() { throw new Error('File contents must never be read'); } }; } };
  const dir = (name, items) => ({ name, kind: 'directory', async *entries() { yield* items; } });
  const forbidden = { kind: 'directory', async *entries() { throw new Error('Excluded folder must not be traversed'); } };
  const selected = dir('selected-project', [ ['empty', dir('empty', [])], ['src', dir('src', [['app.js', file]])], ['node_modules', forbidden], ['.git', forbidden] ]);
  const imported = await scanDirectoryMetadata(selected);
  assert.equal(reads, 1); assert.equal(imported.omitted, 2);
  assert.equal(imported.workspace.name, 'selected-project');
  assert.ok(imported.workspace.entries.some(entry => entry.path === '/empty'));
  assert.equal(imported.workspace.entries.find(entry => entry.path === '/src/app.js').content, null);
  const preview = simulateCommand('rm -rf src', imported.workspace);
  assert.equal(preview.exitCode, 0); assert.equal(preview.changes.length, 2);
  assert.ok(imported.workspace.entries.some(entry => entry.path === '/src/app.js'));
});

test('trailing slashes do not silently turn files into directories', () => {
  for (const command of ['cat notes.txt/', 'ls notes.txt/', 'rm notes.txt/', 'cp notes.txt/ backup/', 'touch new/']) {
    const result = run(command);
    assert.equal(result.exitCode, 1, command);
    assert.equal(result.changes.length, 0, command);
  }
});

test('successive operations maintain a valid snapshot across a generated sequence', () => {
  let state = sampleWorkspace();
  for (let i = 0; i < 30; i++) {
    for (const command of [`mkdir -p /work/step${i}`, `cp /notes.txt /work/step${i}/`, `mv /work/step${i}/notes.txt /work/step${i}/done.txt`, `rm -r /work/step${i}`]) {
      const result = simulateCommand(command, state);
      assert.equal(result.exitCode, 0, command);
      assert.doesNotThrow(() => validateWorkspace(result.after));
      state = result.after;
    }
  }
  assert.ok(state.entries.some(entry => entry.path === '/notes.txt'));
  assert.ok(!state.entries.some(entry => entry.path.startsWith('/work/step')));
});

test('default grammar rejects missing or extra operands before interpretation', () => {
  for (const command of ['cp notes.txt', 'cp notes.txt backup/ extra', 'mv notes.txt', 'rm', 'mkdir', 'touch a b', 'cd', 'pwd extra', 'grep']) {
    const result = run(command);
    assert.equal(result.accepted, false, command);
    assert.equal(result.errorStage, 'syntax', command);
    assert.deepEqual(result.changes, []);
  }
});

test('contextual classification distinguishes keywords, paths, text, patterns, and flags', () => {
  for (const [command, normalized] of [
    ['cp cp "rm"', 'cp path path'],
    ['echo "cp" "&&"', 'echo text text'],
    ['grep -iv rm notes.txt', 'grep filterflag pattern path'],
    ['rm -rf -- -notes', 'rm removeflag endopts path'],
    ['cp -r src backup/ && ls', 'cp copyflag path path and ls']
  ]) {
    const result = parseCommand(command);
    assert.equal(result.accepted, true, command);
    assert.equal(result.normalized, normalized, command);
    assert.equal(result.parseCount, '1', command);
  }
  assert.equal(parseCommand('cp notes.txt -r backup/').accepted, false, 'Default grammar requires options before operands');
});

test('read-only grammar changes acceptance and records removal of unreachable command rules', () => {
  assert.equal(parseCommand('rm notes.txt').accepted, true);
  const rejected = simulateCommand('rm notes.txt', sampleWorkspace(), [], READ_ONLY_GRAMMAR);
  assert.equal(rejected.accepted, false); assert.equal(rejected.errorStage, 'syntax');
  assert.ok(rejected.stages.original.includes('DELETE ->'));
  assert.ok(!rejected.stages.useful.includes('DELETE ->'));
  assert.equal(simulateCommand('ls', sampleWorkspace(), [], READ_ONLY_GRAMMAR).exitCode, 0);
  assert.equal(simulateCommand('cat notes.txt | grep report', sampleWorkspace(), [], READ_ONLY_GRAMMAR).stdout, 'Finish TOC report\n');
});

test('custom grammar really controls arity but cannot invent command behavior', () => {
  const custom = 'START -> cp SOURCE\nSOURCE -> path';
  const acceptedSyntax = simulateCommand('cp notes.txt', sampleWorkspace(), [], custom);
  assert.equal(acceptedSyntax.accepted, true);
  assert.equal(acceptedSyntax.exitCode, 1);
  assert.match(acceptedSyntax.stderr, /expected 2 argument/);
  assert.deepEqual(acceptedSyntax.changes, []);
  assert.equal(parseCommand('cp notes.txt backup/', true, custom).accepted, false);
  const unsupported = simulateCommand('launch file', sampleWorkspace(), [], 'S -> unknown path');
  assert.equal(unsupported.accepted, true);
  assert.equal(unsupported.exitCode, 1);
  assert.match(unsupported.stderr, /Unsupported command/);
  assert.deepEqual(unsupported.changes, []);
});

test('editable grammar returns distinct authored, epsilon-free, simplified, and CNF stages', () => {
  const { stages } = parseCommand('cp notes.txt backup/');
  assert.ok(stages.original.includes('COPY -> cp COPY_OPTIONS SOURCE DESTINATION'));
  assert.ok(stages.original.includes('eps') || stages.original.includes('ε'));
  assert.ok(!stages.epsilon.includes('ε'));
  assert.notEqual(stages.simplified, stages.original);
  assert.notEqual(stages.cnf, stages.simplified);
  assert.ok(stages.helpers.some(helper => helper.reason === 'terminal replacement'));
  assert.ok(stages.helpers.some(helper => helper.reason === 'binarization'));
  assert.ok(stages.counts.authored > 0);
});

test('invalid grammars fail explicitly, including limits and undefined token classes', () => {
  for (const grammar of ['', null, 'S cp path', 'S -> unicorn', 'S -> S', 'S -> cp path path path path path path']) {
    const result = simulateCommand('cp notes.txt backup/', sampleWorkspace(), [], grammar);
    assert.equal(result.accepted, false, String(grammar));
    assert.equal(result.errorStage, 'grammar', String(grammar));
    assert.equal(result.repairs.length, 0);
  }
  assert.ok(compileCommandGrammar('S -> cp\nBAD RULE').grammarErrors.some(error => error.line === 2));
});

test('repair suggestions use the active custom grammar, not the default', () => {
  const custom = 'S -> pwd';
  const result = simulateCommand('pwd &&', sampleWorkspace(), [], custom);
  assert.equal(result.accepted, false);
  assert.ok(result.repairs.some(repair => repair.command === 'pwd'));
  assert.ok(result.repairs.every(repair => parseCommand(repair.command, false, custom).accepted));
  assert.equal(simulateCommand('cp notes.txt backup/ &&', sampleWorkspace(), [], custom).repairs.length, 0);
});

test('ambiguous or unsupported custom connector groupings never silently choose behavior', () => {
  const ambiguous = simulateCommand('pwd && pwd && pwd', sampleWorkspace(), [], 'S -> S and S | pwd');
  assert.equal(ambiguous.accepted, true);
  assert.equal(ambiguous.parseCount, '2');
  assert.equal(ambiguous.exitCode, 1);
  assert.match(ambiguous.interpretationError, /multiple parses/);
  assert.equal(ambiguous.trace.length, 0);
  const flat = simulateCommand('cp notes.txt backup/ && pwd', sampleWorkspace(), [], 'S -> cp path path and pwd');
  assert.equal(flat.accepted, true);
  assert.equal(flat.exitCode, 1);
  assert.match(flat.interpretationError, /grouping/);
  assert.equal(flat.changes.length, 0);
});

test('command interface, simulation and reviewed local-folder APIs work together', async t => {
  const child = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { const finished = once(child, 'exit'); child.kill(); await finished; } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server startup timed out')), 10000);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/localhost:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const config = await (await fetch(base + '/api/simulator')).json();
  assert.equal(config.workspace.name, 'demo-project');
  const response = await fetch(base + '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'rm -rf build', workspace: config.workspace }) });
  const result = await response.json();
  assert.equal(result.exitCode, 0); assert.equal(result.changes.length, 3);
  assert.ok((await (await fetch(base)).text()).includes('Before You Run'));
  for (const asset of ['/simulator.js', '/simulator.css', '/treeRenderer.js', '/workspaceImport.js']) {
    assert.equal((await fetch(base + asset)).status, 200, asset);
  }
  for (const retired of ['/api/cyk', '/api/rna', '/api/compare', '/api/parse', '/api/simplify', '/api/cnf', '/api/ambiguity', '/api/samples', '/grammar.html', '/app.js', '/styles.css']) {
    const response = await fetch(base + retired, { method: retired.startsWith('/api/') && retired !== '/api/samples' ? 'POST' : 'GET' });
    assert.equal(response.status, 404, retired);
  }
  const invalid = await fetch(base + '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'ls', workspace: { entries: [] } }) });
  assert.equal((await invalid.json()).accepted, false);
  const grammarResult = await fetch(base + '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'rm notes.txt', grammarText: READ_ONLY_GRAMMAR }) });
  assert.equal((await grammarResult.json()).accepted, false);
  const authored = await fetch(base + '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'pwd', grammarText: 'ROOT -> pwd' }) });
  const authoredResult = await authored.json();
  assert.equal(authoredResult.exitCode, 0);
  assert.equal(authoredResult.grammar, 'ROOT -> pwd');
  assert.ok(config.grammarPresets.basic);
  const localPost = (action, body, extraHeaders = {}) => fetch(base + '/api/local-folder/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Workspace': '1', ...extraHeaders }, body: JSON.stringify(body) });
  assert.equal((await localPost('open', {}, { 'X-Local-Workspace': '' })).status, 403);
  assert.equal((await localPost('open', {}, { Origin: 'https://example.com' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.request(base + '/api/local-folder/open', { method: 'POST', headers: { Host: 'example.com', 'X-Local-Workspace': '1', 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(foreignHostStatus, 403);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'before-you-run-http-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('before-you-run-http-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, 'hello.txt'), 'original content');
  const opened = await (await localPost('open', { path: root })).json();
  assert.ok(opened.workspaceId);
  const planned = await (await localPost('preview', { workspaceId: opened.workspaceId, command: 'cp hello.txt copy.txt', grammarText: config.grammar })).json();
  assert.ok(planned.planId);
  const applied = await localPost('apply', { workspaceId: opened.workspaceId, planId: planned.planId });
  assert.equal(applied.status, 200);
  assert.equal(await fs.readFile(path.join(root, 'copy.txt'), 'utf8'), 'original content');
});
