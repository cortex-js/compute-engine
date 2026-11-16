// Run from the checkout with: node --import tsx <this-file>
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.env.CE_ROOT ?? process.cwd();
const { ComputeEngine } = await import(pathToFileURL(path.join(root, 'src/compute-engine/index.ts')).href);
const { executeEpsil } = await import(pathToFileURL(path.join(root, 'src/epsil/execute-epsil.ts')).href);
for(const source of [
 'function g(x:real,y:real){x+y};g(y:1,x:2);0',
 'let g:(x:real,y:real)->real=(x,y)=>x+y;g(y:1,x:2);0',
 'function g(x:real,y:real){x+y};let alias:function=g;alias(y:1,x:2);0'
]){const r=executeEpsil(new ComputeEngine(),source);console.log(JSON.stringify({source,value:r.value.json,diagnostics:r.diagnostics}));if(r.diagnostics.length||r.value.json!==0)process.exitCode=1;}
