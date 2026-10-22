/** Convert browser-selected metadata into virtual paths. Never reads file text. */
export function metadataSnapshot(records, name = 'selected-folder') {
  if (!Array.isArray(records)) throw new Error('Invalid folder metadata.');
  const entries = new Map([['/', { path: '/', type: 'directory' }]]);
  for (const record of records) {
    const parts = record.path.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..') || record.path.length > 499) throw new Error('Folder contains an unsupported path.');
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      path += '/' + parts[i];
      const isFile = i === parts.length - 1 && record.type === 'file';
      const existing = entries.get(path);
      if (existing && existing.type !== (isFile ? 'file' : 'directory')) throw new Error('Conflicting folder metadata.');
      entries.set(path, isFile ? { path, type: 'file', size: record.size || 0, content: null } : { path, type: 'directory' });
      if (entries.size > 1500) throw new Error('Folder is too large. Choose a smaller folder (maximum 1,500 entries).');
    }
  }
  return { name, cwd: '/', entries: [...entries.values()] };
}

/** Read-only File System Access API traversal; no content reads or write handles. */
export async function scanDirectoryMetadata(handle) {
  const records = []; let omitted = 0, visited = 0;
  async function visit(directory, prefix = '') {
    for await (const [name, child] of directory.entries()) {
      if (child.kind === 'directory' && ['.git', 'node_modules'].includes(name)) { omitted++; continue; }
      if (++visited > 1499) throw new Error('Folder is too large. Choose a smaller folder (maximum 1,500 entries).');
      const path = prefix + name;
      if (child.kind === 'directory') { records.push({ path, type: 'directory' }); await visit(child, path + '/'); }
      else { const file = await child.getFile(); records.push({ path, type: 'file', size: file.size }); }
    }
  }
  await visit(handle);
  return { workspace: metadataSnapshot(records, handle.name), omitted };
}
