/**
 * Pure SVG Parse Tree Renderer (Zero External Dependencies)
 * 
 * Layout Algorithm:
 * 1. Leaves are placed left-to-right with uniform horizontal spacing.
 * 2. Each parent node is horizontally centered directly above its children.
 * 3. Fixed vertical spacing per depth level with all leaves aligned at the bottom baseline.
 * 4. Clean straight lines connecting parents to children.
 * 5. Uses SVG viewBox for responsiveness and scales inside scrollable panels.
 */

function escapeXml(unsafe) {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Calculates tree dimensions and coordinates without generating SVG.
 * 
 * @param {Object} tree - Root node of the tree
 * @param {Object} [options={}] - Custom spacing options
 * @returns {{ width: number, height: number, leafCount: number, maxDepth: number, nodes: Array, lines: Array }}
 */
export function getTreeDimensions(tree, options = {}) {
  if (!tree) {
    return { width: 0, height: 0, leafCount: 0, maxDepth: 0, nodes: [], lines: [] };
  }

  const leafSpacing = options.leafSpacing || 65;
  const levelHeight = options.levelHeight || 55;
  const paddingX = options.paddingX || 40;
  const paddingY = options.paddingY || 30;

  // 1. Collect all leaves in left-to-right order
  const leaves = [];
  function collectLeaves(node) {
    if (node.terminal || !node.children || node.children.length === 0) {
      leaves.push(node);
    } else {
      for (const child of node.children) {
        collectLeaves(child);
      }
    }
  }
  collectLeaves(tree);

  const leafCount = leaves.length;

  // Assign x coordinates and leaf indices
  leaves.forEach((leaf, idx) => {
    leaf._x = paddingX + idx * leafSpacing;
    leaf._leafStart = idx;
    leaf._leafEnd = idx;
  });

  function computeLeafRanges(node) {
    if (node.terminal || !node.children || node.children.length === 0) {
      return { start: node._leafStart ?? 0, end: node._leafEnd ?? 0 };
    }
    let start = Infinity;
    let end = -Infinity;
    for (const child of node.children) {
      const r = computeLeafRanges(child);
      if (r.start < start) start = r.start;
      if (r.end > end) end = r.end;
    }
    node._leafStart = start;
    node._leafEnd = end;
    return { start, end };
  }
  computeLeafRanges(tree);

  // 2. Post-order traversal to compute x coordinates of non-terminals
  function computeX(node) {
    if (node.terminal || !node.children || node.children.length === 0) {
      return node._x;
    }
    for (const child of node.children) {
      computeX(child);
    }
    const firstChild = node.children[0];
    const lastChild = node.children[node.children.length - 1];
    node._x = (firstChild._x + lastChild._x) / 2;
    return node._x;
  }
  computeX(tree);

  // 3. Compute max depth of tree
  function computeMaxDepth(node) {
    if (node.terminal || !node.children || node.children.length === 0) {
      return 0;
    }
    return 1 + Math.max(...node.children.map(computeMaxDepth));
  }
  const maxDepth = computeMaxDepth(tree);

  // 4. Compute y coordinates for all nodes and collect lines
  const nodes = [];
  const lines = [];

  function assignY(node, depth, isRoot) {
    if (node.terminal || !node.children || node.children.length === 0) {
      // Terminal leaves align on the bottom baseline
      node._y = paddingY + maxDepth * levelHeight;
    } else {
      node._y = paddingY + depth * levelHeight;
    }

    nodes.push({
      symbol: node.symbol,
      x: node._x,
      y: node._y,
      terminal: Boolean(node.terminal),
      isRoot,
      leafStart: node._leafStart,
      leafEnd: node._leafEnd
    });

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        assignY(child, depth + 1, false);
        lines.push({
          x1: node._x,
          y1: node._y + 8,
          x2: child._x,
          y2: child._y - 12
        });
      }
    }
  }
  assignY(tree, 0, true);

  const width = Math.max(120, paddingX * 2 + Math.max(0, leafCount - 1) * leafSpacing);
  const height = Math.max(60, paddingY * 2 + maxDepth * levelHeight);

  return {
    width,
    height,
    leafCount,
    maxDepth,
    nodes,
    lines
  };
}

/**
 * Renders a parse tree as a standalone inline SVG string.
 * 
 * @param {Object} tree - Root node { symbol, children: [...] }
 * @param {Object} [options={}] - Custom options
 * @returns {string} SVG string
 */
export function renderTree(tree, options = {}) {
  if (!tree) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" width="100" height="40"></svg>`;
  }

  const { width, height, nodes, lines } = getTreeDimensions(tree, options);

  // Build connecting lines
  const linesMarkup = lines.map(line =>
    `<line x1="${line.x1.toFixed(1)}" y1="${line.y1.toFixed(1)}" x2="${line.x2.toFixed(1)}" y2="${line.y2.toFixed(1)}" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" />`
  ).join('\n    ');

  // Build text nodes
  const nodesMarkup = nodes.map(node => {
    const escapedSymbol = escapeXml(node.symbol);
    const rangeAttrs = options.includeLeafRange
      ? ` data-leaf-start="${node.leafStart}" data-leaf-end="${node.leafEnd}"`
      : '';
    if (node.terminal) {
      return `<text class="leaf-text" data-leaf="true"${rangeAttrs} x="${node.x.toFixed(1)}" y="${node.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="'JetBrains Mono', monospace" font-size="13" font-weight="500" fill="#475569" text-decoration="underline">${escapedSymbol}</text>`;
    }
    const color = node.isRoot ? '#2563eb' : '#0f172a';
    const weight = node.isRoot ? '600' : '500';
    return `<text class="nonterminal-node"${rangeAttrs} x="${node.x.toFixed(1)}" y="${node.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Inter, -apple-system, sans-serif" font-size="14" font-weight="${weight}" fill="${color}">${escapedSymbol}</text>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display: block; margin: 0 auto; max-width: 100%; height: auto;">
  <g class="tree-edges">
    ${linesMarkup}
  </g>
  <g class="tree-nodes">
    ${nodesMarkup}
  </g>
</svg>`;
}

/**
 * Derives a human-readable one-line plain-text grouping from a collapsed tree.
 * Example for arithmetic: "Tree 1 groups id+(id*id), Tree 2 groups (id+id)*id"
 * 
 * @param {Object} tree - Collapsed parse tree
 * @returns {string|null} Grouped expression or null if not cleanly derivable
 */
export function deriveGrouping(tree) {
  if (!tree || !tree.children || tree.children.length !== 3) {
    return null;
  }

  function getSubExpr(node, isTopLevel = false) {
    if (!node) return '';
    if (node.terminal) return node.symbol;
    if (!node.children || node.children.length === 0) return node.symbol;

    if (node.children.length === 1) {
      return getSubExpr(node.children[0]);
    }

    if (node.children.length === 3) {
      const left = getSubExpr(node.children[0]);
      const op = node.children[1].symbol;
      const right = getSubExpr(node.children[2]);
      if (isTopLevel) {
        return `${left}${op}${right}`;
      }
      return `(${left}${op}${right})`;
    }

    return node.children.map(c => getSubExpr(c)).join('');
  }

  try {
    return getSubExpr(tree, true);
  } catch (err) {
    return null;
  }
}
