import { ComputeEngine } from '/tmp/wt-program-accepted-sol/src/compute-engine.ts';
import { executeEpsil } from '/tmp/wt-program-accepted-sol/src/epsil/execute-epsil.ts';
import { checkSource } from '/tmp/wt-program-accepted-sol/src/cli/check.ts';
import { typeToString } from '/tmp/wt-program-accepted-sol/src/common/type/serialize.ts';
const rows=[];
for(const source of [
'function circle(x, y, r) { {x -> x, y -> y, r -> r} }\ntype circle = record{x: number, y: number, r: number}\ncircle(1, 2, 3)',
'const c = 1\nfunction c(x) { x }\nc',
'const k = (n) => n\nk(x) = x * 2\nk(3)',
'const c = 1\nfunction c(x) { x }\nfunction c(x, y) { x }',
'const c: string = 1\nfunction c(x) { x }\nc(2)',
'f(n) = 1\nf = (x => 42)\nf(m) = 2\nf(0)',
'g(n) = 1\ng = x => 2\ng(n) = 3\ng(9)',
]){const ce=new ComputeEngine();const result=executeEpsil(ce,source);rows.push({source,value:result.value.json,type:result.value.type.toString(),diagnostics:result.diagnostics,checked:checkSource(source).diagnostics});}
{
const ce=new ComputeEngine();let stampSeenInsideHandler:unknown='handler not run';ce.declare('BoxDeclare',{signature:'() -> nothing',evaluate:()=>{ce.box(['DeclareType','BT',"'integer'"]).evaluate();ce.box(['DeclareProtocol','BTP']).evaluate();stampSeenInsideHandler=ce._typeRegistry['BT']._declOrigin;return ce.Nothing;}});
const source='BoxDeclare()\ntype BT = tuple<a: integer>\nprotocol BTP {}\n1';const result=executeEpsil(ce,source);rows.push({source,value:result.value.json,diagnostics:result.diagnostics,stampSeenInsideHandler,stampIsUndefined:stampSeenInsideHandler===undefined,finalType:typeToString(ce._typeRegistry['BT'].def!),protocolKnown:!!ce._protocolRegistry['BTP']});
}
{const ce=new ComputeEngine();executeEpsil(ce,'let (a, b) = (1, 2)');const result=executeEpsil(ce,'let (a, b) = 3');rows.push({source:'rerun let (a,b)=3',value:result.value.json,diagnostics:result.diagnostics,read:executeEpsil(ce,'(a,b)').value.json});}
console.log(JSON.stringify(rows,null,2));
