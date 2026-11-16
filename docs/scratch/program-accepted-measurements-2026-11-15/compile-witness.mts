import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = process.env.CE_SOURCE_ROOT!;
const { ComputeEngine } = await import(pathToFileURL(resolve(root,'src/compute-engine.ts')).href);
const { parseEpsil } = await import(pathToFileURL(resolve(root,'src/epsil/parse-epsil.ts')).href);
const { compile } = await import(pathToFileURL(resolve(root,'src/compute-engine/compilation/compile-expression.ts')).href);
const { resolveLibraryNames } = await import(pathToFileURL(resolve(root,'src/epsil/resolve-library-names.ts')).href);
const cases = {
 scalar:'1 + 2',
 mutable:'let x=1; x=1.5; x',
 callable:'let k=(n:integer)=>n+1; k(2)',
 typedCallable:'let k:(integer)->integer=(n)=>n+1; k(2)',
 paired:'let g:(integer)->integer; function g(k) { k+1 }; g(1)',
 invalid:'let k:(integer)->integer=(n)=>n; k(1.5)',
};
const rows=[];
for (const [name,source] of Object.entries(cases)) for (const to of ['javascript','interval-js','glsl','wgsl']) {
 const ce=new ComputeEngine();
 try {
  const p=ce.box(resolveLibraryNames(parseEpsil(source)[0],source,ce));
  const c=compile(p,{to,fallback:false});
  let result;
  if(c.success && ['javascript','interval-js'].includes(to)) result=c.run();
  rows.push({name,source,to,head:p.operator,type:p.type.toString(),success:c.success,result,unsupported:c.unsupported});
 } catch(e) {rows.push({name,source,to,success:false,error:String(e)});}
}
console.log(JSON.stringify(rows,null,2));
