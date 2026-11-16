import { ComputeEngine } from '/tmp/wt-program-accepted-sol/src/compute-engine.ts';
import { parseEpsil } from '/tmp/wt-program-accepted-sol/src/epsil/parse-epsil.ts';
import { executeEpsil } from '/tmp/wt-program-accepted-sol/src/epsil/execute-epsil.ts';
import { checkSource } from '/tmp/wt-program-accepted-sol/src/cli/check.ts';
import { compile } from '/tmp/wt-program-accepted-sol/src/compute-engine/compilation/compile-expression.ts';
const rows=[];
for (const source of [
'do { let xs = [1, 2, 3]\nwhile let [h, ...] = xs { xs = Rest(xs) }\nxs }',
'do { let xs = [1, 2, 3]\nmatch 1 { 1 => do { xs = "abc" } }\nxs }',
'do { let xs = [1, 2, 3]\nlet s = 0\nwhile let [h, ...] = xs { s = s + h; xs = Rest(xs) }\ns }',
'let a: any = 1\na = "x"\na',
'let a = 1\nlet a = 2\na',
'let a = 1\nlet (a, b) = (2, 3)\nlet b = 4\nb',
'function g(a) {\n  f(y) := y + 1\n  f(x) := x + 3\n  f(a)\n}\n[g(5), g(6)]',
]) {
 const ce = new ComputeEngine();const [ast,parseDiagnostics]=parseEpsil(source);const boxed=ce.box(ast!);const type=boxed.type.toString();const value=boxed.evaluate();const result=executeEpsil(new ComputeEngine(),source);const checked=checkSource(source);let compiled:unknown;
 if(source.includes('let s = 0')){const c=compile(new ComputeEngine().box(ast!));compiled={success:c.success,value:c.success?c.run():undefined};}
 rows.push({source,parseDiagnostics,type,value:value.toString(),sound:value.type.matches(type),result:{value:result.value.json,diagnostics:result.diagnostics},checkDiagnostics:checked.diagnostics,compiled});
}
console.log(JSON.stringify(rows,null,2));
