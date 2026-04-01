/**
 * Generate a self-contained HTML file with an interactive Cytoscape.js
 * graph visualizing Lit component relationships.
 *
 * @param {import('../graph/graph-builder.js').GraphData} graphData
 * @param {{ title?: string }} options
 * @returns {string} Complete HTML document.
 */
export function generateHtml(graphData, options = {}) {
  const title = options.title || 'Lit Component Graph';

  // Convert graph data to Cytoscape elements format.
  const cyNodes = graphData.nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.tagName,
      className: n.className,
      filePath: n.filePath,
      nodeType: n.nodeType,
      properties: n.properties,
      internalState: n.internalState,
      eventsDispatched: n.eventsDispatched,
      propCount: n.properties.length,
      stateCount: n.internalState.length,
      eventCount: n.eventsDispatched.length,
    },
  }));

  const cyEdges = graphData.edges.map((e, i) => {
    const parts = [];
    if (e.propBindings.length) parts.push(e.propBindings.join(', '));
    if (e.eventBindings.length) parts.push(e.eventBindings.join(', '));

    return {
      data: {
        id: `e${i}`,
        source: e.source,
        target: e.target,
        label: parts.join('\n') || '',
        propBindings: e.propBindings,
        eventBindings: e.eventBindings,
      },
    };
  });

  const elements = JSON.stringify([...cyNodes, ...cyEdges], null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f1117;
    color: #e2e8f0;
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Graph canvas ─────────────────────────────────────────── */
  #cy {
    flex: 1;
    min-width: 0;
  }

  /* ── Toolbar ──────────────────────────────────────────────── */
  #toolbar {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 8px;
    z-index: 10;
  }

  #toolbar button, #toolbar input {
    background: #1e2130;
    border: 1px solid #2d3148;
    color: #e2e8f0;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }

  #toolbar button:hover { background: #2d3148; }

  #toolbar input {
    width: 200px;
    cursor: text;
  }

  #toolbar input::placeholder { color: #64748b; }

  /* ── Sidebar ──────────────────────────────────────────────── */
  #sidebar {
    width: 340px;
    background: #161822;
    border-left: 1px solid #2d3148;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    transition: transform 0.2s;
  }

  #sidebar.hidden {
    transform: translateX(100%);
    position: absolute;
    right: 0;
    height: 100%;
  }

  #sidebar h2 {
    font-size: 18px;
    font-weight: 600;
    color: #f1f5f9;
    word-break: break-all;
  }

  #sidebar .class-name {
    font-size: 13px;
    color: #64748b;
    margin-top: 2px;
  }

  #sidebar .file-path {
    font-size: 12px;
    color: #475569;
    word-break: break-all;
    font-family: 'SF Mono', Consolas, monospace;
  }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
    margin-bottom: 6px;
  }

  .prop-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prop-list li {
    font-size: 13px;
    font-family: 'SF Mono', Consolas, monospace;
    padding: 4px 8px;
    background: #1e2130;
    border-radius: 4px;
    display: flex;
    justify-content: space-between;
  }

  .prop-type {
    color: #64748b;
    font-size: 12px;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .badge-root { background: #1e3a5f; color: #60a5fa; }
  .badge-container { background: #134e4a; color: #5eead4; }
  .badge-leaf { background: #14532d; color: #86efac; }

  .event-tag {
    font-size: 13px;
    font-family: 'SF Mono', Consolas, monospace;
    padding: 4px 8px;
    background: #2d1b3d;
    border-radius: 4px;
    color: #c084fc;
  }

  .empty-msg {
    font-size: 13px;
    color: #475569;
    font-style: italic;
  }

  /* ── Legend ────────────────────────────────────────────────── */
  #legend {
    position: absolute;
    bottom: 12px;
    left: 12px;
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: #94a3b8;
    z-index: 10;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  /* ── Stats ────────────────────────────────────────────────── */
  #stats {
    position: absolute;
    bottom: 12px;
    right: 352px;
    font-size: 12px;
    color: #475569;
    z-index: 10;
  }

  #stats.shifted { right: 12px; }
</style>
</head>
<body>

<div id="cy"></div>

<div id="toolbar">
  <input type="text" id="search" placeholder="Search components…" autocomplete="off" />
  <button id="btn-fit" title="Fit graph to viewport">Fit</button>
  <button id="btn-reset" title="Reset layout">Reset</button>
  <button id="btn-png" title="Export as PNG">PNG</button>
  <button id="btn-toggle" title="Toggle sidebar">◀</button>
</div>

<div id="sidebar">
  <div id="detail-placeholder" class="empty-msg">Click a component to see details</div>
  <div id="detail-content" style="display:none;"></div>
</div>

<div id="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#60a5fa"></div> Root</div>
  <div class="legend-item"><div class="legend-dot" style="background:#5eead4"></div> Container</div>
  <div class="legend-item"><div class="legend-dot" style="background:#86efac"></div> Leaf</div>
</div>

<div id="stats"></div>

<script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js"></script>
<script src="https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
<script src="https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
<script>
(function () {
  'use strict';

  // Register dagre layout extension.
  if (typeof cytoscape !== 'undefined' && typeof cytoscapeDagre !== 'undefined') {
    cytoscape.use(cytoscapeDagre);
  }

  const COLORS = {
    root:      { bg: '#1e3a5f', border: '#60a5fa', text: '#60a5fa' },
    container: { bg: '#134e4a', border: '#5eead4', text: '#5eead4' },
    leaf:      { bg: '#14532d', border: '#86efac', text: '#86efac' },
  };

  const elements = ${elements};

  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: elements,
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '12px',
          'font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          'font-weight': '600',
          'color': '#e2e8f0',
          'text-wrap': 'wrap',
          'text-max-width': '140px',
          'width': 'label',
          'height': '40px',
          'padding': '14px',
          'shape': 'round-rectangle',
          'background-color': '#1e2130',
          'border-width': 2,
          'border-color': '#2d3148',
          'text-outline-width': 0,
          'transition-property': 'background-color, border-color, opacity',
          'transition-duration': '0.15s',
        },
      },
      // Color by node type
      {
        selector: 'node[nodeType="root"]',
        style: {
          'background-color': COLORS.root.bg,
          'border-color': COLORS.root.border,
          'color': COLORS.root.text,
        },
      },
      {
        selector: 'node[nodeType="container"]',
        style: {
          'background-color': COLORS.container.bg,
          'border-color': COLORS.container.border,
          'color': COLORS.container.text,
        },
      },
      {
        selector: 'node[nodeType="leaf"]',
        style: {
          'background-color': COLORS.leaf.bg,
          'border-color': COLORS.leaf.border,
          'color': COLORS.leaf.text,
        },
      },
      // Edges
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': '#334155',
          'target-arrow-color': '#334155',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.8,
          'label': 'data(label)',
          'font-size': '10px',
          'font-family': "'SF Mono', Consolas, monospace",
          'color': '#64748b',
          'text-rotation': 'autorotate',
          'text-margin-y': -10,
          'text-wrap': 'wrap',
          'text-max-width': '120px',
          'text-outline-width': 2,
          'text-outline-color': '#0f1117',
        },
      },
      // Selection / hover
      {
        selector: 'node:active, node:selected',
        style: {
          'border-width': 3,
          'overlay-opacity': 0,
        },
      },
      // Dimmed state for search filtering
      {
        selector: '.dimmed',
        style: {
          'opacity': 0.15,
        },
      },
      {
        selector: '.highlighted',
        style: {
          'opacity': 1,
          'border-width': 3,
        },
      },
    ],
    layout: {
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: 60,
      rankSep: 80,
      padding: 40,
    },
    minZoom: 0.2,
    maxZoom: 3,
    wheelSensitivity: 0.3,
  });

  // ── Stats ──────────────────────────────────────────────────
  const nodeCount = cy.nodes().length;
  const edgeCount = cy.edges().length;
  document.getElementById('stats').textContent =
    nodeCount + ' components · ' + edgeCount + ' connections';

  // ── Sidebar detail view ────────────────────────────────────
  const placeholder = document.getElementById('detail-placeholder');
  const detailContent = document.getElementById('detail-content');

  cy.on('tap', 'node', function (evt) {
    const d = evt.target.data();
    placeholder.style.display = 'none';
    detailContent.style.display = '';

    const badgeClass = 'badge-' + d.nodeType;
    let html = '';
    html += '<h2>' + esc(d.label) + '</h2>';
    html += '<div class="class-name">' + esc(d.className || '') + ' <span class="badge ' + badgeClass + '">' + d.nodeType + '</span></div>';
    html += '<div class="file-path">' + esc(shortenPath(d.filePath)) + '</div>';

    // Properties
    html += '<div style="margin-top:16px"><div class="section-title">Properties</div>';
    if (d.properties && d.properties.length) {
      html += '<ul class="prop-list">';
      for (const p of d.properties) {
        html += '<li>' + esc(p.name) + ' <span class="prop-type">' + esc(p.type || 'any') + '</span></li>';
      }
      html += '</ul>';
    } else {
      html += '<div class="empty-msg">None</div>';
    }
    html += '</div>';

    // Internal state
    html += '<div style="margin-top:12px"><div class="section-title">Internal State</div>';
    if (d.internalState && d.internalState.length) {
      html += '<ul class="prop-list">';
      for (const s of d.internalState) {
        html += '<li>' + esc(s.name) + ' <span class="prop-type">' + esc(s.type || 'any') + '</span></li>';
      }
      html += '</ul>';
    } else {
      html += '<div class="empty-msg">None</div>';
    }
    html += '</div>';

    // Events dispatched
    html += '<div style="margin-top:12px"><div class="section-title">Events Dispatched</div>';
    if (d.eventsDispatched && d.eventsDispatched.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
      for (const e of d.eventsDispatched) {
        html += '<span class="event-tag">' + esc(e) + '</span>';
      }
      html += '</div>';
    } else {
      html += '<div class="empty-msg">None</div>';
    }
    html += '</div>';

    // Connections
    const incoming = cy.edges('[target="' + d.id + '"]');
    const outgoing = cy.edges('[source="' + d.id + '"]');

    if (outgoing.length) {
      html += '<div style="margin-top:12px"><div class="section-title">Renders (' + outgoing.length + ')</div>';
      html += '<ul class="prop-list">';
      outgoing.forEach(function (e) {
        const ed = e.data();
        html += '<li>' + esc(ed.target);
        if (ed.propBindings && ed.propBindings.length) {
          html += ' <span class="prop-type">' + esc(ed.propBindings.join(', ')) + '</span>';
        }
        html += '</li>';
      });
      html += '</ul></div>';
    }

    if (incoming.length) {
      html += '<div style="margin-top:12px"><div class="section-title">Rendered by (' + incoming.length + ')</div>';
      html += '<ul class="prop-list">';
      incoming.forEach(function (e) {
        html += '<li>' + esc(e.data().source) + '</li>';
      });
      html += '</ul></div>';
    }

    detailContent.innerHTML = html;
  });

  cy.on('tap', function (evt) {
    if (evt.target === cy) {
      placeholder.style.display = '';
      detailContent.style.display = 'none';
    }
  });

  // ── Search / filter ────────────────────────────────────────
  const searchInput = document.getElementById('search');

  searchInput.addEventListener('input', function () {
    const q = this.value.trim().toLowerCase();
    if (!q) {
      cy.elements().removeClass('dimmed highlighted');
      return;
    }
    cy.batch(function () {
      cy.elements().addClass('dimmed').removeClass('highlighted');
      const matches = cy.nodes().filter(function (n) {
        const d = n.data();
        return d.label.toLowerCase().includes(q) ||
               (d.className && d.className.toLowerCase().includes(q));
      });
      matches.removeClass('dimmed').addClass('highlighted');
      // Also highlight connected edges and neighbors
      matches.connectedEdges().removeClass('dimmed');
      matches.neighborhood().nodes().removeClass('dimmed');
    });
  });

  // ── Toolbar buttons ────────────────────────────────────────
  document.getElementById('btn-fit').addEventListener('click', function () {
    cy.fit(undefined, 40);
  });

  document.getElementById('btn-reset').addEventListener('click', function () {
    cy.layout({
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: 60,
      rankSep: 80,
      padding: 40,
      animate: true,
      animationDuration: 300,
    }).run();
  });

  document.getElementById('btn-png').addEventListener('click', function () {
    const png = cy.png({ scale: 2, bg: '#0f1117', full: true });
    const link = document.createElement('a');
    link.href = png;
    link.download = 'lit-graph.png';
    link.click();
  });

  const sidebar = document.getElementById('sidebar');
  const statsEl = document.getElementById('stats');
  document.getElementById('btn-toggle').addEventListener('click', function () {
    sidebar.classList.toggle('hidden');
    statsEl.classList.toggle('shifted');
    this.textContent = sidebar.classList.contains('hidden') ? '▶' : '◀';
    // Refit after sidebar toggle so graph uses available space.
    setTimeout(function () { cy.resize(); }, 250);
  });
})();

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function shortenPath(filePath) {
  if (!filePath) return '';
  // Show last 3 path segments.
  const parts = filePath.replace(/\\\\/g, '/').split('/');
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : filePath;
}
</script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
