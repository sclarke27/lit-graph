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
  // Include compound (group) nodes for directory clustering.
  const dirGroups = graphData.directoryGroups || [];
  const cyGroupNodes = dirGroups.map((g) => ({
    data: {
      id: 'group:' + g,
      label: g,
      isGroup: true,
    },
  }));

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
      directoryGroup: n.directoryGroup || '',
      depth: n.depth ?? 0,
      // parent is set dynamically by the clustering toggle
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

  const maxDepth = graphData.maxDepth || 0;
  const allElements = JSON.stringify([...cyGroupNodes, ...cyNodes, ...cyEdges], null, 2);

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
    flex-wrap: wrap;
    z-index: 10;
    max-width: calc(100% - 370px);
  }

  #toolbar button, #toolbar input, #toolbar label {
    background: #1e2130;
    border: 1px solid #2d3148;
    color: #e2e8f0;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  #toolbar button:hover, #toolbar label:hover { background: #2d3148; }

  #toolbar button.active, #toolbar label.active {
    background: #2d3148;
    border-color: #60a5fa;
    color: #60a5fa;
  }

  #toolbar input[type="text"] {
    width: 180px;
    cursor: text;
  }

  #toolbar input[type="text"]::placeholder { color: #64748b; }

  .toolbar-sep {
    width: 1px;
    background: #2d3148;
    align-self: stretch;
    margin: 0 2px;
  }

  /* ── Depth slider ─────────────────────────────────────────── */
  .depth-control {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #1e2130;
    border: 1px solid #2d3148;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 13px;
  }

  .depth-control.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .depth-control input[type="range"] {
    width: 80px;
    accent-color: #60a5fa;
    cursor: pointer;
    background: transparent;
    border: none;
    padding: 0;
  }

  .depth-control span {
    min-width: 14px;
    text-align: center;
    color: #94a3b8;
  }

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
  <div class="toolbar-sep"></div>
  <button id="btn-cluster" title="Group components by directory">Clusters</button>
  <div class="depth-control disabled" id="depth-wrap">
    <span>Depth</span>
    <input type="range" id="depth-slider" min="0" max="${maxDepth}" value="${maxDepth}" />
    <span id="depth-value">${maxDepth}</span>
  </div>
  <div class="toolbar-sep"></div>
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

  var MAX_DEPTH = ${maxDepth};

  var COLORS = {
    root:      { bg: '#1e3a5f', border: '#60a5fa', text: '#60a5fa' },
    container: { bg: '#134e4a', border: '#5eead4', text: '#5eead4' },
    leaf:      { bg: '#14532d', border: '#86efac', text: '#86efac' },
  };

  // Deterministic colors for directory clusters.
  var GROUP_PALETTE = [
    { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.35)', text: '#818cf8' },
    { bg: 'rgba(244,114,182,0.08)', border: 'rgba(244,114,182,0.35)', text: '#f472b6' },
    { bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.35)',  text: '#fbbf24' },
    { bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.35)',  text: '#34d399' },
    { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.35)', text: '#f87171' },
    { bg: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.35)',  text: '#38bdf8' },
    { bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.35)', text: '#a78bfa' },
    { bg: 'rgba(253,186,116,0.08)', border: 'rgba(253,186,116,0.35)', text: '#fdba74' },
  ];

  var allElements = ${allElements};

  // ── State ──────────────────────────────────────────────────
  var clusterEnabled = false;
  var depthFilterEnabled = false;
  var currentMaxDepth = MAX_DEPTH;

  // ── Build Cytoscape ────────────────────────────────────────
  // Start without group nodes (clustering off by default).
  var initialElements = allElements.filter(function (el) {
    return !el.data.isGroup;
  });

  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: initialElements,
    style: [
      // ── Regular nodes ──────────────────────────────────────
      {
        selector: 'node[!isGroup]',
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
      // ── Compound (group) nodes ─────────────────────────────
      {
        selector: '$node > node',
        style: {
          'label': 'data(label)',
          'text-valign': 'top',
          'text-halign': 'center',
          'font-size': '11px',
          'font-weight': '600',
          'color': '#94a3b8',
          'text-margin-y': -6,
          'padding': '20px',
          'shape': 'round-rectangle',
          'background-color': 'rgba(30,33,48,0.5)',
          'border-width': 1,
          'border-style': 'dashed',
          'border-color': '#2d3148',
          'background-opacity': 0.5,
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
      // Dimmed state for search / depth filtering
      {
        selector: '.dimmed',
        style: { 'opacity': 0.15 },
      },
      {
        selector: '.highlighted',
        style: { 'opacity': 1, 'border-width': 3 },
      },
      {
        selector: '.depth-hidden',
        style: { 'display': 'none' },
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

  // Apply group colors dynamically to compound nodes.
  var groupColorMap = {};
  allElements.forEach(function (el) {
    if (el.data.isGroup) {
      var idx = Object.keys(groupColorMap).length % GROUP_PALETTE.length;
      groupColorMap[el.data.id] = GROUP_PALETTE[idx];
    }
  });

  // ── Stats ──────────────────────────────────────────────────
  function updateStats() {
    var visible = cy.nodes('[!isGroup]').filter(function (n) { return n.visible(); });
    var visEdges = cy.edges().filter(function (e) { return e.visible(); });
    document.getElementById('stats').textContent =
      visible.length + ' components · ' + visEdges.length + ' connections';
  }
  updateStats();

  // ── Re-layout helper ───────────────────────────────────────
  function reLayout(animate) {
    cy.layout({
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: 60,
      rankSep: 80,
      padding: 40,
      animate: !!animate,
      animationDuration: 300,
    }).run();
    updateStats();
  }

  // ── Clustering toggle ──────────────────────────────────────
  var btnCluster = document.getElementById('btn-cluster');

  btnCluster.addEventListener('click', function () {
    clusterEnabled = !clusterEnabled;
    btnCluster.classList.toggle('active', clusterEnabled);
    applyClustering();
    reLayout(true);
  });

  function applyClustering() {
    if (clusterEnabled) {
      // Add group nodes if not already present.
      allElements.forEach(function (el) {
        if (el.data.isGroup && cy.getElementById(el.data.id).length === 0) {
          cy.add(el);
          // Apply group color.
          var colors = groupColorMap[el.data.id];
          if (colors) {
            cy.getElementById(el.data.id).style({
              'background-color': colors.bg,
              'border-color': colors.border,
              'color': colors.text,
            });
          }
        }
      });
      // Assign parent to each component node.
      cy.nodes('[!isGroup]').forEach(function (n) {
        var group = n.data('directoryGroup');
        if (group) {
          n.move({ parent: 'group:' + group });
        }
      });
    } else {
      // Remove parent from all component nodes.
      cy.nodes('[!isGroup]').forEach(function (n) {
        n.move({ parent: null });
      });
      // Remove group nodes.
      cy.nodes('[?isGroup]').remove();
    }
  }

  // ── Depth filter toggle + slider ───────────────────────────
  var depthWrap = document.getElementById('depth-wrap');
  var depthSlider = document.getElementById('depth-slider');
  var depthValue = document.getElementById('depth-value');

  // Click the "Depth" label text to toggle on/off.
  depthWrap.addEventListener('click', function (e) {
    // Only toggle if clicking the label, not the slider itself.
    if (e.target === depthSlider) return;
    depthFilterEnabled = !depthFilterEnabled;
    depthWrap.classList.toggle('disabled', !depthFilterEnabled);
    applyDepthFilter();
    reLayout(true);
  });

  depthSlider.addEventListener('input', function () {
    currentMaxDepth = parseInt(this.value, 10);
    depthValue.textContent = currentMaxDepth;
    if (depthFilterEnabled) {
      applyDepthFilter();
      reLayout(false);
    }
  });

  // Prevent slider clicks from toggling the depth filter.
  depthSlider.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  function applyDepthFilter() {
    cy.batch(function () {
      cy.nodes('[!isGroup]').forEach(function (n) {
        var nodeDepth = n.data('depth') || 0;
        if (depthFilterEnabled && nodeDepth > currentMaxDepth) {
          n.addClass('depth-hidden');
        } else {
          n.removeClass('depth-hidden');
        }
      });

      // Hide edges whose source or target is hidden.
      cy.edges().forEach(function (e) {
        var src = cy.getElementById(e.data('source'));
        var tgt = cy.getElementById(e.data('target'));
        if (src.hasClass('depth-hidden') || tgt.hasClass('depth-hidden')) {
          e.addClass('depth-hidden');
        } else {
          e.removeClass('depth-hidden');
        }
      });

      // Hide empty group nodes.
      if (clusterEnabled) {
        cy.nodes('[?isGroup]').forEach(function (g) {
          var visibleChildren = g.children().filter(function (c) {
            return !c.hasClass('depth-hidden');
          });
          if (visibleChildren.length === 0) {
            g.addClass('depth-hidden');
          } else {
            g.removeClass('depth-hidden');
          }
        });
      }
    });
    updateStats();
  }

  // ── Sidebar detail view ────────────────────────────────────
  var placeholder = document.getElementById('detail-placeholder');
  var detailContent = document.getElementById('detail-content');

  cy.on('tap', 'node[!isGroup]', function (evt) {
    var d = evt.target.data();
    placeholder.style.display = 'none';
    detailContent.style.display = '';

    var badgeClass = 'badge-' + d.nodeType;
    var html = '';
    html += '<h2>' + esc(d.label) + '</h2>';
    html += '<div class="class-name">' + esc(d.className || '') + ' <span class="badge ' + badgeClass + '">' + d.nodeType + '</span></div>';
    html += '<div class="file-path">' + esc(shortenPath(d.filePath)) + '</div>';

    if (d.directoryGroup) {
      html += '<div class="file-path" style="margin-top:2px;color:#64748b">📁 ' + esc(d.directoryGroup) + '</div>';
    }

    // Properties
    html += '<div style="margin-top:16px"><div class="section-title">Properties</div>';
    if (d.properties && d.properties.length) {
      html += '<ul class="prop-list">';
      for (var i = 0; i < d.properties.length; i++) {
        var p = d.properties[i];
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
      for (var j = 0; j < d.internalState.length; j++) {
        var s = d.internalState[j];
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
      for (var k = 0; k < d.eventsDispatched.length; k++) {
        html += '<span class="event-tag">' + esc(d.eventsDispatched[k]) + '</span>';
      }
      html += '</div>';
    } else {
      html += '<div class="empty-msg">None</div>';
    }
    html += '</div>';

    // Connections
    var incoming = cy.edges('[target="' + d.id + '"]');
    var outgoing = cy.edges('[source="' + d.id + '"]');

    if (outgoing.length) {
      html += '<div style="margin-top:12px"><div class="section-title">Renders (' + outgoing.length + ')</div>';
      html += '<ul class="prop-list">';
      outgoing.forEach(function (e) {
        var ed = e.data();
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
  var searchInput = document.getElementById('search');

  searchInput.addEventListener('input', function () {
    var q = this.value.trim().toLowerCase();
    if (!q) {
      cy.elements().removeClass('dimmed highlighted');
      return;
    }
    cy.batch(function () {
      cy.elements().addClass('dimmed').removeClass('highlighted');
      var matches = cy.nodes('[!isGroup]').filter(function (n) {
        var d = n.data();
        return d.label.toLowerCase().includes(q) ||
               (d.className && d.className.toLowerCase().includes(q)) ||
               (d.directoryGroup && d.directoryGroup.toLowerCase().includes(q));
      });
      matches.removeClass('dimmed').addClass('highlighted');
      // Also highlight connected edges and neighbors
      matches.connectedEdges().removeClass('dimmed');
      matches.neighborhood().nodes().removeClass('dimmed');
      // If clustered, highlight parent groups of matches.
      if (clusterEnabled) {
        matches.forEach(function (n) {
          var parent = n.parent();
          if (parent.length) parent.removeClass('dimmed');
        });
      }
    });
  });

  // ── Toolbar buttons ────────────────────────────────────────
  document.getElementById('btn-fit').addEventListener('click', function () {
    cy.fit(undefined, 40);
  });

  document.getElementById('btn-reset').addEventListener('click', function () {
    reLayout(true);
  });

  document.getElementById('btn-png').addEventListener('click', function () {
    var png = cy.png({ scale: 2, bg: '#0f1117', full: true });
    var link = document.createElement('a');
    link.href = png;
    link.download = 'lit-graph.png';
    link.click();
  });

  var sidebar = document.getElementById('sidebar');
  var statsEl = document.getElementById('stats');
  document.getElementById('btn-toggle').addEventListener('click', function () {
    sidebar.classList.toggle('hidden');
    statsEl.classList.toggle('shifted');
    this.textContent = sidebar.classList.contains('hidden') ? '▶' : '◀';
    setTimeout(function () { cy.resize(); }, 250);
  });
})();

function esc(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function shortenPath(filePath) {
  if (!filePath) return '';
  var parts = filePath.replace(/\\\\/g, '/').split('/');
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
