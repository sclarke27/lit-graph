#!/usr/bin/env node

import { program } from 'commander';
import { resolve } from 'node:path';
import { orchestrate } from '../src/index.js';

program
  .name('lit-graph')
  .description('Generate an interactive component graph from Lit web component projects')
  .version('0.1.0')
  .argument('[directory]', 'Root directory to scan', '.')
  .option('-g, --glob <pattern>', 'Glob pattern for files', '**/*.{ts,js}')
  .option('-o, --output <file>', 'Output HTML file', 'lit-graph.html')
  .option('-e, --exclude <pattern...>', 'Glob patterns to exclude')
  .option('-t, --title <title>', 'Graph title', 'Lit Component Graph')
  .action(async (directory, opts) => {
    try {
      await orchestrate({
        directory: resolve(directory),
        glob: opts.glob,
        output: resolve(opts.output),
        exclude: opts.exclude || ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
        title: opts.title,
      });
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse();
