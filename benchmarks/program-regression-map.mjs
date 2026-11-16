/** Map only byte-proved diagnostic files; auxiliary code is never executed. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const folder = process.argv[2];
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function walk(p) { return fs.readdirSync(p, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(p, e.name)) : e.name.endsWith('.js') ? [path.join(p, e.name)] : []); }
function imports(text) {
  const sf = ts.createSourceFile('bundle.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), ranges = [], modules = [];
  const visit = n => {
    const v = (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) ? n.moduleSpecifier : ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword ? n.arguments[0] : undefined;
    if (v && ts.isStringLiteral(v)) {
      modules.push(v.text); const raw = v.getText(sf); const m = /chunk-([A-Z0-9]{8})\.js/.exec(raw);
      if (m) { const first = v.getStart(sf) + raw.indexOf(m[1]); ranges.push({ first, last: first + 8, value: m[1], specifier: v.text }); }
    }
    ts.forEachChild(n, visit);
  }; visit(sf); return { ranges, modules };
}
const normalized = (text, info) => { let s = text; for (const r of [...info.ranges].reverse()) s = s.slice(0, r.first) + '@@@@@@@@' + s.slice(r.last); return s; };
const proof = { policy: 'Only eight-character import chunk hashes restored. Complete restored JavaScript SHA must equal the original runtime SHA. No auxiliary code is executed. Sources/maps refer to identical frozen inputs.', arms: {}, mappings: [], unmapped: [] };
for (const arm of ['baseline', 'candidate']) {
  const root = `/private/tmp/program-only-accepted-${arm}-20261115/ce`, original = path.join(root, 'dist/esm-min'), auxiliary = path.join(folder, `maps-${arm}/dist/esm-min`);
  const reachable = new Set(), pending = ['epsil.js', 'compute-engine.js'].map(f => path.join(original, f));
  while (pending.length) {
    const p = pending.pop(); if (reachable.has(p)) continue; reachable.add(p);
    for (const name of imports(fs.readFileSync(p, 'utf8')).modules) if (name.startsWith('.')) { const f = path.resolve(path.dirname(p), name); if (fs.existsSync(f)) pending.push(f); }
  }
  const lookup = new Map();
  for (const file of reachable) {
    const text = fs.readFileSync(file, 'utf8'), info = imports(text), key = hash(normalized(text, info)), a = lookup.get(key) ?? [];
    a.push({ file, text, info, sha256: hash(text) }); lookup.set(key, a);
  }
  const matched = new Set();
  for (const file of walk(auxiliary)) {
    const text = fs.readFileSync(file, 'utf8'), info = imports(text), matches = lookup.get(hash(normalized(text, info))) ?? [];
    if (!matches.length) continue;
    if (new Set(matches.map(x => x.sha256)).size !== 1) { proof.unmapped.push({ arm, auxiliary: file, reason: 'Ambiguous reachable originals with different full SHA', matches: matches.map(x => x.file) }); continue; }
    const candidate = matches[0]; let restored = text;
    for (const r of [...info.ranges].reverse()) restored = restored.slice(0, r.first) + candidate.text.slice(r.first, r.last) + restored.slice(r.last);
    if (restored !== candidate.text) throw Error('Non-import byte difference ' + file);
    const verified = path.join(folder, `verified-${arm}`, path.relative(auxiliary, file)); fs.mkdirSync(path.dirname(verified), { recursive: true }); fs.writeFileSync(verified, restored);
    for (const match of matches) {
      matched.add(match.file);
      proof.mappings.push({ arm, original: match.file, originalURL: pathToFileURL(match.file).href, originalSha256: match.sha256, rawAuxiliary: file, rawAuxiliarySha256: hash(text), verifiedAuxiliary: verified, verifiedAuxiliarySha256: hash(restored), byteIdenticalAfterRestoration: true, positionsUnchanged: true, map: file + '.map', mapSha256: hash(fs.readFileSync(file + '.map')), restorations: info.ranges.filter(r => r.value !== match.text.slice(r.first, r.last)).map(r => ({ ...r, restored: match.text.slice(r.first, r.last) })) });
    }
  }
  proof.arms[arm] = { root, reachable: [...reachable], matched: [...matched], unmapped: [...reachable].filter(f => !matched.has(f)) };
}
fs.writeFileSync(path.join(folder, 'verified-source-map-proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ arms: Object.fromEntries(Object.entries(proof.arms).map(([k, v]) => [k, { reachable: v.reachable.length, matched: v.matched.length, unmapped: v.unmapped }])), mappings: proof.mappings.length }));
