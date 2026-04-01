import { relative } from 'node:path';
import { computeCacheKey, readCache, writeCache } from './cache.js';

/**
 * Analyze a component graph using an Ollama LLM to produce meaningful
 * architectural groupings.
 *
 * @param {import('../graph/graph-builder.js').GraphData} graphData
 * @param {import('./arch-signals.js').ArchSignals} archSignals
 * @param {LlmOptions} options
 * @returns {Promise<LlmGrouping>}
 */
export async function analyzeWithLlm(graphData, archSignals, options) {
  const {
    ollamaUrl = 'http://10.0.0.15:11434',
    model = 'qwen3:32b',
    timeout = 600000,
    cacheDir = '.lit-graph-cache',
    rootDir = '.',
  } = options;

  // Check cache first.
  const cacheKey = computeCacheKey(graphData, model);
  const cached = await readCache(cacheDir, cacheKey);
  if (cached) {
    console.log('    (using cached analysis)');
    return cached;
  }

  // Build the prompt.
  const prompt = buildPrompt(graphData, archSignals, rootDir);

  // Call Ollama.
  let result = await callOllama(ollamaUrl, model, prompt, timeout);

  // Validate and fix the response.
  const allTags = new Set(graphData.nodes.map((n) => n.tagName));
  result = validateGrouping(result, allTags);

  // Cache the result.
  await writeCache(cacheDir, cacheKey, result, {
    model,
    nodeCount: graphData.nodes.length,
  });

  return result;
}

// ── Prompt construction ───────────────────────────────────────────

/**
 * Build the analysis prompt for the LLM.
 *
 * @param {import('../graph/graph-builder.js').GraphData} graphData
 * @param {import('./arch-signals.js').ArchSignals} archSignals
 * @param {string} rootDir
 * @returns {string}
 */
function buildPrompt(graphData, archSignals, rootDir) {
  // Component list.
  const componentLines = graphData.nodes.map((n) => {
    const rel = relative(rootDir, n.filePath).replace(/\\/g, '/');
    const parts = [`path: ${rel}`, `type: ${n.nodeType}`, `depth: ${n.depth}`];
    if (n.properties.length) parts.push(`props: ${n.properties.length}`);
    if (n.internalState.length) parts.push(`state: ${n.internalState.length}`);
    if (n.eventsDispatched.length) parts.push(`events: [${n.eventsDispatched.join(', ')}]`);
    return `  - <${n.tagName}> (${parts.join(', ')})`;
  });

  // Relationships. For large graphs, skip binding details to keep prompt manageable.
  const isLargeGraph = graphData.edges.length > 80;
  const edgeLines = graphData.edges.map((e) => {
    if (isLargeGraph) {
      return `  - <${e.source}> renders <${e.target}>`;
    }
    const bindings = [];
    if (e.propBindings.length) bindings.push(`props: ${e.propBindings.join(', ')}`);
    if (e.eventBindings.length) bindings.push(`events: ${e.eventBindings.join(', ')}`);
    const suffix = bindings.length ? ` [${bindings.join('; ')}]` : '';
    return `  - <${e.source}> renders <${e.target}>${suffix}`;
  });

  // Architectural signals.
  const signalLines = [];

  if (archSignals.routes.length) {
    signalLines.push('Route hosts:');
    for (const r of archSignals.routes) {
      const detail = r.hasRouterImport ? '(has router import)' : `(renders ${r.childCount} children)`;
      signalLines.push(`  - <${r.hostTag}> ${detail} -> [${r.targetTags.join(', ')}]`);
    }
  }

  if (archSignals.serviceImports.length) {
    signalLines.push('Service/API imports:');
    for (const s of archSignals.serviceImports) {
      signalLines.push(`  - <${s.tagName}> imports ${s.specifiers.join(', ')} from "${s.importSource}" (${s.category})`);
    }
  }

  if (archSignals.sharedComponents.length) {
    signalLines.push('Shared components (used by 3+ parents):');
    for (const s of archSignals.sharedComponents) {
      signalLines.push(`  - <${s.tagName}> used by ${s.parentCount} parents: [${s.parentTags.join(', ')}]`);
    }
  }

  if (archSignals.pathHints.length) {
    signalLines.push('Path-based role hints:');
    for (const h of archSignals.pathHints) {
      signalLines.push(`  - <${h.tagName}> -> ${h.inferredRole} (from "${h.segment}/" directory)`);
    }
  }

  return `You are analyzing a Lit web component project to understand its architecture.
Given the component graph and architectural signals below, group the components into logical application sections.

COMPONENTS (${graphData.nodes.length} total):
${componentLines.join('\n')}

RELATIONSHIPS (${graphData.edges.length} total):
${edgeLines.join('\n')}

ARCHITECTURAL SIGNALS:
${signalLines.length ? signalLines.join('\n') : '  (none detected)'}

INSTRUCTIONS:
- Group these components into logical sections that reflect the app's architecture
- Use descriptive names like "Authentication", "Dashboard", "Navigation", "Shared UI Kit", "Settings", "Data Visualization", etc.
- Every component tag must appear in exactly one group
- Components used across many features should go in a "Shared Components" group
- Root shell/app components can go in an "App Shell" group
- Prefer fewer, larger groups over many tiny ones (aim for 3-8 groups)

/no_think
Respond with ONLY valid JSON, no markdown fences, no explanation, no thinking:
{"groups":[{"name":"string","description":"one line description","components":["tag-name"]}]}`;
}

// ── Ollama API call ───────────────────────────────────────────────

/**
 * Call Ollama's generate API and parse the JSON response.
 *
 * @param {string} ollamaUrl
 * @param {string} model
 * @param {string} prompt
 * @param {number} timeout
 * @param {boolean} [isRetry]
 * @returns {Promise<LlmGrouping>}
 */
async function callOllama(ollamaUrl, model, prompt, timeout, isRetry = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
        keep_alive: '10m',
        options: {
          temperature: 0.3,
          num_predict: 4096,
          num_ctx: 32768,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const responseText = data.response || '';

    // Parse JSON from the response.
    const grouping = parseJsonResponse(responseText);
    if (grouping) return grouping;

    // If parsing failed, retry once with a stricter prompt.
    if (!isRetry) {
      console.log('    LLM response was not valid JSON, retrying…');
      const retryPrompt = prompt +
        '\n\nYour previous response was not valid JSON. Please respond with ONLY the JSON object, no other text.';
      return callOllama(ollamaUrl, model, retryPrompt, timeout, true);
    }

    throw new Error('LLM did not return valid JSON after retry');
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeout / 1000}s`);
    }
    const errMsg = err.message || '';
    const causeCode = err.cause && err.cause.code;
    if (
      causeCode === 'ECONNREFUSED' ||
      causeCode === 'ECONNRESET' ||
      causeCode === 'ETIMEDOUT' ||
      errMsg.includes('fetch failed') ||
      errMsg.includes('ECONNREFUSED')
    ) {
      throw new Error(
        `Could not connect to Ollama at ${ollamaUrl}. Is the server running?\n` +
        `  Start Ollama or run without --analyze.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attempt to parse an LLM response string as LlmGrouping JSON.
 *
 * @param {string} text
 * @returns {LlmGrouping|null}
 */
function parseJsonResponse(text) {
  // Try direct parse.
  try {
    const parsed = JSON.parse(text);
    if (parsed.groups && Array.isArray(parsed.groups)) return parsed;
  } catch { /* fall through */ }

  // Try extracting JSON from markdown fences or surrounding text.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.groups && Array.isArray(parsed.groups)) return parsed;
    } catch { /* fall through */ }
  }

  return null;
}

// ── Response validation ───────────────────────────────────────────

/**
 * Validate and fix the LLM grouping to ensure correctness.
 *
 * - Every known tag appears in exactly one group.
 * - No hallucinated tags (tags not in the graph).
 * - Missing tags go to "Uncategorized".
 *
 * @param {LlmGrouping} grouping
 * @param {Set<string>} allTags
 * @returns {LlmGrouping}
 */
function validateGrouping(grouping, allTags) {
  const assignedTags = new Set();
  const cleanGroups = [];

  for (const group of grouping.groups) {
    if (!group.name || !Array.isArray(group.components)) continue;

    const validComponents = [];
    for (const tag of group.components) {
      // Skip hallucinated tags.
      if (!allTags.has(tag)) continue;
      // Skip duplicates (keep first occurrence).
      if (assignedTags.has(tag)) continue;

      assignedTags.add(tag);
      validComponents.push(tag);
    }

    if (validComponents.length > 0) {
      cleanGroups.push({
        name: group.name,
        description: group.description || '',
        components: validComponents,
      });
    }
  }

  // Add any missing tags to Uncategorized.
  const missing = [];
  for (const tag of allTags) {
    if (!assignedTags.has(tag)) {
      missing.push(tag);
    }
  }

  if (missing.length > 0) {
    cleanGroups.push({
      name: 'Uncategorized',
      description: 'Components not assigned to a group by the analysis',
      components: missing.sort(),
    });
  }

  return { groups: cleanGroups };
}

/**
 * @typedef {object} LlmGrouping
 * @property {LlmGroup[]} groups
 */

/**
 * @typedef {object} LlmGroup
 * @property {string} name
 * @property {string} description
 * @property {string[]} components
 */

/**
 * @typedef {object} LlmOptions
 * @property {string} [ollamaUrl]
 * @property {string} [model]
 * @property {number} [timeout]
 * @property {string} [cacheDir]
 * @property {string} [rootDir]
 */
