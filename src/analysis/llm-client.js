import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, relative } from 'node:path';
import { computeCacheKey, readCache, writeCache } from './cache.js';

/**
 * Simple HTTP POST using Node built-in modules.
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
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString();
          if (res.statusCode >= 400) {
            reject(new Error(`Ollama returned ${res.statusCode}: ${responseBody}`));
          } else {
            resolve(responseBody);
          }
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Analyze a component graph using an Ollama LLM to produce meaningful
 * architectural groupings.
 *
 * Uses CodeBoarding-style approach: pre-cluster with static analysis,
 * then make small per-cluster LLM calls to name and describe each group.
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
    timeout = 120000,
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

  // Step 1: Pre-cluster components by directory (static, instant).
  const clusters = buildDirectoryClusters(graphData.nodes, rootDir);
  console.log(`    Pre-clustered into ${clusters.length} directory groups`);

  // Step 2: For each cluster, ask the LLM to name and describe it.
  // Each call is tiny (~100-200 tokens).
  const groups = [];
  let completed = 0;

  for (const cluster of clusters) {
    completed++;
    const pct = Math.round((completed / clusters.length) * 100);
    process.stdout.write(`\r    Naming groups: ${completed}/${clusters.length} (${pct}%)`);

    const prompt = buildClusterPrompt(cluster);
    try {
      const named = await callOllama(ollamaUrl, model, prompt, timeout);
      groups.push({
        name: named.name || cluster.directory,
        description: named.description || '',
        components: cluster.tags,
      });
    } catch {
      // If LLM fails for this cluster, fall back to directory name.
      groups.push({
        name: prettifyDirName(cluster.directory),
        description: `Components from ${cluster.directory}/`,
        components: cluster.tags,
      });
    }
  }
  console.log(''); // newline after progress

  const result = { groups };

  // Validate.
  const allTags = new Set(graphData.nodes.map((n) => n.tagName));
  const validated = validateGrouping(result, allTags);

  // Cache.
  await writeCache(cacheDir, cacheKey, validated, {
    model,
    nodeCount: graphData.nodes.length,
  });

  return validated;
}

// ── Static pre-clustering ─────────────────────────────────────────

/**
 * @typedef {object} DirectoryCluster
 * @property {string} directory
 * @property {string[]} tags
 * @property {string[]} childDirs - Subdirectory names if any.
 */

/**
 * Group components by their top-level directory (1-2 levels deep).
 * Merges small directories into their parent to avoid too many clusters.
 *
 * @param {import('../graph/graph-builder.js').GraphNode[]} nodes
 * @param {string} rootDir
 * @returns {DirectoryCluster[]}
 */
function buildDirectoryClusters(nodes, rootDir) {
  // Group by full directory path.
  const byDir = {};
  for (const n of nodes) {
    const rel = relative(rootDir, n.filePath).replace(/\\/g, '/');
    const dir = rel.includes('/') ? dirname(rel) : '(root)';
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(n.tagName);
  }

  // Merge small directories (< 3 components) into their parent.
  // This reduces cluster count while keeping meaningful groups.
  const merged = {};
  for (const [dir, tags] of Object.entries(byDir)) {
    let groupDir = dir;

    if (tags.length < 3 && dir !== '(root)') {
      // Try parent directory.
      const parent = dirname(dir);
      if (parent !== '.' && parent !== dir) {
        groupDir = parent;
      }
    }

    if (!merged[groupDir]) merged[groupDir] = { tags: [], childDirs: new Set() };
    merged[groupDir].tags.push(...tags);
    if (groupDir !== dir) merged[groupDir].childDirs.add(dir);
  }

  return Object.entries(merged)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, data]) => ({
      directory: dir,
      tags: data.tags.sort(),
      childDirs: [...data.childDirs].sort(),
    }));
}

// ── Per-cluster LLM prompt ────────────────────────────────────────

/**
 * Build a tiny prompt asking the LLM to name one cluster.
 *
 * @param {DirectoryCluster} cluster
 * @returns {string}
 */
function buildClusterPrompt(cluster) {
  const tagList = cluster.tags.length <= 15
    ? cluster.tags.join(', ')
    : cluster.tags.slice(0, 10).join(', ') + `, ... (${cluster.tags.length} total)`;

  return `/nothink
Name this group of Lit web components from the "${cluster.directory}/" directory.

Components: ${tagList}

Respond with ONLY valid JSON:
{"name":"Short Group Name","description":"one sentence description"}`;
}

// ── Ollama API call ───────────────────────────────────────────────

/**
 * Call Ollama and parse the JSON response.
 *
 * @param {string} ollamaUrl
 * @param {string} model
 * @param {string} prompt
 * @param {number} timeout
 * @returns {Promise<object>}
 */
async function callOllama(ollamaUrl, model, prompt, timeout) {
  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: 'json',
    keep_alive: '10m',
    think: false,
    options: {
      temperature: 0.3,
      num_predict: 256,
      num_ctx: 2048,
    },
  });

  try {
    const responseText = await httpPost(`${ollamaUrl}/api/chat`, payload, timeout);
    const data = JSON.parse(responseText);
    const content = (data.message && data.message.content) || data.response || '';

    // Parse JSON.
    try {
      return JSON.parse(content);
    } catch { /* fall through */ }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch { /* fall through */ }
    }

    throw new Error('Invalid JSON response');
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

// ── Fallback directory name prettifier ────────────────────────────

/**
 * Convert a directory path like "src/components/auth" into "Auth".
 *
 * @param {string} dir
 * @returns {string}
 */
function prettifyDirName(dir) {
  const last = dir.split('/').pop() || dir;
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/[-_]/g, ' ');
}

// ── Response validation ───────────────────────────────────────────

/**
 * Validate and fix the LLM grouping.
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
      if (!allTags.has(tag)) continue;
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

  const missing = [];
  for (const tag of allTags) {
    if (!assignedTags.has(tag)) missing.push(tag);
  }

  if (missing.length > 0) {
    cleanGroups.push({
      name: 'Uncategorized',
      description: 'Components not assigned to a group',
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
