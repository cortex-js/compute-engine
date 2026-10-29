import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';

const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8')
).scripts;
// Maintained entry points, not archived plans or generated API examples.
const defaults = [
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'BUILD.md',
  'CODING-STYLEGUIDE.md',
  'ARCHITECTURE.md',
  'docs/README.md',
  'docs/REVIEW-CHECKLIST.md',
  'docs/COMPUTE-ENGINE-BOX-SPECIFICS.md',
];
function skillFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? skillFiles(path)
      : entry.name === 'SKILL.md'
        ? [path]
        : [];
  });
}
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((file) => resolve(file))
  : [
      ...defaults.map((file) => resolve(root, file)),
      ...skillFiles(resolve(root, '.agents/skills')),
    ];
const failures = [];
function walk(node, callback) {
  callback(node);
  for (const child of node.children ?? []) walk(child, callback);
}
for (const file of files) {
  let tree;
  try {
    tree = fromMarkdown(readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${relative(root, file)}: ${error.message}`);
    continue;
  }
  const definitions = new Map();
  walk(tree, (node) => {
    if (node.type === 'definition' && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  const fail = (node, message) =>
    failures.push(
      `${relative(root, file)}:${node.position.start.line}: ${message}`
    );
  walk(tree, (node) => {
    if (
      node.type === 'link' ||
      node.type === 'image' ||
      node.type === 'linkReference' ||
      node.type === 'imageReference'
    ) {
      const url = node.url ?? definitions.get(node.identifier);
      if (!url) {
        fail(node, `Unresolved link reference: ${node.identifier}`);
        return;
      }
      // Site routes, external URLs and same-page anchors aren't repository file references.
      if (!/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) {
        try {
          const path = decodeURIComponent(url.split(/[?#]/)[0]);
          if (path && !existsSync(resolve(dirname(file), path)))
            fail(node, `Missing file: ${url}`);
        } catch {
          fail(node, `Invalid file link: ${url}`);
        }
      }
    }
    if (['inlineCode', 'code', 'text'].includes(node.type)) {
      for (const match of (node.value ?? '').matchAll(
        /\bnpm\s+run\s+(?:"([^"]+)"|'([^']+)'|([^\s`"'|&;<>]+))/g
      )) {
        const name = match[1] ?? match[2] ?? match[3];
        if (name.startsWith('-')) continue;
        // Try exact names before trimming punctuation used in surrounding prose.
        const proseName = match[3] ? name.replace(/[.,:!?)]+$/, '') : name;
        if (!Object.hasOwn(scripts, name) && !Object.hasOwn(scripts, proseName))
          fail(node, `Unknown npm script: ${name}`);
      }
    }
  });
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`PASS documentation references (${files.length} files)`);
