import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Compute a content-addressed cache key from the graph topology and model.
 * Only the component tag names, edge structure, and model name are hashed —
 * file paths and metadata changes don't invalidate the cache.
 *
 * @param {import('../graph/graph-builder.js').GraphData} graphData
 * @param {string} model
 * @returns {string} Hex SHA-256 hash.
 */
export function computeCacheKey(graphData, model) {
  const tags = graphData.nodes.map((n) => n.tagName).sort();
  const edges = graphData.edges
    .map((e) => `${e.source}>${e.target}`)
    .sort();

  const payload = JSON.stringify({ tags, edges, model });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Read a cached LLM grouping result.
 *
 * @param {string} cacheDir
 * @param {string} key
 * @returns {Promise<import('./llm-client.js').LlmGrouping|null>}
 */
export async function readCache(cacheDir, key) {
  try {
    const filePath = join(cacheDir, `${key}.json`);
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return data.result || null;
  } catch {
    return null;
  }
}

/**
 * Write an LLM grouping result to the cache.
 *
 * @param {string} cacheDir
 * @param {string} key
 * @param {import('./llm-client.js').LlmGrouping} result
 * @param {{ model: string, nodeCount: number }} meta
 */
export async function writeCache(cacheDir, key, result, meta) {
  try {
    await mkdir(cacheDir, { recursive: true });
    const filePath = join(cacheDir, `${key}.json`);
    const data = {
      result,
      meta: { ...meta, timestamp: new Date().toISOString() },
    };
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Cache write failure is non-fatal — silently ignore.
  }
}
