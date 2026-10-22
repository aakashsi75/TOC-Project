/** A deliberately bounded Bash-style language. No filesystem or process APIs. */
import { cykParse } from './cyk.js';
import { buildTrees, collapseCNFArtifacts, countParses } from './parseTrees.js';
import { COMMAND_GRAMMAR, compileCommandGrammar } from './commandGrammar.js';
export { COMMAND_GRAMMAR, READ_ONLY_GRAMMAR, COPY_ONLY_GRAMMAR, TOKEN_CLASSES } from './commandGrammar.js';

export const COMMANDS = {
  pwd: 'Print the current virtual directory.',
  ls: 'List one directory or file. Supports -a and -l.',
  cd: 'Change the virtual directory. Requires one path.',
  mkdir: 'Create one directory. Supports -p for missing parents.',
  touch: 'Create one empty file, or mark an existing file as touched.',
  cp: 'Copy one source to one destination. Supports -r / -R for directories.',
  mv: 'Move or rename one source to one destination.',
  rm: 'Delete one virtual path. Supports -r / -R and -f.',
  echo: 'Print literal arguments. Supports -n.',
  cat: 'Read one sample file, or pass through piped input.',
  grep: 'Filter lines by literal substring (not regular expressions). Supports -i and -v.'
};

export const FLAG_HELP = {
  ls: { a: 'Include hidden names present in the snapshot.', l: 'Show a simplified type and size listing.' },
  mkdir: { p: 'Create missing parent directories; allow existing directories.' },
  cp: { r: 'Copy a directory and its descendants.', R: 'Copy a directory and its descendants.' },
  rm: { r: 'Remove a directory and its descendants.', R: 'Remove a directory and its descendants.', f: 'Ignore a missing target. This does not make an existing directory removable without -r.' },
  echo: { n: 'Do not append a newline.' },
  grep: { i: 'Ignore letter case when matching the literal substring.', v: 'Return lines that do not contain the literal substring.' }
};

const MAX_ENTRIES = 100000;
const MAX_BYTES = 256000;

export function sampleWorkspace() {
  const workspace = { name: 'demo-project', cwd: '/', entries: [
    { path: '/', type: 'directory' },
    { path: '/src', type: 'directory' },
    { path: '/src/app.js', type: 'file', content: 'import { start } from "./utils.js";\nstart();\n', size: 49 },
    { path: '/src/utils.js', type: 'file', content: 'export const start = () => "Hello, world";\n', size: 42 },
    { path: '/build', type: 'directory' },
    { path: '/build/bundle.js', type: 'file', content: '// Generated build output\n', size: 26 },
    { path: '/build/app.css', type: 'file', content: 'body { margin: 0; }\n', size: 20 },
    { path: '/backup', type: 'directory' },
    { path: '/notes.txt', type: 'file', content: 'Finish TOC report\nReview parser tests\nPrepare demo\n', size: 48 },
    { path: '/README.md', type: 'file', content: '# Demo project\nA workspace you can experiment with.\n', size: 51 },
    { path: '/.gitignore', type: 'file', content: 'node_modules\nbuild\n', size: 19 }
  ] };
  for (const entry of workspace.entries) if (entry.type === 'file') entry.size = new TextEncoder().encode(entry.content).length;
  return workspace;
}

export function resolvePath(input, cwd = '/') {
  if (typeof input !== 'string' || !input || input.includes('\0')) throw new Error('A non-empty path is required.');
  const parts = (input.startsWith('/') ? input : `${cwd}/${input}`).split('/');
  const result = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop(); else result.push(part);
  }
  return '/' + result.join('/');
}

const parentPath = path => path.slice(0, path.lastIndexOf('/')) || '/';
const baseName = path => path.split('/').pop();
const inside = (path, root) => path === root || path.startsWith(root === '/' ? '/' : root + '/');

export function validateWorkspace(workspace) {
  if (!workspace || !Array.isArray(workspace.entries) || workspace.entries.length > MAX_ENTRIES) {
    throw new Error(`Workspace must contain at most ${MAX_ENTRIES} entries.`);
  }
  const seen = new Set();
  let bytes = 0;
  for (const entry of workspace.entries) {
    if (!entry || typeof entry.path !== 'string' || entry.path.length > 500 || !entry.path.startsWith('/') || resolvePath(entry.path) !== entry.path || seen.has(entry.path)) {
      throw new Error('Workspace paths must be unique, normalized absolute virtual paths.');
    }
    if (!['file', 'directory'].includes(entry.type)) throw new Error('Only regular files and directories are supported.');
    if (entry.content !== undefined && entry.content !== null && typeof entry.content !== 'string') throw new Error('Invalid file content.');
    bytes += (entry.content || '').length;
    if (bytes > MAX_BYTES) throw new Error('Sample contents exceed the 256 KB workspace limit.');
    if (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || entry.size < 0)) throw new Error('Invalid file size.');
    seen.add(entry.path);
  }
  const map = new Map(workspace.entries.map(entry => [entry.path, entry]));
  if (map.get('/')?.type !== 'directory') throw new Error('Workspace must have a root directory.');
  for (const entry of map.values()) {
    if (entry.path !== '/' && map.get(parentPath(entry.path))?.type !== 'directory') throw new Error(`Missing parent directory for ${entry.path}.`);
  }
  const cwd = workspace.cwd || '/';
  if (map.get(cwd)?.type !== 'directory') throw new Error('Current directory is missing from the snapshot. Reset the workspace.');
  return { name: String(workspace.name || 'workspace').slice(0, 100), cwd, entries: [...map.values()].map(entry => ({
    path: entry.path, type: entry.type, ...(entry.type === 'file' ? { content: entry.content ?? null, size: entry.size ?? (entry.content || '').length, touched: Boolean(entry.touched) } : {})
  })) };
}

export function lexCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return { error: 'Enter a command to preview.', tokens: [] };
  if (command.length > 512) return { error: 'Commands are limited to 512 characters.', tokens: [] };
  const tokens = [];
  let i = 0;
  const fail = (message, position = i) => ({ error: `${message} (position ${position + 1}).`, position, tokens });
  while (i < command.length) {
    if (/\s/.test(command[i])) {
      if (/[\r\n]/.test(command[i])) return fail('Newlines are unsupported; use && or || between commands');
      i++; continue;
    }
    const start = i;
    if (command[i] === '(' || command[i] === ')') {
      const value = command[i++];
      tokens.push({ kind: value === '(' ? 'lparen' : 'rparen', value, start, end: i, raw: value });
      continue;
    }
    if (command.startsWith('&&', i) || command.startsWith('||', i) || command[i] === '|') {
      const value = command[i] === '&' ? '&&' : command.startsWith('||', i) ? '||' : '|';
      i += value.length;
      tokens.push({ kind: value === '&&' ? 'and' : value === '||' ? 'or' : 'pipe', value, start, end: i, raw: value });
      continue;
    }
    let value = '';
    while (i < command.length && !/\s/.test(command[i]) && !['|', '&', '(', ')'].includes(command[i])) {
      const ch = command[i];
      if (ch === "'" || ch === '"') {
        const quote = ch;
        const quoteStart = i++;
        while (i < command.length && command[i] !== quote) {
          if (/[\r\n]/.test(command[i])) return fail('Multiline strings are unsupported');
          if (quote === '"' && /[$`]/.test(command[i])) return fail('Shell expansion and command substitution are unsupported');
          if (quote === '"' && command[i] === '\\' && /["\\$`]/.test(command[i + 1] || '')) i++;
          value += command[i++];
        }
        if (i === command.length) return { ...fail(`Unclosed ${quote === '"' ? 'double' : 'single'} quote`, quoteStart), missingQuote: quote };
        i++;
      } else if (ch === '\\') {
        if (++i === command.length) return fail('Trailing escape needs a character', i - 1);
        if (/[\r\n]/.test(command[i])) return fail('Line continuations are unsupported');
        value += command[i++];
      } else {
        if (/[$`*?\[\]{}~;<>#!]/.test(ch)) return fail(`Unsupported shell syntax '${ch}'; expansions, redirection and comments are not simulated`);
        value += command[i++];
      }
    }
    if (i === start) return fail("A single '&' (background execution) is unsupported");
    tokens.push({ kind: 'word', value, start, end: i, raw: command.slice(start, i) });
    if (tokens.length > 40) return fail('Commands are limited to 40 tokens');
  }
  return { tokens, error: null };
}

export function classifyCommandTokens(tokens) {
  const flagClasses = { cp: 'copyflag', rm: 'removeflag', mkdir: 'makeflag', ls: 'listflag', echo: 'echoflag', grep: 'filterflag' };
  let name = null, optionsEnded = false, argumentsSeen = 0;
  return tokens.map(token => {
    if (token.kind !== 'word') {
      name = null; optionsEnded = false; argumentsSeen = 0;
      return { ...token, class: token.kind };
    }
    if (name === null) { name = token.value; return { ...token, class: Object.hasOwn(COMMANDS, name) ? name : 'unknown' }; }
    if (token.value === '--' && !optionsEnded) { optionsEnded = true; return { ...token, class: 'endopts' }; }
    if (!optionsEnded && token.value.startsWith('-') && token.value !== '-') {
      const supported = !token.value.startsWith('--') && [...token.value.slice(1)].every(flag => Object.hasOwn(FLAG_HELP[name] || {}, flag));
      return { ...token, class: supported ? flagClasses[name] : 'badflag' };
    }
    const type = name === 'echo' ? 'text' : name === 'grep' && argumentsSeen === 0 ? 'pattern' : 'path';
    argumentsSeen++;
    if (name === 'echo') optionsEnded = true;
    return { ...token, class: type };
  });
}

export function parseCommand(command, includeTrace = true, grammarText = COMMAND_GRAMMAR) {
  const compiled = compileCommandGrammar(grammarText);
  if (compiled.error) return { accepted: false, tokens: [], error: compiled.error, grammarErrors: compiled.grammarErrors, errorStage: 'grammar' };
  const metadata = { grammar: grammarText, stages: compiled.stages };
  const lexical = lexCommand(command);
  if (lexical.error) return { ...metadata, ...lexical, accepted: false, errorStage: 'lexer' };
  const tokens = classifyCommandTokens(lexical.tokens);
  if (tokens.length > 40) return { accepted: false, tokens, error: 'Commands are limited to 40 tokens.' };
  const normalized = tokens.map(token => token.class).join(' ');
  const cyk = cykParse(compiled.cnf.final, normalized);
  if (!cyk.accepted) {
    const invalid = tokens.find(token => token.class === 'unknown' || token.class === 'badflag');
    const commandClasses = tokens.filter((token, i) => token.kind === 'word' && (i === 0 || tokens[i - 1].kind !== 'word'));
    const unavailable = commandClasses.find(token => Object.hasOwn(COMMANDS, token.class) && !Object.values(compiled.simplified.productions).flat().some(rule => rule.includes(token.class)));
    const error = invalid ? `Unsupported ${invalid.class === 'unknown' ? 'command' : 'flag'} '${invalid.value}' at position ${invalid.start + 1}. The active grammar rejects its token class.` : unavailable ? `The active grammar does not allow the '${unavailable.value}' command. Change the COMMAND alternatives or choose another preset.` : 'Rejected by the active grammar. Check command arguments, option order, and connectors. A command is required on each side of |, &&, or ||.';
    let syntaxHelp = 'Check arguments and connectors. Parentheses must enclose a complete command or command chain; nested groups require Advanced mode.';
    const openGroups = [];
    for (const token of tokens) {
      if (token.kind === 'lparen') openGroups.push(token);
      if (token.kind === 'rparen') {
        if (openGroups.length) openGroups.pop();
        else { syntaxHelp = `Unexpected ')' at position ${token.start + 1}. Match every closing parenthesis with an opening parenthesis.`; break; }
      }
    }
    if (openGroups.length) syntaxHelp = `Missing ${openGroups.length} closing ${openGroups.length > 1 ? 'parentheses' : 'parenthesis'}; '(' at position ${openGroups.at(-1).start + 1} is still open. Nested groups require Advanced mode.`;
    if (tokens.every(t => t.kind === 'word') && ['cp', 'mv'].includes(tokens[0]?.value)) {
      syntaxHelp = `${tokens[0].value} requires one source and one destination: ${tokens[0].value} SOURCE DESTINATION. Supply your own paths; a correction cannot infer them.`;
    }
    return { ...metadata, accepted: false, tokens, normalized, error, syntaxHelp, errorStage: 'syntax' };
  }
  const raw = buildTrees(cyk, 1)[0];
  const tree = collapseCNFArtifacts(raw, compiled.cnf.trace);
  let index = 0;
  function attach(node) {
    if (node.terminal) {
      node.symbol = tokens[index++].raw;
    } else (node.children || []).forEach(attach);
  }
  attach(tree);
  // Terminal occurrence indices preserve repeated or differently quoted words.
  let cursor = 0;
  function attachIndex(node) {
    if (node.terminal) node.tokenIndex = cursor++;
    else (node.children || []).forEach(attachIndex);
  }
  attachIndex(tree);
  // The grammar, not a second hand-written parser, determines precedence and grouping.
  function buildAST(node) {
    if (!node.terminal && node.children.length === 1 && !node.children[0].terminal) return buildAST(node.children[0]);
    function tokenLeaves(n) {
      if (n.terminal) return [tokens[n.tokenIndex]];
      return (n.children || []).flatMap(tokenLeaves);
    }
    const children = node.children || [];
    if (children.length === 3 && children[0].terminal && children[2].terminal && tokens[children[0].tokenIndex].kind === 'lparen' && tokens[children[2].tokenIndex].kind === 'rparen') {
      return { type: 'group', body: buildAST(children[1]), tokenIndices: tokenLeaves(node).map(token => tokens.indexOf(token)) };
    }
    const middle = children.length === 3 ? tokenLeaves(children[1]) : [];
    if (middle.length === 1 && ['and', 'or', 'pipe'].includes(middle[0].kind)) {
      return { type: middle[0].kind === 'pipe' ? 'pipe' : 'conditional', operator: middle[0].value, left: buildAST(children[0]), right: buildAST(children[2]) };
    }
    const leaves = tokenLeaves(node);
    if (leaves.some(token => token.kind !== 'word')) throw new Error('This grammar accepts a connector grouping the interpreter cannot model. Use binary command/pipeline groups.');
    return { type: 'command', words: leaves.map(token => token.value), tokenIndices: leaves.map(token => tokens.indexOf(token)) };
  }
  const total = countParses(cyk);
  let ast = null, interpretationError = null;
  try {
    if (total > 1) throw new Error('This input has multiple parses under the active grammar. The first tree is shown, but simulation is disabled until the grammar is unambiguous for this input.');
    ast = buildAST(tree);
  } catch (error) { interpretationError = error.message; }
  return {
    ...metadata, accepted: true, error: null, tokens, ast, interpretationError, tree,
    parseCount: String(total), parseCountCapped: total === Number.MAX_SAFE_INTEGER,
    cnfGrammar: compiled.stages.cnf,
    steps: includeTrace ? cyk.steps.map(step => ({ i: step.i, len: step.len, added: step.added })) : [],
    normalized
  };
}

export function suggestRepairs(command, grammarText = COMMAND_GRAMMAR) {
  if (typeof command !== 'string' || command.length > 512) return [];
  const lexed = lexCommand(command);
  const candidates = [];
  if (lexed.missingQuote) candidates.push({ command: command + lexed.missingQuote, explanation: 'Close the unfinished quoted argument.' });
  let depth = 0, missingOpen = 0;
  for (const token of lexed.tokens) {
    if (token.kind === 'lparen') depth++;
    if (token.kind === 'rparen') { if (depth) depth--; else missingOpen++; }
  }
  if (!lexed.error && (depth || missingOpen)) candidates.push({ command: '('.repeat(missingOpen) + command + ')'.repeat(depth), explanation: 'Balance the unmatched command-group parentheses.' });
  for (const token of lexed.tokens.filter(token => token.kind !== 'word')) {
    candidates.push({ command: (command.slice(0, token.start) + command.slice(token.end)).trim(), explanation: `Remove '${token.value}' at position ${token.start + 1}.` });
  }
  const seen = new Set();
  return candidates.filter(candidate => {
    if (seen.has(candidate.command)) return false;
    seen.add(candidate.command);
    const parsed = parseCommand(candidate.command, false, grammarText);
    return parsed.accepted && !parsed.interpretationError;
  }).slice(0, 3);
}

export function diffWorkspaces(before, after) {
  const a = new Map(before.entries.map(entry => [entry.path, entry]));
  const b = new Map(after.entries.map(entry => [entry.path, entry]));
  const changes = [];
  for (const [path, entry] of a) {
    if (!b.has(path)) changes.push({ path, action: 'deleted', type: entry.type });
    else if (JSON.stringify(entry) !== JSON.stringify(b.get(path))) changes.push({ path, action: 'modified', type: entry.type });
  }
  for (const [path, entry] of b) if (!a.has(path)) changes.push({ path, action: 'created', type: entry.type });
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}

export function simulateCommand(command, workspace = sampleWorkspace(), protectedPaths = [], grammarText = COMMAND_GRAMMAR) {
  let before;
  try { before = validateWorkspace(workspace); }
  catch (error) { return { accepted: false, error: error.message, repairs: [] }; }
  const analysis = parseCommand(command, true, grammarText);
  if (!analysis.accepted) return { ...analysis, changes: [], repairs: analysis.errorStage === 'grammar' ? [] : suggestRepairs(command, grammarText) };
  if (analysis.interpretationError) return { ...analysis, before, after: structuredClone(before), changes: [], trace: [], stdout: '', stderr: analysis.interpretationError, exitCode: 1, warnings: [] };
  const state = structuredClone(before);
  let fs = new Map(state.entries.map(entry => [entry.path, entry]));
  const trace = [];
  const ok = (stdout = '', exitCode = 0) => ({ stdout, stderr: '', exitCode });
  const requireEntry = path => { if (!fs.has(path)) throw new Error(`${path}: no such file or directory in this snapshot`); return fs.get(path); };
  const requireParent = path => { if (fs.get(parentPath(path))?.type !== 'directory') throw new Error(`${parentPath(path)}: parent directory does not exist`); };
  function run(words, stdin = '') {
    const [name, ...rawArgs] = words;
    if (!Object.hasOwn(COMMANDS, name)) throw new Error(`Unsupported command '${name}'. Supported: ${Object.keys(COMMANDS).join(', ')}.`);
    const flags = new Set();
    const args = [];
    let optionsEnded = false;
    const allowed = { pwd: '', ls: 'al', cd: '', mkdir: 'p', touch: '', cp: 'rR', mv: '', rm: 'rRf', echo: 'n', cat: '', grep: 'iv' }[name];
    for (const arg of rawArgs) {
      if (arg === '--' && !optionsEnded) { optionsEnded = true; continue; }
      if (!optionsEnded && arg.startsWith('-') && arg !== '-') {
        if (arg.startsWith('--') || [...arg.slice(1)].some(flag => !allowed.includes(flag))) throw new Error(`Unsupported flag '${arg}' for ${name}. Use Supported commands for the modeled subset.`);
        [...arg.slice(1)].forEach(flag => flags.add(flag));
      } else { args.push(arg); if (name === 'echo') optionsEnded = true; }
    }
    const arity = (min, max = min) => { if (args.length < min || args.length > max) throw new Error(`${name}: expected ${min === max ? min : `${min}–${max}`} argument(s), got ${args.length}`); };
    const path = value => resolvePath(value, state.cwd);
    const pathArgs = name === 'grep' ? args.slice(1) : ['echo', 'pwd'].includes(name) ? [] : args;
    for (const value of pathArgs) {
      if (value.endsWith('/') && fs.get(path(value))?.type === 'file') throw new Error(`${value}: not a directory (trailing /)`);
    }
    const recursive = flags.has('r') || flags.has('R');
    if (name === 'pwd') { arity(0); return ok(state.cwd + '\n'); }
    if (name === 'echo') return ok(args.join(' ') + (flags.has('n') ? '' : '\n'));
    if (name === 'cd') {
      arity(1); const target = path(args[0]);
      if (requireEntry(target).type !== 'directory') throw new Error(`${target}: not a directory`);
      state.cwd = target; return ok();
    }
    if (name === 'ls') {
      arity(0, 1); const target = path(args[0] || '.'); const entry = requireEntry(target);
      const entries = entry.type === 'directory' ? [...fs.values()].filter(item => item.path !== '/' && parentPath(item.path) === target && (flags.has('a') || !baseName(item.path).startsWith('.'))) : [entry];
      return ok(entries.sort((a, b) => a.path.localeCompare(b.path)).map(item => `${flags.has('l') ? `${item.type === 'directory' ? 'dir ' : 'file'} ${String(item.size || 0).padStart(6)}  ` : ''}${baseName(item.path)}${item.type === 'directory' ? '/' : ''}`).join('\n') + (entries.length ? '\n' : ''));
    }
    if (name === 'cat' || name === 'grep') {
      arity(name === 'cat' ? 0 : 1, name === 'cat' ? 1 : 2);
      const file = name === 'cat' ? args[0] : args[1];
      let text = stdin;
      if (file !== undefined) {
        const entry = requireEntry(path(file));
        if (entry.type !== 'file') throw new Error(`${file}: is a directory`);
        if (entry.content === null) throw new Error(`${file}: contents were not imported. Folder snapshots contain metadata only; cat/grep cannot read these files.`);
        text = entry.content;
      }
      if (name === 'cat') return ok(text);
      const pattern = flags.has('i') ? args[0].toLowerCase() : args[0];
      const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop();
      const matches = lines.filter(line => ((flags.has('i') ? line.toLowerCase() : line).includes(pattern)) !== flags.has('v'));
      return ok(matches.join('\n') + (matches.length ? '\n' : ''), matches.length ? 0 : 1);
    }
    if (name === 'mkdir' || name === 'touch') {
      arity(1); const target = path(args[0]);
      if (name === 'touch' && args[0].endsWith('/') && !fs.has(target)) throw new Error(`${args[0]}: directory does not exist`);
      if (name === 'touch' && fs.has(target)) {
        fs.set(target, { ...fs.get(target), ...(fs.get(target).type === 'file' ? { touched: true } : {}) }); return ok();
      }
      if (fs.has(target)) { if (name === 'mkdir' && flags.has('p') && fs.get(target).type === 'directory') return ok(); throw new Error(`${target}: already exists`); }
      if (name === 'mkdir' && flags.has('p')) {
        let current = '';
        for (const part of target.split('/').filter(Boolean)) {
          current += '/' + part;
          if (fs.has(current) && fs.get(current).type !== 'directory') throw new Error(`${current}: not a directory`);
          fs.set(current, { path: current, type: 'directory' });
        }
      } else {
        requireParent(target);
        fs.set(target, name === 'mkdir' ? { path: target, type: 'directory' } : { path: target, type: 'file', content: '', size: 0 });
      }
      return ok();
    }
    if (name === 'rm') {
      arity(1); const target = path(args[0]);
      if (target === '/') throw new Error('The virtual root cannot be removed.');
      if (state.cwd !== '/' && inside(state.cwd, target)) throw new Error('Removing the current virtual directory or its ancestor is outside this simulator’s subset. Change directory first.');
      if (!fs.has(target) && flags.has('f')) return ok();
      const entry = requireEntry(target);
      if (entry.type === 'directory' && !recursive) throw new Error(`${target}: is a directory; use -r to preview recursive deletion`);
      for (const key of [...fs.keys()]) if (inside(key, target)) fs.delete(key);
      return ok();
    }
    if (name === 'cp' || name === 'mv') {
      arity(2); const source = path(args[0]); const entry = requireEntry(source);
      let target = path(args[1]);
      if (fs.get(target)?.type === 'directory') target = resolvePath(baseName(source), target);
      if (source === '/' || inside(target, source)) throw new Error('Cannot copy or move a path onto itself or into its own subtree.');
      if (entry.type === 'directory' && name === 'cp' && !recursive) throw new Error(`${source}: is a directory; use cp -r`);
      requireParent(target);
      if (fs.has(target) && fs.get(target).type !== entry.type) throw new Error('Source and destination types differ.');
      if (fs.get(target)?.type === 'directory') throw new Error('Merging or replacing existing directories is outside this simulator’s subset.');
      if (args[1].endsWith('/') && !fs.has(path(args[1]))) throw new Error('A destination ending in / must be an existing directory.');
      const sourceEntries = [...fs.values()].filter(item => inside(item.path, source));
      for (const item of sourceEntries) {
        const nextPath = target + item.path.slice(source.length);
        fs.set(nextPath, { ...item, path: nextPath });
      }
      if (name === 'mv') {
        for (const item of sourceEntries) fs.delete(item.path);
        if (inside(state.cwd, source)) state.cwd = target + state.cwd.slice(source.length);
      }
      return ok();
    }
  }
  const formatCommand = node => node.tokenIndices.map(index => analysis.tokens[index].raw).join(' ');
  function skipped(node, reason) {
    if (node.type === 'command') trace.push({ command: formatCommand(node), tokenIndices: node.tokenIndices, skipped: true, reason, changes: [], stdout: '', stderr: '', exitCode: null });
    else if (node.type === 'group') skipped(node.body, reason);
    else { skipped(node.left, reason); skipped(node.right, reason); }
  }
  function evaluate(node, stdin = '', inPipe = false) {
    if (node.type === 'group') {
      const savedCwd = state.cwd;
      try { return evaluate(node.body, stdin, inPipe); }
      finally { state.cwd = savedCwd; }
    }
    if (node.type === 'conditional') {
      const left = evaluate(node.left, stdin, inPipe);
      const shouldRun = node.operator === '&&' ? left.exitCode === 0 : left.exitCode !== 0;
      if (!shouldRun) { skipped(node.right, `${node.operator}: previous exit status was ${left.exitCode}`); return left; }
      const right = evaluate(node.right, stdin, inPipe);
      return { ...right, stdout: left.stdout + right.stdout, stderr: left.stderr + right.stderr };
    }
    if (node.type === 'pipe') {
      // Bash pipelines isolate cd state; virtual file writes still persist.
      const savedCwd = state.cwd;
      const left = evaluate(node.left, stdin, true); state.cwd = savedCwd;
      const right = evaluate(node.right, left.stdout, true); state.cwd = savedCwd;
      return { ...right, stderr: left.stderr + right.stderr };
    }
    const previous = { ...state, entries: [...fs.values()].map(entry => ({ ...entry })) };
    let result;
    try {
      result = run(node.words, stdin);
      const snapshot = { ...state, entries: [...fs.values()] };
      validateWorkspace(snapshot);
    } catch (error) {
      // Unsupported or failed commands are atomic in this modeled subset.
      fs = new Map(previous.entries.map(entry => [entry.path, entry])); state.cwd = previous.cwd;
      result = { stdout: '', stderr: error.message + '\n', exitCode: 1 };
    }
    const changes = diffWorkspaces(previous, { ...state, entries: [...fs.values()] });
    trace.push({ command: formatCommand(node), tokenIndices: node.tokenIndices, cwd: previous.cwd, nextCwd: state.cwd, ...result, changes, skipped: false, piped: inPipe, stdin });
    return result;
  }
  const result = evaluate(analysis.ast);
  state.entries = [...fs.values()].sort((a, b) => a.path.localeCompare(b.path));
  const changes = diffWorkspaces(before, state);
  const protection = Array.isArray(protectedPaths) ? protectedPaths.filter(p => typeof p === 'string').map(p => resolvePath(p)) : [];
  const warnings = changes.filter(change => protection.some(root => inside(change.path, root) || inside(root, change.path)));
  return { ...analysis, before, after: state, changes, trace, ...result, warnings,
    note: 'In-memory simulation of a documented Bash-style subset. No commands execute on the host. Imported files contain metadata only. Permissions, symlinks, expansion, redirection, and external programs are not modeled. Failed individual commands are atomic.' };
}
