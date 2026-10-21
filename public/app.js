/**
 * Frontend logic — CFG Parser & Simplification
 */
import { renderTree, deriveGrouping, treeToBracket } from './treeRenderer.js';

const SAMPLES = {
  arithmetic: `E -> E+T | T\nT -> T*F | F\nF -> (E) | id`,
  simplification: `S -> A | B\nA -> a\nB -> C\nC -> c\nD -> d\nE -> E e`,
  ambiguous: `E -> E+E | E*E | id`
};

const MALFORMED = [
  { name: "Missing '->'",           text: `E E+T | T\nT -> T*F | F\nF -> (E) | id`, strict: false },
  { name: 'Missing LHS',            text: `-> E+T | T\nT -> T*F | F`,               strict: false },
  { name: 'Trailing pipe',          text: `E -> E+T |\nT -> T*F | F`,               strict: false },
  { name: 'Undefined NT',           text: `S -> A B\nA -> a`,                        strict: true  },
  { name: 'Empty input',            text: ``,                                         strict: false }
];

// Elements
const editor                = document.getElementById('grammar-input');
const btnParse              = document.getElementById('btn-parse');
const btnClear              = document.getElementById('btn-clear');
const chkStrict             = document.getElementById('chk-strict');
const lineCounter           = document.getElementById('line-counter');
const tabCnf                = document.getElementById('tab-cnf');
const viewCnf               = document.getElementById('view-cnf');
const cnfContainer          = document.getElementById('cnf-container');
const tabTrees              = document.getElementById('tab-trees');
const viewTrees             = document.getElementById('view-trees');
const treesInput            = document.getElementById('trees-input');
const btnShowTrees          = document.getElementById('btn-show-trees');
const treesVerdict          = document.getElementById('trees-verdict');
const treesNav              = document.getElementById('trees-nav');
const btnTreesPrev          = document.getElementById('btn-trees-prev');
const btnTreesNext          = document.getElementById('btn-trees-next');
const treesPageLabel        = document.getElementById('trees-page-label');
const treesCanvas           = document.getElementById('trees-canvas');

// Resolve Tab Elements
const tabResolve            = document.getElementById('tab-resolve');
const viewResolve           = document.getElementById('view-resolve');
const resolveGrammarA       = document.getElementById('resolve-grammar-a');
const resolveGrammarB       = document.getElementById('resolve-grammar-b');
const resolveStrings        = document.getElementById('resolve-strings');
const resolveNote           = document.getElementById('resolve-note');
const btnResolveCompare     = document.getElementById('btn-resolve-compare');
const resolveStatus         = document.getElementById('resolve-status');
const resolveErrorBlock     = document.getElementById('resolve-error-block');
const resolveErrorMsg       = document.getElementById('resolve-error-msg');
const resolveResults        = document.getElementById('resolve-results');
const resolveTableBody      = document.getElementById('resolve-table-body');
const resolveSummary        = document.getElementById('resolve-summary');
const resolveExplanation    = document.getElementById('resolve-explanation');
const resolveTreesContainer = document.getElementById('resolve-trees-container');
const resolveSelectedString = document.getElementById('resolve-selected-string');
const resolveCanvasA        = document.getElementById('resolve-canvas-a');
const resolveCanvasB        = document.getElementById('resolve-canvas-b');
const resolveNavA           = document.getElementById('resolve-nav-a');
const btnResolvePrevA       = document.getElementById('btn-resolve-prev-a');
const btnResolveNextA       = document.getElementById('btn-resolve-next-a');
const resolvePageLabelA     = document.getElementById('resolve-page-label-a');
const resolvePresetBtns     = document.querySelectorAll('.resolve-preset-btn');

// RNA Tab Elements
const tabRna                = document.getElementById('tab-rna');
const viewRna               = document.getElementById('view-rna');
const rnaInput              = document.getElementById('rna-input');
const rnaPreset             = document.getElementById('rna-preset');
const btnRnaFold            = document.getElementById('btn-rna-fold');
const rnaVerdict            = document.getElementById('rna-verdict');
const rnaOutputContainer    = document.getElementById('rna-output-container');
const rnaArcContainer       = document.getElementById('rna-arc-container');
const rnaGalleryGrid        = document.getElementById('rna-gallery-grid');
const rnaTreeSection        = document.getElementById('rna-tree-section');
const rnaTreeCanvas         = document.getElementById('rna-tree-canvas');
const rnaQuickBtns          = document.querySelectorAll('.rna-quick-btn');

const sampleBtns            = document.querySelectorAll('.sample-btn[data-sample]');
const malformedToggle       = document.getElementById('btn-malformed-toggle');
const malformedMenu         = document.getElementById('malformed-menu');
const malformedItems        = document.querySelectorAll('.dropdown button[data-malformed]');
const tabVisual             = document.getElementById('tab-visual');
const tabSimplify           = document.getElementById('tab-simplify');
const tabJson               = document.getElementById('tab-json');
const viewVisual            = document.getElementById('view-visual');
const viewSimplify          = document.getElementById('view-simplify');
const viewJson              = document.getElementById('view-json');
const statusText            = document.getElementById('status-text');
const errorSection          = document.getElementById('error-section');
const errorsContainer       = document.getElementById('errors-container');
const outputContent         = document.getElementById('output-content');
const statStart             = document.getElementById('stat-start-symbol');
const statNt                = document.getElementById('stat-nt-count');
const statT                 = document.getElementById('stat-t-count');
const statP                 = document.getElementById('stat-prod-count');
const ntDisplay             = document.getElementById('nt-set-display');
const tDisplay              = document.getElementById('t-set-display');
const tableBody             = document.getElementById('productions-table-body');
const jsonOutput            = document.getElementById('json-output');
const btnCopyJson           = document.getElementById('btn-copy-json');
const simplificationContainer = document.getElementById('simplification-container');

let currentResult = null;
let treesState = { trees: [], page: 0 };

function countLines() {
  const n = editor.value.split('\n').length;
  lineCounter.textContent = `${n} line${n !== 1 ? 's' : ''}`;
}

function setActiveSample(key) {
  sampleBtns.forEach(b => b.classList.toggle('active', b.dataset.sample === key));
}

function switchTab(tab) {
  tabVisual.classList.toggle('active', tab === 'visual');
  tabSimplify.classList.toggle('active', tab === 'simplify');
  tabCnf.classList.toggle('active', tab === 'cnf');
  tabTrees.classList.toggle('active', tab === 'trees');
  tabResolve.classList.toggle('active', tab === 'resolve');
  tabRna.classList.toggle('active', tab === 'rna');
  tabJson.classList.toggle('active', tab === 'json');

  viewVisual.className   = 'view' + (tab === 'visual' ? ' active' : ' hidden');
  viewSimplify.className = 'view' + (tab === 'simplify' ? ' active' : ' hidden');
  viewCnf.className      = 'view' + (tab === 'cnf' ? ' active' : ' hidden');
  viewTrees.className    = 'view' + (tab === 'trees' ? ' active' : ' hidden');
  viewResolve.className  = 'view' + (tab === 'resolve' ? ' active' : ' hidden');
  viewRna.className      = 'view' + (tab === 'rna' ? ' active' : ' hidden');
  viewJson.className     = 'view' + (tab === 'json' ? ' active' : ' hidden');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderCnf(cnfData) {
  if (!cnfData) {
    cnfContainer.innerHTML = '<p class="dim">No CNF data available.</p>';
    return;
  }

  const { original, step1, step2, final, formattedFinal, trace = [], isCNF: cnfStatus } = cnfData;
  const isValid = Boolean(cnfStatus && (cnfStatus.valid ?? cnfStatus.isCNF));

  const step1NTs = (step1?.trace || []).map(t => t.name);
  const step2NTs = (step2?.trace || []).map(t => t.name);

  const step1NTStr = step1NTs.length > 0 ? step1NTs.join(', ') : 'None';
  const step2NTStr = step2NTs.length > 0 ? step2NTs.join(', ') : 'None';

  let traceRowsHtml = '';
  if (trace.length > 0) {
    traceRowsHtml = `
      <table class="trace-table">
        <thead>
          <tr>
            <th style="width: 70px;">Symbol</th>
            <th style="width: 170px;">Source Rule</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${trace.map(item => `
            <tr>
              <td class="nt-cell">${esc(item.name)}</td>
              <td class="mono" style="color: var(--text);">${esc(item.production)}</td>
              <td style="color: var(--muted);">${esc(item.reason)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    traceRowsHtml = '<p class="dim" style="padding: 0.25rem 0;">No new non-terminals introduced (grammar was already in CNF).</p>';
  }

  let offendingHtml = '';
  if (!isValid && cnfStatus?.offending?.length) {
    offendingHtml = `
      <div class="step-detail-row">
        <span class="step-detail-label">Violations:</span>
        <span class="step-detail-val err">${esc(cnfStatus.offending.map(o => o.production || `${o.lhs} -> ${o.rhs.join(' ')}`).join(', '))}</span>
      </div>
    `;
  }

  cnfContainer.innerHTML = `
    <div class="pipeline-breadcrumb">
      Simplified &nbsp;→&nbsp; <strong>1. Replace terminals</strong> &nbsp;→&nbsp; <strong>2. Binarize productions</strong> &nbsp;→&nbsp; <strong>Final CNF grammar</strong>
    </div>

    <!-- Step 1: Replace terminals -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-title-group">
          <span class="step-badge">Step 1</span>
          <span class="step-title-text">Step 1: Replace terminals</span>
        </div>
        <span class="step-desc">A → aB becomes A → X_a B and X_a → a (length ≥ 2)</span>
      </div>

      <div class="step-details-box">
        <div class="step-detail-row">
          <span class="step-detail-label">Introduced non-terminals:</span>
          <span class="step-detail-val ${step1NTs.length > 0 ? 'highlight' : ''}">${esc(step1NTStr)}</span>
        </div>
      </div>

      <div class="step-grammar-box">${esc(step1?.formatted || '(No changes)')}</div>
    </div>

    <!-- Step 2: Binarize productions -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-title-group">
          <span class="step-badge">Step 2</span>
          <span class="step-title-text">Step 2: Binarize productions</span>
        </div>
        <span class="step-desc">Break A → BCD into A → B Y1, Y1 → CD (length &gt; 2)</span>
      </div>

      <div class="step-details-box">
        <div class="step-detail-row">
          <span class="step-detail-label">Introduced non-terminals:</span>
          <span class="step-detail-val ${step2NTs.length > 0 ? 'highlight' : ''}">${esc(step2NTStr)}</span>
        </div>
      </div>

      <div class="step-grammar-box">${esc(step2?.formatted || '(No changes)')}</div>
    </div>

    <!-- Final CNF grammar -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-title-group">
          <span class="step-badge">Final</span>
          <span class="step-title-text">Final CNF grammar</span>
        </div>
        <span class="step-desc">All productions are A → BC or A → a (or S → ε)</span>
      </div>

      <div class="step-details-box">
        <div class="step-detail-row">
          <span class="step-detail-label">CNF Status:</span>
          <span class="step-detail-val ${isValid ? 'ok' : 'err'}">${isValid ? 'Valid CNF' : 'Not in CNF'}</span>
        </div>
        ${offendingHtml}
      </div>

      <div class="step-grammar-box">${esc(formattedFinal || '(Empty grammar)')}</div>
    </div>

    <!-- Trace table of introduced non-terminals -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-title-group">
          <span class="step-badge">Trace</span>
          <span class="step-title-text">Introduced Non-Terminals</span>
        </div>
        <span class="step-desc">Every newly introduced non-terminal and why</span>
      </div>

      ${traceRowsHtml}
    </div>
  `;
}

// ─── Trees Tab ──────────────────────────────────────────────────────────────

function showTreePage(page) {
  const { trees, truncated, parseCount } = treesState;
  if (!trees || trees.length === 0) return;

  treesState.page = Math.max(0, Math.min(page, trees.length - 1));
  const idx = treesState.page;

  treesCanvas.innerHTML = '';
  const tree = trees[idx];
  const svgStr = renderTree(tree);
  const wrap = document.createElement('div');
  wrap.className = 'tree-svg-wrap';
  wrap.innerHTML = svgStr;

  // Grouping hint for ambiguous grammars
  const grouping = deriveGrouping(tree);
  if (grouping && trees.length > 1) {
    const hint = document.createElement('div');
    hint.className = 'tree-grouping-hint';
    hint.textContent = grouping;
    wrap.appendChild(hint);
  }
  treesCanvas.appendChild(wrap);

  if (trees.length > 1) {
    treesNav.classList.remove('hidden');
    const countStr = truncated ? `at least ${parseCount}` : String(parseCount);
    treesPageLabel.textContent = `Tree ${idx + 1} of ${trees.length} shown (${countStr} total)`;
    btnTreesPrev.disabled = idx === 0;
    btnTreesNext.disabled = idx === trees.length - 1;
  } else {
    treesNav.classList.add('hidden');
  }
}

async function runTrees() {
  const str = treesInput.value.trim();
  if (!str) return;
  if (!currentResult?.success) {
    treesVerdict.textContent = 'Parse the grammar first.';
    treesVerdict.className = 'trees-verdict err';
    return;
  }

  treesVerdict.textContent = 'Running…';
  treesVerdict.className = 'trees-verdict dim';
  treesNav.classList.add('hidden');
  treesCanvas.innerHTML = '';

  try {
    const res = await fetch('/api/cyk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grammarText: editor.value,
        inputString: str,
        options: { strictNonTerminals: chkStrict.checked }
      })
    });
    const data = await res.json();

    // Grammar error
    if (!data.success && data.errors) {
      treesVerdict.textContent = `Grammar error: ${data.errors.map(e => e.message).join('; ')}`;
      treesVerdict.className = 'trees-verdict err';
      return;
    }

    // Unknown symbol
    if (data.error) {
      treesVerdict.textContent = data.error;
      treesVerdict.className = 'trees-verdict err';
      return;
    }

    const { accepted, ambiguity } = data;

    if (!accepted) {
      treesVerdict.textContent = 'Rejected: no parse tree';
      treesVerdict.className = 'trees-verdict dim';
      treesCanvas.innerHTML = '';
      return;
    }

    const { parseCount, ambiguous, truncated, trees } = ambiguity;
    treesState = { trees: trees || [], page: 0, truncated, parseCount };

    const countStr = truncated ? `at least ${parseCount}` : String(parseCount);
    if (parseCount === 1 || parseCount === 1n) {
      treesVerdict.textContent = 'Accepted: 1 parse tree, unambiguous for this string';
    } else if (ambiguous) {
      treesVerdict.textContent = `Accepted: ${countStr} parse trees, ambiguous for this string${truncated ? ' (only first few shown)' : ''}`;
    } else {
      treesVerdict.textContent = `Accepted: ${countStr} parse tree${parseCount === 1 ? '' : 's'}, unambiguous for this string`;
    }
    treesVerdict.className = 'trees-verdict ok';

    showTreePage(0);
  } catch (err) {
    treesVerdict.textContent = `Error: ${err.message}`;
    treesVerdict.className = 'trees-verdict err';
  }
}

// ─── Resolve Tab (Ambiguity Resolution Demo) ────────────────────────────────

const RESOLVE_PRESETS = {
  arithmetic: {
    grammarA: `E -> E+E | E*E | id`,
    grammarB: `E -> E+T | T\nT -> T*F | F\nF -> (E) | id`,
    note: `Note: Grammar B also accepts parentheses; default test strings stay inside the language both accept (no parentheses).`,
    strings: `id+id*id\nid*id+id\nid+id+id\nid`,
    explanation: `Grammar B enforces precedence by layering: E handles +, T handles *, F handles atoms, so * always binds tighter than +, and left recursion makes both operators left-associative.`
  },
  linear: {
    grammarA: `S -> aS | Sa | a`,
    grammarB: `S -> aS | a`,
    note: `Note: Linear grammar exhibiting shift/reduce and left-right branching ambiguities on repetitive tokens.`,
    strings: `a\naa\naaa`,
    explanation: `Grammar B eliminates ambiguity by restricting recursion to the right (aS), resolving the branching conflict between aS and Sa.`
  },
  dangling: {
    grammarA: `S -> if c then S else S | if c then S | s`,
    grammarB: `S -> M | U\nM -> if c then M else M | s\nU -> if c then S | if c then M else U`,
    note: `Note: Classic dangling-else ambiguity where nested 'if' has fewer 'else' clauses than conditionals.`,
    strings: `if c then if c then s else s\nif c then s\nif c then s else s`,
    explanation: `Grammar B resolves the dangling-else ambiguity by pairing each 'else' with the closest open 'then' using matched (M) and unmatched (U) statements.`
  }
};

let activeResolvePreset = 'arithmetic';
let resolveState = {
  rows: [],
  selectedRowIdx: 0,
  pageA: 0
};

function applyResolvePreset(presetKey) {
  const p = RESOLVE_PRESETS[presetKey];
  if (!p) return;
  activeResolvePreset = presetKey;
  resolvePresetBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === presetKey);
  });
  resolveGrammarA.value = p.grammarA;
  resolveGrammarB.value = p.grammarB;
  resolveStrings.value = p.strings;
  resolveNote.textContent = p.note;
  resolveExplanation.textContent = p.explanation;
}

function showResolvePageA(page) {
  const row = resolveState.rows[resolveState.selectedRowIdx];
  if (!row || !row.a.trees || row.a.trees.length === 0) return;

  const totalTrees = row.a.trees.length;
  const maxPage = Math.max(0, Math.ceil(totalTrees / 2) - 1);
  resolveState.pageA = Math.max(0, Math.min(page, maxPage));
  const startIdx = resolveState.pageA * 2;
  const slice = row.a.trees.slice(startIdx, startIdx + 2);

  resolveCanvasA.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'resolve-trees-paired';

  slice.forEach((tree, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'tree-svg-wrap';
    const treeNum = startIdx + idx + 1;
    wrap.innerHTML = `<div class="tree-grouping-hint" style="font-weight:600;">Tree ${treeNum} of ${totalTrees}</div>` +
      renderTree(tree) +
      `<div class="resolve-tree-bracket mono">${esc(treeToBracket(tree))}</div>`;
    const grouping = deriveGrouping(tree);
    if (grouping) {
      const hint = document.createElement('div');
      hint.className = 'tree-grouping-hint';
      hint.textContent = `Grouping: ${grouping}`;
      wrap.appendChild(hint);
    }
    container.appendChild(wrap);
  });

  resolveCanvasA.appendChild(container);

  if (totalTrees > 2) {
    resolveNavA.classList.remove('hidden');
    resolvePageLabelA.textContent = `Trees ${startIdx + 1}–${Math.min(startIdx + 2, totalTrees)} of ${totalTrees}`;
    btnResolvePrevA.disabled = resolveState.pageA === 0;
    btnResolveNextA.disabled = resolveState.pageA >= maxPage;
  } else {
    resolveNavA.classList.add('hidden');
  }
}

function renderResolveRowTrees(idx) {
  resolveState.selectedRowIdx = idx;
  resolveState.pageA = 0;
  const row = resolveState.rows[idx];
  if (!row) return;

  // Highlight selected row in table
  const trs = resolveTableBody.querySelectorAll('tr');
  trs.forEach((tr, i) => tr.classList.toggle('selected', i === idx));

  resolveTreesContainer.classList.remove('hidden');
  resolveSelectedString.textContent = `"${row.string}"`;

  // Render Grammar A trees
  if (row.a.error) {
    resolveCanvasA.innerHTML = `<div class="trees-verdict err">Error: ${esc(row.a.error)}</div>`;
    resolveNavA.classList.add('hidden');
  } else if (!row.a.accepted) {
    resolveCanvasA.innerHTML = '<div class="trees-verdict dim">Rejected: no parse tree</div>';
    resolveNavA.classList.add('hidden');
  } else if (row.a.trees && row.a.trees.length > 0) {
    showResolvePageA(0);
  } else {
    resolveCanvasA.innerHTML = '<div class="trees-verdict dim">No parse trees reconstructed</div>';
    resolveNavA.classList.add('hidden');
  }

  // Render Grammar B trees
  if (row.b.error) {
    resolveCanvasB.innerHTML = `<div class="trees-verdict err">Error: ${esc(row.b.error)}</div>`;
  } else if (!row.b.accepted) {
    resolveCanvasB.innerHTML = '<div class="trees-verdict dim">Rejected: no parse tree</div>';
  } else if (row.b.trees && row.b.trees.length > 0) {
    const tree = row.b.trees[0];
    const wrap = document.createElement('div');
    wrap.className = 'tree-svg-wrap';
    wrap.innerHTML = `<div class="tree-grouping-hint" style="font-weight:600;">Unique Parse Tree (1 of 1)</div>` +
      renderTree(tree) +
      `<div class="resolve-tree-bracket mono">${esc(treeToBracket(tree))}</div>`;
    const grouping = deriveGrouping(tree);
    if (grouping) {
      const hint = document.createElement('div');
      hint.className = 'tree-grouping-hint';
      hint.textContent = `Grouping: ${grouping}`;
      wrap.appendChild(hint);
    }
    resolveCanvasB.innerHTML = '';
    resolveCanvasB.appendChild(wrap);
  } else {
    resolveCanvasB.innerHTML = '<div class="trees-verdict dim">No parse trees reconstructed</div>';
  }
}

async function runResolve() {
  const gA = resolveGrammarA.value.trim();
  const gB = resolveGrammarB.value.trim();
  const rawStrings = resolveStrings.value.split('\n').map(s => s.trim()).filter(Boolean);

  if (!gA || !gB) {
    resolveErrorBlock.classList.remove('hidden');
    resolveErrorMsg.textContent = 'Please provide both Grammar A and Grammar B.';
    resolveStatus.textContent = 'Error';
    resolveStatus.className = 'status err';
    return;
  }

  if (rawStrings.length === 0) {
    resolveErrorBlock.classList.remove('hidden');
    resolveErrorMsg.textContent = 'Please provide at least one test string.';
    resolveStatus.textContent = 'Error';
    resolveStatus.className = 'status err';
    return;
  }

  resolveStatus.textContent = 'Comparing…';
  resolveStatus.className = 'status dim';
  resolveErrorBlock.classList.add('hidden');

  try {
    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grammarA: gA,
        grammarB: gB,
        inputStrings: rawStrings,
        options: { strictNonTerminals: chkStrict.checked }
      })
    });
    const data = await res.json();

    if (!data.success) {
      resolveStatus.textContent = 'Error';
      resolveStatus.className = 'status err';
      resolveErrorBlock.classList.remove('hidden');
      resolveErrorMsg.textContent = data.error || 'Comparison failed';
      return;
    }

    resolveStatus.textContent = 'Done';
    resolveStatus.className = 'status ok';
    resolveResults.classList.remove('hidden');

    resolveState.rows = data.rows || [];
    const rows = resolveState.rows;

    // Render Table
    resolveTableBody.innerHTML = '';
    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'clickable';

      const formatSide = (side) => {
        if (side.error) return `<span class="err">Error: ${esc(side.error)}</span>`;
        if (!side.accepted) return '<span class="dim">rejected</span>';
        const pCount = side.parseCount;
        const pWord = pCount === 1 ? '1 parse' : `${pCount} parses`;
        if (side.ambiguous) return `${pWord}, ambiguous`;
        return `${pWord}, unambiguous`;
      };

      const isResolved = row.a.ambiguous && !row.b.ambiguous && row.b.accepted;
      const markerText = isResolved ? '<span class="resolve-marker">* resolved</span>' : '';

      tr.innerHTML = `
        <td class="mono"><strong>${esc(row.string)}</strong></td>
        <td>${formatSide(row.a)}</td>
        <td>${formatSide(row.b)}${markerText}</td>
      `;

      tr.addEventListener('click', () => renderResolveRowTrees(idx));
      resolveTableBody.appendChild(tr);
    });

    // Render Summary Line
    const ambCountA = rows.filter(r => r.a.ambiguous).length;
    const unambCountB = rows.filter(r => !r.b.ambiguous && r.b.accepted).length;
    const total = rows.length;

    let eqNote = '';
    if (data.equivalence) {
      if (data.equivalence.allMatch) {
        eqNote = 'and gives the same accept/reject result on every tested string.';
      } else {
        eqNote = `and gives the same accept/reject result on ${data.equivalence.matchingVerdicts} of ${data.equivalence.testedStrings} tested strings.`;
      }
    }

    const bWord = unambCountB === total ? `all ${total}` : `${unambCountB} of ${total}`;
    resolveSummary.innerHTML = `Grammar A is ambiguous on ${ambCountA} of ${total} test string${total === 1 ? '' : 's'}. Grammar B is unambiguous on ${bWord} ${eqNote}<br><span class="dim" style="font-size: 11.5px;">Note: This checks only the tested strings; this is not a mathematical proof of language equivalence.</span>`;

    const preset = RESOLVE_PRESETS[activeResolvePreset];
    resolveExplanation.textContent = preset ? preset.explanation : '';

    // Auto-select row 0
    if (rows.length > 0) {
      renderResolveRowTrees(0);
    }

  } catch (err) {
    resolveStatus.textContent = 'Error';
    resolveStatus.className = 'status err';
    resolveErrorBlock.classList.remove('hidden');
    resolveErrorMsg.textContent = `Network or server error: ${err.message}`;
  }
}

// ─── RNA Tab (Secondary RNA Folding Analysis) ───────────────────────────────

let rnaState = {
  sequence: '',
  folds: [],
  selectedFoldIdx: 0
};
let rnaRequest = null;

function renderArcDiagram(sequence, pairs = [], isMini = false) {
  if (!sequence) return '';
  const n = sequence.length;
  const r = isMini ? 6 : 14;
  const spacing = isMini ? 22 : 46;
  const padX = isMini ? 12 : 24;
  const padY = isMini ? 8 : 16;
  const fontSize = isMini ? 8 : 13;
  const strokeW = isMini ? 1.2 : 1.8;

  let maxSpan = 0;
  for (const [i, j] of pairs) {
    const span = Math.abs(j - i);
    if (span > maxSpan) maxSpan = span;
  }

  const maxArcHeight = maxSpan > 0 ? (maxSpan * spacing) / 2 : (isMini ? 15 : 30);
  const baselineY = padY + maxArcHeight + 8;
  const totalW = Math.max(isMini ? 100 : 200, padX * 2 + (n - 1) * spacing);
  const totalH = baselineY + r + padY;

  // Arc paths
  const arcs = pairs.map(([i, j]) => {
    const x1 = padX + i * spacing;
    const x2 = padX + j * spacing;
    const arcR = (x2 - x1) / 2;
    return `<path class="rna-arc-path" d="M ${x1.toFixed(1)},${baselineY.toFixed(1)} A ${arcR.toFixed(1)},${arcR.toFixed(1)} 0 0,1 ${x2.toFixed(1)},${baselineY.toFixed(1)}" fill="none" stroke="#777" stroke-width="${strokeW}" stroke-linecap="round" />`;
  }).join('\n    ');

  // Baseline line
  const baseline = `<line x1="${padX}" y1="${baselineY.toFixed(1)}" x2="${(padX + (n - 1) * spacing).toFixed(1)}" y2="${baselineY.toFixed(1)}" stroke="#ddd" stroke-width="${isMini ? 1 : 1.5}" />`;

  // Base circles
  const circles = Array.from(sequence).map((base, idx) => {
    const cx = padX + idx * spacing;
    const cy = baselineY;
    const bLower = base.toLowerCase();
    const bUpper = base.toUpperCase();
    return `<g class="rna-base-group" data-base-idx="${idx}">
      <circle class="rna-base-circle rna-base-${bLower}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" stroke-width="${isMini ? 1 : 1.5}" />
      <text class="rna-base-text rna-base-${bLower}-text" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="'JetBrains Mono', monospace" font-size="${fontSize}" font-weight="600">${bUpper}</text>
    </g>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(sequence)}: ${pairs.length} base pairs" viewBox="0 0 ${totalW.toFixed(1)} ${totalH.toFixed(1)}" width="${totalW.toFixed(1)}" height="${totalH.toFixed(1)}" style="display:block; margin:0 auto; max-width:100%; height:auto;">
    ${baseline}
    <g class="rna-arcs">${arcs}</g>
    <g class="rna-bases">${circles}</g>
  </svg>`;
}

function selectRnaFold(idx) {
  if (!rnaState.folds || !rnaState.folds[idx]) return;
  rnaState.selectedFoldIdx = idx;
  const fold = rnaState.folds[idx];

  // Highlight selected card in gallery
  const cards = rnaGalleryGrid.querySelectorAll('.rna-gallery-card');
  cards.forEach((c, i) => {
    c.classList.toggle('selected', i === idx);
    c.setAttribute('aria-pressed', String(i === idx));
  });

  // Redraw large arc diagram
  rnaArcContainer.innerHTML = renderArcDiagram(rnaState.sequence, fold.pairs, false);
  document.getElementById('rna-selected-bracket').textContent = fold.dotBracket;

  // Render tree for selected fold with leaf ranges
  if (fold.tree) {
    rnaTreeCanvas.innerHTML = renderTree(fold.tree, { includeLeafRange: true });

    // Interactive subtree hover & click
    const nodeTexts = rnaTreeCanvas.querySelectorAll('.tree-nodes text[data-leaf-start]');
    let pinned = null;
    const highlight = node => {
        const s = node ? Number(node.dataset.leafStart) : -1;
        const e = node ? Number(node.dataset.leafEnd) : -1;
        const groups = rnaArcContainer.querySelectorAll('.rna-base-group');
        groups.forEach(g => {
          const bIdx = parseInt(g.dataset.baseIdx, 10);
          g.classList.toggle('highlighted', bIdx >= s && bIdx <= e);
        });
    };
    nodeTexts.forEach(el => {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', 'false');
      el.setAttribute('aria-label', `${el.textContent}: bases ${Number(el.dataset.leafStart) + 1} to ${Number(el.dataset.leafEnd) + 1}`);
      const toggle = () => {
        pinned = pinned === el ? null : el;
        nodeTexts.forEach(node => node.setAttribute('aria-pressed', String(node === pinned)));
        highlight(pinned);
      };
      el.addEventListener('mouseenter', () => highlight(el));
      el.addEventListener('mouseleave', () => highlight(pinned));
      el.addEventListener('focus', () => highlight(el));
      el.addEventListener('blur', () => highlight(pinned));
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
        if (event.key === 'Escape') { pinned = null; nodeTexts.forEach(node => node.setAttribute('aria-pressed', 'false')); highlight(null); }
      });
    });
  } else {
    rnaTreeCanvas.innerHTML = '<div class="trees-verdict dim">No parse tree available</div>';
  }
}

async function runRNA() {
  rnaRequest?.abort();
  const request = new AbortController();
  rnaRequest = request;
  const rawSeq = rnaInput.value.trim();
  const preset = rnaPreset.value;

  if (!rawSeq) {
    rnaVerdict.textContent = 'Please enter an RNA sequence.';
    rnaVerdict.className = 'rna-verdict err';
    rnaOutputContainer.classList.add('hidden');
    return;
  }

  rnaVerdict.textContent = 'Folding…';
  rnaVerdict.className = 'rna-verdict dim';
  rnaOutputContainer.classList.add('hidden');

  try {
    const res = await fetch('/api/rna', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: request.signal,
      body: JSON.stringify({ sequence: rawSeq, preset })
    });
    let data;
    try { data = await res.json(); }
    catch { throw new Error(`Server returned an invalid response (HTTP ${res.status}). Please try again.`); }
    if (!res.ok) throw new Error(data.error || `Server error (HTTP ${res.status}). Please try again.`);
    if (request !== rnaRequest) return;

    if (!data.success && data.error) {
      rnaVerdict.textContent = data.error;
      rnaVerdict.className = 'rna-verdict err';
      rnaOutputContainer.classList.add('hidden');
      return;
    }

    if (!data.accepted) {
      rnaVerdict.textContent = 'Rejected: this sequence cannot form this structure';
      rnaVerdict.className = 'rna-verdict dim';
      rnaOutputContainer.classList.add('hidden');
      return;
    }

    const { parseCount, distinctFoldCount, truncated, enumeratedTrees, folds } = data;
    rnaState = {
      sequence: rawSeq.toUpperCase().replace(/\s+/g, ''),
      folds: folds || [],
      selectedFoldIdx: 0
    };

    if (truncated) {
      rnaVerdict.textContent = `Accepted: ${parseCount} parse trees, at least ${distinctFoldCount} distinct folds among the first ${enumeratedTrees} trees`;
    } else {
      rnaVerdict.textContent = `Accepted: ${parseCount} parse tree${parseCount === '1' ? '' : 's'}, ${distinctFoldCount} distinct fold${distinctFoldCount === 1 ? '' : 's'}`;
    }
    rnaVerdict.className = 'rna-verdict ok';

    // Render Fold Gallery (up to 6)
    rnaGalleryGrid.innerHTML = '';
    const gallerySlice = rnaState.folds.slice(0, 6);
    gallerySlice.forEach((f, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.setAttribute('aria-label', `Select fold ${f.dotBracket}`);
      card.className = 'rna-gallery-card' + (idx === 0 ? ' selected' : '');
      const miniSvg = renderArcDiagram(rnaState.sequence, f.pairs, true);
      card.innerHTML = `
        ${miniSvg}
        <div class="rna-card-bracket">${esc(f.dotBracket)}</div>
      `;
      card.addEventListener('click', () => selectRnaFold(idx));
      rnaGalleryGrid.appendChild(card);
    });

    rnaOutputContainer.classList.remove('hidden');

    // Select first fold
    selectRnaFold(0);

  } catch (err) {
    if (err.name === 'AbortError' || request !== rnaRequest) return;
    rnaVerdict.textContent = `Error: ${err.message}`;
    rnaVerdict.className = 'rna-verdict err';
    rnaOutputContainer.classList.add('hidden');
  }
}

function renderSimplification(simp) {
  if (!simp) {
    simplificationContainer.innerHTML = '<p class="dim">No simplification data available.</p>';
    return;
  }

  const { step1, step2, step3 } = simp;

  const nonGenStr = step1.details.nonGeneratingNT.length > 0 ? step1.details.nonGeneratingNT.join(', ') : 'None';
  const unreachNTStr = step1.details.unreachableNT.length > 0 ? step1.details.unreachableNT.join(', ') : 'None';
  const unreachTStr = step1.details.unreachableT.length > 0 ? step1.details.unreachableT.join(', ') : 'None';

  const nullNTStr = step2.details.nullableNT.length > 0 ? step2.details.nullableNT.join(', ') : 'None (no ε-productions)';
  const startEpsStr = step2.details.addedStartEps ? 'Yes (added S0 -> S | ε)' : 'No';

  let unitPairsStr = '';
  for (const [nt, targets] of Object.entries(step3.details.unitPairs || {})) {
    unitPairsStr += `UNIT(${esc(nt)}) = { ${esc(targets.join(', '))} } &nbsp;&nbsp; `;
  }
  const eliminatedUnitsStr = step3.details.eliminatedUnits.length > 0
    ? step3.details.eliminatedUnits.map(u => `${esc(u.from)} → ${esc(u.to)}`).join(', ')
    : 'None';

  simplificationContainer.innerHTML = `
    <div class="pipeline-breadcrumb">
      Original &nbsp;→&nbsp; <strong>1. Useless Symbol Removal</strong> &nbsp;→&nbsp; <strong>2. Epsilon Removal</strong> &nbsp;→&nbsp; <strong>3. Unit Removal</strong>
    </div>

    <!-- Step 1: Remove Useless Symbols -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-title-group">
          <span class="step-badge">Step 1</span>
          <span class="step-title-text">Remove Useless Symbols</span>
        </div>
        <span class="step-desc">Non-generating &amp; unreachable symbols</span>
      </div>

      <div class="step-details-box">
        <div class="step-detail-row">
          <span class="step-detail-label">Non-Generating (V<sub>N</sub>):</span>
          <span class="step-detail-val ${step1.details.nonGeneratingNT.length > 0 ? 'highlight' : ''}">${esc(nonGenStr)}</span>
        </div>
        <div class="step-detail-row">
          <span class="step-detail-label">Unreachable (V<sub>N</sub>):</span>
          <span class="step-detail-val ${step1.details.unreachableNT.length > 0 ? 'highlight' : ''}">${esc(unreachNTStr)}</span>
        </div>
        <div class="step-detail-row">
          <span class="step-detail-label">Unreachable (V<sub>T</sub>):</span>
          <span class="step-detail-val">${esc(unreachTStr)}</span>
        </div>
      </div>

      <div class="step-grammar-box">${esc(step1.formatted || '(Empty language)')}</div>
    </div>

    <!-- Step 2: Eliminate Epsilon Productions -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-title-group">
          <span class="step-badge">Step 2</span>
          <span class="step-title-text">Eliminate ε-Productions</span>
        </div>
        <span class="step-desc">Substitute nullable non-terminals</span>
      </div>

      <div class="step-details-box">
        <div class="step-detail-row">
          <span class="step-detail-label">Nullable Symbols (A ⇒* ε):</span>
          <span class="step-detail-val ${step2.details.nullableNT.length > 0 ? 'highlight' : ''}">${esc(nullNTStr)}</span>
        </div>
        <div class="step-detail-row">
          <span class="step-detail-label">Preserved Start ε:</span>
          <span class="step-detail-val">${esc(startEpsStr)}</span>
        </div>
      </div>

      <div class="step-grammar-box">${esc(step2.formatted || '(Empty grammar)')}</div>
    </div>

    <!-- Step 3: Eliminate Unit Productions -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-title-group">
          <span class="step-badge">Step 3</span>
          <span class="step-title-text">Eliminate Unit Productions</span>
        </div>
        <span class="step-desc">Collapse A → B → C chains into direct rules</span>
      </div>

      <div class="step-details-box">
        <div class="step-detail-row">
          <span class="step-detail-label">Unit Closures:</span>
          <span class="step-detail-val">${unitPairsStr || 'None'}</span>
        </div>
        <div class="step-detail-row">
          <span class="step-detail-label">Eliminated Unit Rules:</span>
          <span class="step-detail-val ${step3.details.eliminatedUnits.length > 0 ? 'highlight' : ''}">${eliminatedUnitsStr}</span>
        </div>
      </div>

      <div class="step-grammar-box">${esc(step3.formatted || '(Empty grammar)')}</div>
    </div>
  `;
}

function renderResults(result) {
  currentResult = result;

  if (result.success) {
    const g = result.grammar;
    const totalAlts = Object.values(g.productions).reduce((s, a) => s + a.length, 0);

    statusText.textContent = 'Valid';
    statusText.className = 'status ok';

    errorSection.classList.add('hidden');
    outputContent.style.display = '';

    statStart.textContent = g.startSymbol || '—';
    statNt.textContent    = g.nonTerminals.length;
    statT.textContent     = g.terminals.length;
    statP.textContent     = totalAlts;

    ntDisplay.textContent = g.nonTerminals.length ? `{ ${g.nonTerminals.join(', ')} }` : '∅';
    tDisplay.textContent  = g.terminals.length    ? `{ ${g.terminals.join(', ')} }`    : '∅';

    tableBody.innerHTML = '';
    for (const nt of g.nonTerminals) {
      const alts = g.productions[nt] || [];
      const tr = document.createElement('tr');

      const body = alts.map(alt =>
        alt.map(sym => {
          if (g.nonTerminals.includes(sym)) return `<strong>${esc(sym)}</strong>`;
          if (sym === 'ε') return `<span class="eps">ε</span>`;
          return `<span class="t">${esc(sym)}</span>`;
        }).join(' ')
      ).join('<span class="pipe">|</span>');

      tr.innerHTML = `
        <td class="nt-cell">${esc(nt)}</td>
        <td class="arrow-cell">→</td>
        <td class="body-cell">${body}</td>`;
      tableBody.appendChild(tr);
    }

    // Render Simplification
    renderSimplification(result.simplification);

    // Render CNF
    if (result.cnf) {
      renderCnf(result.cnf);
    }

    jsonOutput.querySelector('code').textContent = JSON.stringify(g, null, 2);

  } else {
    const n = result.errors.length;
    statusText.textContent = `${n} error${n !== 1 ? 's' : ''}`;
    statusText.className = 'status err';

    errorSection.classList.remove('hidden');
    outputContent.style.display = 'none';

    errorsContainer.innerHTML = result.errors.map(e => `
      <div class="error-item">
        <span>[line ${e.line}] ${esc(e.message)}</span>
        ${e.snippet ? `<div><code class="error-snippet">${esc(e.snippet)}</code></div>` : ''}
      </div>`).join('');
  }
}

async function parse() {
  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grammarText: editor.value, options: { strictNonTerminals: chkStrict.checked } })
    });
    renderResults(await res.json());
  } catch (err) {
    console.error(err);
  }
}

// Wire up events
editor.addEventListener('input', countLines);
editor.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); parse(); }
});
btnParse.addEventListener('click', parse);
btnClear.addEventListener('click', () => { editor.value = ''; countLines(); parse(); });
chkStrict.addEventListener('change', parse);

sampleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sample;
    editor.value = SAMPLES[key] || '';
    countLines();
    setActiveSample(key);
    parse();
  });
});

malformedToggle.addEventListener('click', e => { e.stopPropagation(); malformedMenu.classList.toggle('hidden'); });
document.addEventListener('click', () => malformedMenu.classList.add('hidden'));
malformedItems.forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    const tc = MALFORMED[parseInt(item.dataset.malformed, 10)];
    if (tc) {
      editor.value = tc.text;
      chkStrict.checked = tc.strict;
      countLines();
      sampleBtns.forEach(b => b.classList.remove('active'));
      malformedMenu.classList.add('hidden');
      parse();
    }
  });
});

tabVisual.addEventListener('click', () => switchTab('visual'));
tabSimplify.addEventListener('click', () => switchTab('simplify'));
tabCnf.addEventListener('click', () => switchTab('cnf'));
tabTrees.addEventListener('click', () => switchTab('trees'));
tabResolve.addEventListener('click', () => {
  switchTab('resolve');
  if (!resolveState.rows.length) runResolve();
});
tabJson.addEventListener('click', () => switchTab('json'));

btnShowTrees.addEventListener('click', runTrees);
treesInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runTrees(); } });
document.querySelectorAll('.trees-quick-btn').forEach(btn => {
  btn.addEventListener('click', () => { treesInput.value = btn.dataset.val; runTrees(); });
});
btnTreesPrev.addEventListener('click', () => showTreePage(treesState.page - 1));
btnTreesNext.addEventListener('click', () => showTreePage(treesState.page + 1));

// Resolve Tab Events
btnResolveCompare.addEventListener('click', runResolve);
btnResolvePrevA.addEventListener('click', () => showResolvePageA(resolveState.pageA - 1));
btnResolveNextA.addEventListener('click', () => showResolvePageA(resolveState.pageA + 1));
resolvePresetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    applyResolvePreset(btn.dataset.preset);
    runResolve();
  });
});

// RNA Tab Events
tabRna.addEventListener('click', () => {
  switchTab('rna');
  if (!rnaState.folds || !rnaState.folds.length) runRNA();
});
btnRnaFold.addEventListener('click', runRNA);
rnaInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runRNA();
  }
});
rnaPreset.addEventListener('change', runRNA);
rnaQuickBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    rnaInput.value = btn.dataset.seq;
    if (btn.dataset.preset) {
      rnaPreset.value = btn.dataset.preset;
    }
    runRNA();
  });
});

btnCopyJson.addEventListener('click', () => {
  if (currentResult?.grammar) {
    navigator.clipboard.writeText(JSON.stringify(currentResult.grammar, null, 2));
    btnCopyJson.textContent = 'copied';
    setTimeout(() => btnCopyJson.textContent = 'copy', 1500);
  }
});

// Boot
editor.value = SAMPLES.simplification;
countLines();
setActiveSample('simplification');
applyResolvePreset('arithmetic');
parse();
