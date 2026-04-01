import { dirname, relative, sep } from 'node:path';

/**
 * Build a directed graph from parsed Lit component metadata.
 *
 * Nodes = custom elements. Edges = "parent renders child in its template."
 * Each edge is annotated with the prop/event bindings used.
 *
 * Also computes:
 *  - directoryGroup per node (folder relative to the scan root)
 *  - depth per node (BFS distance from nearest root)
 *  - list of unique directory groups for the UI
 *
 * @param {import('../parser/lit-parser.js').ComponentInfo[]} components
 * @param {string} [rootDir] - Scan root directory for relative path grouping.
 * @returns {GraphData}
 */
export function buildGraph(components, rootDir) {
  // Index components by tag name for fast lookup.
  /** @type {Map<string, import('../parser/lit-parser.js').ComponentInfo>} */
  const byTag = new Map();
  for (const comp of components) {
    if (comp.tagName) {
      byTag.set(comp.tagName, comp);
    }
  }

  /** @type {GraphEdge[]} */
  const edges = [];

  // Track which tags appear as children (to classify roots vs leaves).
  const childTags = new Set();
  const parentTags = new Set();

  // Adjacency list for BFS depth computation.
  /** @type {Map<string, string[]>} */
  const childrenOf = new Map();

  for (const comp of components) {
    if (!comp.tagName) continue;

    // Deduplicate child usages — a parent may render the same child
    // multiple times (e.g. in a map). Merge bindings.
    /** @type {Map<string, { propBindings: Set<string>, eventBindings: Set<string> }>} */
    const childMap = new Map();

    for (const usage of comp.templateUsages) {
      // Only create edges for tags that are known components.
      if (!byTag.has(usage.tagName)) continue;

      if (!childMap.has(usage.tagName)) {
        childMap.set(usage.tagName, {
          propBindings: new Set(),
          eventBindings: new Set(),
        });
      }

      const entry = childMap.get(usage.tagName);
      for (const p of usage.propBindings) entry.propBindings.add(p);
      for (const e of usage.eventBindings) entry.eventBindings.add(e);
    }

    if (!childrenOf.has(comp.tagName)) childrenOf.set(comp.tagName, []);

    for (const [childTag, bindings] of childMap) {
      parentTags.add(comp.tagName);
      childTags.add(childTag);
      childrenOf.get(comp.tagName).push(childTag);

      edges.push({
        source: comp.tagName,
        target: childTag,
        propBindings: [...bindings.propBindings],
        eventBindings: [...bindings.eventBindings],
      });
    }
  }

  // BFS from all roots to compute depth.
  /** @type {Map<string, number>} */
  const depthMap = new Map();
  const roots = [];

  for (const comp of components) {
    if (!comp.tagName) continue;
    const isChild = childTags.has(comp.tagName);
    if (!isChild) {
      roots.push(comp.tagName);
      depthMap.set(comp.tagName, 0);
    }
  }

  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift();
    const currentDepth = depthMap.get(current);
    const children = childrenOf.get(current) || [];
    for (const child of children) {
      if (!depthMap.has(child)) {
        depthMap.set(child, currentDepth + 1);
        queue.push(child);
      }
    }
  }

  // Compute max depth for the UI slider.
  let maxDepth = 0;
  for (const d of depthMap.values()) {
    if (d > maxDepth) maxDepth = d;
  }

  // ── Component groups: cluster by root subtree ───────────────
  // BFS from each root to assign every component to a root's subtree.
  // Components reachable from multiple roots go to "shared".
  /** @type {Map<string, string>} */
  const componentGroupMap = new Map();

  for (const root of roots) {
    const bfsQueue = [root];
    const visited = new Set();
    while (bfsQueue.length > 0) {
      const tag = bfsQueue.shift();
      if (visited.has(tag)) continue;
      visited.add(tag);

      if (componentGroupMap.has(tag) && componentGroupMap.get(tag) !== root) {
        // Reachable from multiple roots — mark as shared.
        componentGroupMap.set(tag, '__shared__');
      } else if (!componentGroupMap.has(tag)) {
        componentGroupMap.set(tag, root);
      }

      const kids = childrenOf.get(tag) || [];
      for (const kid of kids) bfsQueue.push(kid);
    }
  }

  // Build group labels: root tag name, or "shared" for multi-root components.
  const componentGroups = new Set();

  // Compute directory groups from file paths.
  const directoryGroups = new Set();

  /** @type {GraphNode[]} */
  const nodes = components
    .filter((c) => c.tagName)
    .map((comp) => {
      const isParent = parentTags.has(comp.tagName);
      const isChild = childTags.has(comp.tagName);

      let nodeType;
      if (isParent && !isChild) nodeType = 'root';
      else if (isParent && isChild) nodeType = 'container';
      else nodeType = 'leaf';

      // Directory group.
      let dirGroup = '';
      if (rootDir) {
        const relPath = relative(rootDir, comp.filePath).split(sep).join('/');
        const relDir = dirname(relPath);
        dirGroup = relDir === '.' ? '(root)' : relDir;
      }
      directoryGroups.add(dirGroup);

      // Component group (by root subtree).
      const rawGroup = componentGroupMap.get(comp.tagName) || '';
      const compGroup = rawGroup === '__shared__' ? 'shared' : rawGroup;
      componentGroups.add(compGroup);

      return {
        id: comp.tagName,
        tagName: comp.tagName,
        className: comp.className,
        filePath: comp.filePath,
        properties: comp.properties,
        internalState: comp.internalState,
        eventsDispatched: comp.eventsDispatched,
        nodeType,
        directoryGroup: dirGroup,
        componentGroup: compGroup,
        depth: depthMap.get(comp.tagName) ?? 0,
      };
    });

  return {
    nodes,
    edges,
    maxDepth,
    directoryGroups: [...directoryGroups].sort(),
    componentGroups: [...componentGroups].sort(),
  };
}

/**
 * @typedef {object} GraphData
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
 * @property {number} maxDepth
 * @property {string[]} directoryGroups
 */

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {string} tagName
 * @property {string|null} className
 * @property {string} filePath
 * @property {{ name: string, type: string|null, attribute: boolean }[]} properties
 * @property {{ name: string, type: string|null }[]} internalState
 * @property {string[]} eventsDispatched
 * @property {'root'|'container'|'leaf'} nodeType
 * @property {string} directoryGroup
 * @property {number} depth
 */

/**
 * @typedef {object} GraphEdge
 * @property {string} source
 * @property {string} target
 * @property {string[]} propBindings
 * @property {string[]} eventBindings
 */
