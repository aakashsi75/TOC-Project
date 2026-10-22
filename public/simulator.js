import { renderTree } from './treeRenderer.js';
import { metadataSnapshot } from './workspaceImport.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let workspace, baseline, sample, commands, flags = {}, result = null;
let history = [], request = null, imported = false, excluded = 0;
let cykStep = 0, playTimer = null;
let grammarPresets = {};
let localFolder = null, applyPending = false;
let recovery = null;
const folderExpansion = new Map();
const examples = {
  copy: 'cp notes.txt backup/', delete: 'rm notes.txt',
  chain: 'mkdir archive && cp notes.txt archive/',
  pipe: 'cat notes.txt | grep report', repair: 'cp "notes.txt" "backup/',
  nested: 'mkdir archive && (cp notes.txt archive/ || echo "Copy failed")',
  groupRepair: 'mkdir archive && (cp notes.txt archive/ || echo "Copy failed"'
};
const basicDescriptions = { ls: 'List the current directory or one path.', mkdir: 'Create one directory.', cp: 'Copy one file to a destination.', mv: 'Move or rename one file or directory.', rm: 'Remove one file.' };
const commandDescription = name => $('command-mode').value === 'basic' ? basicDescriptions[name] : commands?.[name];

function stopPlayback() {
  clearInterval(playTimer); playTimer = null; $('cyk-play').textContent = 'Play';
}
function invalidate() {
  request?.abort(); request = null; result = null; stopPlayback();
  $('preview-button').disabled = false;
  $('preview-button').innerHTML = 'Preview changes <span aria-hidden="true">↗</span>';
  $('apply-button').disabled = true;
  $('real-apply-button').disabled = true;
}
function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
function setWorkspace(next, real = false, omitted = 0) {
  recovery = null;
  folderExpansion.clear();
  invalidate(); workspace = structuredClone(next); baseline = structuredClone(next);
  history = []; imported = real; excluded = omitted;
  if (!real) localFolder = null;
  $('apply-button').hidden = Boolean(localFolder);
  $('real-apply-button').hidden = !localFolder;
  $('undo-button').hidden = Boolean(localFolder);
  $('snapshot-note').textContent = localFolder ? 'Preview leaves files untouched. Review & apply writes to the selected folder.' : 'A preview doesn’t change even the virtual workspace until you keep it.';
  $('command-input').value = real ? 'ls' : examples.copy;
  $('workspace-info').textContent = real
    ? `${workspace.name} · ${localFolder ? 'Local folder connected · Preview before applying' : 'Browser metadata upload · Preview only'}${omitted ? ` · ${omitted} excluded folder(s)` : ''}`
    : 'Sample project · Full sample contents available · Changes exist only in memory';
  renderEmpty();
  setStatus(real ? 'Folder snapshot loaded. Your original files stay untouched.' : 'Sample workspace loaded. Ready to explore.');
}
function highlightTokens(indices = []) {
  const selected = new Set(indices);
  document.querySelectorAll('[data-token]').forEach(token => token.classList.toggle('selected', selected.has(Number(token.dataset.token))));
}
function highlightPaths(paths = []) {
  const selected = new Set(paths);
  document.querySelectorAll('[data-path]').forEach(row => row.classList.toggle('highlighted', selected.has(row.dataset.path)));
}
function paintTree(container, snapshot, changes = [], includeDeleted = false) {
  const map = new Map(snapshot.entries.map(entry => [entry.path, entry]));
  const marks = new Map(changes.map(change => [change.path, change.action]));
  if (includeDeleted && result?.before) {
    for (const entry of result.before.entries) if (!map.has(entry.path)) map.set(entry.path, entry);
  }
  const children = new Map();
  for (const entry of map.values()) {
    if (entry.path === '/') continue;
    const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entry);
  }
  const rows = [];
  const reveal = new Set();
  for (const change of changes.slice(0, 20)) {
    const parts = change.path.split('/').slice(1, -1);
    for (let i = 1; i <= parts.length; i++) reveal.add('/' + parts.slice(0, i).join('/'));
  }
  function visit(path, depth) {
    const items = (children.get(path) || []).sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === 'directory' ? -1 : 1));
    for (const entry of items) {
      const action = marks.get(entry.path) || '';
      const name = entry.path.split('/').pop();
      const directory = entry.type === 'directory';
      const expanded = folderExpansion.get(`${container.id}:${entry.path}`) ?? (!localFolder || reveal.has(entry.path));
      const tag = directory ? 'button type="button"' : 'div';
      rows.push(`<${tag} class="file-row ${entry.type} ${action}" data-path="${escape(entry.path)}" ${directory ? `data-folder="${escape(entry.path)}" aria-expanded="${expanded}"` : ''} style="padding-left:${7 + depth * 16}px" title="${escape(entry.path)}${action ? ` · ${action}` : ''}"><span class="file-symbol" aria-hidden="true">${directory ? expanded ? '▾' : '▸' : '·'}</span><span class="file-name">${escape(name)}${directory ? '/' : ''}</span>${action ? `<span class="change-symbol" aria-label="${action}">${{ created: '+', deleted: '−', modified: '~' }[action]}</span>` : entry.type === 'file' ? `<span class="size">${entry.size ?? 0} B</span>` : ''}</${directory ? 'button' : 'div'}>`);
      if (directory && expanded) visit(entry.path, depth + 1);
    }
  }
  visit('/', 0);
  container.innerHTML = `<p class="tree-root">▾ ${escape(snapshot.name)} /</p>` + (rows.join('') || '<p class="empty-state">This directory is empty.</p>');
  container.querySelectorAll('[data-folder]').forEach(button => button.addEventListener('click', () => {
    folderExpansion.set(`${container.id}:${button.dataset.folder}`, button.getAttribute('aria-expanded') !== 'true');
    paintTree(container, snapshot, changes, includeDeleted);
  }));
}
function renderEmpty() {
  paintTree($('before-tree'), workspace); paintTree($('after-tree'), workspace);
  $('before-count').textContent = `${workspace.entries.length - 1} entries`;
  $('change-count').textContent = 'No preview yet';
  $('cwd-label').textContent = `${workspace.name} ${workspace.cwd}`;
  $('impact-title').innerHTML = 'One command.<br>Zero guesswork.';
  $('impact-description').textContent = 'Preview a command to see the files it creates, changes, or removes.';
  $('change-list').replaceChildren(); $('protection-warning').textContent = '';
  $('execution-trace').innerHTML = '<p class="empty-state">Your execution trace will appear here.</p>';
  $('terminal-output').textContent = '$ waiting for a preview'; $('exit-label').textContent = '—';
  $('parse-tree').replaceChildren(); $('token-strip').replaceChildren(); $('repairs').replaceChildren();
  $('recovery-evidence').replaceChildren();
  $('conversion-tokens').replaceChildren();
  $('command-meaning').textContent = 'Preview a command to see its meaning.';
  $('conversion-command').textContent = 'Waiting for a command preview.';
  $('local-apply-note').textContent = localFolder ? 'Real folder connected. One Basic command can be applied after review.' : '';
  $('token-explanation').textContent = '';
  $('normalized-tokens').textContent = ''; $('cyk-grid').replaceChildren();
  ['grammar-text', 'grammar-useful', 'grammar-epsilon', 'grammar-simplified', 'grammar-cnf', 'grammar-stage-counts'].forEach(id => { $(id).textContent = ''; });
  $('grammar-status').textContent = 'The next preview compiles and checks the grammar shown above.';
  $('grammar-status').classList.remove('error-text');
  $('cyk-caption').textContent = 'Preview a command first.';
  ['cyk-prev', 'cyk-play', 'cyk-next'].forEach(id => { $(id).disabled = true; });
  $('undo-button').disabled = history.length === 0;
}
function showWatchWarning() {
  const path = $('protected-path').value.trim().replace(/\/+$/, '') || '/';
  if (!path.startsWith('/') || path.includes('//') || path.split('/').some(part => part === '.' || part === '..')) { $('protection-warning').textContent = 'Use a normalized absolute virtual path, such as /src.'; return; }
  const hits = (result?.changes || []).filter(change => path === '/' || change.path === path || change.path.startsWith(path + '/') || path.startsWith(change.path + '/'));
  $('protection-warning').textContent = hits.length ? `Heads up: ${hits.length} proposed change${hits.length === 1 ? '' : 's'} affect your watched path ${path}.` : '';
}
function renderTokens(tokens) {
  const commandIndices = new Set((result?.trace || []).flatMap(step => step.tokenIndices?.slice(0, 1) || []));
  const explanations = [];
  $('token-strip').innerHTML = tokens.map((token, i) => {
    const step = result?.trace?.find(item => item.tokenIndices.includes(i));
    const name = step ? tokens[step.tokenIndices[0]].value : '';
    const previousArgs = step ? step.tokenIndices.filter(index => index < i).slice(1).map(index => tokens[index].value) : [];
    const option = token.value.startsWith('-') && token.value !== '-' && !previousArgs.includes('--') && !(name === 'echo' && previousArgs.some(arg => !arg.startsWith('-')));
    const flagMeaning = [...token.value.slice(1)].map(flag => `-${flag}: ${flags[name]?.[flag] || 'Not supported for this command.'}`).join(' ');
    const meaning = token.kind === 'lparen' ? 'Open a nested command group; its directory changes stay inside the group.' : token.kind === 'rparen' ? 'Close the nested command group.' : token.kind === 'and' ? 'Continue if the previous pipeline succeeds (exit 0).' : token.kind === 'or' ? 'Continue if the previous pipeline fails (nonzero exit).' : token.kind === 'pipe' ? 'Pass standard output, not error output, into the next command.' : commandIndices.has(i) || Object.hasOwn(commands || {}, token.class) ? commandDescription(token.value) || 'Command name is outside the active subset.' : token.value === '--' && !previousArgs.includes('--') ? 'End option processing. Following arguments are literal, even if they start with a dash.' : option ? flagMeaning : `Literal argument: ${token.value || '(empty string)'}.${step ? ` Paths resolve from ${step.cwd || '/'}.` : ''}`;
    explanations.push(meaning);
    return `<button class="token ${token.kind === 'word' ? '' : 'operator'}" data-token="${i}" title="${escape(meaning)}${token.class ? ` Token class: ${escape(token.class)}.` : ''}">${escape(token.raw)}${token.class ? `<small>${escape(token.class)}</small>` : ''}</button>`;
  }).join('');
  $('conversion-tokens').innerHTML = $('token-strip').innerHTML;
  document.querySelectorAll('[data-token]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.token); highlightTokens([index]);
    $('token-explanation').textContent = explanations[index];
  }));
}
function renderAnalysis() {
  $('conversion-command').textContent = $('command-input').value;
  const longestToken = Math.max(...result.tokens.map(token => token.raw.length));
  $('parse-tree').innerHTML = renderTree(result.tree, { includeLeafRange: true, leafSpacing: Math.max(82, longestToken * 8 + 18), paddingX: Math.max(40, longestToken * 4 + 8), levelHeight: 48 });
  $('parse-tree').querySelectorAll('text[data-leaf-start]').forEach(node => {
    const select = () => {
      const start = Number(node.dataset.leafStart), end = Number(node.dataset.leafEnd);
      highlightTokens(Array.from({ length: end - start + 1 }, (_, i) => start + i));
      $('parse-tree').querySelectorAll('text').forEach(text => text.classList.toggle('selected', text === node));
    };
    node.setAttribute('tabindex', '0'); node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `${node.textContent}, tokens ${Number(node.dataset.leafStart) + 1} to ${Number(node.dataset.leafEnd) + 1}`);
    node.addEventListener('mouseenter', select); node.addEventListener('click', select); node.addEventListener('focus', select);
    node.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } });
  });
  renderGrammarStages(result);
  cykStep = 0; $('cyk-play').disabled = false; renderCYK();
}
function renderGrammarStages(data) {
  if (data.stages) {
    for (const [id, stage] of [['grammar-text', 'original'], ['grammar-useful', 'useful'], ['grammar-epsilon', 'epsilon'], ['grammar-simplified', 'simplified'], ['grammar-cnf', 'cnf']]) $(id).textContent = data.stages[stage];
    const counts = data.stages.counts;
    $('grammar-stage-counts').textContent = `${counts.authored} authored alternatives → ${counts.simplified} simplified → ${counts.cnf} CNF. Optional eps rules can increase the number of alternatives when removed.`;
    $('grammar-status').textContent = `Grammar compiled successfully. ${data.accepted ? 'This command is accepted.' : 'This command is rejected by the lexer or grammar.'}`;
    $('grammar-status').classList.remove('error-text');
  } else if (data.errorStage === 'grammar') {
    $('grammar-status').textContent = data.error;
    $('grammar-status').classList.add('error-text');
  }
  if (data.tokens?.length) $('normalized-tokens').textContent = data.tokens.map((token, index) => `${index + 1}. ${token.raw} → ${token.class || token.kind}`).join('\n') + (data.normalized ? `\n\nCYK input: ${data.normalized}` : '') + (data.parseCount ? `\nParse trees: ${data.parseCountCapped ? 'at least ' : ''}${data.parseCount}` : '');
}
function renderCYK() {
  const steps = result?.steps || [];
  if (!steps.length) return;
  cykStep = Math.max(0, Math.min(cykStep, steps.length - 1));
  $('cyk-prev').disabled = cykStep === 0; $('cyk-next').disabled = cykStep === steps.length - 1;
  const current = steps[cykStep];
  $('cyk-caption').textContent = `${cykStep + 1} / ${steps.length} · tokens ${current.i + 1}–${current.i + current.len}`;
  $('cyk-grid').innerHTML = steps.slice(Math.max(0, cykStep - 5), cykStep + 1).map((step, i, displayed) => `<div class="cyk-cell ${i === displayed.length - 1 ? 'current' : ''}">[${step.i + 1}, length ${step.len}] → { ${escape(step.added.join(', ') || 'no matches')} }</div>`).join('');
  highlightTokens(Array.from({ length: current.len }, (_, i) => current.i + i));
}
function renderResult() {
  const changes = result.changes;
  paintTree($('before-tree'), result.before, changes.filter(change => change.action !== 'created'));
  paintTree($('after-tree'), result.after, changes, true);
  $('before-count').textContent = `${result.before.entries.length - 1} entries`;
  $('change-count').textContent = `${changes.length} proposed change${changes.length === 1 ? '' : 's'}`;
  const deleted = changes.filter(change => change.action === 'deleted').length;
  const created = changes.filter(change => change.action === 'created').length;
  $('impact-title').textContent = deleted ? `${deleted} entr${deleted === 1 ? 'y' : 'ies'} removed.` : created ? `${created} new entr${created === 1 ? 'y' : 'ies'}.` : changes.length ? 'Existing files change.' : result.before.cwd !== result.after.cwd ? 'A different directory.' : 'Your files stay put.';
  $('impact-description').textContent = deleted ? 'These paths disappear from the virtual workspace. The originals on your computer are untouched.' : changes.length ? 'Compare the highlighted paths. Keeping this preview updates only the in-memory workspace.' : result.exitCode ? 'A command failed. Inspect its message and execution steps below.' : `This command changes no files.${result.before.cwd !== result.after.cwd ? ` Next virtual directory: ${result.after.cwd}.` : ' Check its output below.'}`;
  $('change-list').innerHTML = changes.slice(0, 120).map(change => `<div class="change-item ${change.action}"><span>${{ created: '+', deleted: '−', modified: '~' }[change.action]}</span><span>${escape(change.path)}</span></div>`).join('') + (changes.length > 120 ? `<p>And ${changes.length - 120} more. See the file tree.</p>` : '');
  $('execution-trace').innerHTML = result.trace.map((step, i) => `<button class="trace-step ${step.skipped ? 'skipped' : ''}" data-step="${i}"><span class="trace-step-header"><span class="step-number">${String(i + 1).padStart(2, '0')}</span><code>${escape(step.command)}</code><span class="step-exit ${step.exitCode ? 'failed' : ''}">${step.skipped ? 'SKIPPED' : 'EXIT ' + step.exitCode}</span></span><span class="step-description">${escape(step.reason || step.stderr.trim() || (step.piped ? 'Pipeline stage · ' : '') + (step.changes.length ? `${step.changes.length} virtual change(s)` : step.nextCwd !== step.cwd ? `Directory → ${step.nextCwd}` : 'No file changes'))}</span></button>`).join('');
  $('execution-trace').querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
    const step = result.trace[Number(button.dataset.step)];
    highlightTokens(step.tokenIndices); highlightPaths(step.changes.map(change => change.path));
    $('execution-trace').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
  }));
  $('terminal-output').textContent = (result.stdout ? result.stdout : '(no standard output)\n') + (result.stderr ? `\nSTDERR\n${result.stderr}` : '');
  $('exit-label').textContent = `EXIT ${result.exitCode}`;
  $('apply-button').disabled = changes.length === 0 && result.before.cwd === result.after.cwd;
  $('real-apply-button').disabled = !localFolder || !result.planId;
  $('local-apply-note').textContent = localFolder ? result.localApplyNote : imported ? 'Browser uploads are preview-only. Open a local folder by path to apply changes.' : '';
  if (localFolder) $('impact-description').textContent = 'This is a preview. Review & apply writes the listed changes to your selected folder.';
  $('command-meaning').innerHTML = result.trace.map(step => {
    const words = step.tokenIndices.map(i => result.tokens[i].value);
    const labels = { cp: ['Copy', 'Source', 'Destination'], mv: ['Move / rename', 'Source', 'Destination'], rm: ['Remove', 'Path'], mkdir: ['Create directory', 'Path'], ls: ['List directory', 'Path'] };
    const [title, ...roles] = words.slice(1).some(word => word.startsWith('-')) ? [words[0], 'Argument'] : labels[words[0]] || [words[0], 'Argument'];
    return `<div class="meaning-step"><strong>${escape(title)}</strong>${words.slice(1).map((word, i) => `<div><span>${escape(roles[i] || 'Argument')}</span><code>${escape(word)}</code></div>`).join('')}${words.length === 1 ? '<p>Current directory</p>' : ''}</div>`;
  }).join('');
  renderTokens(result.tokens); renderAnalysis(); highlightTokens([]); showWatchWarning();
}
async function preview(event) {
  event?.preventDefault();
  if (!workspace) return;
  invalidate(); renderEmpty();
  const active = new AbortController(); request = active;
  $('preview-button').disabled = true; $('preview-button').textContent = 'Parsing…';
  setStatus('Reading tokens, parsing the grammar, and calculating the virtual changes…');
  try {
    const response = await fetch(localFolder ? '/api/local-folder/preview' : '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Workspace': '1' }, signal: active.signal, body: JSON.stringify({ workspaceId: localFolder?.workspaceId, command: $('command-input').value, ...(localFolder ? {} : { workspace }), protectedPaths: [$('protected-path').value], grammarText: $('command-grammar').value }) });
    let data;
    try { data = await response.json(); } catch { throw new Error(`The server returned an invalid response (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(data.error || `Server error ${response.status}.`);
    if (request !== active) return;
    renderGrammarStages(data);
    if (recovery && recovery.corrected === $('command-input').value) {
      $('recovery-evidence').innerHTML = `<h3>Error → correction → reparse</h3><p>Rejected input</p><pre>${escape(recovery.original)}</pre><p>${escape(recovery.error)}</p><p>Candidate correction: ${escape(recovery.explanation)}</p><pre>${escape(recovery.corrected)}</pre><p>${data.accepted ? 'CYK accepts the corrected input.' : 'The corrected input is rejected by the current grammar.'} ${data.accepted && data.exitCode ? 'Syntax is valid; the simulated command still reports a runtime error.' : ''}</p>`;
    }
    if (!data.accepted) {
      renderTokens(data.tokens || []); setStatus(data.error + (data.syntaxHelp ? ` ${data.syntaxHelp}` : ''), true);
      $('repairs').innerHTML = (data.repairs || []).map((repair, i) => `<button class="repair-button" data-repair="${i}">Candidate correction: ${escape(repair.explanation)}<code>${escape(repair.command)}</code></button>`).join('');
      $('repairs').querySelectorAll('[data-repair]').forEach(button => button.addEventListener('click', () => {
        const repair = data.repairs[Number(button.dataset.repair)];
        recovery = { original: $('command-input').value, corrected: repair.command, explanation: repair.explanation, error: data.error + (data.syntaxHelp ? ` ${data.syntaxHelp}` : '') };
        $('command-input').value = repair.command; preview();
      }));
      return;
    }
    result = data; renderResult();
    if (localFolder && data.before) { workspace = structuredClone(data.before); baseline = structuredClone(data.before); }
    setStatus(data.exitCode ? `Parsed successfully; simulation finished with exit ${data.exitCode}. See the error below.` : `Preview complete. ${data.changes.length} proposed change${data.changes.length === 1 ? '' : 's'} · Original files untouched.`, Boolean(data.exitCode));
  } catch (error) {
    if (error.name !== 'AbortError' && request === active) setStatus(`Could not preview: ${error.message} Start the local server and try again.`, true);
  } finally {
    if (request === active) { $('preview-button').disabled = false; $('preview-button').innerHTML = 'Preview changes <span aria-hidden="true">↗</span>'; }
  }
}

$('command-form').addEventListener('submit', preview);
function grammarChanged() {
  recovery = null;
  syncMode();
  invalidate(); if (workspace) renderEmpty();
  $('grammar-status').textContent = 'Grammar edited. Apply or preview to compile these rules.';
  $('grammar-status').classList.remove('error-text');
  setStatus('Grammar changed. Old previews are cleared; the next preview will use these rules.');
}
$('command-grammar').addEventListener('input', () => { $('grammar-preset').value = 'custom'; grammarChanged(); });
$('grammar-apply').addEventListener('click', preview);
$('grammar-preset').addEventListener('change', () => {
  const preset = grammarPresets[$('grammar-preset').value];
  if (preset) { $('command-grammar').value = preset; grammarChanged(); preview(); }
});
$('grammar-reset').addEventListener('click', () => {
  if (!grammarPresets.basic) return;
  $('command-grammar').value = grammarPresets.basic; $('grammar-preset').value = 'basic'; grammarChanged(); preview();
});
$('command-input').addEventListener('input', () => { recovery = null; invalidate(); if (workspace) renderEmpty(); setStatus('Command changed. Preview again to calculate its effects.'); });
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  recovery = null;
  if (imported) setWorkspace(sample);
  else { invalidate(); workspace = structuredClone(sample); baseline = structuredClone(sample); history = []; }
  $('command-input').value = examples[button.dataset.example]; preview();
}));
$('apply-button').addEventListener('click', () => {
  if (!result || $('apply-button').disabled) return;
  history.push(structuredClone(workspace)); if (history.length > 20) history.shift();
  workspace = structuredClone(result.after); invalidate(); renderEmpty();
  setStatus('Virtual state kept. You can preview another command or undo. No real files changed.');
});
$('undo-button').addEventListener('click', () => {
  if (!history.length) return;
  workspace = history.pop(); invalidate(); renderEmpty(); setStatus('Previous virtual state restored.');
});
$('reset-button').addEventListener('click', () => {
  if (localFolder) { preview(); return; }
  if (!baseline) return;
  workspace = structuredClone(baseline); history = []; invalidate(); renderEmpty(); setStatus('Workspace restored to its initial snapshot.');
});
$('sample-button').addEventListener('click', () => { if (sample) { setWorkspace(sample); preview(); } });
$('protected-path').addEventListener('input', showWatchWarning);
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('folder-fallback-button').addEventListener('click', () => { $('help-dialog').close(); $('folder-input').click(); });
$('cyk-prev').addEventListener('click', () => { stopPlayback(); cykStep--; renderCYK(); });
$('cyk-next').addEventListener('click', () => { stopPlayback(); cykStep++; renderCYK(); });
$('cyk-play').addEventListener('click', () => {
  if (playTimer) return stopPlayback();
  if (cykStep === result.steps.length - 1) cykStep = 0;
  $('cyk-play').textContent = 'Pause';
  playTimer = setInterval(() => { renderCYK(); if (cykStep >= result.steps.length - 1) stopPlayback(); else cykStep++; }, 500);
});

$('folder-button').addEventListener('click', () => { $('folder-error').textContent = ''; $('folder-dialog').showModal(); });
$('folder-input').addEventListener('change', async event => {
  const files = [...event.target.files]; if (!files.length) return;
  try {
    const excludedFolders = new Set();
    const root = files[0].webkitRelativePath.split('/')[0];
    const records = [];
    for (const file of files) {
      const parts = file.webkitRelativePath.split('/').slice(1);
      const excludedAt = parts.findIndex(part => ['.git', 'node_modules'].includes(part));
      if (excludedAt !== -1) { excludedFolders.add(parts.slice(0, excludedAt + 1).join('/')); continue; }
      records.push({ path: parts.join('/'), type: 'file', size: file.size });
    }
    localFolder = null; setWorkspace(metadataSnapshot(records, root), true, excludedFolders.size); await preview();
  } catch (error) { setStatus(error.message, true); }
  event.target.value = '';
});

async function boot() {
  try {
    const response = await fetch('/api/simulator');
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const data = await response.json(); sample = data.workspace; commands = data.commands; flags = data.flags || {};
    grammarPresets = data.grammarPresets;
    $('grammar-preset').value = 'basic'; syncMode();
    $('command-grammar').value = data.grammar;
    $('token-class-reference').innerHTML = Object.entries(data.tokenClasses).map(([name, meaning]) => `<dt>${escape(name)}</dt><dd>${escape(meaning)}</dd>`).join('');
    $('grammar-text').textContent = data.grammar;
    setWorkspace(sample); await preview();
  } catch (error) { setStatus(`Could not load the workspace: ${error.message}. Make sure the local server is running, then reload.`, true); }
}
boot();

function syncMode() {
  const mode = $('grammar-preset').value;
  $('command-mode').value = ['basic', 'full'].includes(mode) ? mode : 'custom';
  $('mode-hint').textContent = mode === 'basic' ? 'One command, simple paths, no flags.' : mode === 'full' ? 'Nested groups, flags, pipes and chains. Local apply still requires a single Basic command.' : 'Custom rules defined in Command conversions.';
  document.querySelectorAll('[data-advanced]').forEach(button => { button.hidden = mode !== 'full'; });
  $('command-help').innerHTML = Object.entries(mode === 'basic' ? basicDescriptions : commands || {}).map(([name, description]) => `<dt>${escape(name)}</dt><dd>${escape(description)}</dd>`).join('');
  $('advanced-help').hidden = mode === 'basic';
}
function showTab(conversions) {
  $('playground-view').hidden = conversions; $('conversions-view').hidden = !conversions;
  for (const [id, selected] of [['playground-tab', !conversions], ['conversions-tab', conversions]]) {
    $(id).setAttribute('aria-selected', String(selected)); $(id).classList.toggle('nav-current', selected);
  }
  stopPlayback();
  window.history.replaceState(null, '', conversions ? '#conversions' : location.pathname);
}
$('playground-tab').addEventListener('click', () => showTab(false));
['conversions-tab', 'inspect-conversion', 'footer-conversions'].forEach(id => $(id).addEventListener('click', () => showTab(true)));
$('command-mode').addEventListener('change', () => {
  const mode = $('command-mode').value;
  if (mode === 'custom') { showTab(true); $('grammar-workbench').open = true; return; }
  $('grammar-preset').value = mode; $('command-grammar').value = grammarPresets[mode]; grammarChanged(); preview();
});
if (location.hash === '#conversions') showTab(true);

async function localAPI(action, body = {}) {
  const response = await fetch('/api/local-folder/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Workspace': '1' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Server error ${response.status}`);
  return data;
}
$('close-folder').addEventListener('click', () => $('folder-dialog').close());
$('metadata-folder-picker').addEventListener('click', () => { $('folder-dialog').close(); $('folder-input').click(); });
$('native-folder-picker').addEventListener('click', async () => {
  const button = $('native-folder-picker'); button.disabled = true;
  $('folder-error').textContent = 'Choose a folder in the Windows dialog. You can also paste the path below.';
  try { const data = await localAPI('pick'); if (data.path) $('local-folder-path').value = data.path; $('folder-error').textContent = data.path ? 'Folder selected. Click Open folder.' : 'Selection cancelled. You can paste a folder path below.'; }
  catch (error) { $('folder-error').textContent = `Picker unavailable: ${error.message} Paste the full folder path below.`; }
  finally { button.disabled = false; }
});
$('local-folder-form').addEventListener('submit', async event => {
  event.preventDefault(); $('open-local-folder').disabled = true; $('folder-error').textContent = 'Reading local folder…';
  try {
    const data = await localAPI('open', { path: $('local-folder-path').value });
    localFolder = data; setWorkspace(data.workspace, true, data.omitted);
    $('folder-dialog').close(); await preview();
  } catch (error) { $('folder-error').textContent = error.message; }
  finally { $('open-local-folder').disabled = false; }
});
$('real-apply-button').addEventListener('click', () => {
  if (!localFolder || !result?.planId) return;
  $('apply-folder-path').textContent = localFolder.folderPath;
  $('apply-review').textContent = $('command-input').value + '\n\n' + result.changes.map(change => `${change.action}: ${change.path}`).join('\n');
  $('apply-error').textContent = ''; $('apply-dialog').showModal();
});
$('cancel-real-apply').addEventListener('click', () => { if (!applyPending) $('apply-dialog').close(); });
$('apply-dialog').addEventListener('cancel', event => { if (applyPending) event.preventDefault(); });
$('confirm-real-apply').addEventListener('click', async () => {
  if (applyPending || !localFolder || !result?.planId) return;
  applyPending = true; $('confirm-real-apply').disabled = true; $('cancel-real-apply').disabled = true;
  try {
    const data = await localAPI('apply', { workspaceId: localFolder.workspaceId, planId: result.planId });
    setWorkspace(data.workspace, true); $('apply-dialog').close();
    setStatus(data.message);
  } catch (error) { $('apply-error').textContent = error.message; invalidate(); }
  finally { applyPending = false; $('confirm-real-apply').disabled = false; $('cancel-real-apply').disabled = false; }
});
