import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { relative } from 'node:path';
import { computeCacheKey, readCache, writeCache } from './cache.js';

/**
 * Simple HTTP POST using Node built-in modules.
 * Avoids Node fetch quirks that can cause hangs with Ollama.
 *
 * @param {string} url
 * @param {string} body - JSON string.
 * @param {number} timeout - Milliseconds.
 * @returns {Promise<string>} Response body.
 */
function httpPost(url, body, timeout) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

    console.log(`    POST ${url} (${Buffer.byteLength(body)} bytes, timeout: ${timeout / 1000}s)`);

    const req = reqFn(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout,
      },
      (res) => {
        console.log(`    Response status: ${res.statusCode}`);
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
          if (chunks.length === 1) console.log('    Receiving data…');
        });
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString();
          console.log(`    Response complete (${responseBody.length} bytes)`);
          if (res.statusCode >= 400) {
            reject(new Error(`Ollama returned ${res.statusCode}: ${responseBody}`));
          } else {
            resolve(responseBody);
          }
        });
      },
    );

    req.on('error', (err) => {
      console.log(`    Request error: ${err.message}`);
      reject(err);
    });
    req.on('timeout', () => {
      console.log('    Request timed out');
      req.destroy();
      reject(new Error('TIMEOUT'));
    });

    req.write(body);
    req.end();
    console.log('    Request sent, waiting for response…');
  });
}

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
  const approxTokens = Math.ceil(prompt.length / 4);
  console.log(`    Prompt: ${prompt.length} chars (~${approxTokens} tokens)`);

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
  const nodeCount = graphData.nodes.length;
  const isLarge = nodeCount > 50;

  // For large projects, group components by directory and show as a tree.
  // For small projects, list individually.
  let componentSection;

  if (isLarge) {
    // Group by directory, just list tag names per directory.
    const byDir = {};
    for (const n of graphData.nodes) {
      const rel = relative(rootDir, n.filePath).replace(/\\/g, '/');
      const dir = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '(root)';
      if (!byDir[dir]) byDir[dir] = [];
      byDir[dir].push(n.tagName);
    }
    const dirLines = Object.entries(byDir)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dir, tags]) => `  ${dir}/: ${tags.join(', ')}`);
    componentSection = `COMPONENTS BY DIRECTORY (${nodeCount} total):\n${dirLines.join('\n')}`;
  } else {
    const componentLines = graphData.nodes.map((n) => {
      const rel = relative(rootDir, n.filePath).replace(/\\/g, '/');
      const parts = [`path: ${rel}`, `type: ${n.nodeType}`];
      if (n.eventsDispatched.length) parts.push(`events: [${n.eventsDispatched.join(', ')}]`);
      return `  - <${n.tagName}> (${parts.join(', ')})`;
    });
    componentSection = `COMPONENTS (${nodeCount} total):\n${componentLines.join('\n')}`;
  }

  // Relationships: for large graphs, show as adjacency list (parent: [children]).
  let relationSection;

  if (isLarge) {
    const adj = {};
    for (const e of graphData.edges) {
      if (!adj[e.source]) adj[e.source] = [];
      adj[e.source].push(e.target);
    }
    const adjLines = Object.entries(adj)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([parent, children]) => `  ${parent} -> ${children.join(', ')}`);
    relationSection = `COMPONENT TREE (${graphData.edges.length} edges):\n${adjLines.join('\n')}`;
  } else {
    const edgeLines = graphData.edges.map((e) => {
      const bindings = [];
      if (e.propBindings.length) bindings.push(`props: ${e.propBindings.join(', ')}`);
      if (e.eventBindings.length) bindings.push(`events: ${e.eventBindings.join(', ')}`);
      const suffix = bindings.length ? ` [${bindings.join('; ')}]` : '';
      return `  - <${e.source}> renders <${e.target}>${suffix}`;
    });
    relationSection = `RELATIONSHIPS (${graphData.edges.length} total):\n${edgeLines.join('\n')}`;
  }

  // Architectural signals — keep concise.
  const signalLines = [];

  if (archSignals.sharedComponents.length) {
    const shared = archSignals.sharedComponents.map((s) => s.tagName);
    signalLines.push(`Shared components (used by 3+ parents): ${shared.join(', ')}`);
  }

  if (archSignals.routes.length) {
    const hosts = archSignals.routes.map((r) => r.hostTag);
    signalLines.push(`Route hosts: ${hosts.join(', ')}`);
  }

  // For service imports, summarize by category instead of listing each one.
  if (archSignals.serviceImports.length) {
    const byCat = {};
    for (const s of archSignals.serviceImports) {
      if (!byCat[s.category]) byCat[s.category] = new Set();
      byCat[s.category].add(s.tagName);
    }
    for (const [cat, tags] of Object.entries(byCat)) {
      signalLines.push(`Components using ${cat} imports: ${[...tags].join(', ')}`);
    }
  }

  // Path hints — summarize by role.
  if (archSignals.pathHints.length) {
    const byRole = {};
    for (const h of archSignals.pathHints) {
      if (!byRole[h.inferredRole]) byRole[h.inferredRole] = [];
      byRole[h.inferredRole].push(h.tagName);
    }
    for (const [role, tags] of Object.entries(byRole)) {
      signalLines.push(`${role} components: ${tags.join(', ')}`);
    }
  }

  // Build a complete tag list for the LLM to reference.
  const allTags = graphData.nodes.map((n) => n.tagName).sort();

  return `/nothink
Group these ${nodeCount} Lit web components into logical application sections.

${componentSection}

${relationSection}

SIGNALS:
${signalLines.length ? signalLines.join('\n') : '(none)'}

ALL TAGS (for reference):
${allTags.join(', ')}

RULES:
- Every tag above must appear in exactly one group
- Use descriptive group names (e.g. "Authentication", "Dashboard", "Navigation", "Shared UI Kit")
- Aim for 4-10 groups
- Components used everywhere go in "Shared Components"

Respond with ONLY valid JSON:
{"groups":[{"name":"string","description":"string","components":["tag-name"]}]}`;
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
  try {
    const payload = JSON.stringify({
      model,
      messages: [
        { role: 'user', content: prompt },
      ],
      stream: false,
      format: 'json',
      keep_alive: '10m',
      think: false,
      options: {
        temperature: 0.3,
        num_predict: 4096,
        num_ctx: 8192,
      },
    });

    const responseText = await httpPost(`${ollamaUrl}/api/chat`, payload, timeout);
    const data = JSON.parse(responseText);
    const content = (data.message && data.message.content) || data.response || '';

    // Parse JSON from the response.
    const grouping = parseJsonResponse(content);
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
    const errMsg = err.message || '';
    if (errMsg.includes('TIMEOUT')) {
      throw new Error(`LLM request timed out after ${timeout / 1000}s`);
    }
    if (
      errMsg.includes('ECONNREFUSED') ||
      errMsg.includes('ECONNRESET') ||
      errMsg.includes('ETIMEDOUT') ||
      errMsg.includes('connect')
    ) {
      throw new Error(
        `Could not connect to Ollama at ${ollamaUrl}. Is the server running?\n` +
        `  Start Ollama or run without --analyze.`,
      );
    }
    throw err;
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
