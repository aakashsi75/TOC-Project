/**
 * Frontend logic — CFG Parser & Simplification
 */

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
  tabJson.classList.toggle('active', tab === 'json');

  viewVisual.className   = 'view' + (tab === 'visual' ? ' active' : ' hidden');
  viewSimplify.className = 'view' + (tab === 'simplify' ? ' active' : ' hidden');
  viewJson.className     = 'view' + (tab === 'json' ? ' active' : ' hidden');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
tabJson.addEventListener('click', () => switchTab('json'));

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
parse();
