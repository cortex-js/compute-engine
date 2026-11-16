/** Separate main-only measurement artifact costs from the candidate patch. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const folder = path.dirname(new URL(import.meta.url).pathname);
const repo = '/Users/arno/dev/compute-engine';
const ledger = JSON.parse(fs.readFileSync(path.join(folder, 'deletion-ledger-final.json'), 'utf8'));
const ts = createRequire(path.join(repo, 'package.json'))('typescript');
const relativeFolder = path.relative(repo, folder);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const generatedOutputs = new Set(['FINAL-ARTIFACT-HASHES.json','deletion-ledger-final.json', 'deletion-ledger-final.md', 'deletion-ledger-attribution-final.json', 'deletion-ledger-attribution-final.md', 'deletion-relocation-map-final.json', 'final-support-inventory.json', 'final-support-inventory.md']);
const git = argv => { const r = spawnSync('git', argv, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); if (r.status !== 0) throw Error(r.stderr); return r.stdout; };
const oldPaths = new Set(git(['ls-tree', '-r', '--name-only', ledger.baseline, '--', relativeFolder]).split('\n').filter(Boolean));
function walk(root) { return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(root, e.name)) : e.isFile() ? [path.join(root, e.name)] : []); }
function measure(data, file) {
  const binary = /\.(?:gz|zip|png|pdf)$/.test(file) || data.includes(0);
  if (binary) return { bytes: data.length, physical: null, code: null, binary: true };
  const text = data.toString('utf8'), physical = text.length ? text.split('\n').length - Number(text.endsWith('\n')) : 0;
  let code = null;
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS), lines = new Set();
    if (sf.parseDiagnostics.length) throw Error('Support instrument parse failure: ' + file);
    function visit(n) {
      if ((n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) || n.kind === ts.SyntaxKind.EndOfFileToken) return;
      const children = n.getChildren(sf); if (children.length) return children.forEach(visit);
      const first = n.getStart(sf), end = n.getEnd();
      if (end > first) for (let ln = sf.getLineAndCharacterOfPosition(first).line; ln <= sf.getLineAndCharacterOfPosition(end - 1).line; ln++) lines.add(ln + 1);
    }
    visit(sf); code = lines.size;
  }
  return { bytes: data.length, physical, code, binary: false };
}
const files = [], duplicatesExcluded = [];
for (const absolute of walk(folder).sort()) {
  const name = path.basename(absolute); if (generatedOutputs.has(name) || name.startsWith('final-ledger-capture-')) continue;
  const file = path.relative(repo, absolute), data = fs.readFileSync(absolute);
  const candidateRecord = ledger.files.find(r => r.project === 'CE' && r.file === file);
  if (candidateRecord) {
    if (candidateRecord.afterHash !== hash(data)) throw Error('Main-only artifact conflicts with candidate patch: ' + file);
    duplicatesExcluded.push(file); continue;
  }
  const before = oldPaths.has(file) ? Buffer.from(git(['show', ledger.baseline + ':' + file]), 'utf8') : Buffer.alloc(0);
  if (hash(before) === hash(data)) continue;
  const category = /\.(?:[cm]?[jt]sx?|py|sh)$/.test(file) ? 'Measurement instrument source' : /\.md$/.test(file) ? 'Measurement reports' : 'Measurement raw data/logs';
  files.push({ file, category, beforeHash: hash(before), afterHash: hash(data), before: measure(before, file), after: measure(data, file), productionCredit: 0 });
}
const summary = {};
for (const f of files) {
  const s = summary[f.category] ??= { files: 0, binaryFiles: 0, addedBytes: 0, deletedBytes: 0, textPhysicalAdded: 0, textPhysicalDeleted: 0, measuredAstCodeAdded: 0, measuredAstCodeDeleted: 0 };
  s.files++; s.binaryFiles += Number(f.after.binary || f.before.binary); s.addedBytes += f.after.bytes; s.deletedBytes += f.before.bytes;
  s.textPhysicalAdded += f.after.physical ?? 0; s.textPhysicalDeleted += f.before.physical ?? 0; s.measuredAstCodeAdded += f.after.code ?? 0; s.measuredAstCodeDeleted += f.before.code ?? 0;
}
const changedDuringRead = files.filter(f => hash(fs.readFileSync(path.join(repo, f.file))) !== f.afterHash).map(f => f.file);
const result = { baseline: ledger.baseline, primaryCapturedAt: ledger.capturedAt, capturedAt: new Date().toISOString(), scope: relativeFolder, productionCredit: 0, policy: 'Main-only support artifacts are not production additions/deletions. Whole-file added/deleted sizes are reported against the fixed baseline; generated FINAL output files are excluded to avoid recursive self-counting. Raw logs/data are separate from instrument source. Binary archives have bytes but no physical/AST line claim. Only JS/TS instrument code receives the AST metric; Python/shell and data have physical counts only.', generatedOutputsExcluded: [...generatedOutputs], duplicatesExcluded, changedDuringRead, summary, files };
if (changedDuringRead.length) throw Error('Support artifacts changed during capture: ' + changedDuringRead.join(', '));
fs.writeFileSync(path.join(folder, 'final-support-inventory.json'), JSON.stringify(result, null, 2) + '\n');
const md = ['# Separate measurement support inventory', '', result.policy, '', '| Category | Files | Binary | Bytes added/deleted | Text physical added/deleted | JS/TS AST code added/deleted |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
for (const [name, s] of Object.entries(summary)) md.push(`| ${name} | ${s.files} | ${s.binaryFiles} | ${s.addedBytes}/${s.deletedBytes} | ${s.textPhysicalAdded}/${s.textPhysicalDeleted} | ${s.measuredAstCodeAdded}/${s.measuredAstCodeDeleted} |`);
md.push('', 'Candidate tests, editor fixtures, snapshots and user-facing documentation remain separate categories in deletion-ledger-final.json. This support inventory is additive only for main-only artifacts not present in that candidate capture; duplicate paths are explicitly excluded. External cortex documentation is outside this inventory and remains the coordinator’s separate report.', '', `Stable artifact hashes: ${changedDuringRead.length === 0}. Production credit:0.`);
fs.writeFileSync(path.join(folder, 'final-support-inventory.md'), md.join('\n') + '\n');
console.log(JSON.stringify({ summary, changedDuringRead, productionCredit: 0 }));
