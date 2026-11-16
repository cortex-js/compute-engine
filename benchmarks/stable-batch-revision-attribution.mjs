// Preserve raw trees; self and inclusive category columns overlap and never sum.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping');
const [input, output, sitesFile] = process.argv.slice(2);
const sites = sitesFile ? JSON.parse(readFileSync(sitesFile, 'utf8')) : [];
const profile = JSON.parse(readFileSync(input, 'utf8'));
const maps = new Map();
const identities = new Map();
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function mapped(frame) {
  let path = frame.url;
  if (path.startsWith('file:')) path = fileURLToPath(path);
  if (!maps.has(path)) maps.set(path, existsSync(`${path}.map`) ? new TraceMap(JSON.parse(readFileSync(`${path}.map`, 'utf8'))) : null);
  const map = maps.get(path);
  if (map && !identities.has(path)) identities.set(path, { generated: path, generatedSha256: sha256(path), map: `${path}.map`, mapSha256: sha256(`${path}.map`) });
  const original = map ? originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber }) : null;
  return { function: original?.name ?? frame.functionName, source: original?.source ?? frame.url,
    line: original?.line ?? frame.lineNumber + 1, column: original?.column ?? frame.columnNumber,
    mapped: !!original?.source, generated: frame };
}
const nodes = profile.nodes ?? [];
const cpu = Array.isArray(profile.samples) && nodes.length > 0;
const rows = new Map();
function row(frame) {
  const value = mapped(frame); const key = JSON.stringify(value);
  if (!rows.has(key)) rows.set(key, { ...value, self: 0, inclusive: 0, positionTicks: [] });
  return rows.get(key);
}
if (cpu) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) if (node.positionTicks) row(node.callFrame).positionTicks.push({ generatedFrame: node.callFrame, ticks: node.positionTicks });
  const parents = new Map(nodes.flatMap((node) => (node.children ?? []).map((child) => [child, node.id])));
  for (let i = 0; i < profile.samples.length; i++) {
    const weight = profile.timeDeltas?.[i] ?? 1;
    let id = profile.samples[i];
    row(byId.get(id).callFrame).self += weight;
    const seen = new Set();
    while (id !== undefined) {
      const value = row(byId.get(id).callFrame);
      if (!seen.has(value)) { value.inclusive += weight; seen.add(value); }
      id = parents.get(id);
    }
  }
} else {
  function visit(node, ancestors = new Set()) {
    const value = row(node.callFrame); value.self += node.selfSize;
    const active = new Set([...ancestors, value]);
    for (const ancestor of active) ancestor.inclusive += node.selfSize;
    for (const child of node.children) visit(child, active);
  }
  visit(profile.head);
}
const sorted = [...rows.values()].sort((a, b) => b.self - a.self);
writeFileSync(output, JSON.stringify({ input, metric: cpu ? 'sampled microseconds' : 'estimated allocation bytes',
  interpretation: 'Inclusive rows overlap, including recursive stacks; do not add them. Call-frame positions and original mapped columns identify function entries, not executing or allocating instructions. Distinct callback or handler frames may identify a mechanism; whole-run self cost leaves internal dispatch, argument allocation, and approximation unresolved. Preserved positionTicks use generated lines; a minified single line cannot recover precise instruction columns. Missing site matches mean unsupported attribution, never zero cost. Unmapped frames remain explicit. Allocation stacks estimate bytes including collected objects, not exact physical allocation counts.',
  sites: sites.map((site) => {
    const matches = sorted.filter((row) => row.source.endsWith(site.source) && row.line >= site.firstLine && row.line <= site.lastLine && (site.firstColumn === undefined || row.column >= site.firstColumn) && (site.lastColumn === undefined || row.column <= site.lastColumn));
    return { ...site, attribution: matches.length ? 'function-entry matches only; inspect callbacks and stacks before assigning mechanism cost' : 'unsupported: no distinct function-entry attribution; not zero cost', matches };
  }),
  sourceMapIdentities: [...identities.values()], rows: sorted }, null, 2) + '\n');
