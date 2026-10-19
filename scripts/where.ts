/** List every place that defines, parses, serializes, compiles or tests one
 * operator, grouped by part of the engine.
 *
 * The first section comes from the running engine: the operator's signature,
 * its description, the definition flags that are set, and how `[Name, x]`
 * serializes to LaTeX and parses back. The rest comes from a ripgrep search
 * (`rg` must be on the PATH) for the name as a whole word. Comment lines are
 * skipped unless `--comments` is given, because names such as `Add` or `Sum`
 * also appear as English words.
 *
 * The LaTeX commands of the operator come from two places: the
 * `latexTrigger` of each entry of the runtime LaTeX dictionary
 * (`LATEX_DICTIONARY`) whose `name` is the operator, and the mapping tables
 * in `latex-syntax/` (for example `'\\arcoth': 'Arcoth'`) found in the search
 * hits. The test files are also searched for those commands as whole words,
 * so tests written only in LaTeX are found.
 *
 * The search runs from the repository root, so the script works from any
 * directory.
 *
 * Options:
 *   --max <n>       Lines shown per source file (default 6).
 *   --tests <n>     Test files shown (default 15), most hits first.
 *   --comments      Include comment lines.
 *
 * Example:
 *   npx tsx scripts/where.ts Arcoth
 */
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ComputeEngine } from '../src/compute-engine';
import { LATEX_DICTIONARY } from '../src/compute-engine/latex-syntax/dictionary/default-dictionary';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    max: { type: 'string', default: '6' },
    tests: { type: 'string', default: '15' },
    comments: { type: 'boolean', default: false },
  },
});

if (
  positionals.length !== 1 ||
  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(positionals[0])
) {
  console.error(
    'Usage: npx tsx scripts/where.ts [--max n] [--tests n] [--comments] <OperatorName>'
  );
  process.exit(2);
}
const name = positionals[0];
const maxLines = Number(values.max);

//
// Runtime definition
//
// When the output goes to a pipe that closes early (`| head`), stop quietly
// instead of crashing with an EPIPE stack trace.
process.stdout.on('error', (err: { code?: string }) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const ce = new ComputeEngine();
const def = ce.lookupDefinition(name);
console.log(`== ${name} ==`);
if (!def) {
  console.log('Not defined in the engine (no library definition).');
} else if (!('operator' in def)) {
  console.log('Defined as a symbol, not an operator.');
} else {
  const op = def.operator as unknown as Record<string, unknown>;
  const signature = op.signature as { toString(): string } | undefined;
  console.log(`signature    ${signature?.toString() ?? '?'}`);
  if (typeof op.description === 'string' || Array.isArray(op.description)) {
    const text = [op.description].flat().join(' ').replace(/\s+/g, ' ');
    console.log(
      `description  ${text.length > 160 ? text.slice(0, 157) + '...' : text}`
    );
  }
  // Boolean flags whose `true` value changes how the engine treats the
  // operator. A flag that is `false` or missing is not printed.
  const flags = [
    'lazy',
    'broadcastable',
    'associative',
    'commutative',
    'idempotent',
    'involution',
    'inspectsErrors',
    'evaluatesOperands',
  ].filter((f) => op[f] === true);
  if (op.scoped) flags.push('scoped');
  // `threadsConditionals` is `true` or a list of the operand positions that
  // are threaded.
  if (op.threadsConditionals === true) flags.push('threadsConditionals');
  else if (
    Array.isArray(op.threadsConditionals) &&
    op.threadsConditionals.length > 0
  )
    flags.push(`threadsConditionals[${op.threadsConditionals.join(',')}]`);
  const handlers = [
    'canonical',
    'evaluate',
    'evaluateAsync',
    'compile',
    'derivative',
    'sgn',
  ].filter((h) => typeof op[h] === 'function');
  console.log(`flags        ${flags.join(', ') || '(none)'}`);
  console.log(`handlers     ${handlers.join(', ') || '(none)'}`);
  // Every boxed operator definition has a `holdClass`, `'evaluate'` by
  // default, so only a different value is printed.
  if (op.holdClass && op.holdClass !== 'evaluate')
    console.log(`holdClass    ${String(op.holdClass)}`);
}
try {
  // A symbol is shown by itself. An operator is shown applied to as many
  // symbol arguments as its signature requires: its required arguments, plus
  // one when the variadic argument cannot be empty, and two for an operator
  // that has only a variadic argument (such as `Add`), so that the sample is
  // not reduced to its single argument. An unknown name gets one argument.
  const signature =
    def && 'operator' in def
      ? ((def.operator as unknown as { signature?: { type?: unknown } })
          .signature?.type as
          | {
              kind?: string;
              args?: unknown[];
              variadicArg?: unknown;
              variadicMin?: number;
            }
          | undefined)
      : undefined;
  let arity = 1;
  if (signature?.kind === 'signature') {
    const required = signature.args?.length ?? 0;
    arity =
      required === 0 && signature.variadicArg
        ? 2
        : Math.max(1, required + (signature.variadicMin === 1 ? 1 : 0));
  }
  const args = ['x', 'y', 'z', 'u', 'v', 'w'].slice(0, arity);
  const sample =
    def && !('operator' in def) ? ce.symbol(name) : ce.expr([name, ...args]);
  if (def && !('operator' in def))
    console.log(`type         ${sample.type.toString()}`);
  const latex = sample.latex;
  const back = ce.parse(latex);
  const roundTrip = back.isSame(sample)
    ? 'round trip ok'
    : `parses back as ${JSON.stringify(back.json)}`;
  console.log(
    `latex        ${JSON.stringify(sample.json)} -> ${latex}   (${roundTrip})`
  );
} catch (err) {
  console.log(
    `latex        THROWS: ${err instanceof Error ? err.message : err}`
  );
}

//
// Source search
//
type Hit = { file: string; line: number; text: string };

// The directories `src` and `test` are relative to the repository root, which
// is the parent of the directory of this script.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function rg(pattern: string, dirs: string[], fixed = false): Hit[] {
  let out = '';
  try {
    out = execFileSync(
      'rg',
      [
        '-n',
        '--no-heading',
        '--null',
        '--type',
        'ts',
        // A fixed string is also matched as a whole word, so `\\sin` does not
        // match `\\sinh`. A leading backslash is not a word character, so the
        // match can still follow a quote.
        ...(fixed ? ['-F', '-w'] : ['-w']),
        '--',
        pattern,
        ...dirs,
      ],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, cwd: repoRoot }
    );
  } catch (err) {
    const e = err as { status?: number; code?: string; stdout?: string };
    if (e.code === 'ENOENT') {
      console.error('ripgrep (rg) is not on the PATH');
      process.exit(2);
    }
    // ripgrep exits with status 1 when nothing matches, and with status 2
    // when there was an error (for example a file it could not read), even
    // if it found matches in other files. Keep those matches.
    if (e.status === 1) return [];
    if (e.status === 2 && e.stdout) out = e.stdout;
    else throw err;
  }
  const hits: Hit[] = [];
  // With `--null`, each row is the path, a NUL byte, then `line:text`. The
  // path can contain `:`, so it is not split on `:`. On Windows the path uses
  // `\`; it is changed to `/` so the group tests below match.
  for (const row of out.split('\n')) {
    const nul = row.indexOf('\0');
    if (nul < 0) continue;
    const m = /^(\d+):(.*)$/.exec(row.slice(nul + 1));
    if (m)
      hits.push({
        file: row.slice(0, nul).replace(/\\/g, '/'),
        line: Number(m[1]),
        text: m[2],
      });
  }
  return hits;
}

const isComment = (text: string) => /^\s*(\/\/|\*|\/\*)/.test(text);
const keep = (h: Hit) => values.comments || !isComment(h.text);

const srcHits = rg(name, ['src']).filter(keep);

// Groups in display order. The first group whose test accepts the file wins.
const groups: [string, (file: string) => boolean][] = [
  ['Library', (f) => f.includes('/library/')],
  ['LaTeX syntax', (f) => f.includes('/latex-syntax/')],
  ['Compile targets', (f) => f.includes('/compilation/')],
  [
    'Symbolic (simplify, derivative, integration)',
    (f) => f.includes('/symbolic/'),
  ],
  ['Rubi integration rules', (f) => f.includes('/rubi/')],
  ['Boxed expressions', (f) => f.includes('/boxed-expression/')],
  ['Numerics', (f) => f.includes('/numerics/')],
  ['Epsil', (f) => f.startsWith('src/epsil/')],
  ['Other source', () => true],
];

const byGroup = new Map<string, Map<string, Hit[]>>();
for (const hit of srcHits) {
  const group = groups.find(([, test]) => test(hit.file))![0];
  const files = byGroup.get(group) ?? new Map<string, Hit[]>();
  files.set(hit.file, [...(files.get(hit.file) ?? []), hit]);
  byGroup.set(group, files);
}

// A library definition entry is a line `Name: {` at the start of an object
// property. Mark it so the definition stands out among the other hits.
const definitionLine = new RegExp(`^\\s*${name}:\\s*\\{`);

for (const [group] of groups) {
  const files = byGroup.get(group);
  if (!files) continue;
  console.log(`\n-- ${group} --`);
  for (const [file, hits] of files) {
    for (const h of hits.slice(0, maxLines)) {
      const mark =
        definitionLine.test(h.text) && group === 'Library'
          ? ' <- definition'
          : '';
      console.log(`${file}:${h.line}  ${h.text.trim().slice(0, 110)}${mark}`);
    }
    if (hits.length > maxLines)
      console.log(`${file}  ... and ${hits.length - maxLines} more`);
  }
}

//
// LaTeX commands mapped to the operator
//
const commands = new Set<string>();
// The triggers of the runtime dictionary entries named after the operator.
// In an entry, `name` and `latexTrigger` are often on different source lines,
// so the search hits alone do not find them.
for (const entry of (LATEX_DICTIONARY as unknown[]).flat(2)) {
  const e = entry as { name?: unknown; latexTrigger?: unknown } | null;
  if (!e || typeof e !== 'object' || e.name !== name) continue;
  for (const token of [e.latexTrigger].flat())
    if (typeof token === 'string' && /^\\[A-Za-z]+$/.test(token))
      commands.add(token);
}
// The mapping tables (for example `'\\arcoth': 'Arcoth'`) and the triggers
// written on the same line as the name, for commands that are not in the
// runtime dictionary.
const mapping = new RegExp(`'(\\\\\\\\[A-Za-z]+)'\\s*:\\s*'${name}'`);
const trigger = /latexTrigger:\s*\[?\s*'(\\\\[A-Za-z]+)'/;
for (const hit of srcHits.filter((h) => h.file.includes('/latex-syntax/'))) {
  const m = mapping.exec(hit.text) ?? trigger.exec(hit.text);
  // The source spells a backslash as `\\`; the LaTeX command has one.
  if (m) commands.add(m[1].replace(/\\\\/g, '\\'));
}
if (commands.size > 0)
  console.log(`\nLaTeX commands: ${[...commands].join(', ')}`);

//
// Tests
//
const testCounts = new Map<string, number>();
const testHits = [
  ...rg(name, ['test']),
  // In a test file the command is usually written inside a string, so the
  // backslash is doubled.
  ...[...commands].flatMap((c) => rg(c.replace(/\\/g, '\\\\'), ['test'], true)),
];
for (const h of testHits)
  testCounts.set(h.file, (testCounts.get(h.file) ?? 0) + 1);
const sorted = [...testCounts].sort((a, b) => b[1] - a[1]);
console.log(`\n-- Tests (${sorted.length} files) --`);
for (const [file, n] of sorted.slice(0, Number(values.tests)))
  console.log(`${String(n).padStart(4)}  ${file}`);
if (sorted.length > Number(values.tests))
  console.log(
    `      ... and ${sorted.length - Number(values.tests)} more files`
  );
