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

  // Use component groups (by root subtree) for clustering.
  const compGroups = graphData.componentGroups || [];

  const groupMeta = {};
  for (const g of compGroups) {
    const children = graphData.nodes.filter((n) => n.componentGroup === g);
    groupMeta[g] = {
      count: children.length,
      tags: children.map((c) => c.tagName),
    };
  }

  const groupDescriptions = graphData.groupDescriptions || {};
  const isLlmGrouped = graphData.isLlmGrouped || false;

  const cyGroupNodes = compGroups.map((g) => ({
    data: {
      id: 'group:' + g,
      label: g + ' (' + groupMeta[g].count + ')',
      rawLabel: g,
      isGroup: true,
      childCount: groupMeta[g].count,
      childTags: groupMeta[g].tags,
      description: groupDescriptions[g] || '',
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
      componentGroup: n.componentGroup || '',
      depth: n.depth ?? 0,
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

  #cy { flex: 1; min-width: 0; }

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

  #toolbar input[type="text"] { width: 180px; cursor: text; }
  #toolbar input[type="text"]::placeholder { color: #64748b; }

  .toolbar-sep {
    width: 1px;
    background: #2d3148;
    align-self: stretch;
    margin: 0 2px;
  }

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

  .depth-control.disabled { opacity: 0.4; pointer-events: none; }

  .depth-control input[type="range"] {
    width: 80px;
    accent-color: #60a5fa;
    cursor: pointer;
    background: transparent;
    border: none;
    padding: 0;
  }

  .depth-control span { min-width: 14px; text-align: center; color: #94a3b8; }

  /* ── Breadcrumb ───────────────────────────────────────────── */
  #breadcrumb {
    position: absolute;
    top: 52px;
    left: 12px;
    z-index: 10;
    display: none;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: #94a3b8;
  }

  #breadcrumb span { cursor: default; }
  #breadcrumb a {
    color: #60a5fa;
    cursor: pointer;
    text-decoration: none;
  }
  #breadcrumb a:hover { text-decoration: underline; }

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

  #sidebar .class-name { font-size: 13px; color: #64748b; margin-top: 2px; }
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

  .prop-type { color: #64748b; font-size: 12px; }

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

  .empty-msg { font-size: 13px; color: #475569; font-style: italic; }

  /* ── Group sidebar content ────────────────────────────────── */
  .group-tag-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .group-tag-list li {
    font-size: 13px;
    font-family: 'SF Mono', Consolas, monospace;
    padding: 3px 8px;
    background: #1e2130;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .group-tag-list li:hover { background: #2d3148; }

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

  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }

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
  <button id="btn-cluster" title="Group components by directory (double-click group to expand)">Clusters</button>
  <button id="btn-focus" title="Focus on selected component (or double-click any component)">Focus</button>
  <button id="btn-depth" title="Toggle depth filtering">Depth</button>
  <div class="depth-control" id="depth-wrap" style="display:none">
    <input type="range" id="depth-slider" min="0" max="${maxDepth}" value="${maxDepth}" />
    <span id="depth-value">${maxDepth}</span>
  </div>
  <div class="toolbar-sep"></div>
  <button id="btn-fit" title="Fit graph to viewport">Fit</button>
  <button id="btn-reset" title="Reset layout">Reset</button>
  <button id="btn-png" title="Export as PNG">PNG</button>
  <button id="btn-toggle" title="Toggle sidebar">◀</button>
</div>

<div id="breadcrumb">
  <a id="bc-back">All components</a>
  <span>›</span>
  <span id="bc-current"></span>
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
${isLlmGrouped ? '<div style="position:absolute;top:52px;right:352px;z-index:10;font-size:11px;color:#818cf8;background:#1e2130;padding:3px 8px;border-radius:4px;border:1px solid rgba(99,102,241,0.3)">AI-grouped</div>' : ''}

<script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js"></script>
<script src="https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
<script src="https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
<script>
(function () {
  'use strict';

  if (typeof cytoscape !== 'undefined') {
    if (typeof cytoscapeDagre !== 'undefined') cytoscape.use(cytoscapeDagre);
  }

  var MAX_DEPTH = ${maxDepth};
  var COLORS = {
    root:      { bg: '#1e3a5f', border: '#60a5fa', text: '#60a5fa' },
    container: { bg: '#134e4a', border: '#5eead4', text: '#5eead4' },
    leaf:      { bg: '#14532d', border: '#86efac', text: '#86efac' },
  };

  var GROUP_PALETTE = [
    { bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.5)',  text: '#818cf8' },
    { bg: 'rgba(244,114,182,0.12)', border: 'rgba(244,114,182,0.5)', text: '#f472b6' },
    { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.5)',  text: '#fbbf24' },
    { bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.5)',  text: '#34d399' },
    { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.5)', text: '#f87171' },
    { bg: 'rgba(56,189,248,0.12)',  border: 'rgba(56,189,248,0.5)',  text: '#38bdf8' },
    { bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.5)', text: '#a78bfa' },
    { bg: 'rgba(253,186,116,0.12)', border: 'rgba(253,186,116,0.5)', text: '#fdba74' },
  ];

  var allElements = ${allElements};

  // ── State ──────────────────────────────────────────────────
  var clusterEnabled = false;
  var depthFilterEnabled = false;
  var currentMaxDepth = MAX_DEPTH;
  var focusTarget = null;       // tag name of focused component, or null
  var selectedNode = null;      // currently selected node id
  var expandedGroups = {};      // track which groups are expanded

  // Precompute group color map.
  var groupColorMap = {};
  var gIdx = 0;
  allElements.forEach(function (el) {
    if (el.data.isGroup) {
      groupColorMap[el.data.id] = GROUP_PALETTE[gIdx % GROUP_PALETTE.length];
      gIdx++;
    }
  });

  // ── Build Cytoscape ────────────────────────────────────────
  var initialElements = allElements.filter(function (el) {
    return !el.data.isGroup;
  });

  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: initialElements,
    style: [
      // Regular component nodes
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
      // Collapsed group nodes (shown as single summary node)
      {
        selector: 'node[?isGroup][?collapsed]',
        style: {
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '13px',
          'font-weight': '600',
          'width': 'label',
          'height': '50px',
          'padding': '20px',
          'shape': 'round-rectangle',
          'border-width': 2,
          'border-style': 'dashed',
          'background-opacity': 0.8,
        },
      },
      // Expanded group nodes (compound parent)
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
          'padding': '24px',
          'shape': 'round-rectangle',
          'background-color': 'rgba(30,33,48,0.4)',
          'border-width': 1,
          'border-style': 'dashed',
          'border-color': '#2d3148',
        },
      },
      // Node type colors
      {
        selector: 'node[nodeType="root"]',
        style: { 'background-color': COLORS.root.bg, 'border-color': COLORS.root.border, 'color': COLORS.root.text },
      },
      {
        selector: 'node[nodeType="container"]',
        style: { 'background-color': COLORS.container.bg, 'border-color': COLORS.container.border, 'color': COLORS.container.text },
      },
      {
        selector: 'node[nodeType="leaf"]',
        style: { 'background-color': COLORS.leaf.bg, 'border-color': COLORS.leaf.border, 'color': COLORS.leaf.text },
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
      {
        selector: 'node:active, node:selected',
        style: { 'border-width': 3, 'overlay-opacity': 0 },
      },
      {
        selector: '.dimmed',
        style: { 'opacity': 0.1 },
      },
      {
        selector: '.highlighted',
        style: { 'opacity': 1, 'border-width': 3 },
      },
      {
        selector: '.depth-hidden',
        style: { 'display': 'none' },
      },
      {
        selector: '.focus-hidden',
        style: { 'display': 'none' },
      },
    ],
    layout: { name: 'dagre', rankDir: 'TB', nodeSep: 60, rankSep: 80, padding: 40 },
    minZoom: 0.2,
    maxZoom: 3,
    wheelSensitivity: 0.3,
  });

  // ── Layout helpers ─────────────────────────────────────────
  function reLayout(animate) {
    // Pick layout based on current mode.
    var hasExpandedGroups = Object.keys(expandedGroups).some(function (k) { return expandedGroups[k]; });
    var opts;

    if (clusterEnabled && hasExpandedGroups) {
      // Expanded compound nodes — dagre handles compound parents.
      opts = {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 60,
        rankSep: 80,
        padding: 40,
        animate: !!animate,
        animationDuration: 300,
      };
    } else if (clusterEnabled) {
      // All groups collapsed — manually center them.
      var groupNodes = cy.nodes('[?isGroup]:visible');
      var cols = Math.ceil(Math.sqrt(groupNodes.length));
      groupNodes.forEach(function (n, i) {
        var col = i % cols;
        var row = Math.floor(i / cols);
        n.position({ x: col * 250, y: row * 180 });
      });
      cy.fit(groupNodes, 80);
      updateStats();
      return;
    } else {
      // No clustering — dagre hierarchy.
      opts = {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 60,
        rankSep: 80,
        padding: 40,
        animate: !!animate,
        animationDuration: 300,
      };
    }

    var layout = cy.layout(opts);
    layout.on('layoutstop', function () { cy.fit(undefined, 40); });
    layout.run();
    updateStats();
  }

  function updateStats() {
    var visible = cy.nodes('[!isGroup]').filter(function (n) { return n.visible(); });
    var visEdges = cy.edges().filter(function (e) { return e.visible(); });
    document.getElementById('stats').textContent =
      visible.length + ' components · ' + visEdges.length + ' connections';
  }
  updateStats();

  // ── Clustering: collapsible groups ─────────────────────────
  var btnCluster = document.getElementById('btn-cluster');

  btnCluster.addEventListener('click', function () {
    clusterEnabled = !clusterEnabled;
    btnCluster.classList.toggle('active', clusterEnabled);
    if (clusterEnabled) {
      enableClustering();
    } else {
      disableClustering();
    }
    reLayout(true);
  });

  function enableClustering() {
    // Add all group nodes as collapsed summary nodes.
    expandedGroups = {};
    allElements.forEach(function (el) {
      if (!el.data.isGroup) return;
      if (cy.getElementById(el.data.id).length > 0) return;
      var added = cy.add({
        data: Object.assign({}, el.data, { collapsed: true }),
      });
      applyGroupStyle(added);
    });
    // Hide all component nodes — they're inside collapsed groups.
    cy.nodes('[!isGroup]').addClass('focus-hidden');
    cy.edges().addClass('focus-hidden');
    // Add inter-group edges.
    addGroupEdges();
  }

  function disableClustering() {
    expandedGroups = {};
    // Remove group nodes and group edges.
    cy.nodes('[?isGroup]').remove();
    cy.edges('[?isGroupEdge]').remove();
    // Show all component nodes again.
    cy.nodes('[!isGroup]').removeClass('focus-hidden');
    cy.edges('[!isGroupEdge]').removeClass('focus-hidden');
    // Un-parent everything.
    cy.nodes('[!isGroup]').forEach(function (n) { n.move({ parent: null }); });
  }

  function applyGroupStyle(node) {
    var colors = groupColorMap[node.id()];
    if (colors) {
      node.style({
        'background-color': colors.bg,
        'border-color': colors.border,
        'color': colors.text,
      });
    }
  }

  // Compute edges between groups (how many component edges cross groups).
  function addGroupEdges() {
    cy.edges('[?isGroupEdge]').remove();
    var groupEdges = {};
    allElements.forEach(function (el) {
      if (!el.data.source) return; // not an edge
      if (el.data.isGroupEdge) return;
      // Find groups for source and target.
      var srcNode = allElements.find(function (n) { return n.data.id === el.data.source; });
      var tgtNode = allElements.find(function (n) { return n.data.id === el.data.target; });
      if (!srcNode || !tgtNode) return;
      var srcGroup = 'group:' + (srcNode.data.componentGroup || '');
      var tgtGroup = 'group:' + (tgtNode.data.componentGroup || '');
      if (srcGroup === tgtGroup) return; // same group, skip
      // Don't add if either group is expanded.
      if (expandedGroups[srcGroup] || expandedGroups[tgtGroup]) return;
      var key = srcGroup + '>' + tgtGroup;
      if (!groupEdges[key]) groupEdges[key] = 0;
      groupEdges[key]++;
    });
    Object.keys(groupEdges).forEach(function (key, i) {
      var parts = key.split('>');
      // Only add edge if both group nodes exist and are visible.
      if (cy.getElementById(parts[0]).length && cy.getElementById(parts[1]).length) {
        cy.add({
          data: {
            id: 'ge' + i,
            source: parts[0],
            target: parts[1],
            label: groupEdges[key] + ' connections',
            isGroupEdge: true,
          },
        });
      }
    });
  }

  // Double-click a collapsed group to expand it.
  cy.on('dbltap', 'node[?isGroup]', function (evt) {
    var groupNode = evt.target;
    var groupId = groupNode.id();
    var isCollapsed = groupNode.data('collapsed');

    if (isCollapsed) {
      expandGroup(groupId);
    } else {
      collapseGroup(groupId);
    }
    reLayout(true);
  });

  function expandGroup(groupId) {
    var groupNode = cy.getElementById(groupId);
    if (!groupNode.length) return;
    expandedGroups[groupId] = true;
    groupNode.data('collapsed', false);

    // Show child component nodes and parent them to this group.
    var rawLabel = groupNode.data('rawLabel');
    cy.nodes('[!isGroup]').forEach(function (n) {
      if (n.data('componentGroup') === rawLabel) {
        n.removeClass('focus-hidden');
        n.move({ parent: groupId });
      }
    });

    // Show edges between visible nodes.
    cy.edges('[!isGroupEdge]').forEach(function (e) {
      var src = cy.getElementById(e.data('source'));
      var tgt = cy.getElementById(e.data('target'));
      if (src.visible() && tgt.visible()) {
        e.removeClass('focus-hidden');
      }
    });

    // Rebuild group edges (remove ones connected to this expanded group).
    addGroupEdges();
  }

  function collapseGroup(groupId) {
    var groupNode = cy.getElementById(groupId);
    if (!groupNode.length) return;
    expandedGroups[groupId] = false;
    groupNode.data('collapsed', true);

    var rawLabel = groupNode.data('rawLabel');
    // Hide child component nodes.
    cy.nodes('[!isGroup]').forEach(function (n) {
      if (n.data('componentGroup') === rawLabel) {
        n.addClass('focus-hidden');
        n.move({ parent: null });
      }
    });

    // Hide edges connected to now-hidden nodes.
    cy.edges('[!isGroupEdge]').forEach(function (e) {
      var src = cy.getElementById(e.data('source'));
      var tgt = cy.getElementById(e.data('target'));
      if (!src.visible() || !tgt.visible()) {
        e.addClass('focus-hidden');
      }
    });

    addGroupEdges();
  }

  // ── Focus mode ─────────────────────────────────────────────
  var btnFocus = document.getElementById('btn-focus');
  var breadcrumb = document.getElementById('breadcrumb');
  var bcBack = document.getElementById('bc-back');
  var bcCurrent = document.getElementById('bc-current');

  btnFocus.addEventListener('click', function () {
    if (focusTarget) {
      exitFocus();
    } else if (selectedNode) {
      enterFocus(selectedNode);
    }
  });

  bcBack.addEventListener('click', function () {
    exitFocus();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && focusTarget) {
      exitFocus();
    }
  });

  // Double-click a component node to focus on it directly.
  cy.on('dbltap', 'node[!isGroup]', function (evt) {
    selectedNode = evt.target.id();
    enterFocus(selectedNode);
    showNodeDetail(evt.target.data());
  });

  function enterFocus(nodeId) {
    var node = cy.getElementById(nodeId);
    if (!node.length || node.data('isGroup')) return;

    focusTarget = nodeId;
    btnFocus.textContent = 'Exit Focus';
    btnFocus.classList.add('active');

    // Show breadcrumb.
    breadcrumb.style.display = 'flex';
    bcCurrent.textContent = node.data('label');

    cy.batch(function () {
      // Get the neighborhood: the node itself + connected edges + connected nodes.
      var neighborhood = node.closedNeighborhood();
      // Also include 2nd-degree neighbors for more context.
      var extended = neighborhood.closedNeighborhood();

      cy.elements().addClass('focus-hidden');
      extended.removeClass('focus-hidden');

      // If clustered, show parent groups of visible nodes.
      if (clusterEnabled) {
        extended.nodes().forEach(function (n) {
          var parent = n.parent();
          if (parent.length) parent.removeClass('focus-hidden');
        });
      }
    });

    cy.fit(cy.elements(':visible'), 60);
    updateStats();
  }

  function exitFocus() {
    focusTarget = null;
    btnFocus.textContent = 'Focus';
    btnFocus.classList.remove('active');
    btnFocus.disabled = !selectedNode;
    breadcrumb.style.display = 'none';

    cy.batch(function () {
      cy.elements().removeClass('focus-hidden');

      // Re-apply clustering state if active.
      if (clusterEnabled) {
        // Hide nodes that belong to collapsed groups.
        cy.nodes('[!isGroup]').forEach(function (n) {
          var gId = 'group:' + n.data('componentGroup');
          if (!expandedGroups[gId]) {
            n.addClass('focus-hidden');
          }
        });
        cy.edges('[!isGroupEdge]').forEach(function (e) {
          var src = cy.getElementById(e.data('source'));
          var tgt = cy.getElementById(e.data('target'));
          if (!src.visible() || !tgt.visible()) {
            e.addClass('focus-hidden');
          }
        });
      }

      // Re-apply depth filter if active.
      if (depthFilterEnabled) {
        applyDepthFilter();
      }
    });

    reLayout(true);
  }

  // ── Track selection for Focus button ───────────────────────
  cy.on('tap', 'node[!isGroup]', function (evt) {
    selectedNode = evt.target.id();
    showNodeDetail(evt.target.data());
  });

  // Click on group node shows group info in sidebar.
  cy.on('tap', 'node[?isGroup]', function (evt) {
    selectedNode = null;
    showGroupDetail(evt.target.data());
  });

  cy.on('tap', function (evt) {
    if (evt.target === cy) {
      selectedNode = null;
      placeholder.style.display = '';
      detailContent.style.display = 'none';
    }
  });

  // ── Depth filter ───────────────────────────────────────────
  var btnDepth = document.getElementById('btn-depth');
  var depthWrap = document.getElementById('depth-wrap');
  var depthSlider = document.getElementById('depth-slider');
  var depthValue = document.getElementById('depth-value');

  btnDepth.addEventListener('click', function () {
    depthFilterEnabled = !depthFilterEnabled;
    btnDepth.classList.toggle('active', depthFilterEnabled);
    depthWrap.style.display = depthFilterEnabled ? 'flex' : 'none';
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

  function applyDepthFilter() {
    cy.batch(function () {
      cy.nodes('[!isGroup]').forEach(function (n) {
        if (n.hasClass('focus-hidden')) return; // don't touch focus-hidden nodes
        var nodeDepth = n.data('depth') || 0;
        if (depthFilterEnabled && nodeDepth > currentMaxDepth) {
          n.addClass('depth-hidden');
        } else {
          n.removeClass('depth-hidden');
        }
      });
      cy.edges().forEach(function (e) {
        if (e.hasClass('focus-hidden')) return;
        var src = cy.getElementById(e.data('source'));
        var tgt = cy.getElementById(e.data('target'));
        if (src.hasClass('depth-hidden') || tgt.hasClass('depth-hidden')) {
          e.addClass('depth-hidden');
        } else {
          e.removeClass('depth-hidden');
        }
      });
    });
    updateStats();
  }

  // ── Sidebar: node detail ───────────────────────────────────
  var placeholder = document.getElementById('detail-placeholder');
  var detailContent = document.getElementById('detail-content');

  function showNodeDetail(d) {
    placeholder.style.display = 'none';
    detailContent.style.display = '';

    var badgeClass = 'badge-' + d.nodeType;
    var h = '';
    h += '<h2>' + esc(d.label) + '</h2>';
    h += '<div class="class-name">' + esc(d.className || '') + ' <span class="badge ' + badgeClass + '">' + d.nodeType + '</span></div>';
    h += '<div class="file-path">' + esc(shortenPath(d.filePath)) + '</div>';
    if (d.directoryGroup) {
      h += '<div class="file-path" style="margin-top:2px;color:#64748b">' + esc(d.directoryGroup) + '</div>';
    }

    h += '<div style="margin-top:16px"><div class="section-title">Properties</div>';
    if (d.properties && d.properties.length) {
      h += '<ul class="prop-list">';
      for (var i = 0; i < d.properties.length; i++) {
        h += '<li>' + esc(d.properties[i].name) + ' <span class="prop-type">' + esc(d.properties[i].type || 'any') + '</span></li>';
      }
      h += '</ul>';
    } else { h += '<div class="empty-msg">None</div>'; }
    h += '</div>';

    h += '<div style="margin-top:12px"><div class="section-title">Internal State</div>';
    if (d.internalState && d.internalState.length) {
      h += '<ul class="prop-list">';
      for (var j = 0; j < d.internalState.length; j++) {
        h += '<li>' + esc(d.internalState[j].name) + ' <span class="prop-type">' + esc(d.internalState[j].type || 'any') + '</span></li>';
      }
      h += '</ul>';
    } else { h += '<div class="empty-msg">None</div>'; }
    h += '</div>';

    h += '<div style="margin-top:12px"><div class="section-title">Events Dispatched</div>';
    if (d.eventsDispatched && d.eventsDispatched.length) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
      for (var k = 0; k < d.eventsDispatched.length; k++) {
        h += '<span class="event-tag">' + esc(d.eventsDispatched[k]) + '</span>';
      }
      h += '</div>';
    } else { h += '<div class="empty-msg">None</div>'; }
    h += '</div>';

    var incoming = cy.edges('[target="' + d.id + '"]');
    var outgoing = cy.edges('[source="' + d.id + '"]');

    if (outgoing.length) {
      h += '<div style="margin-top:12px"><div class="section-title">Renders (' + outgoing.length + ')</div>';
      h += '<ul class="prop-list">';
      outgoing.forEach(function (e) {
        var ed = e.data();
        h += '<li>' + esc(ed.target);
        if (ed.propBindings && ed.propBindings.length) h += ' <span class="prop-type">' + esc(ed.propBindings.join(', ')) + '</span>';
        h += '</li>';
      });
      h += '</ul></div>';
    }

    if (incoming.length) {
      h += '<div style="margin-top:12px"><div class="section-title">Rendered by (' + incoming.length + ')</div>';
      h += '<ul class="prop-list">';
      incoming.forEach(function (e) { h += '<li>' + esc(e.data().source) + '</li>'; });
      h += '</ul></div>';
    }

    detailContent.innerHTML = h;
  }

  function showGroupDetail(d) {
    placeholder.style.display = 'none';
    detailContent.style.display = '';

    var colors = groupColorMap[d.id] || {};
    var h = '';
    h += '<h2 style="color:' + (colors.text || '#e2e8f0') + '">' + esc(d.rawLabel || d.label) + '</h2>';
    h += '<div class="class-name">' + d.childCount + ' components</div>';
    if (d.description) {
      h += '<div class="file-path" style="margin-top:4px;color:#94a3b8">' + esc(d.description) + '</div>';
    }
    h += '<div class="empty-msg" style="margin-top:4px">Double-click to ' + (d.collapsed ? 'expand' : 'collapse') + '</div>';

    h += '<div style="margin-top:16px"><div class="section-title">Components</div>';
    h += '<ul class="group-tag-list">';
    if (d.childTags) {
      for (var i = 0; i < d.childTags.length; i++) {
        h += '<li data-tag="' + esc(d.childTags[i]) + '">' + esc(d.childTags[i]) + '</li>';
      }
    }
    h += '</ul></div>';

    detailContent.innerHTML = h;

    // Allow clicking a tag in the group list to focus on it.
    detailContent.querySelectorAll('.group-tag-list li').forEach(function (li) {
      li.addEventListener('click', function () {
        var tag = this.getAttribute('data-tag');
        // If group is collapsed, expand it first.
        var groupId = d.id;
        if (d.collapsed) {
          expandGroup(groupId);
          reLayout(false);
        }
        // Then focus on the component.
        setTimeout(function () { enterFocus(tag); }, 100);
      });
    });
  }

  // ── Search ─────────────────────────────────────────────────
  var searchInput = document.getElementById('search');

  searchInput.addEventListener('input', function () {
    var q = this.value.trim().toLowerCase();
    if (!q) {
      cy.elements().removeClass('dimmed highlighted');
      return;
    }
    cy.batch(function () {
      cy.elements().addClass('dimmed').removeClass('highlighted');
      var matches = cy.nodes().filter(function (n) {
        if (!n.visible()) return false;
        var d = n.data();
        var label = (d.label || '').toLowerCase();
        var cls = (d.className || '').toLowerCase();
        var dir = (d.componentGroup || d.directoryGroup || d.rawLabel || '').toLowerCase();
        return label.includes(q) || cls.includes(q) || dir.includes(q);
      });
      matches.removeClass('dimmed').addClass('highlighted');
      matches.connectedEdges().removeClass('dimmed');
      matches.neighborhood().nodes().removeClass('dimmed');
      if (clusterEnabled) {
        matches.forEach(function (n) {
          var p = n.parent();
          if (p.length) p.removeClass('dimmed');
        });
      }
    });
  });

  // ── Toolbar buttons ────────────────────────────────────────
  document.getElementById('btn-fit').addEventListener('click', function () { cy.fit(undefined, 40); });
  document.getElementById('btn-reset').addEventListener('click', function () { reLayout(true); });

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
    this.textContent = sidebar.classList.contains('hidden') ? '\\u25B6' : '\\u25C0';
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
  var parts = filePath.replace(/\\\\\\\\/g, '/').split('/');
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
