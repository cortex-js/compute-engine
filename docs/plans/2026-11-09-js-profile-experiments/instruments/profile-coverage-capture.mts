import { createHash } from 'node:crypto';

// Research-only observer. Resolution follows boxed binding identities, never an
// ambient name lookup in place of a captured definition. No CE private API.
const numeric = new Set(`Add Subtract Multiply Divide Power Negate Abs Sign Mod Floor Ceil Round Sqrt Root Square Sin Cos Tan Cot Sec Csc Sinh Cosh Tanh Arcsin Arccos Arctan Arctan2 Ln Log Exp Max Min ElementMax ElementMin Equal NotEqual Less LessEqual Greater GreaterEqual And Or Not If Which When At First Last Length List Tuple PointList PointX PointY PointZ Range Sum Product Comprehension Map Filter Reduce Scan ListJoin ReplaceAt Reverse Take Drop Flatten Sort Unique GCD LCM Factorial Gamma BesselJ Mandelbrot Complex Real Imaginary Conjugate Arg Re Im Rgb Oklch AsOklab Color Typed IsMissing Coalesce AssertPresent`.split(' '));
const structural = new Set(`Function Block Declare Assign DefineFunction Loop ParallelLoop Break Continue Return Element Limits Hold ReleaseHold`.split(' '));
const leaves = new Set(`Symbol Integer Real Rational Number Complex String NaN`.split(' '));
const definitions = new WeakMap<object, {literal:any; name:string; origin:string; ambiguous?:boolean}>();
const baselines = new WeakMap<object, Map<string,object>>();
const ids = new WeakMap<object,number>(); let nextId=1;
const id=(v:any) => { if(!v || typeof v!=='object') return null; if(!ids.has(v))ids.set(v,nextId++);return ids.get(v)!; };
const defOf=(n:any)=>n?.operatorDefinition ?? n?.valueDefinition;
const definition=(ce:any,name:string)=>{ const d=ce.lookupDefinition(name); return d?.operator ?? d?.value; };
const boxed=(v:any)=>v && typeof v==='object' && typeof v.operator==='string' && v.engine;
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

function remember(n:any,origin:string) {
 if(!boxed(n))return;
 if(n.operator==='DefineFunction' && n.ops?.[0]?.symbol && n.ops?.[1]?.operator==='Function') {
  const name=n.ops[0].symbol;const d=definition(n.engine,name);
  if(d) { const prior=definitions.get(d); definitions.set(d,{literal:n.ops[1],name,origin,ambiguous:prior?.ambiguous || (prior && hash(prior.literal.json)!==hash(n.ops[1].json))}); }
 }
}
export function installPublicObserver(Base:any) {
 const originalBox=Base.prototype.box, originalAssign=Base.prototype.assign;
 const evaluated=new WeakSet<object>();const restorations:Array<()=>void>=[];
 function baseline(ce:any) {
  if(baselines.has(ce))return;
  const entries=new Map<string,object>();
  for(const name of [...numeric,...structural]) {const d=definition(ce,name);if(d)entries.set(name,d);}
  if(entries.has('Add'))baselines.set(ce,entries);
 }
 Base.prototype.box=function(...args:any[]) {baseline(this);const n=originalBox.apply(this,args);remember(n,'public prototype box DefineFunction');if(n.operator==='DefineFunction'&&!evaluated.has(n)){evaluated.add(n);const own=Object.getOwnPropertyDescriptor(n,'evaluate');const evaluate=n.evaluate;n.evaluate=function(...a:any[]){const result=evaluate.apply(this,a);remember(this,'public DefineFunction evaluate event');return result;};restorations.push(()=>{if(own)Object.defineProperty(n,'evaluate',own);else delete n.evaluate;});}return n;};
 Base.prototype.assign=function(...args:any[]) {
  baseline(this);const prior=typeof args[0]==='string'?definition(this,args[0]):undefined;
  const literal=boxed(args[1])&&args[1].operator==='Function'?args[1]:undefined;
  const result=originalAssign.apply(this,args);
  if(prior&&!literal)definitions.delete(prior);
  if(typeof args[0]==='string'&&literal){const d=definition(this,args[0]);if(d)definitions.set(d,{literal,name:args[0],origin:'public prototype assign Function'});}
  return result;
 };
 return ()=>{Base.prototype.box=originalBox;Base.prototype.assign=originalAssign;for(const restore of restorations)restore();};
}
export function observedConstructor(Base:any) {
 return class extends Base {
  constructor(...args:any[]) {
   super(...args);
   const baseline=new Map<string,object>();
   for(const name of [...numeric,...structural]) {const d=definition(this,name);if(d)baseline.set(name,d);}
   baselines.set(this,baseline);
  }
  box(...args:any[]) {const n=super.box(...args);remember(n,'public box DefineFunction');return n;}
  assign(...args:any[]) {
   const literal=boxed(args[1]) && args[1].operator==='Function' ? args[1] : undefined;
   const prior=typeof args[0]==='string'?definition(this,args[0]):undefined;
   const result=super.assign(...args);
   if(prior && !literal)definitions.delete(prior);
   if(typeof args[0]==='string' && literal) {const d=definition(this,args[0]);if(d)definitions.set(d,{literal,name:args[0],origin:'public assign boxed Function'});}
   return result;
  }
 }
}
function bindingNames(n:any):string[] {
 if(!n)return [];
 if(n.symbol)return [n.symbol];
 if(n.operator==='Tuple'||n.operator==='List')return (n.ops??[]).flatMap(bindingNames);
 if(n.operator==='Declare'||n.operator==='Typed')return bindingNames(n.ops?.[0]);
 return [];
}
export function inspectProfile(expr:any,options:any={},context:any={}) {
 const activeFunctions=new Set<any>();const visitedFunctions=new Set<any>();
 const heads:Record<string,number>={};const types:Record<string,number>={};const functions:any[]=[];const symbols:any[]=[];
 const unknown=new Set<string>();const outside=new Set<string>();const effects=new Set<string>();let count=0;
 const baseline=baselines.get(expr.engine);
 function symbol(n:any,locals:Set<string>,owner:string) {
  if(locals.has(n.symbol))return;
  const bound=n.valueDefinition ?? n.operatorDefinition;
  const current=definition(n.engine,n.symbol);
  const value=n.valueDefinition?.value;
  const item={name:n.symbol,owner,type:n.type.toString(),binding:id(bound),ambientBinding:id(current),ambientAgrees:bound===current,hasValue:value!==undefined,valueType:value?.type.toString(),valueHash:value?hash(value.json):undefined};
  if(!symbols.some(x=>x.name===item.name&&x.owner===owner&&x.binding===item.binding))symbols.push(item);
  if(!bound && !['True','False','Pi','ExponentialE','ImaginaryUnit','Nothing','Missing'].includes(n.symbol))unknown.add(`unbound-symbol:${owner}:${n.symbol}`);
  if(value?.operator==='Function')expand(value,n.symbol,bound,locals,owner,'public bound value');
  else if(value && !['Integer','Real','Rational','Number','Complex','List','Tuple','String'].includes(value.operator))unknown.add(`computed-capture:${owner}:${n.symbol}`);
 }
 function expand(literal:any,name:string,bound:any,locals:Set<string>,owner:string,origin:string) {
  if(activeFunctions.has(bound??literal)){unknown.add(`recursive-call:${name}`);return;}
  if(visitedFunctions.has(bound??literal))return;
  visitedFunctions.add(bound??literal);activeFunctions.add(bound??literal);
  const params=(literal.ops??[]).slice(1).flatMap(bindingNames);
  functions.push({name,binding:id(bound),origin,parameters:params,bodyHash:hash(literal.ops?.[0]?.json),type:literal.type.toString(),definitionJson:literal.json});
  // Function body keeps its own boxed lexical bindings. Only its parameters
  // are local; caller-local spellings never replace captured definitions.
  walk(literal.ops?.[0],new Set(params),`function:${name}#${id(bound)}`);
  activeFunctions.delete(bound??literal);
 }
 function walk(n:any,locals:Set<string>,owner:string,role='value') {
  if(!boxed(n))return;
  if(count++>=30000){unknown.add('node-limit');return;}
  // Same boxed node can appear under different binders. Count uses, not DAG
  // nodes, and use no global seen set that would drop lexical occurrences.
  const head=n.operator;heads[head]=(heads[head]??0)+1;
  const type=n.type.toString();types[type]=(types[type]??0)+1;
  if(n.symbol){symbol(n,locals,owner);return;}
  if(head==='String'){if(role!=='metadata')outside.add('runtime-string');return;}
  if(leaves.has(head)&&!(n.ops?.length))return;
  if(head==='Dictionary'){
   if(role!=='metadata')outside.add('runtime-dictionary');
   for(const key of n.keys??[]) {
    const val=n.get(key); if(role==='metadata'&&key!=='value')continue;
    walk(val,locals,owner,key==='value'?'value':role);
   }return;
  }
  if(head==='Function'){expand(n,'literal',n,locals,owner,'literal operand');return;}
  if(head==='Block'){
   const nested=new Set(locals);
   for(const s of n.ops??[])if(['Declare','Assign','DefineFunction'].includes(s.operator))for(const b of bindingNames(s.ops?.[0]))nested.add(b);
   for(const s of n.ops??[])walk(s,nested,owner);return;
  }
  if(head==='Typed') {walk(n.ops?.[0],locals,owner);return;}
  if(head==='Declare') {for(const op of (n.ops??[]).slice(1))walk(op,locals,owner,'metadata');return;}
  if(head==='Assign') {effects.add('assignment');for(const op of (n.ops??[]).slice(1))walk(op,locals,owner);return;}
  if(head==='DefineFunction'){walk(n.ops?.[1],locals,owner);return;}
  if(['Loop','ParallelLoop','Sum','Product','Comprehension'].includes(head)) {
   effects.add(head==='ParallelLoop'?'parallel-loop-syntax':'iteration');
   const nested=new Set(locals);
   for(const op of (n.ops??[]).slice(1))if(['Element','Limits'].includes(op.operator))for(const name of bindingNames(op.ops?.[0]))nested.add(name);
   walk(n.ops?.[0],nested,owner);
   for(const op of (n.ops??[]).slice(1)) {
    if(['Element','Limits'].includes(op.operator))for(const bound of op.ops.slice(1))walk(bound,locals,owner);
    else walk(op,locals,owner);
   }return;
  }
  if(options.functions && Object.hasOwn(options.functions,head))unknown.add(`host-override:${head}`);
  else if(locals.has(head))unknown.add(`local-call:${owner}:${head}`);
  else {
   const bound=defOf(n);const known=bound?definitions.get(bound):undefined;
   const literal=known?.literal ?? (n.valueDefinition?.value?.operator==='Function'?n.valueDefinition.value:undefined);
   if(known?.ambiguous)unknown.add(`ambiguous-definition-history:${head}`);
   else if(literal)expand(literal,head,bound,locals,owner,known?.origin??'public bound value');
   else if(!(bound && baseline?.get(head)===bound) && !structural.has(head))unknown.add(`unmodeled-or-opaque-call:${owner}:${head}`);
  }
  if(['Random','RandomExpression','RandomInteger','RandomReal','Print'].includes(head))effects.add(head);
  for(const op of n.ops??[])walk(op,locals,owner);
 }
 walk(expr,new Set(),'root');
 for(const t of Object.keys(types))if(t==='unknown'||t==='any'||t==='error')unknown.add(`unspecialized-type:${t}`);
 const classification=outside.size?'outside-candidate-vocabulary':unknown.size?'unresolved':'candidate-syntax-only';
 return {...context,target:options.to??'javascript',mode:options.mode??'strict',inputHash:hash(expr.json),resultType:expr.type.toString(),classification,heads,types,functions,symbols,unknown:[...unknown].sort(),outside:[...outside].sort(),effects:[...effects].sort(),nodeVisits:count,options:{...options,functions:options.functions?Object.keys(options.functions):undefined},limitations:['Pre-CE-preparation; no profile admission claim','Public definition events only; missing function provenance remains unresolved','Name-local call sites conservatively unresolved; no argument-shape specialization','Candidate syntax includes statements; independence and portability not established']};
}
export const profileVocabulary={numeric:[...numeric].sort(),structural:[...structural].sort(),description:'Candidate numeric expressions, homogeneous numeric lists/tuples and color, control flow and local assignment; string/dictionary values outside; declaration metadata ignored. Numeric types are observed, not fully signature-validated. Unknown types or calls remain unresolved.'};
