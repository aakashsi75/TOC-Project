// Local filesystem adapter. The parser/interpreter remains entirely virtual.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { simulateCommand, resolvePath } from './core/commandSimulator.js';
import { BASIC_GRAMMAR } from './core/commandGrammar.js';

const BACKUPS = '.before-you-run-backups';
const excluded = new Set(['.git', 'node_modules', BACKUPS]);
const sessions = new Map();
const inside = (root, target) => target !== root && !path.relative(root, target).startsWith('..' + path.sep) && path.relative(root, target) !== '..' && !path.isAbsolute(path.relative(root, target));

async function scan(root) {
  const entries = [{ path: '/', type: 'directory' }], fingerprints = [], omitted = [];
  async function walk(dir, prefix = '') {
    for (const name of (await fs.readdir(dir)).sort()) {
      const virtual = `${prefix}/${name}`, absolute = path.join(dir, name);
      const stat = await fs.lstat(absolute);
      if (excluded.has(name.toLowerCase())) { omitted.push(virtual); continue; }
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsupported link or special file: ${virtual}. Choose a folder containing regular files and directories.`);
      if (entries.length >= 100000) throw new Error('Folder exceeds 100,000 entries. Open one project inside it to keep the preview responsive.');
      if (stat.isDirectory()) {
        entries.push({ path: virtual, type: 'directory' }); fingerprints.push([virtual, 'directory']);
        await walk(absolute, virtual);
      } else {
        entries.push({ path: virtual, type: 'file', size: stat.size, content: null });
        fingerprints.push([virtual, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]);
      }
    }
  }
  await walk(root);
  return { workspace: { name: path.basename(root), cwd: '/', entries }, omitted, fingerprint: JSON.stringify([fingerprints, omitted.filter(p => p !== '/' + BACKUPS)]) };
}

// Opening/listing reads no file contents. Only files involved in a proposed
// write are hashed, streaming bounded chunks even when an individual file is large.
async function contentFingerprint(session, snapshot, paths) {
  const hashes = [];
  for (const entry of snapshot.workspace.entries) {
    if (entry.type !== 'file' || !paths.some(p => entry.path === p || entry.path.startsWith(p + '/'))) continue;
    const absolute = await checked(session, entry.path);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(absolute)) hash.update(chunk);
    hashes.push([entry.path, hash.digest('hex')]);
  }
  return JSON.stringify(hashes);
}

async function checked(session, virtual) {
  if (typeof virtual !== 'string' || resolvePath(virtual) !== virtual || virtual === '/' || virtual.includes('\\') || virtual.includes(':')) throw new Error('Invalid local path.');
  const parts = virtual.slice(1).split('/');
  if (parts.some(p => excluded.has(p.toLowerCase()) || /[<>:"|?*\u0000-\u001f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw new Error('This path is reserved or excluded from local changes.');
  const absolute = path.resolve(session.root, ...parts);
  if (!inside(session.root, absolute)) throw new Error('Path leaves the selected folder.');
  let cursor = session.root;
  const rootStat = await fs.lstat(cursor);
  if (rootStat.isSymbolicLink() || await fs.realpath(cursor) !== session.root) throw new Error('Selected folder changed. Open it again.');
  for (const part of parts) {
    if (process.platform === 'win32') {
      try {
        const names = await fs.readdir(cursor);
        if (names.some(name => name.toLowerCase() === part.toLowerCase() && name !== part)) throw new Error('Use the exact letter case shown in the folder preview.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    cursor = path.join(cursor, part);
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Links cannot be changed.'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
  if (session.snapshot.omitted.some(p => p === virtual || p.startsWith(virtual + '/') || virtual.startsWith(p + '/'))) throw new Error('Operation would affect excluded contents. Choose an individual file instead.');
  return absolute;
}

function sessionFor(id) {
  const session = sessions.get(id);
  if (!session || Date.now() - session.created > 2 * 60 * 60 * 1000) throw new Error('Folder session expired. Open the folder again.');
  return session;
}

export async function openLocalWorkspace(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input.trim())) throw new Error('Enter the full local folder path, for example C:\\Users\\you\\Documents\\demo.');
  const requested = path.resolve(input.trim());
  if ((await fs.lstat(requested)).isSymbolicLink()) throw new Error('Choose a real folder, not a link.');
  const root = await fs.realpath(requested);
  if (root === path.parse(root).root || !(await fs.stat(root)).isDirectory()) throw new Error('Choose a project folder, not a drive root.');
  const snapshot = await scan(root), id = randomUUID();
  if (sessions.size >= 16) sessions.delete(sessions.keys().next().value);
  sessions.set(id, { root, snapshot, created: Date.now(), plan: null, busy: false });
  return { workspaceId: id, folderPath: root, workspace: snapshot.workspace, omitted: snapshot.omitted.length };
}

export async function previewLocalWorkspace(id, command, grammarText, protectedPaths) {
  const session = sessionFor(id);
  if (session.busy) throw new Error('An apply operation is still running.');
  session.busy = true;
  try {
    session.plan = null;
    const snapshot = await scan(session.root);
    session.snapshot = snapshot;
    const result = simulateCommand(command, snapshot.workspace, protectedPaths, grammarText);
    result.localApplyNote = 'Local apply supports one Basic command at a time. Advanced commands remain preview-only.';
    const basic = simulateCommand(command, snapshot.workspace, [], BASIC_GRAMMAR);
    if (!basic.accepted || basic.exitCode || !basic.changes.length || !result.accepted || result.exitCode || JSON.stringify(basic.after) !== JSON.stringify(result.after)) return result;
    const [name, ...args] = basic.ast.words;
    let source = resolvePath(args[0]), destination = null;
    if (name === 'cp' || name === 'mv') {
      destination = resolvePath(args[1]);
      if (snapshot.workspace.entries.some(e => e.path === destination && e.type === 'directory')) destination = resolvePath(destination + '/' + source.split('/').pop());
    }
    let contents;
    const paths = [source, destination].filter(Boolean);
    try {
      await checked(session, source);
      if (destination) await checked(session, destination);
      contents = await contentFingerprint(session, snapshot, paths);
    } catch (error) { result.localApplyNote = error.message; return result; }
    const planId = randomUUID();
    session.plan = { id: planId, name, source, destination, paths, contents, fingerprint: snapshot.fingerprint, created: Date.now(), result };
    return { ...result, planId, localApplyNote: 'Review and apply this exact preview to your selected folder. Changes are applied directly, without recovery copies.' };
  } finally { session.busy = false; }
}

export async function applyLocalWorkspace(id, planId) {
  const session = sessionFor(id), plan = session.plan;
  if (session.busy || !plan || plan.id !== planId || Date.now() - plan.created > 10 * 60 * 1000) throw new Error('Preview expired or already applied. Preview again.');
  session.busy = true;
  try {
    const fresh = await scan(session.root);
    if (fresh.fingerprint !== plan.fingerprint) throw new Error('Folder changed since the preview. Preview again before applying.');
    if (await contentFingerprint(session, fresh, plan.paths) !== plan.contents) throw new Error('File contents changed since the preview. Preview again before applying.');
    const source = await checked(session, plan.source);
    const destination = plan.destination ? await checked(session, plan.destination) : null;
    // Single-use even if the filesystem operation fails partway through.
    session.plan = null;
    try {
      if (plan.name === 'mkdir') await fs.mkdir(source);
      else if (plan.name === 'cp') await fs.copyFile(source, destination);
      else if (plan.name === 'mv') await fs.rename(source, destination);
      else if (plan.name === 'rm') await fs.unlink(source);
      else throw new Error('Unsupported apply command.');
    } catch (error) {
      throw new Error(`Apply failed: ${error.message}. Refresh the folder and preview again. No recovery copies were created.`);
    }
    try { session.snapshot = await scan(session.root); }
    catch (error) {
      return { workspace: plan.result.after, message: `Changes applied. Folder refresh failed: ${error.message}. Reopen the folder to refresh it.` };
    }
    return { workspace: session.snapshot.workspace, message: 'Changes applied to your folder.' };
  } finally { session.busy = false; }
}
