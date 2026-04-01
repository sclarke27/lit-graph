import { dirname, relative, sep } from 'node:path';

/**
 * Extract higher-level architectural signals from parsed components
 * and the graph edges. These signals feed the LLM prompt to help it
 * understand the app's structure beyond just parent-child rendering.
 *
 * @param {import('../parser/lit-parser.js').ComponentInfo[]} components
 * @param {import('../graph/graph-builder.js').GraphEdge[]} edges
 * @param {string} rootDir - Scan root for relative paths.
 * @returns {ArchSignals}
 */
export function extractArchSignals(components, edges, rootDir) {
  const componentPaths = new Set(
    components.map((c) => c.filePath),
  );

  // Collect all resolved import paths from components to know which
  // imports point to component files vs external modules/services.
  const componentResolvedPaths = new Set();
  for (const comp of components) {
    for (const imp of comp.imports) {
      if (imp.resolvedPath) {
        // Normalize: imports might omit extensions.
        componentResolvedPaths.add(imp.resolvedPath);
        componentResolvedPaths.add(imp.resolvedPath + '.ts');
        componentResolvedPaths.add(imp.resolvedPath + '.js');
      }
    }
  }

  return {
    routes: detectRoutes(components),
    serviceImports: detectServiceImports(components, componentPaths),
    sharedComponents: detectSharedComponents(edges),
    pathHints: detectPathHints(components, rootDir),
  };
}

// ── Route detection ───────────────────────────────────────────────

const ROUTER_KEYWORDS = [
  'router', 'route', 'routing',
  '@vaadin/router', '@lit-labs/router',
  'page.js', 'navigo',
];

/**
 * Detect components that appear to be route hosts or pages.
 *
 * Heuristics:
 * 1. Component imports a router-related package.
 * 2. Component is a root/container that renders 3+ distinct child tags
 *    (suggests conditional page rendering).
 *
 * @param {import('../parser/lit-parser.js').ComponentInfo[]} components
 * @returns {RouteInfo[]}
 */
function detectRoutes(components) {
  /** @type {RouteInfo[]} */
  const routes = [];

  for (const comp of components) {
    if (!comp.tagName) continue;

    // Check for router imports.
    const routerImport = comp.imports.find((imp) =>
      ROUTER_KEYWORDS.some((kw) => imp.source.toLowerCase().includes(kw)),
    );

    // Check if this component renders many children (potential page host).
    const childTags = [...new Set(comp.templateUsages.map((u) => u.tagName))];
    const isPageHost = childTags.length >= 3;

    if (routerImport || isPageHost) {
      routes.push({
        hostTag: comp.tagName,
        hasRouterImport: !!routerImport,
        childCount: childTags.length,
        targetTags: childTags,
      });
    }
  }

  return routes;
}

// ── Service/API import detection ──────────────────────────────────

const CATEGORY_PATTERNS = [
  { keywords: ['service', 'api', 'client', 'fetch', 'http', 'graphql', 'rest'], category: 'api' },
  { keywords: ['store', 'state', 'redux', 'context', 'mobx', 'observable', 'signal'], category: 'store' },
  { keywords: ['util', 'helper', 'mixin', 'lib', 'common', 'shared'], category: 'util' },
];

/**
 * Identify non-component imports (services, stores, utilities).
 *
 * @param {import('../parser/lit-parser.js').ComponentInfo[]} components
 * @param {Set<string>} componentPaths - Absolute paths of known component files.
 * @returns {ServiceImport[]}
 */
function detectServiceImports(components, componentPaths) {
  /** @type {ServiceImport[]} */
  const results = [];

  for (const comp of components) {
    if (!comp.tagName) continue;

    for (const imp of comp.imports) {
      // Skip side-effect imports (likely component registrations).
      if (imp.isSideEffect) continue;

      // Skip imports that resolve to known component files.
      if (imp.resolvedPath) {
        const isComponent =
          componentPaths.has(imp.resolvedPath) ||
          componentPaths.has(imp.resolvedPath + '.ts') ||
          componentPaths.has(imp.resolvedPath + '.js');
        if (isComponent) continue;
      }

      // Skip lit/lit-element framework imports.
      if (imp.source.startsWith('lit') || imp.source === '@lit/reactive-element') continue;

      // Categorize by path keywords.
      const sourceLower = imp.source.toLowerCase();
      let category = 'unknown';
      for (const { keywords, category: cat } of CATEGORY_PATTERNS) {
        if (keywords.some((kw) => sourceLower.includes(kw))) {
          category = cat;
          break;
        }
      }

      // Only report categorized imports or named imports from relative paths.
      if (category !== 'unknown' || (imp.resolvedPath && imp.specifiers.length > 0)) {
        results.push({
          tagName: comp.tagName,
          importSource: imp.source,
          specifiers: imp.specifiers.map((s) => s.name),
          category,
        });
      }
    }
  }

  return results;
}

// ── Shared component detection ────────────────────────────────────

/**
 * Find components that are rendered by 3+ different parents.
 *
 * @param {import('../graph/graph-builder.js').GraphEdge[]} edges
 * @returns {SharedComponentInfo[]}
 */
function detectSharedComponents(edges) {
  /** @type {Map<string, Set<string>>} */
  const parentMap = new Map();

  for (const edge of edges) {
    if (!parentMap.has(edge.target)) {
      parentMap.set(edge.target, new Set());
    }
    parentMap.get(edge.target).add(edge.source);
  }

  /** @type {SharedComponentInfo[]} */
  const shared = [];
  for (const [tag, parents] of parentMap) {
    if (parents.size >= 3) {
      shared.push({
        tagName: tag,
        parentCount: parents.size,
        parentTags: [...parents],
      });
    }
  }

  return shared.sort((a, b) => b.parentCount - a.parentCount);
}

// ── Path hint detection ───────────────────────────────────────────

const PATH_ROLE_MAP = {
  pages: 'page',
  views: 'page',
  routes: 'page',
  screens: 'page',
  components: 'component',
  shared: 'shared-ui',
  common: 'shared-ui',
  ui: 'shared-ui',
  atoms: 'shared-ui',
  molecules: 'shared-ui',
  organisms: 'feature',
  layouts: 'layout',
  layout: 'layout',
  features: 'feature',
  modules: 'feature',
  sections: 'feature',
};

/**
 * Infer component roles from their file paths.
 *
 * @param {import('../parser/lit-parser.js').ComponentInfo[]} components
 * @param {string} rootDir
 * @returns {PathHint[]}
 */
function detectPathHints(components, rootDir) {
  /** @type {PathHint[]} */
  const hints = [];

  for (const comp of components) {
    if (!comp.tagName) continue;

    const relPath = relative(rootDir, comp.filePath).split(sep).join('/');
    const segments = dirname(relPath).split('/').filter(Boolean);

    for (const segment of segments) {
      const lower = segment.toLowerCase();
      if (PATH_ROLE_MAP[lower]) {
        hints.push({
          tagName: comp.tagName,
          segment,
          inferredRole: PATH_ROLE_MAP[lower],
        });
        break; // Use the first matching segment.
      }
    }
  }

  return hints;
}

/**
 * @typedef {object} ArchSignals
 * @property {RouteInfo[]} routes
 * @property {ServiceImport[]} serviceImports
 * @property {SharedComponentInfo[]} sharedComponents
 * @property {PathHint[]} pathHints
 */

/**
 * @typedef {object} RouteInfo
 * @property {string} hostTag
 * @property {boolean} hasRouterImport
 * @property {number} childCount
 * @property {string[]} targetTags
 */

/**
 * @typedef {object} ServiceImport
 * @property {string} tagName
 * @property {string} importSource
 * @property {string[]} specifiers
 * @property {string} category
 */

/**
 * @typedef {object} SharedComponentInfo
 * @property {string} tagName
 * @property {number} parentCount
 * @property {string[]} parentTags
 */

/**
 * @typedef {object} PathHint
 * @property {string} tagName
 * @property {string} segment
 * @property {string} inferredRole
 */
