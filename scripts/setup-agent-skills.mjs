import {
  readdirSync,
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const canonical = join(root, '.agents/skills');
const destination = join(root, '.claude/skills');
const names = readdirSync(canonical, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(join(canonical, entry.name, 'SKILL.md'))
  )
  .map((entry) => entry.name);

// Check every destination before writing: an existing local skill is never replaced.
const missing = [];
for (const name of names) {
  const target = join(canonical, name);
  const link = join(destination, name);
  let entry;
  try {
    entry = lstatSync(link);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!entry) {
    missing.push({ target, link });
    continue;
  }
  if (
    entry.isSymbolicLink() &&
    existsSync(link) &&
    realpathSync(link) === realpathSync(target)
  )
    continue;
  throw new Error(
    `${relative(root, link)} already exists; move it aside before running setup:agents`
  );
}
mkdirSync(destination, { recursive: true });
for (const { target, link } of missing) {
  const windows = process.platform === 'win32';
  symlinkSync(
    windows ? resolve(target) : relative(destination, target),
    link,
    windows ? 'junction' : 'dir'
  );
}
console.log(
  `PASS agent skills (${names.length} shared, ${missing.length} links created)`
);
