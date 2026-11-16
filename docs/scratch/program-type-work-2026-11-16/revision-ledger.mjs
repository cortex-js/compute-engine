/** Read-only accounting; writes only this revision's report. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const repo = '/Users/arno/dev/compute-engine';
const folder = path.dirname(new URL(import.meta.url).pathname);
const previousFolder = path.join(repo, 'docs/scratch/program-accepted-measurements-2026-11-15');
const previous = JSON.parse(fs.readFileSync(path.join(previousFolder, 'deletion-ledger-final.json')));
const attribution = JSON.parse(fs.readFileSync(path.join(previousFolder, 'deletion-ledger-attribution-final.json')));
const accepted = '050a140880e56a9698fa61b99ef7205a53b651c9';
const changed = ['src/compute-engine/boxed-expression/boxed-function.ts', 'src/compute-engine/boxed-expression/broadcast-lift-type.ts', 'src/compute-engine/boxed-expression/derive-application-type.ts', 'src/compute-engine/boxed-expression/effects-inference.ts', 'src/compute-engine/collection-utils.ts'];
const priorRevision = JSON.parse(fs.readFileSync(path.join(repo, 'docs/scratch/program-profile-revision-2026-11-16/revision-ledger.json')));
const records = [...priorRevision.cumulative, ...changed.filter(file => !priorRevision.cumulative.some(r => r.file === file)).map(file => ({project:'CE', file}))];
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function command(args, exits = [0]) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!exits.includes(r.status)) throw Error(r.stderr);
  return r.stdout;
}
function codeLines(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) throw Error('Parse failure ' + file);
  const result = new Set();
  const line = p => sf.getLineAndCharacterOfPosition(p).line + 1;
  const visit = n => {
    if ((n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) || n.kind === ts.SyntaxKind.EndOfFileToken) return;
    const children = n.getChildren(sf);
    if (children.length) return children.forEach(visit);
    if (n.getEnd() > n.getStart(sf)) for (let i = line(n.getStart(sf)); i <= line(n.getEnd() - 1); i++) result.add(i);
  };
  visit(sf); return result;
}
const temp = fs.mkdtempSync('/private/tmp/program-revision-ledger-');
function count(before, after, file) {
  fs.writeFileSync(path.join(temp, 'before'), before); fs.writeFileSync(path.join(temp, 'after'), after);
  const diff = command(['diff', '--no-index', '--no-ext-diff', '--unified=0', '--', path.join(temp, 'before'), path.join(temp, 'after')], [0, 1]);
  const old = codeLines(before, file), fresh = codeLines(after, file);
  const totals = { physicalAdded: 0, physicalDeleted: 0, codeAdded: 0, codeDeleted: 0 };
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    for (const [start, length, code, suffix] of [[+m[1], m[2] === undefined ? 1 : +m[2], old, 'Deleted'], [+m[3], m[4] === undefined ? 1 : +m[4], fresh, 'Added']]) {
      totals['physical' + suffix] += length;
      for (let i = start; i < start + length; i++) if (code.has(i)) totals['code' + suffix]++;
    }
  }
  return totals;
}
try {
  const delta = changed.map(file => {
    const before = command(['show', accepted + ':' + file]), after = fs.readFileSync(path.join(repo, file), 'utf8');
    return { file, beforeHash: hash(before), afterHash: hash(after), ...count(before, after, file) };
  });
  const cumulative = records.map(r => {
    // Keep unrelated compiler changes out of the causal consolidation ledger.
    const root = r.project === 'Tycho' ? '/private/tmp/program-only-accepted-candidate-20261115/tycho' : changed.includes(r.file) ? '/private/tmp/program-only-type-work-revision-20261116/ce' : '/private/tmp/program-only-profile-revision-20261116/ce';
    const filename = path.join(root, r.file);
    const after = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : command(['show', accepted + ':' + r.file]);
    if (!changed.includes(r.file) && hash(after) !== r.afterHash) throw Error('Unchanged production hash differs: ' + r.file);
    const before = r.project === 'Tycho' ? fs.readFileSync(path.join(previous.tychoBefore, r.file), 'utf8') : command(['show', previous.baseline + ':' + r.file], [0, 128]);
    return { project: r.project, file: r.file, beforeHash: hash(before), afterHash: hash(after), ...count(before, after, r.file) };
  });
  // Every previously neutral fragment is in an unchanged production file.
  const neutralFiles = new Set([
    ...attribution.partialRelocationProofs.map(x => x.file),
    ...attribution.exactLineRelocationProofs.map(x => x.file),
    ...previous.exactBodyMoves.map(x => x.after.file),
  ]);
  for (const file of neutralFiles) if (changed.includes(file)) throw Error('Reprove neutral fragment: ' + file);
  const sum = rows => Object.fromEntries(['physicalAdded', 'physicalDeleted', 'codeAdded', 'codeDeleted'].map(k => [k, rows.reduce((n, r) => n + r[k], 0)]));
  const raw = sum(cumulative), neutral = { added: 79, deleted: 102 };
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const instrumentFiles = [...walk(folder).filter(f => /\.(mjs|py)$/.test(f)), ...['instrument', 'trace'].map(n => path.join(repo, 'benchmarks/program-type-work-' + n + '.mjs'))];
  const instruments = instrumentFiles.map(file => {
    const text = fs.readFileSync(file, 'utf8');
    return { file: path.relative(repo, file), physicalAdded: text.split('\n').length - Number(text.endsWith('\n')), physicalDeleted: 0, javascriptCodeAdded: file.endsWith('.mjs') ? codeLines(text, file).size : null };
  });
  const dataFiles = walk(folder).filter(f => /\.json$/.test(f) && !f.endsWith('/revision-ledger.json') && !f.endsWith('/ARTIFACT-HASHES.json'));
  const result = { accepted, baseline: previous.baseline, capturedAt: new Date().toISOString(), metric: previous.metric, delta, deltaTotals: sum(delta), cumulative, cumulativeRaw: raw, neutral, neutralPolicy: 'Prior reviewed neutral fragments remain byte-identical in unchanged files; no new neutral credit.', charged: { added: raw.codeAdded - neutral.added, deleted: raw.codeDeleted - neutral.deleted, net: raw.codeAdded - neutral.added - raw.codeDeleted + neutral.deleted }, tests: { added: 0, deleted: 0, snapshots: 0 }, instruments, instrumentTotals: { files: instruments.length, physicalAdded: instruments.reduce((n, r) => n + r.physicalAdded, 0), physicalDeleted: 0, javascriptCodeAdded: instruments.reduce((n, r) => n + (r.javascriptCodeAdded ?? 0), 0), pythonPhysicalAdded: instruments.filter(r => r.javascriptCodeAdded === null).reduce((n, r) => n + r.physicalAdded, 0) }, measurementData: { files: dataFiles.length, bytes: dataFiles.reduce((n, f) => n + fs.statSync(f).size, 0) } };
  fs.writeFileSync(path.join(folder, 'revision-ledger.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ delta: result.deltaTotals, cumulativeRaw: raw, charged: result.charged }));
} finally { fs.rmSync(temp, { recursive: true }); }
