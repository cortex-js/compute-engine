/** Account a captured ledger by reviewed mechanism and exact retained fragments. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const folder=path.dirname(new URL(import.meta.url).pathname);
const p=JSON.parse(fs.readFileSync(path.join(folder,'deletion-ledger-current.json'),'utf8'));
const fragments=JSON.parse(fs.readFileSync(path.join(folder,'deletion-relocation-map.json'),'utf8'));
const ts=createRequire('/Users/arno/dev/compute-engine/package.json')('typescript');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const base=file=>{const r=spawnSync('git',['show',p.baseline+':'+file],{cwd:p.candidate,encoding:'utf8',maxBuffer:64*1024*1024});if(r.status===128)return '';if(r.status!==0)throw Error(r.stderr);return r.stdout;};
const names={M1:'Program registration and shared sequence canonicalization policy',M2:'Stable Program variable lifetime and assignment-contract integration',M3:'Existing sync/async evaluator continuation/cancellation and reporting hooks',M4:'Checker projection, pure diagnostic flow and obsolete-control removal',M5:'Parser, public execute/check adapters, direct compile and parsed-container consumers'};
const defaults={
 'src/common/debug-hook.ts':'M3',
 'src/compute-engine/boxed-expression/ambient-chain.ts':'M2',
 'src/compute-engine/boxed-expression/binders.ts':'M2',
 'src/compute-engine/boxed-expression/effects-inference.ts':'M2',
 'src/compute-engine/boxed-expression/function-literal.ts':'M2',
 'src/compute-engine/boxed-expression/lazy-view-context.ts':'M2',
 'src/compute-engine/boxed-expression/box.ts':'M4',
 'src/compute-engine/boxed-expression/boxed-function.ts':'M1',
 'src/compute-engine/boxed-expression/boxed-value-definition.ts':'M2',
 'src/compute-engine/boxed-expression/named-arguments.ts':'M2',
 'src/compute-engine/boxed-expression/parameter-defaults.ts':'M1',
 'src/compute-engine/boxed-expression/validate.ts':'M4',
 'src/compute-engine/compilation/compile-expression.ts':'M5',
 'src/compute-engine/function-utils.ts':'M3',
 'src/compute-engine/index.ts':'M4',
 'src/compute-engine/library/calculus.ts':'M5',
 'src/compute-engine/library/control-structures.ts':'M1',
 'src/compute-engine/library/core.ts':'M1',
 'src/compute-engine/statement-position.ts':'M1',
 'src/compute-engine/types-definitions.ts':'M2',
 'src/compute-engine/types-engine.ts':'M4',
 'src/compute-engine/types-expression.ts':'M2',
 'src/epsil/diagnostic-flow.ts':'M4',
 'src/epsil/error-explanations.ts':'M5',
 'src/epsil/error-location.ts':'M5',
 'src/epsil/execute-epsil.ts':'M5',
 'src/epsil/occurrences.ts':'M4',
 'src/epsil/parallel-checks.ts':'M4',
 'src/epsil/parser.ts':'M5',
 'src/epsil/parse-epsil.ts':'M5',
 'src/epsil/resolve-library-names.ts':'M5',
 'src/epsil/serialize-epsil.ts':'M5',
 'src/epsil/signature-notes.ts':'M4',
 'src/epsil/static-diagnostics.ts':'M4',
 'vscode-epsil/src/debug-worker.ts':'M5',
 'vscode-epsil/src/inline-runner.ts':'M5',
 'vscode-epsil/src/server.ts':'M5',
};
const gcd=(a,b)=>b?gcd(b,a%b):a;
const frac=(n,d=1n)=>{n=BigInt(n);d=BigInt(d);const g=gcd(n<0n?-n:n,d);return[n/g,d/g];};
const add=(a,b)=>frac(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const sub=(a,b)=>add(a,[-b[0],b[1]]);
const fmt=a=>a[1]===1n?String(a[0]):`${a[0]}/${a[1]}`;
const dec=a=>Number(a[0])/Number(a[1]);
const zero=()=>[0n,1n];
const totals=Object.fromEntries([...Object.keys(names),'Neutral retained code'].map(k=>[k,{added:zero(),deleted:zero(),physicalAdded:0,physicalDeleted:0}]));
const mappings=[],proofs=[],lineProofs=[],lineProofCache=new Map();
for(const r of p.files.filter(x=>x.category.endsWith('production'))){
 const before=r.project==='Tycho'?fs.readFileSync(path.join(p.tychoBefore,r.file),'utf8'):base(r.file);
 const after=fs.readFileSync(r.livePath,'utf8');
 if(hash(before)!==r.beforeHash||hash(after)!==r.afterHash)throw Error('Capture hash mismatch: '+r.project+':'+r.file+'; rerun primary ledger first.');
 const fileMap={project:r.project,file:r.file,beforeHash:r.beforeHash,afterHash:r.afterHash,defaultMechanism:r.project==='Tycho'?'M5':defaults[r.file],deleted:[],added:[]};
 if(!fileMap.defaultMechanism)throw Error('Unattributed production file '+r.file);
 const parsed={};
 for(const side of ['before','after']){
  const text=side==='before'?before:after;
  const changed=new Set(side==='before'?r.changedCodeDeletedLines:r.changedCodeAddedLines);
  const autoNeutral=new Set(side==='before'?r.neutralCodeDeletedLines:r.neutralCodeAddedLines);
  const sf=ts.createSourceFile(r.file,text,ts.ScriptTarget.Latest,true,/\.mjs$/.test(r.file)?ts.ScriptKind.JS:ts.ScriptKind.TS);
  const line=pos=>sf.getLineAndCharacterOfPosition(Math.max(0,pos)).line+1;
  const leaves=n=>{if((n.kind>=ts.SyntaxKind.FirstJSDocNode&&n.kind<=ts.SyntaxKind.LastJSDocNode)||n.kind===ts.SyntaxKind.EndOfFileToken)return[];const c=n.getChildren(sf);return c.length?c.flatMap(leaves):n.getEnd()>n.getStart(sf)?[n]:[];};
  const all=leaves(sf),perLine=new Map(),nodes=[];
  all.forEach((n,i)=>{for(let k=line(n.getStart(sf));k<=line(n.getEnd()-1);k++)if(changed.has(k)){const a=perLine.get(k)??[];a.push(i);perLine.set(k,a);}});
  const visit=n=>{nodes.push(n);ts.forEachChild(n,visit);};visit(sf);
  const spans=new Map();
  for(const n of nodes){let name=n.name&&ts.isIdentifier(n.name)?n.name.text:undefined;if(!name&&ts.isArrowFunction(n)&&ts.isVariableDeclaration(n.parent))name=n.parent.name.getText(sf);if(name){const a=spans.get(name)??[];a.push([line(n.getFullStart()),line(n.getEnd()-1)]);spans.set(name,a);}}
  const overrides=[];
  const override=(first,last,mechanism,why)=>{if(first>last)return;overrides.push({first,last,mechanism,why});};
  const named=(name,mechanism,why)=>{for(const[a,b]of spans.get(name)??[])override(a,b,mechanism,why);};
  const textLines=text.split('\n');
  const matching=(re,mechanism,why)=>textLines.forEach((s,i)=>{if(re.test(s))override(i+1,i+1,mechanism,why);});
  if(r.file==='src/compute-engine/boxed-expression/box.ts'){
   named('calleeSignatureType','M2','Stable callable variables do not adopt the held value signature.');
   matching(/def\.value\._programVariable/,'M2','Stable callable-variable dispatch/admission integration.');
   for(const n of nodes)if(ts.isIfStatement(n)&&n.expression.getText(sf).includes('def.value._programVariable')&&n.expression.getText(sf).includes('value === undefined'))override(line(n.getStart(sf)),line(n.getEnd()-1),'M2','Preserve raw named calls until the stable variable has a callable value.');
  }
   if(r.file==='src/compute-engine/boxed-expression/box.ts')for(const n of nodes)if(ts.isIfStatement(n)&&n.expression.getText(sf)==="normalized.kind === 'error'")override(line(n.getStart(sf)),line(n.getEnd()-1),'M2','A refused named call follows replacement of its stable callable variable.');
  if(r.file==='src/compute-engine/boxed-expression/boxed-function.ts'){
   named('heldErrorCallback','M2','Held value error propagation under a stable binding type.');
   matching(/import \{ isErrorTypedOperand \}/,'M2','Import removed with held-value error check.');
  }
  if(['src/compute-engine/index.ts','src/compute-engine/types-engine.ts'].includes(r.file)){
   named('_epsilStatementResultHook','M3','Extended existing per-statement reporting hook.');
   named('_epsilStatementTimeLimitMs','M3','Per-statement limit forwarded to the shared evaluator.');
  }
  if(r.file==='src/compute-engine/library/core.ts'){
   for(const name of ['withOuterNames','widenLocalType','localAssignmentMismatch','recordInitializerEvidence','assignSteps','declareSteps'])named(name,'M2','Stable declaration/assignment lifetime and existing contract integration.');
   matching(/(?:^import \{ widenValueTypes|^\s+widenLocalType,|^\s+programInitializerOuter,)/,'M2','Dependency of stable variable initialization/admission.');
  }
  if(r.file==='src/compute-engine/library/control-structures.ts'){
   for(const name of ['evaluateBlock','evaluateBlockAsync'])named(name,'M3','Existing Block evaluator delegates without inferred Program detection.');
   named('hoistDeclared','M2','Persistent Program binding creation, prior-binding preservation and flags.');
   for(const n of nodes)if(ts.isPropertyAssignment(n)&&['evaluate','evaluateAsync'].includes(n.name.getText(sf))&&n.parent.parent?.name?.getText(sf)==='PROGRAM_DEFINITION')override(line(n.getStart(sf)),line(n.getEnd()-1),'M3','Program delegates to existing sync/async statement evaluation.');
   matching(/(?:declaredConstants|const constant = isDictionary|const attributes = op\.ops|const literalType = program|const previousBindings|widenAssignedType, widenLocalType)/,'M2','Persistent declaration constness/coarse callable type and existing widening helper.');
   for(const n of nodes)if(ts.isIfStatement(n)&&n.expression.getText(sf)==='program'&&n.thenStatement.getText(sf).includes('binding.value.inferredType = false'))override(line(n.getStart(sf)),line(n.getEnd()-1),'M2','Finalize one stable Program variable type after common canonicalization.');
  }
  if(r.file==='src/compute-engine/statement-position.ts'){
   for(const name of ['programInitializerOuters','withProgramInitializerOuters','programInitializerOuter'])named(name,'M2','Resolve declaration initializers through the prior caller binding.');
   matching(/^\s+BoxedDefinition,/,'M2','Type dependency of prior binding metadata.');
  }
  if(r.file==='src/epsil/execute-epsil.ts'){
   for(const name of ['topLevelRedeclaration','prepareFunctionDeclarations','hasOuterDefinition','outerDefinitionType','statementWrites','isSettledBefore','functionLocalNames','namesIn','writtenNames','epsilBatchCounter','nextEpsilBatchId'])named(name,'M1','Retire independent top-level preparation/declaration policy or relocate shared batch origin.');
   named('canceledPreparation','M3','Report a shared preparation cancellation without an executable statement result.');
   named('nestedStatementReporter','M3','Existing nested result reporter bridge.');
   named('constantAssignmentSite','M3','Failure location passed from the existing shared evaluator.');
   named('onStatement','M3','Public callback for existing statement-result hook.');
   named('statementTimeLimitMs','M3','Public forwarding of the shared evaluator statement limit.');
   if(side==='before')override(534,901,'M3','Retire per-statement evaluation/error/budget loop while retaining diagnostics in hooks.');
   else {
    const hook=nodes.find(n=>ts.isBinaryExpression(n)&&n.left.getText(sf)==='ce._epsilStatementResultHook'&&ts.isArrowFunction(n.right)&&n.right.getText(sf).includes('reportNested'));
    if(!hook)throw Error('Missing Program result-hook bridge');
    override(line(hook.getStart(sf)),line(hook.getEnd()-1),'M3','Result-hook bridge and reporting/backstop integration.');
    for(const n of nodes)if(ts.isVariableDeclaration(n)&&n.name.getText(sf)==='reportNested')override(line(n.getStart(sf)),line(n.getEnd()-1),'M3','Reuse of the nested statement reporter by the shared hook bridge.');
   }
  }
  for(const ln of (side==='before'?r.changedPhysicalDeletedLines:r.changedPhysicalAddedLines)){const winner=overrides.filter(o=>ln>=o.first&&ln<=o.last).at(-1);const key=winner?.mechanism??fileMap.defaultMechanism;totals[key][side==='before'?'physicalDeleted':'physicalAdded']++;}
  const manualTokens=new Set();
  for(const f of fragments.approvedFragments.filter(f=>f.file===r.file)){
   const first=side==='before'?f.beforeFirst:f.afterFirst,last=side==='before'?f.beforeLast:f.afterLast;
   const candidates=nodes.filter(n=>ts.SyntaxKind[n.kind]===f.kind&&line(n.getStart(sf))===first&&line(n.getEnd()-1)===last);
   const node=candidates.find(n=>hash(JSON.stringify(leaves(n).map(x=>x.getText(sf))))===f.tokenHash);
   if(!node)throw Error('Retained fragment no longer matches '+r.file+' '+side+':'+first+'; re-inspect mapping.');
   const within=new Set(leaves(node));
   all.forEach((n,i)=>{if(within.has(n)){if(manualTokens.has(i))throw Error('Overlapping retained token');manualTokens.add(i);}});
   if(side==='after')proofs.push(f);
  }
  for(const f of (fragments.approvedExactLinePairs??[]).filter(f=>f.file===r.file)){
   const ln=side==='before'?f.beforeLine:f.afterLine;const ids=perLine.get(ln);
   if(!ids?.length)throw Error('Retained line is no longer changed: '+r.file+':'+ln);
   const tokenHash=hash(JSON.stringify(ids.map(i=>all[i].getText(sf))));
   const key=r.file+':'+f.beforeLine+':'+f.afterLine;
   if(side==='before')lineProofCache.set(key,tokenHash);else{if(lineProofCache.get(key)!==tokenHash)throw Error('Retained line token mismatch '+key);lineProofs.push({...f,tokenHash});}
   for(const i of ids){if(manualTokens.has(i))throw Error('Retained line overlaps another fragment '+key);manualTokens.add(i);}
  }
  const entries=[];
  for(const ln of [...changed].sort((a,b)=>a-b)){
   const ids=perLine.get(ln);if(!ids?.length)throw Error('Code line has no leaf '+r.file+':'+ln);
   const matchingOverrides=overrides.filter(o=>ln>=o.first&&ln<=o.last);
   const winner=matchingOverrides.at(-1),mechanism=winner?.mechanism??fileMap.defaultMechanism;
   const matchedLeafIncidences=ids.filter(i=>manualTokens.has(i)).length;
   const neutral=autoNeutral.has(ln)||matchedLeafIncidences===ids.length?frac(1):frac(0);
   const charged=sub(frac(1),neutral);
   const direction=side==='before'?'deleted':'added';
   totals[mechanism][direction]=add(totals[mechanism][direction],charged);
   totals['Neutral retained code'][direction]=add(totals['Neutral retained code'][direction],neutral);
   entries.push({line:ln,mechanism,charged:fmt(charged),neutral:fmt(neutral),leafIncidences:ids.length,neutralLeafIncidences:neutral[0]===1n?ids.length:0,matchedLeafIncidences,partialFragmentDoesNotNeutralizeMixedLine:matchedLeafIncidences>0&&matchedLeafIncidences<ids.length,...(winner?{reason:winner.why}: {})});
  }
  fileMap[side==='before'?'deleted':'added']=entries;
  parsed[side]={overrides};
 }
 fileMap.reviewedOverrides=parsed;
 mappings.push(fileMap);
}
const summary=Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,{name:names[k]??k,added:fmt(v.added),deleted:fmt(v.deleted),net:fmt(sub(v.added,v.deleted)),addedApprox:dec(v.added),deletedApprox:dec(v.deleted),physicalAdded:v.physicalAdded,physicalDeleted:v.physicalDeleted}]));
const allAdded=Object.values(totals).reduce((a,b)=>add(a,b.added),zero()),allDeleted=Object.values(totals).reduce((a,b)=>add(a,b.deleted),zero());
if(fmt(allAdded)!==String(p.combinedProduction.codeAdded)||fmt(allDeleted)!==String(p.combinedProduction.codeDeleted))throw Error('Line-unit allocation does not reconcile');
const residualAdded=Object.entries(totals).filter(([k])=>k!=='Neutral retained code').reduce((a,[,v])=>add(a,v.added),zero());
const residualDeleted=Object.entries(totals).filter(([k])=>k!=='Neutral retained code').reduce((a,[,v])=>add(a,v.deleted),zero());
if(Object.values(totals).reduce((a,b)=>a+b.physicalAdded,0)!==p.combinedProduction.physicalAdded||Object.values(totals).reduce((a,b)=>a+b.physicalDeleted,0)!==p.combinedProduction.physicalDeleted)throw Error('Physical line allocation does not reconcile');
const result={phase:p.phase+'; rerun after any production change',capturedAt:new Date().toISOString(),rawLedgerCapturedAt:p.capturedAt,baseline:p.baseline,candidate:p.candidate,allocation:'Every changed AST-code physical line is one integer unit. A line is neutral only when its complete nontrivia AST-leaf code belongs to a proved unchanged moved body/fragment. A mixed wrapper line containing new tokens stays fully charged to its documented dominant owner. Partial-token matches are supplementary proof only, never fractional line credit. No line belongs to two mechanisms.',summary,rawPhysical:{added:p.combinedProduction.physicalAdded,deleted:p.combinedProduction.physicalDeleted},rawCode:{added:p.combinedProduction.codeAdded,deleted:p.combinedProduction.codeDeleted},chargedCode:{added:fmt(residualAdded),deleted:fmt(residualDeleted),net:fmt(sub(residualAdded,residualDeleted))},rawCategories:p.summary,mapping:mappings,partialRelocationProofs:proofs,exactLineRelocationProofs:lineProofs,automaticBodyRelocations:p.exactBodyMoves,sourceHashesVerified:true,unresolvedManualAttributions:[],ownershipNotes:['Imports/signatures use the importing module mechanism unless explicitly overridden; no line is charged to both the imported policy and its adapter.','Sequence metadata consumed by adapters/checker is owned by the common canonicalizer (M1); persistent variable flags/types/initializer lifetime are M2.','Editor debugger/inline callbacks are consumer adapter code (M5); engine hook invocation and execute result bridge are M3.','Existing raw diagnostic/binding-site walks and obsolete early-function graph removal are M4; syntax/container dispatch and implicit-variable consumer fixes are M5.','Most execute diagnostic rendering stayed unchanged in Git context, so it generates no added/deleted units at all. Changed wrappers, source-index/range substitutions, new debugger flags and altered guards are charged.','The widener body has 34 raw-text-identical lines neutral on each side. Its export/signature/import integration remains charged.','No automatic source-level copy matching beyond the reviewed token-identical fragments is used. The errors[0].toString() subexpression inside a changed source-location template was inspected and intentionally left charged with that changed template.']};
fs.writeFileSync(path.join(folder,'deletion-ledger-attribution.json'),JSON.stringify(result,null,2)+'\n');
const md=['# Reviewed source-freeze deletion attribution','',`Frozen baseline: \`${p.baseline}\`. Raw capture: ${p.capturedAt}. Attribution: ${result.capturedAt}. All production source hashes verified against the raw capture. No source edits, tests, builds or git commands in Tycho.`, '', '**This is accounting, not a semantic/code-review pass.** Rerun both instruments after any production change. Test expectation migration is outside the production counts.','', '## Required five-mechanism breakdown','', result.allocation+' Raw physical columns retain comment/blank/move churn and allocate each physical diff line once; only code gross totals neutralize reused code.', '', '| Mechanism | Raw physical +/− | Charged code + | Charged code − | Net |','| --- | ---: | ---: | ---: | ---: |'];
for(const[k,v]of Object.entries(summary))md.push(`| ${k}: ${v.name} | ${v.physicalAdded}/${v.physicalDeleted} | ${v.added} | ${v.deleted} | ${v.net} |`);
md.push('',`Raw combined production: **+${p.combinedProduction.codeAdded}/−${p.combinedProduction.codeDeleted} AST code lines**, physical **+${p.combinedProduction.physicalAdded}/−${p.combinedProduction.physicalDeleted}**. After neutral retained code: added **${result.chargedCode.added}**, deleted **${result.chargedCode.deleted}**, net **${result.chargedCode.net}**. All gross/net code counts are integer physical-line units; mixed wrapper lines remain fully charged.`,'','## Retained code: no deletion credit','',...result.ownershipNotes.map(n=>'- '+n),'','### Reviewed partial relocations','', '| Retained fragment | Before → after | Why neutral |','| --- | --- | --- |');
for(const f of proofs)md.push(`| \`${f.file}\` | ${f.beforeFirst}–${f.beforeLast} → ${f.afterFirst}–${f.afterLast} | ${f.rationale} |`);
md.push('','### Additional exact retained reporting lines','', '| File | Before → after |','| --- | --- |');
for(const f of lineProofs)md.push(`| \`${f.file}\` | ${f.beforeLine} → ${f.afterLine} |`);
md.push('','The eight subtree fragments and the corresponding debugger/inline reporting lines have identical nontrivia AST leaf-token sequences and a recorded hash in `deletion-relocation-map.json`; identifier-renamed snippets are not treated as unchanged. Exact integer line allocation and supplementary matched-leaf counts are in `deletion-ledger-attribution.json`. Changed formatting can make old/new line counts differ, so neutralization removes that apparent deletion credit as well.','', '## Per-file mechanism allocation','', '| Production file | Mechanisms receiving charged line units |','| --- | --- |');
for(const r of mappings){const sums={};for(const d of ['added','deleted'])for(const e of r[d]){const f=e.charged.split('/');const q=frac(f[0],f[1]??1);if(q[0]){const t=sums[e.mechanism]??={added:zero(),deleted:zero(),physicalAdded:0,physicalDeleted:0};t[d]=add(t[d],q);}}md.push(`| ${r.project}: \`${r.file}\` | ${Object.entries(sums).map(([k,v])=>`${k}: added ${fmt(v.added)}, deleted ${fmt(v.deleted)}`).join('; ')} |`);}
md.push('','## Separate nonproduction totals','', '| Category | Files | Physical +/− | AST code +/− |','| --- | ---: | ---: | ---: |');for(const[k,v]of Object.entries(p.summary).filter(([k])=>!k.endsWith('production')))md.push(`| ${k} | ${v.files} | ${v.physicalAdded??0}/${v.physicalDeleted??0} | ${v.codeAdded??0}/${v.codeDeleted??0} |`);
md.push('','Main-checkout measurement instruments/reports are outside this candidate diff and receive zero production credit. The primary ledger separately records its own instrument size. Other measurement scripts remain measurement artifacts. No snapshot/pinned-emission change is inferred from passing/failing assertions; only actual changed snapshot files count here.','', '## Retirement and completeness','',`The nominal 949-line retirement set is fully enumerated by the primary ledger; its frozen source remeasures ${p.retirement.observedBaselineNamedAndFragmentCode} under the stated JSDoc-excluding metric. All named declarations/fragments and obsolete controls are independently reported there. This attribution adds no retirement credit for relocated unchanged code.`, '', 'All captured production code line units are allocated, including imports, new wrappers and shared integration lines. Unresolved manual attribution: none for this capture. This does not certify semantics, completion checks, or the absence of later production edits.','', '## Reproduce','', '```sh',`node ${path.join(folder,'deletion-ledger.mjs')}`,`node ${path.join(folder,'attribute-deletion-ledger.mjs')}`,'```');
fs.writeFileSync(path.join(folder,'deletion-ledger-attribution.md'),md.join('\n')+'\n');
console.log(JSON.stringify({summary,rawCode:result.rawCode,chargedCode:result.chargedCode,partialFragments:proofs.length,exactRetainedLines:lineProofs.length,sourceHashesVerified:true}));
