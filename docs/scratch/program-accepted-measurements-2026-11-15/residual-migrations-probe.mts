import { ComputeEngine } from '/tmp/wt-program-accepted-sol/src/compute-engine.ts';
import { compile } from '/tmp/wt-program-accepted-sol/src/compile.ts';
import { executeEpsil, parseEpsil, resolveLibraryNames } from '/tmp/wt-program-accepted-sol/src/epsil.ts';
const rows=[];
for (const source of ['let xs: list<integer> = [1, 2, 3, 4, 5, 6]\nfor k in [1, 2, 3] { xs = filter(xs, c => c > k) }\nxs','let xs = [1, 2, 3, 4, 5, 6]\nfor k in [1, 2, 3] { xs = filter(xs, c => c > k) }\nxs','let x: integer = 1\nlet y: integer = 2\n(x, y) := (7, 4.5)']) {
 const ce=new ComputeEngine();const result=executeEpsil(ce,source);const other=new ComputeEngine();const [ast]=parseEpsil(source);const c=compile(other.box(resolveLibraryNames(ast!,source,other)),{to:'javascript'});rows.push({source,value:result.value.toString(),diagnostics:result.diagnostics,x:ce.symbol('x').evaluate().toString(),y:ce.symbol('y').evaluate().toString(),compiled:c.success?{success:true,value:c.run!({})}:{success:false,error:c.error}});
}
console.log(JSON.stringify(rows,null,2));
