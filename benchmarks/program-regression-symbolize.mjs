// Preserve raw trees; self and inclusive category columns overlap and never sum.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping');
const [input, output, proofFile] = process.argv.slice(2);
const proof=JSON.parse(readFileSync(proofFile,'utf8'));
const verified=new Map(proof.mappings.map(x=>[x.original,x]));
const sites=[];
const ts=require('typescript');
const sourceOwners=new Map();
function ownerOf(source,line,column){
 let file=source;try{if(file.startsWith('file:'))file=fileURLToPath(file);}catch{}
 if(!existsSync(file)||!/\.[cm]?[jt]sx?$/.test(file))return undefined;
 if(!sourceOwners.has(file)){
  const text=readFileSync(file,'utf8'),sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),owners=[];
  const visit=n=>{
   if(ts.isFunctionLike(n)&&n.body){
    const parent=n.parent;let label=ts.isConstructorDeclaration(n)?'constructor':n.name?.getText(sf)??(ts.isVariableDeclaration(parent)?parent.name.getText(sf):ts.isPropertyAssignment(parent)?parent.name.getText(sf):'<callback>');
    let cls=n.parent;while(cls&&!ts.isClassLike(cls))cls=cls.parent;if(cls?.name)label=cls.name.getText(sf)+'.'+label;
    const start=ts.isVariableDeclaration(parent)?parent.getStart(sf):n.getStart(sf);owners.push({start,end:n.getEnd(),name:label});
   }ts.forEachChild(n,visit);
  };visit(sf);sourceOwners.set(file,{sf,owners,sha256:sha256(file)});
 }
 const x=sourceOwners.get(file);let pos;try{pos=x.sf.getPositionOfLineAndCharacter(line-1,column);}catch{return undefined;}
 return x.owners.filter(n=>n.start<=pos&&n.end>pos).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]?.name;
}
const profile = JSON.parse(readFileSync(input, 'utf8'));
const maps = new Map();
const identities = new Map();
const frameCache=new Map();
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function mapped(frame) {
  const key=JSON.stringify(frame);if(frameCache.has(key))return frameCache.get(key);
  let path = frame.url;
  if (path.startsWith('file:')) path = fileURLToPath(path);
  if (!maps.has(path)) {
    const found=verified.get(path);
    if(found){
      if(sha256(path)!==found.originalSha256||sha256(found.verifiedAuxiliary)!==found.originalSha256||sha256(found.map)!==found.mapSha256)throw Error('Mapping proof hash mismatch '+path);
      const raw=JSON.parse(readFileSync(found.map,'utf8'));
      // sources are relative to the auxiliary map directory; sourceRoot is a display namespace.
      maps.set(path,new TraceMap({...raw,sourceRoot:''},found.map));
      identities.set(path,found);
    }else maps.set(path,null);
  }
  const map=maps.get(path);
  const original=map?originalPositionFor(map,{line:frame.lineNumber+1,column:frame.columnNumber}):null;
  const owner=original?.source?ownerOf(original.source,original.line,original.column):undefined;
  const value={function:owner??original?.name??frame.functionName,source:original?.source??frame.url,line:original?.line??frame.lineNumber+1,column:original?.column??frame.columnNumber,mapped:!!original?.source,generated:frame};frameCache.set(key,value);return value;
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
const allocationStacks=[];
if(!cpu){const stack=(n,parents=[])=>{const frames=[...parents,mapped(n.callFrame)];if(n.selfSize)allocationStacks.push({bytes:n.selfSize,frames});for(const child of n.children)stack(child,frames);};stack(profile.head);allocationStacks.sort((a,b)=>b.bytes-a.bytes);}
const sorted = [...rows.values()].sort((a, b) => b.self - a.self);
writeFileSync(output, JSON.stringify({ input, metric: cpu ? 'sampled microseconds' : 'estimated allocation bytes',
  interpretation: 'Inclusive rows overlap, including recursive stacks; do not add them. Call-frame positions and original mapped columns identify function entries, not executing or allocating instructions. Distinct callback or handler frames may identify a mechanism; whole-run self cost leaves internal dispatch, argument allocation, and approximation unresolved. Preserved positionTicks use generated lines; a minified single line cannot recover precise instruction columns. Missing site matches mean unsupported attribution, never zero cost. Unmapped frames remain explicit. Allocation stacks estimate bytes including collected objects, not exact physical allocation counts.',
  sites: sites.map((site) => {
    const matches = sorted.filter((row) => row.source.endsWith(site.source) && row.line >= site.firstLine && row.line <= site.lastLine && (site.firstColumn === undefined || row.column >= site.firstColumn) && (site.lastColumn === undefined || row.column <= site.lastColumn));
    return { ...site, attribution: matches.length ? 'function-entry matches only; inspect callbacks and stacks before assigning mechanism cost' : 'unsupported: no distinct function-entry attribution; not zero cost', matches };
  }),
  sourceMapIdentities: [...identities.values()], sourceIdentities:[...sourceOwners].map(([file,x])=>({file,sha256:x.sha256})), totalSelf:sorted.reduce((n,r)=>n+r.self,0), mappedSelf:sorted.filter(r=>r.mapped).reduce((n,r)=>n+r.self,0), allocationStacks, rows: sorted }, null, 2) + '\n');
