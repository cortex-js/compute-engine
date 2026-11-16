/** Retarget reviewed relocation proofs only after a frozen primary capture. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const folder = path.dirname(new URL(import.meta.url).pathname);
const capture = JSON.parse(fs.readFileSync(path.join(folder, 'deletion-ledger-final.json'), 'utf8'));
const prior = JSON.parse(fs.readFileSync(path.join(folder, 'deletion-relocation-map.json'), 'utf8'));
const ts = createRequire('/Users/arno/dev/compute-engine/package.json')('typescript');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const loaded = new Map();
function source(file) {
  if (loaded.has(file)) return loaded.get(file);
  const record = capture.files.find(r => r.project === 'CE' && r.file === file);
  if (!record) throw Error('No frozen production record: ' + file);
  const result = spawnSync('git', ['show', capture.baseline + ':' + file], { cwd: capture.candidate, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw Error(result.stderr);
  const before = result.stdout, after = fs.readFileSync(record.livePath, 'utf8');
  if (hash(before) !== record.beforeHash || hash(after) !== record.afterHash) throw Error('Frozen capture mismatch: ' + file);
  function parse(text) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (sf.parseDiagnostics.length) throw Error('Parse error: ' + file);
    const line = pos => sf.getLineAndCharacterOfPosition(Math.max(0, pos)).line + 1;
    function leaves(n) {
      if ((n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) || n.kind === ts.SyntaxKind.EndOfFileToken) return [];
      const children = n.getChildren(sf);
      return children.length ? children.flatMap(leaves) : n.getEnd() > n.getStart(sf) ? [n] : [];
    }
    const nodes = [];
    function visit(n) {
      const tokens = leaves(n).map(x => x.getText(sf));
      nodes.push({ node: n, kind: ts.SyntaxKind[n.kind], first: line(n.getStart(sf)), last: line(Math.max(n.getStart(sf), n.getEnd() - 1)), tokenHash: hash(JSON.stringify(tokens)), tokenCount: tokens.length });
      ts.forEachChild(n, visit);
    }
    visit(sf);
    const perLine = new Map();
    for (const leaf of leaves(sf)) {
      for (let ln = line(leaf.getStart(sf)); ln <= line(leaf.getEnd() - 1); ln++) {
        const tokens = perLine.get(ln) ?? []; tokens.push(leaf.getText(sf)); perLine.set(ln, tokens);
      }
    }
    return { nodes, perLine, lineHash: ln => perLine.has(ln) ? hash(JSON.stringify(perLine.get(ln))) : undefined };
  }
  const value = { record, before: parse(before), after: parse(after) }; loaded.set(file, value); return value;
}
const approvedFragments = [], approvedExactLinePairs = [], excludedCandidates = [];
for (const f of prior.approvedFragments) {
  const s = source(f.file);
  const before = s.before.nodes.filter(n => n.kind === f.kind && n.first === f.beforeFirst && n.last === f.beforeLast && n.tokenHash === f.tokenHash);
  if (before.length !== 1) throw Error('Baseline proof no longer matches: ' + f.file + ':' + f.beforeFirst);
  let matches = s.after.nodes.filter(n => n.kind === f.kind && n.tokenHash === f.tokenHash);
  const unchangedFileProof = f.currentSourceHash === s.record.afterHash;
  if (unchangedFileProof) matches = matches.filter(n => n.first === f.afterFirst && n.last === f.afterLast);
  if (matches.length !== 1) { excludedCandidates.push({ ...f, reason: matches.length ? 'ambiguous identical candidate subtrees; zero neutral credit' : 'candidate code changed; zero neutral credit', candidateMatches: matches.length }); continue; }
  const n = matches[0];
  approvedFragments.push({ ...f, previousAfterFirst: f.afterFirst, previousAfterLast: f.afterLast, afterFirst: n.first, afterLast: n.last, currentSourceHash: s.record.afterHash, baselineSourceHash: s.record.beforeHash, retargetedBy: unchangedFileProof ? 'unchanged full-file hash plus reviewed AST-node position and exact token identity' : 'unique identical nontrivia AST leaf-token sequence and node kind' });
}
for (const f of prior.approvedExactLinePairs ?? []) {
  const s = source(f.file), tokenHash = s.before.lineHash(f.beforeLine);
  if(!s.record.changedCodeDeletedLines.includes(f.beforeLine)){ excludedCandidates.push({...f,reason:'baseline code line is no longer a deleted diff line; zero neutral credit'}); continue; }
  if (!tokenHash) throw Error('Baseline line has no AST code: ' + f.file + ':' + f.beforeLine);
  const priorFileHash = prior.approvedFragments.find(x => x.file === f.file)?.currentSourceHash;
  const unchangedFileProof = priorFileHash === s.record.afterHash && s.after.lineHash(f.afterLine) === tokenHash && s.record.changedCodeAddedLines.includes(f.afterLine);
  const matches = s.record.changedCodeAddedLines.filter(ln => s.after.lineHash(ln) === tokenHash);
  const target = unchangedFileProof ? f.afterLine : matches.length === 1 ? matches[0] : undefined;
  if (target === undefined) { excludedCandidates.push({ ...f, tokenHash, reason: matches.length ? 'ambiguous complete-line identity after source changed; zero neutral credit' : 'complete AST-code line changed; zero neutral credit', candidateMatches: matches.length }); continue; }
  approvedExactLinePairs.push({ ...f, previousAfterLine: f.afterLine, afterLine: target, tokenHash, currentSourceHash: s.record.afterHash, baselineSourceHash: s.record.beforeHash, retargetedBy: unchangedFileProof ? 'unchanged full-file hash plus complete AST-code line identity' : 'unique complete AST-code line token identity' });
}
// Reviewed extraction: the global-name guard keeps these complete statements.
// The new helper signature, static-check condition and changed wrapper stay charged.
const guardFile = 'src/compute-engine/engine-declarations.ts';
const guard = source(guardFile);
function ancestorName(node) { for (let n = node.parent; n; n = n.parent) if (ts.isFunctionDeclaration(n)) return n.name?.text; return undefined; }
const guardSelectors = [
  ['system scope declaration', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'systemScope')],
  ['global scope declaration', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'globalScope')],
  ['visible binding declaration', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'visible')],
  ['existing library-constant predicate and refusal', n => ts.isIfStatement(n) && n.expression.getText().includes('visible.value.isConstant')],
];
for (const [label, select] of guardSelectors) {
  const old = guard.before.nodes.filter(x => ancestorName(x.node) === 'declareFn' && select(x.node));
  if (old.length !== 1) throw Error('Global guard baseline selector is ambiguous: ' + label);
  const a = old[0], matches = guard.after.nodes.filter(x => x.kind === a.kind && x.tokenHash === a.tokenHash && ancestorName(x.node) === 'assertDeclarationName');
  if (matches.length !== 1) { excludedCandidates.push({ file: guardFile, label, beforeFirst: a.first, beforeLast: a.last, tokenHash: a.tokenHash, reason: 'extracted guard statement changed or ambiguous; zero neutral credit' }); continue; }
  const z = matches[0]; approvedFragments.push({ file: guardFile, beforeFirst: a.first, beforeLast: a.last, afterFirst: z.first, afterLast: z.last, kind: a.kind, tokenHash: a.tokenHash, tokenCount: a.tokenCount, rationale: 'Existing global-name guard statement extracted unchanged; new helper and checking-global condition remain charged.', baselineSourceHash: guard.record.beforeHash, currentSourceHash: guard.record.afterHash, retargetedBy: 'reviewed AST statement identity inside old declareFn and new assertDeclarationName' });
}
const result = { metric: prior.metric, capturedLedgerAt: capture.capturedAt, baseline: capture.baseline, approvedFragments, approvedExactLinePairs, excludedCandidates, policy: 'No fractional credit. Only complete AST-code lines fully covered by exact proved statements are neutral. Changed or ambiguous candidates are wholly charged and do not prevent gross accounting.' };
fs.writeFileSync(path.join(folder, 'deletion-relocation-map-final.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ approvedFragments: approvedFragments.length, approvedExactLinePairs: approvedExactLinePairs.length, excludedCandidates: excludedCandidates.length, sourceHashesVerified: true }));
