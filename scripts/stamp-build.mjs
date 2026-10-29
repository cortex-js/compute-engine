import { readdir, readFile, writeFile } from 'node:fs/promises';
import pkg from '../package.json' with { type: 'json' };
for (const entry of await readdir('dist', {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile() || !/\.(js|mjs|cjs|d\.ts)$/.test(entry.name)) continue;
  const path = `${entry.parentPath}/${entry.name}`;
  const source = await readFile(path, 'utf8');
  const stamped = source.replaceAll('{{SDK_VERSION}}', pkg.version);
  // Avoid touching unchanged declarations: their mtimes matter to incremental builds.
  if (stamped !== source) await writeFile(path, stamped);
}
