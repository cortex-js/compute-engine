/** Read-only source accounting. Writes only its JSON/Markdown reports. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const k = args.indexOf(name);
  return k < 0 ? fallback : args[k + 1];
};
const repo = option('--repo', '/Users/arno/dev/compute-engine');
const candidate = option('--candidate', '/tmp/wt-program-accepted-sol');
const baseline = option('--baseline', 'ffff1d44fc566ef01fb52a0ce67b6797797f4dcf');
const tychoBefore = option('--tycho-before', '/private/tmp/program-accepted-tycho-before');
const tychoLive = option('--tycho-live', '/Users/arno/dev/tycho');
const output = option('--output', path.dirname(new URL(import.meta.url).pathname));
const phase = option('--phase', 'FINAL-SOURCE-FREEZE');
const ts = createRequire(path.join(repo, 'package.json'))('typescript');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const command = (argv, cwd = candidate, allowed = [0]) => {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!allowed.includes(r.status)) throw Error(`${argv.join(' ')}: ${r.status}: ${r.stderr}`);
  return r.stdout;
};
const git = (...argv) => command(['git', ...argv]);
const physicalLines = (s) => s.length === 0 ? 0 : s.split('\n').length - Number(s.endsWith('\n'));
const range = (first, count) => Array.from({ length: count }, (_, k) => first + k);
const intersection = (a, b) => new Set([...a].filter((x) => b.has(x)));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const parseable = (p) => /\.(?:[cm]?[jt]sx?)$/.test(p);
const category = (p, project) => {
  if (project === 'Tycho') return 'Tycho production';
  if (p.includes('__snapshots__/') || p.endsWith('.snap')) return 'Snapshots';
  if (p.startsWith('vscode-epsil/test/')) return 'Editor tests/fixtures';
  if (p.startsWith('test/')) return 'CE tests/fixtures';
  if (p.startsWith('docs/scratch/') || p.startsWith('scripts/')) return 'Instruments/scripts';
  if (/\.md$/.test(p)) return 'Documentation';
  if (p.startsWith('src/') || p.startsWith('vscode-epsil/src/')) return 'CE production';
  return 'Other';
};
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'program-ledger-'));
let parseDiagnostics = [];
function parse(text, file) {
  if (!parseable(file)) return { code: new Set(), declarations: [], bodies: [], identifiers: [] };
  const kind = /\.(?:[cm]?js|jsx)$/.test(file) ? ts.ScriptKind.JS : file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  parseDiagnostics.push(...sf.parseDiagnostics.map((d) => ({ file, start: d.start, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') })));
  const line = (pos) => sf.getLineAndCharacterOfPosition(Math.max(0, pos)).line + 1;
  const code = new Set();
  const leaves = (node) => {
    if ((node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) || node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const children = node.getChildren(sf);
    if (children.length) return children.forEach(leaves);
    const a = node.getStart(sf, false), z = node.getEnd();
    if (z > a) for (let n = line(a); n <= line(z - 1); n++) code.add(n);
  };
  leaves(sf);
  const declarations = [], bodies = [], identifiers = [];
  const visit = (node) => {
    if (ts.isIdentifier(node)) identifiers.push({ name: node.text, line: line(node.getStart(sf)) });
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      const a = node.getStart(sf, false), z = node.getEnd();
      const first = line(a), last = line(z - 1);
      declarations.push({ name: node.name.text, first, last, physical: last - first + 1, code: [...code].filter((n) => n >= first && n <= last).length });
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.body && ts.isBlock(node.body)) {
      const body = node.body, start = body.getStart(sf), end = body.getEnd();
      let first = line(start), last = line(end - 1);
      const starts = sf.getLineStarts();
      if (text.slice(starts[first - 1], start).trim()) first++;
      const endOfLine = text.indexOf('\n', end);
      if (text.slice(end, endOfLine < 0 ? text.length : endOfLine).trim()) last--;
      const lines = [...code].filter((n) => n >= first && n <= last);
      if (lines.length >= 5) bodies.push({ name: node.name?.getText(sf) ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(sf) : '<anonymous>'), first, last, lines, hash: hash(body.getText(sf)) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { code, declarations, bodies, identifiers };
}
function difference(before, after) {
  fs.writeFileSync(path.join(temporary, 'before'), before);
  fs.writeFileSync(path.join(temporary, 'after'), after);
  const diff = command(['git', 'diff', '--no-index', '--no-ext-diff', '--no-renames', '--unified=0', '--', path.join(temporary, 'before'), path.join(temporary, 'after')], repo, [0, 1]);
  const deleted = new Set(), added = new Set();
  for (const h of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    range(Number(h[1]), h[2] === undefined ? 1 : Number(h[2])).forEach((n) => deleted.add(n));
    range(Number(h[3]), h[4] === undefined ? 1 : Number(h[4])).forEach((n) => added.add(n));
  }
  return { deleted, added };
}
const records = [];
function add(project, file, before, after, livePath) {
  const old = parse(before, file), fresh = parse(after, file), diff = difference(before, after);
  records.push({ project, file, category: category(file, project), livePath, before, after, old, fresh, diff, beforeHash: hash(before), afterHash: hash(after),
    totals: { physicalAdded: diff.added.size, physicalDeleted: diff.deleted.size, codeAdded: intersection(diff.added, fresh.code).size, codeDeleted: intersection(diff.deleted, old.code).size } });
}
try {
  const tracked = git('diff', '--name-only', '--no-renames', baseline, '--').split('\n').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean).filter((p) => { try { return fs.statSync(path.join(candidate, p)).isFile(); } catch { return false; } });
  for (const file of [...new Set([...tracked, ...untracked])].sort()) {
    const before = tracked.includes(file) ? command(['git', 'show', `${baseline}:${file}`], candidate, [0, 128]) : '';
    const live = path.join(candidate, file), after = fs.existsSync(live) ? fs.readFileSync(live, 'utf8') : '';
    add('CE', file, before, after, live);
  }
  const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(root, path.join(rel, e.name)) : [path.join(rel, e.name)]);
  const tychoFiles = walk(tychoBefore).sort();
  for (const file of tychoFiles) add('Tycho', file, fs.readFileSync(path.join(tychoBefore, file), 'utf8'), fs.readFileSync(path.join(tychoLive, file), 'utf8'), path.join(tychoLive, file));

  // Only identical complete function/block bodies, wholly deleted and added,
  // receive automatic move credit. Largest bodies first prevent nested credit.
  const production = records.filter((r) => r.category.endsWith('production'));
  const removed = production.flatMap((r) => r.old.bodies.filter((b) => b.lines.every((n) => r.diff.deleted.has(n))).map((b) => ({ ...b, r })));
  const introduced = production.flatMap((r) => r.fresh.bodies.filter((b) => b.lines.every((n) => r.diff.added.has(n))).map((b) => ({ ...b, r })));
  const neutral = [], usedOld = new Map(), usedNew = new Map();
  const available = (map, x) => x.lines.every((n) => !map.get(x.r)?.has(n));
  const mark = (map, x) => { const set = map.get(x.r) ?? new Set(); x.lines.forEach((n) => set.add(n)); map.set(x.r, set); };
  for (const a of removed.sort((a, b) => b.lines.length - a.lines.length)) {
    if (!available(usedOld, a)) continue;
    const candidates = introduced.filter((b) => b.r.project === a.r.project && b.hash === a.hash && available(usedNew, b));
    if (candidates.length !== 1) continue;
    const b = candidates[0]; mark(usedOld, a); mark(usedNew, b);
    neutral.push({ before: { project: a.r.project, file: a.r.file, name: a.name, first: a.first, last: a.last }, after: { project: b.r.project, file: b.r.file, name: b.name, first: b.first, last: b.last }, codeDeleted: a.lines.length, codeAdded: b.lines.length, rawBodyHash: a.hash });
  }
  for (const r of production) {
    r.totals.neutralCodeDeleted = usedOld.get(r)?.size ?? 0;
    r.totals.neutralCodeAdded = usedNew.get(r)?.size ?? 0;
    r.totals.chargedCodeDeleted = r.totals.codeDeleted - r.totals.neutralCodeDeleted;
    r.totals.chargedCodeAdded = r.totals.codeAdded - r.totals.neutralCodeAdded;
  }
  const execute = 'src/epsil/execute-epsil.ts', stat = 'src/epsil/static-diagnostics.ts', control = 'src/compute-engine/library/control-structures.ts';
  const retired = [
    [execute, 'prepareFunctionDeclarations',230],[execute,'hasOuterDefinition',8],[execute,'outerDefinitionType',9],[execute,'statementWrites',65],[execute,'isSettledBefore',8],[execute,'functionLocalNames',23],[execute,'namesIn',12],[execute,'writtenNames',21],
    [stat,'boxTopLevelStatement',25],[control,'runsAsProgram',15],[control,'isProgramBlock',8],[control,'firstDeclarationIndex',10],
    [execute,'topLevelRedeclaration',10],[stat,'topLevelDeclarationIndexes',23],[stat,'declaredByEarlierStatement',14],[stat,'topLevelUseCheck',17],[stat,'TOP_LEVEL_USE_CHECKS',4],[stat,'TOP_LEVEL_DECLARATIONS',4],[control,'isLibraryConstant',4],
    [stat,'applyAssignmentTypeEffect',113],[stat,'declareStatementNames',15],[stat,'registerPinnedSignature',142],[stat,'pinnedAliasOf',13],[stat,'passScopeDefinition',8],[stat,'assignOverUserFunction',23],[stat,'installAssignedLiteralBeforeClause',25],[stat,'keepConstantBinding',15],[stat,'PinnedSignature',7],[stat,'reassignedPin',25],[stat,'replacePin',19],[stat,'isNamedSignature',6],
  ].map(([file,name,expectedCode]) => {
    const r = records.find((r) => r.project === 'CE' && r.file === file);
    const old = r?.old.declarations.find((d) => d.name === name), fresh = r?.fresh.declarations.filter((d) => d.name === name) ?? [];
    return { file, name, expectedCode, baselineDeclaration: old, remainingDeclarations: fresh, baselineCodeMatchesLedger: old?.code === expectedCode, currentIdentifierReferencesInOriginalFile: r?.fresh.identifiers.filter((i) => i.name === name) ?? [] };
  });
  const fragmentSpans = [
    ['Program-as-Block deferral declarations',4426,4447,12],['Deferral boundary',4524,4524,1],['Deferral count',4531,4531,1],['Per-statement deferred constant shadows',4546,4558,13],['Deferral cleanup loop',4575,4575,1],
  ].map(([name,first,last,expectedCode]) => {
    const r=records.find((r)=>r.project==='CE'&&r.file===control);
    const relevant=[...r.old.code].filter((n)=>n>=first&&n<=last);
    return {file:control,name,first,last,expectedCode,baselineCode:relevant.length,baselineCodeMatchesLedger:relevant.length===expectedCode,deletedBaselineCodeLines:relevant.filter((n)=>r.diff.deleted.has(n)).length,exactFragmentStillPresent:r.after.includes(r.before.split('\n').slice(first-1,last).join('\n'))};
  });
  const retiredNames = new Set(retired.map((r)=>r.name));
  const controls=['_staticPinnedCallees','_staticAssignmentEvidence','TOP_LEVEL_USE_CHECKS','TOP_LEVEL_DECLARATIONS','runsAsProgram','isProgramBlock','firstDeclarationIndex','prepareFunctionDeclarations','boxTopLevelStatement'];
  const srcFiles=command(['rg','--files','src'],candidate).split('\n').filter((p)=>parseable(p));
  const references=[];
  for(const file of srcFiles){const text=fs.readFileSync(path.join(candidate,file),'utf8');for(const name of new Set([...controls,...retiredNames])){const re=new RegExp(`\\b${name}\\b`,'g');for(const match of text.matchAll(re))references.push({name,file,line:text.slice(0,match.index).split('\n').length,kind:'text; may be comment or unrelated same-name helper'});}}
  const sums=Object.fromEntries(['CE production','Tycho production','CE tests/fixtures','Editor tests/fixtures','Snapshots','Instruments/scripts','Documentation','Other'].map((k)=>[k,{files:0}]));
  for(const r of records){const s=sums[r.category]??={files:0};s.files++;for(const [k,v]of Object.entries(r.totals))s[k]=(s[k]??0)+v;}
  const prodTotals={};for(const r of production)for(const[k,v]of Object.entries(r.totals))prodTotals[k]=(prodTotals[k]??0)+v;
  const changedDuringRead=records.filter((r)=>hash(fs.existsSync(r.livePath)?fs.readFileSync(r.livePath,'utf8'):'')!==r.afterHash).map((r)=>r.livePath);
  const finalTracked=git('diff','--name-only','--no-renames',baseline,'--').split('\n').filter(Boolean);
  const trackedSetChanged=tracked.join('\n')!==finalTracked.join('\n');
  const finalUntracked=git('ls-files','--others','--exclude-standard').split('\n').filter(Boolean).filter((p)=>{try{return fs.statSync(path.join(candidate,p)).isFile();}catch{return false;}});
  const untrackedSetChanged=untracked.join('\n')!==finalUntracked.join('\n');
  const controlStatus=controls.map((name)=>({name,textReferences:references.filter((r)=>r.name===name)}));
  const selfText=fs.readFileSync(new URL(import.meta.url),'utf8');
  const instrumentSelf={file:new URL(import.meta.url).pathname,sha256:hash(selfText),physicalAdded:physicalLines(selfText),codeAdded:parse(selfText,'deletion-ledger.mjs').code.size,productionCredit:0};
  const result={phase,capturedAt:new Date().toISOString(),baseline,candidate,tychoBefore,tychoLive,typescript:ts.version,metric:'Changed physical lines intersecting nontrivia TypeScript AST leaf-token ranges; skip JSDoc AST nodes/EOF; multiline literals intersect each physical line. Non-JS/TS files have physical counts only, code count 0 means not measured.',lineDiff:'git diff --no-index --no-ext-diff --no-renames --unified=0; default Git text diff matching',movePolicy:'Raw body text identical, >=5 code-bearing lines, fully deleted/added, unique available destination within project; largest bodies first, no overlapping credit. Declaration-header lines outside body are not neutralized.',completeMechanismAttribution:false,changedDuringRead,trackedSetChanged,untrackedSetChanged,instrumentSelf,parseDiagnostics,summary:sums,combinedProduction:prodTotals,exactBodyMoves:neutral,retirement:{expectedNamedAndFragmentCode:949,observedBaselineNamedAndFragmentCode:sum(retired.map((r)=>r.baselineDeclaration?.code??0))+sum(fragmentSpans.map((r)=>r.baselineCode)),controlStatus,expectedDeclarationCode:sum(retired.map((r)=>r.expectedCode)),expectedFragmentCode:sum(fragmentSpans.map((r)=>r.expectedCode)),declarations:retired,fragments:fragmentSpans,currentSourceTextReferences:references},files:records.map(({project,file,category,livePath,beforeHash,afterHash,totals,old,fresh,diff})=>({project,file,category,livePath,beforeHash,afterHash,totals,changedPhysicalAddedLines:[...diff.added].sort((a,b)=>a-b),changedPhysicalDeletedLines:[...diff.deleted].sort((a,b)=>a-b),changedCodeAddedLines:[...intersection(diff.added,fresh.code)].sort((a,b)=>a-b),changedCodeDeletedLines:[...intersection(diff.deleted,old.code)].sort((a,b)=>a-b),neutralCodeAddedLines:[...(usedNew.get(records.find(r=>r.project===project&&r.file===file))??[])].sort((a,b)=>a-b),neutralCodeDeletedLines:[...(usedOld.get(records.find(r=>r.project===project&&r.file===file))??[])].sort((a,b)=>a-b),parseable:parseable(file),baselinePhysical:physicalLines(records.find(r=>r.project===project&&r.file===file).before),candidatePhysical:physicalLines(records.find(r=>r.project===project&&r.file===file).after),baselineCode:old.code.size,candidateCode:fresh.code.size})),manualAttribution:{unresolved:'Exact-body move recognition is deliberately conservative. Any moved partial body, changed wrapper, whitespace-changed body, same-name unrelated helper or interleaved mechanism must be reviewed manually before final per-mechanism accounting. Raw diff totals and project net are exact for the captured text; charged gross totals remain provisional until this attribution is complete.',unmatchedDeletedFunctionBodies:removed.filter((x)=>available(usedOld,x)).map((x)=>({project:x.r.project,file:x.r.file,name:x.name,first:x.first,last:x.last,code:x.lines.length})),productionFilesRequiringMechanismSplit:production.map((r)=>r.file)}};
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'deletion-ledger-final.json'),JSON.stringify(result,null,2)+'\n');
  const md=[`# ${phase} production deletion ledger`,'',`Captured ${result.capturedAt}; frozen CE baseline \`${baseline}\`; candidate \`${candidate}\`.`, '', '**Not a final deletion claim.** Rerun after candidate freeze and finish the manual attribution below. This run reads sources and git objects only; it builds/runs no CE or Tycho code and performs no git command in Tycho.','',`Integrity: ${changedDuringRead.length?'files changed while read: '+changedDuringRead.join(', '):'captured file hashes stable at end'}; tracked changed-file set ${trackedSetChanged?'changed':'stable'}; untracked file set ${untrackedSetChanged?'changed':'stable'}; parse diagnostics ${parseDiagnostics.length}.`,'','## Metric','',result.metric,'',`Diff matching: ${result.lineDiff}. Physical additions/deletions include comments and blank lines. Exact body moves are neutralized only in code gross totals; raw physical churn remains shown. Tests and snapshots are never production credit.`,'','| Category | Files | Physical + | Physical − | AST code + | AST code − |','| --- | ---: | ---: | ---: | ---: | ---: |'];
  for(const[k,s]of Object.entries(sums))md.push(`| ${k} | ${s.files} | ${s.physicalAdded??0} | ${s.physicalDeleted??0} | ${s.codeAdded??0} | ${s.codeDeleted??0} |`);
  md.push('',`Combined production raw code: +${prodTotals.codeAdded??0}/−${prodTotals.codeDeleted??0}; net ${(prodTotals.codeAdded??0)-(prodTotals.codeDeleted??0)}. Automatically neutral unchanged bodies: +${prodTotals.neutralCodeAdded??0}/−${prodTotals.neutralCodeDeleted??0}. Remaining charged gross code: +${prodTotals.chargedCodeAdded??0}/−${prodTotals.chargedCodeDeleted??0}.`,'','## Per production file','','| Project/file | Physical +/− | Raw AST +/− | Exact move +/− | Charged AST +/− |','| --- | ---: | ---: | ---: | ---: |');
  for(const r of production){const t=r.totals;md.push(`| ${r.project}: \`${r.file}\` | ${t.physicalAdded}/${t.physicalDeleted} | ${t.codeAdded}/${t.codeDeleted} | ${t.neutralCodeAdded}/${t.neutralCodeDeleted} | ${t.chargedCodeAdded}/${t.chargedCodeDeleted} |`);}
  md.push('','## Named retirement inventory','','The nominal 949-code-line inventory is fully enumerated: '+result.retirement.expectedDeclarationCode+' declared named-helper lines plus '+result.retirement.expectedFragmentCode+' declared fragment lines. The frozen source remeasures '+result.retirement.observedBaselineNamedAndFragmentCode+' lines under the stated metric. `prepareFunctionDeclarations` has 228 rather than 230: two inline return-property JSDoc lines are excluded. No other inventory count differs. Do not silently award the nominal extra two lines. Inventory is not earned deletion credit; code moves and remaining callers must still be accounted for.','','| Name | Expected code | Frozen AST code | Declaration remains | Original-file identifier refs |','| --- | ---: | ---: | ---: | ---: |');
  for(const r of retired)md.push(`| \`${r.name}\` | ${r.expectedCode} | ${r.baselineDeclaration?.code??'NOT FOUND'} | ${r.remainingDeclarations.length} | ${r.currentIdentifierReferencesInOriginalFile.length} |`);
  md.push('','| Fragment | Expected/frozen code | Deleted frozen code | Exact old fragment remains |','| --- | ---: | ---: | --- |');for(const r of fragmentSpans)md.push(`| ${r.name} | ${r.expectedCode}/${r.baselineCode} | ${r.deletedBaselineCodeLines} | ${r.exactFragmentStillPresent} |`);
  md.push('','## Exact unchanged body relocations','',neutral.length?neutral.map((x)=>`- ${x.before.file}:${x.before.first} (${x.before.name}) → ${x.after.file}:${x.after.first} (${x.after.name}): ${x.codeDeleted}/${x.codeAdded} neutral code lines.`).join('\n'):'None automatically proved by the conservative exact-body rule.','', '## Remaining obsolete-name/control references','',references.length?'Text matches below include explanatory comments and unrelated same-name helpers; inspect before treating them as retained calls.':'No named retirement/control text matches in candidate `src/`.','');for(const r of references)md.push(`- \`${r.name}\` — ${r.file}:${r.line}`);
  md.push('','## Unresolved manual attribution','',result.manualAttribution.unresolved,'','The per-file totals are not yet the required five-mechanism breakdown: shared core/evaluator/checker files interleave responsibilities. Do not assign a whole file to one mechanism merely to fill the table. The JSON lists unmatched deleted function bodies and every production file needing attribution. No partial-body relocation receives automatic deletion credit.','', '## Obsolete control/caller status','',...controlStatus.map((r)=>`- \`${r.name}\`: ${r.textReferences.length} text references in candidate src.`),'','## This measurement instrument','',`The main-checkout instrument is outside the candidate diff and receives zero production credit: ${instrumentSelf.physicalAdded} physical / ${instrumentSelf.codeAdded} AST code lines, SHA-256 \`${instrumentSelf.sha256}\`. Other main-checkout reports/adapters are deliberately not mixed into the candidate production diff.`,'','## Reproduction','', '```sh',`node ${path.join(output,'deletion-ledger-final.mjs')} --repo ${repo} --candidate ${candidate} --baseline ${baseline} --tycho-before ${tychoBefore} --tycho-live ${tychoLive} --output ${output} --phase ${phase}`,'```','', 'Artifacts: `deletion-ledger-final.json` records source hashes, parser diagnostics, per-file totals, exact-body moves and all retirement checks. The instrument itself is measurement code and gets no production credit.');
  fs.writeFileSync(path.join(output,'deletion-ledger-final.md'),md.join('\n')+'\n');
  console.log(JSON.stringify({phase,summary:sums,combinedProduction:prodTotals,exactMoves:neutral.length,retirementCode:result.retirement.expectedDeclarationCode+result.retirement.expectedFragmentCode,ledgerMismatches:retired.filter(r=>!r.baselineCodeMatchesLedger).map(r=>r.name),changedDuringRead,trackedSetChanged,parseDiagnostics:parseDiagnostics.length}));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
