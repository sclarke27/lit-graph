/**
 * Build a directed graph from parsed Lit component metadata.
 *
 * Nodes = custom elements. Edges = "parent renders child in its template."
 * Each edge is annotated with the prop/event bindings used.
 *
 * @param {import('../parser/lit-parser.js').ComponentInfo[]} components
 * @returns {GraphData}
 */
export function buildGraph(components) {
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

    for (const [childTag, bindings] of childMap) {
      parentTags.add(comp.tagName);
      childTags.add(childTag);

      edges.push({
        source: comp.tagName,
        target: childTag,
        propBindings: [...bindings.propBindings],
        eventBindings: [...bindings.eventBindings],
      });
    }
  }

  // Build nodes with classification.
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

      return {
        id: comp.tagName,
        tagName: comp.tagName,
        className: comp.className,
        filePath: comp.filePath,
        properties: comp.properties,
        internalState: comp.internalState,
        eventsDispatched: comp.eventsDispatched,
        nodeType,
      };
    });

  return { nodes, edges };
}

/**
 * @typedef {object} GraphData
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
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
 */

/**
 * @typedef {object} GraphEdge
 * @property {string} source
 * @property {string} target
 * @property {string[]} propBindings
 * @property {string[]} eventBindings
 */
