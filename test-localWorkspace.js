import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openLocalWorkspace, previewLocalWorkspace, applyLocalWorkspace } from './src/localWorkspace.js';
import { BASIC_GRAMMAR, COMMAND_GRAMMAR } from './src/core/commandGrammar.js';
import { parseCommand } from './src/core/commandSimulator.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'before-you-run-test-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('before-you-run-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, 'notes.bin'), Buffer.from([0, 255, 31, 128, 10]));
  await fs.mkdir(path.join(root, 'backup'));
  return { root, ...await openLocalWorkspace(root) };
}
const preview = (session, command, grammar = BASIC_GRAMMAR) => previewLocalWorkspace(session.workspaceId, command, grammar);

test('opening a folder larger than 64 MB reads metadata only and permits unrelated file operations', async t => {
  const session = await fixture(t);
  const large = await fs.open(path.join(session.root, 'large.bin'), 'w');
  await large.truncate(80 * 1024 * 1024); await large.close();
  const readFile = fs.readFile;
  fs.readFile = async () => { throw new Error('Opening must not read file contents'); };
  let opened;
  try { opened = await openLocalWorkspace(session.root); }
  finally { fs.readFile = readFile; }
  assert.equal(opened.workspace.entries.find(e => e.path === '/large.bin').size, 80 * 1024 * 1024);
  const plan = await preview(opened, 'cp notes.bin backup/');
  assert.ok(plan.planId);
  await applyLocalWorkspace(opened.workspaceId, plan.planId);
  assert.deepEqual(await fs.readFile(path.join(session.root, 'backup/notes.bin')), Buffer.from([0, 255, 31, 128, 10]));
  assert.equal((await fs.stat(path.join(session.root, 'large.bin'))).size, 80 * 1024 * 1024);
});

test('local folders with more than 1,500 entries can open, preview and apply', async t => {
  const session = await fixture(t);
  await Promise.all(Array.from({ length: 1510 }, (_, i) => fs.writeFile(path.join(session.root, 'backup', `file-${i}.txt`), 'demo')));
  const opened = await openLocalWorkspace(session.root);
  assert.ok(opened.workspace.entries.length > 1500);
  const plan = await preview(opened, 'cp notes.bin backup/');
  assert.ok(plan.planId);
  await applyLocalWorkspace(opened.workspaceId, plan.planId);
  assert.deepEqual(await fs.readFile(path.join(session.root, 'backup/notes.bin')), Buffer.from([0, 255, 31, 128, 10]));
});

test('Basic grammar accepts five commands but rejects flags, chains and other commands', () => {
  for (const command of ['ls', 'ls src', 'mkdir archive', 'cp a b', 'mv a b', 'rm a']) assert.equal(parseCommand(command, true, BASIC_GRAMMAR).accepted, true, command);
  for (const command of ['rm -rf src', 'ls && ls', 'cat a', 'cp a']) assert.equal(parseCommand(command, true, BASIC_GRAMMAR).accepted, false, command);
});
test('open includes empty directories; preview never writes; apply preserves binary bytes', async t => {
  const session = await fixture(t);
  assert.ok(session.workspace.entries.some(e => e.path === '/backup'));
  const plan = await preview(session, 'cp notes.bin backup/');
  assert.ok(plan.planId);
  await assert.rejects(fs.stat(path.join(session.root, 'backup/notes.bin')), { code: 'ENOENT' });
  await applyLocalWorkspace(session.workspaceId, plan.planId);
  assert.deepEqual(await fs.readFile(path.join(session.root, 'backup/notes.bin')), await fs.readFile(path.join(session.root, 'notes.bin')));
  await assert.rejects(applyLocalWorkspace(session.workspaceId, plan.planId), /expired|already applied/);
});
test('overwrite and deletion apply directly without creating recovery copies', async t => {
  const session = await fixture(t);
  await fs.writeFile(path.join(session.root, 'backup/notes.bin'), 'original destination');
  const copy = await preview(session, 'cp notes.bin backup/');
  const applied = await applyLocalWorkspace(session.workspaceId, copy.planId);
  assert.equal(applied.backupPath, undefined);
  assert.deepEqual(await fs.readFile(path.join(session.root, 'backup/notes.bin')), Buffer.from([0, 255, 31, 128, 10]));
  const remove = await preview(session, 'rm notes.bin');
  const deleted = await applyLocalWorkspace(session.workspaceId, remove.planId);
  assert.equal(deleted.backupPath, undefined);
  await assert.rejects(fs.stat(path.join(session.root, 'notes.bin')), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(session.root)).sort(), ['backup']);
  assert.deepEqual(await fs.readdir(path.join(session.root, 'backup')), ['notes.bin']);
});
test('mkdir and directory rename apply without losing nested files', async t => {
  const session = await fixture(t);
  const make = await preview(session, 'mkdir archive');
  await applyLocalWorkspace(session.workspaceId, make.planId);
  await fs.writeFile(path.join(session.root, 'archive/nested.txt'), 'keep me');
  const move = await preview(session, 'mv archive renamed');
  await applyLocalWorkspace(session.workspaceId, move.planId);
  assert.equal(await fs.readFile(path.join(session.root, 'renamed/nested.txt'), 'utf8'), 'keep me');
  await assert.rejects(fs.stat(path.join(session.root, 'archive')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(session.root, '.before-you-run-backups')), { code: 'ENOENT' });
});
test('folder changes invalidate preview; wrong session/plan IDs cannot apply', async t => {
  const session = await fixture(t), plan = await preview(session, 'rm notes.bin');
  await fs.writeFile(path.join(session.root, 'notes.bin'), 'edited after preview');
  await assert.rejects(applyLocalWorkspace(session.workspaceId, plan.planId), /changed since/);
  assert.equal(await fs.readFile(path.join(session.root, 'notes.bin'), 'utf8'), 'edited after preview');
  await assert.rejects(applyLocalWorkspace('unknown', plan.planId), /expired/);
  await assert.rejects(applyLocalWorkspace(session.workspaceId, 'unknown'), /expired/);
});
test('excluded subtrees, roots and advanced operations cannot produce an apply plan', async t => {
  const session = await fixture(t);
  await fs.mkdir(path.join(session.root, 'backup/.git'));
  await fs.writeFile(path.join(session.root, 'backup/.git/secret'), 'untouched');
  const move = await preview(session, 'mv backup renamed');
  assert.equal(move.planId, undefined); assert.match(move.localApplyNote, /excluded/);
  for (const command of ['rm -rf backup', 'mkdir one && mkdir two', 'rm /', 'mkdir ../.before-you-run-backups', 'cp notes.bin C:bad']) {
    assert.equal((await preview(session, command, COMMAND_GRAMMAR)).planId, undefined, command);
  }
  assert.equal(await fs.readFile(path.join(session.root, 'backup/.git/secret'), 'utf8'), 'untouched');
  await assert.rejects(openLocalWorkspace(path.parse(session.root).root), /drive root/);
});
test('a new preview invalidates the previous plan and Windows case aliases are blocked', async t => {
  const session = await fixture(t), first = await preview(session, 'rm notes.bin');
  await preview(session, 'ls');
  await assert.rejects(applyLocalWorkspace(session.workspaceId, first.planId), /expired/);
  if (process.platform === 'win32') {
    const alias = await preview(session, 'cp notes.bin NOTES.BIN');
    assert.equal(alias.planId, undefined); assert.match(alias.localApplyNote, /letter case/);
  }
});

test('filesystem failure reports the error without backup copies or a reusable plan', async t => {
  const session = await fixture(t), plan = await preview(session, 'mv notes.bin renamed.bin');
  const rename = fs.rename;
  fs.rename = async () => { throw new Error('Injected rename failure'); };
  try { await assert.rejects(applyLocalWorkspace(session.workspaceId, plan.planId), /Injected rename failure.*No recovery copies/); }
  finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(path.join(session.root, 'notes.bin')), Buffer.from([0, 255, 31, 128, 10]));
  await assert.rejects(fs.stat(path.join(session.root, 'renamed.bin')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(session.root, '.before-you-run-backups')), { code: 'ENOENT' });
  await assert.rejects(applyLocalWorkspace(session.workspaceId, plan.planId), /expired|already applied/);
});

test('directory links cannot be imported or used to escape the selected folder', async t => {
  const session = await fixture(t);
  await fs.symlink(path.join(session.root, 'backup'), path.join(session.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(openLocalWorkspace(session.root), /link or special/);
  await assert.rejects(openLocalWorkspace(path.join(session.root, 'linked')), /not a link/);
});
