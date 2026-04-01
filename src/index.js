import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { scanFiles } from './parser/file-scanner.js';
import { parseLitComponents } from './parser/lit-parser.js';
import { buildGraph } from './graph/graph-builder.js';
import { generateHtml } from './output/html-generator.js';

/**
 * Main orchestrator: scan → parse → graph → render.
 *
 * @param {OrchestrateOptions} options
 */
export async function orchestrate(options) {
  const {
    directory,
    glob = '**/*.{ts,js}',
    output = 'lit-graph.html',
    exclude = ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
    title = 'Lit Component Graph',
  } = options;

  // 1. Scan for files.
  console.log(`Scanning ${directory} for ${glob} …`);
  const files = await scanFiles(directory, glob, exclude);
  console.log(`  Found ${files.length} files`);

  if (files.length === 0) {
    console.log('No files found. Check your directory and glob pattern.');
    return;
  }

  // 2. Parse each file.
  /** @type {import('./parser/lit-parser.js').ComponentInfo[]} */
  const allComponents = [];

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf-8');
    const components = parseLitComponents(filePath, source);
    allComponents.push(...components);
  }

  console.log(`  Found ${allComponents.length} Lit components:`);
  for (const comp of allComponents) {
    const rel = relative(directory, comp.filePath);
    console.log(`    <${comp.tagName}>  (${rel})`);
  }

  if (allComponents.length === 0) {
    console.log('No Lit components found. Are the files using LitElement?');
    return;
  }

  // 3. Build graph.
  const graphData = buildGraph(allComponents);
  console.log(`\n  Graph: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`);

  // 4. Generate HTML.
  const html = generateHtml(graphData, { title });
  await writeFile(output, html, 'utf-8');

  console.log(`\n✓ Written to ${output}`);
}

/**
 * @typedef {object} OrchestrateOptions
 * @property {string} directory
 * @property {string} [glob]
 * @property {string} [output]
 * @property {string[]} [exclude]
 * @property {string} [title]
 */
