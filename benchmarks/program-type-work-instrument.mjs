/** PRIVATE diagnostic copy only. Original production source is never written. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ts = createRequire(import.meta.url)('typescript');
const root = fs.realpathSync(process.argv[2]), manifest = [];
const repository = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const inRepository = value => value === repository || value.startsWith(repository + path.sep);
if (inRepository(root) || !root.startsWith('/private/tmp/'))
 throw Error('Instrumentation requires a private /private/tmp copy outside the repository');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const trace = '(globalThis as any).__programTypeTrace';
const files = {
 'compute-engine/boxed-expression/boxed-function.ts': ['boundCallType'],
 'compute-engine/boxed-expression/effects-inference.ts': ['functionLiteralCallSignatureType', 'functionLiteralSignatureType', 'functionLiteralArrowEffects'],
 'compute-engine/library/assignment-evidence.ts': ['withEvidenceSession', 'registerEvidenceSite'],
 'compute-engine/library/core.ts': ['joinAssignmentEvidence','joinEvidenceOnBinding','writeEvidenceType'],
 'compute-engine/boxed-expression/boxed-value-definition.ts': [],
 'compute-engine/index.ts': [],
 'compute-engine/collection-utils.ts': ['appliesToListCoordinateTuple','addsPointToNumberCollection'],
 'compute-engine/boxed-expression/derive-application-type.ts': ['withCodomainForAbsentAnswer'],
 'compute-engine/boxed-expression/broadcast-lift-type.ts': ['passesAbsentCellsThrough'],
};
for (const [rel, names] of Object.entries(files)) {
 const file=fs.realpathSync(path.join(root,'src',rel));
 if(inRepository(file)||!file.startsWith(root+path.sep))throw Error('Probe file escapes the private copy: '+file);
 const original=fs.readFileSync(file,'utf8'), sf=ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true), edits=[], probes=[];
 const add=(pos,text)=>edits.push({pos,text});
 const wrap=(node,kind,info)=>{add(node.body.getStart(sf)+1,`return ${trace}.span(${JSON.stringify(kind)},${info},()=>{`);add(node.body.getEnd()-1,'});');probes.push({kind,line:sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1});};
 const visit=n=>{
  const name=n.name?.getText(sf);
  if(ts.isFunctionDeclaration(n)&&n.body&&names.includes(name)) {
   const info=name==='appliesToListCoordinateTuple'?'{operator,overTuples}':['addsPointToNumberCollection','passesAbsentCellsThrough'].includes(name)?'{operator}':name==='withCodomainForAbsentAnswer'?'{answer:answered}':['boundCallType','functionLiteralCallSignatureType','functionLiteralSignatureType','functionLiteralArrowEffects'].includes(name)?'{expr,ce:expr.engine}':name==='joinEvidenceOnBinding'?'{ce,target,assignedType,coarse}':name==='writeEvidenceType'?'{ce,target,proposed:next}':name==='joinAssignmentEvidence'?'{ce,name,target:undefined}':name==='withEvidenceSession'?'{ce:engine}':'{ce:engine,site}';
   wrap(n,name,info);
  }
  if(rel.endsWith('boxed-function.ts')&&ts.isGetAccessor(n)&&n.body&&['type','operatorDefinition'].includes(name)&&n.parent.name?.text==='BoxedFunction')wrap(n,'expression-read',`{expr:this,ce:this.engine,read:${JSON.stringify(name)},proposed:${name==='_writeType'?'t':'undefined'}}`);
  if(rel.endsWith('boxed-value-definition.ts')&&n.body&&(ts.isGetAccessor(n)&&['type','declaredType','storedValue','value'].includes(name)||ts.isSetAccessor(n)&&name==='value'||ts.isMethodDeclaration(n)&&['_setType','_writeType'].includes(name)))wrap(n,ts.isGetAccessor(n)?'binding-read':'binding-write',`{ce:this._engine,target:this,read:${JSON.stringify(name)},proposed:${name==='_writeType'?'t':'undefined'}}`);
  if(rel==='compute-engine/index.ts'&&ts.isMethodDeclaration(n)&&name==='lookupDefinition')wrap(n,'lookup','{ce:this,name:id}');
  if(rel.endsWith('effects-inference.ts')&&ts.isCallExpression(n)&&n.expression.getText(sf)==='functionLiteralSignatureType') {
   const start=original.indexOf('export function functionLiteralCallSignatureType('),stop=original.indexOf('export function functionLiteralParameterSignature(',start);
   if(n.getStart(sf)>start&&n.getStart(sf)<stop){const there=original.indexOf('const there =',start),here=original.indexOf('const here =',start);const reason=n.getStart(sf)>here?'current/full':n.getStart(sf)>there?'written/full':'single/full';add(n.getStart(sf),`${trace}.span('signature-demand',{expr,ce:expr.engine,reason:${JSON.stringify(reason)}},()=> (`);add(n.getEnd(),'))');probes.push({kind:'signature-demand',reason});}
  }
  if(rel.endsWith('effects-inference.ts')&&ts.isCallExpression(n)&&n.expression.getText(sf)==='functionLiteralArrowEffects') {
   const start=original.indexOf('export function functionLiteralCallSignatureType('),stop=original.indexOf('export function functionLiteralParameterSignature(',start);
   if(n.getStart(sf)>start&&n.getStart(sf)<stop){add(n.getStart(sf),`${trace}.span('signature-demand',{expr,ce:expr.engine,reason:'current/effects-only'},()=> (`);add(n.getEnd(),'))');probes.push({kind:'signature-demand',reason:'current/effects-only'});}
  }
  if(rel.endsWith('boxed-function.ts')&&ts.isCallExpression(n)) {
   const helper=n.expression.getText(sf);
   if(['appliesToListCoordinateTuple','addsPointToNumberCollection','withCodomainForAbsentAnswer'].includes(helper)) {
    let arg=n.arguments[helper==='addsPointToNumberCollection'?1:2];
    if(arg&&ts.isArrowFunction(arg))arg=arg.body;
    if(arg&&arg.getText(sf).includes('expr.ops.map')){add(arg.getStart(sf),`${trace}.span('operand-map',{expr,ce:expr.engine,reason:${JSON.stringify(helper)}},()=> (`);add(arg.getEnd(),'))');probes.push({kind:'operand-map',reason:helper,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1});}
   }
   if(helper==='passesAbsentCellsThrough'&&n.parent&&ts.isArrowFunction(n.parent)&&ts.isCallExpression(n.parent.parent)&&n.parent.parent.expression.getText(sf)==='expr.ops.map') {
    const map=n.parent.parent;add(map.getStart(sf),`${trace}.span('operand-map',{expr,ce:expr.engine,reason:'passedThrough'},()=> (`);add(map.getEnd(),'))');probes.push({kind:'operand-map',reason:'passedThrough',line:sf.getLineAndCharacterOfPosition(map.getStart(sf)).line+1});
   }
  }
  ts.forEachChild(n,visit);
 };visit(sf);
 // Evidence pass and each actual site call, retaining its boolean result.
 if(rel.endsWith('assignment-evidence.ts')) {
  const a='for (const site of sites) if (site.rejoin(coarse)) changed = true;';
  const b=`for (const site of sites) if (${trace}.span('evidence-rejoin',{ce:engine,site,pass:passes,coarse},()=>site.rejoin(coarse))) changed = true;`;
  const start=original.indexOf(a);if(start<0)throw Error('Evidence pass anchor missing');edits.push({pos:start,remove:a.length,text:b});
 }
 // Snapshot the actual target selected by existing admission; no new lookup.
 if(rel.endsWith('/core.ts')) {
  const anchor='  const target = def.value;';const method=original.indexOf('function joinAssignmentEvidence(');const pos=original.indexOf(anchor,method);if(pos<0)throw Error('Target anchor missing');add(pos+anchor.length,`${trace}.note('evidence-target',{ce,target,name});`);
 }
 edits.sort((a,b)=>b.pos-a.pos);let text=original;for(const e of edits)text=text.slice(0,e.pos)+e.text+text.slice(e.pos+(e.remove??0));fs.writeFileSync(file,text);manifest.push({file:rel,beforeSha256:sha(original),afterSha256:sha(text),probes});
}
fs.writeFileSync(path.join(root,'trace-instrumentation.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest.map(x=>({file:x.file,probes:x.probes.length}))));
