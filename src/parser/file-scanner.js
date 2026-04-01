import fg from 'fast-glob';
import { resolve } from 'node:path';

/**
 * Scan a directory for JS/TS files matching a glob pattern.
 *
 * @param {string} directory - Root directory to scan.
 * @param {string} globPattern - Glob pattern for file matching.
 * @param {string[]} excludePatterns - Glob patterns to exclude.
 * @returns {Promise<string[]>} Sorted list of absolute file paths.
 */
export async function scanFiles(
  directory,
  globPattern = '**/*.{ts,js}',
  excludePatterns = ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
) {
  const absoluteDir = resolve(directory);

  const files = await fg(globPattern, {
    cwd: absoluteDir,
    absolute: true,
    ignore: excludePatterns,
    onlyFiles: true,
  });

  return files.sort();
}
