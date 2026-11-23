// Port tool (not run in CI): converts the examples.tsv of statistics from the
// enumeratio repository into data rows. See PORTING notes in
// docs/combinatorics/COMBINATORICS.md.
//
//   node scripts/combinatorics/import-examples.ts --area permutations MajorIndex=<path/to/examples.tsv> ...
//
// The source cells are in notatio form (`[Head, arg, …]`), whose carrier
// constructors wrap elements: `[Permutation, [List, …]]`, `[IntegerPartition, …]`.
// This engine's elements are plain lists, so a wrapper is dropped. A FindStat
// row (`[CombinatorialStat, element, "'Head'"]`) becomes a call of the head.
// A row about another collection (tableaux, compositions, …) is dropped and
// listed. Rows are merged into data/combinatorics/examples/<area>.json by id.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

type Json = number | string | Json[];

function parseForm(text: string): Json {
  const tokens =
    text.match(
      /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|[[\],]|[A-Za-z_][A-Za-z0-9_]*/g
    ) ?? [];
  let i = 0;
  const value = (): Json => {
    const t = tokens[i++];
    if (t === '[') {
      const items: Json[] = [];
      while (tokens[i] !== ']') {
        items.push(value());
        if (tokens[i] === ',') i++;
      }
      i++;
      return items;
    }
    if (t.startsWith('"')) return t.slice(1, -1).replace(/^'|'$/g, '');
    if (/^-?\d/.test(t)) return Number(t);
    return t;
  };
  const result = value();
  if (i !== tokens.length) throw new Error(`trailing tokens in ${text}`);
  return result;
}

const WRAPPERS = new Set(['Permutation', 'IntegerPartition']);

/** Drop carrier wrappers; `undefined` when something other than a list is wrapped. */
function unwrap(node: Json): Json | undefined {
  if (!Array.isArray(node)) return node;
  if (WRAPPERS.has(node[0] as string) && node.length === 2)
    return unwrap(node[1]);
  const items = node.slice(1).map(unwrap);
  return items.includes(undefined as never)
    ? undefined
    : ([node[0], ...items] as Json);
}

const { values, positionals } = parseArgs({
  options: { area: { type: 'string' } },
  allowPositionals: true,
});
if (!values.area || positionals.length === 0) {
  console.error(
    'usage: import-examples.ts --area <area> Head=<examples.tsv>...'
  );
  process.exit(2);
}
const out = new URL(
  `../../data/combinatorics/examples/${values.area}.json`,
  import.meta.url
);
const heads = positionals.map((x) => x.split('=')[0]);

type Row = {
  id: string;
  head: string;
  input: Json;
  expected: Json;
  source: string;
};
const rows = new Map<string, Row>();
if (existsSync(out))
  for (const r of JSON.parse(readFileSync(out, 'utf8')).entries as Row[])
    rows.set(r.id, r);
const dropped: string[] = [];

for (const arg of positionals) {
  const [head, path] = arg.split('=');
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  const columns = lines[0].split('\t');
  const seen = new Set<string>(
    [...rows.values()]
      .filter((r) => r.head === head)
      .map((r) => JSON.stringify(r.input))
  );
  for (const line of lines.slice(1)) {
    const cell = Object.fromEntries(
      line.split('\t').map((v, k) => [columns[k], v])
    );
    let input = parseForm(cell.expr);
    if (
      Array.isArray(input) &&
      input[0] === 'CombinatorialStat' &&
      input[2] === head
    )
      input = [head, input[1]];
    const plain = unwrap(input);
    const ok =
      Array.isArray(plain) &&
      plain[0] === head &&
      plain.length === 2 &&
      Array.isArray(plain[1]) &&
      plain[1][0] === 'List' &&
      plain[1].slice(1).every((x) => typeof x === 'number');
    if (!ok) {
      dropped.push(`${head} ${cell.id}: ${cell.expr}`);
      continue;
    }
    const key = JSON.stringify(plain);
    if (seen.has(key)) {
      dropped.push(`${head} ${cell.id}: duplicate of an earlier row`);
      continue;
    }
    seen.add(key);
    // Source ids are only unique within a head ("the-one-line-word-312").
    const id =
      rows.get(cell.id)?.head === head || !rows.has(cell.id)
        ? cell.id
        : `${head}-${cell.id}`;
    rows.set(id, {
      id,
      head,
      input: plain as Json,
      expected: parseForm(cell.expected),
      source: cell.source ? cell.source : 'enumeratio reference',
    });
  }
}

const sorted = [...rows.values()].sort(
  (a, b) => heads.indexOf(a.head) - heads.indexOf(b.head) || 0
);
const body = sorted.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
writeFileSync(
  out,
  `{\n  "area": ${JSON.stringify(values.area)},\n  "entries": [\n${body}\n  ]\n}\n`
);
console.log(`${rows.size} rows written, ${dropped.length} dropped`);
for (const d of dropped) console.log('  dropped:', d);
