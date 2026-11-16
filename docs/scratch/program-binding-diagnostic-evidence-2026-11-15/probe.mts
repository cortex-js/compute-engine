import { ComputeEngine } from '../../../src/compute-engine.ts';
import { executeEpsil } from '../../../src/epsil/execute-epsil.ts';
import { checkEpsil } from '../../../src/epsil/check-epsil.ts';
const codes=(ds:any[])=>ds.map(d=>({kind:d.message[0],code:d.code??d.message[1],range:d.range}));
const binding=(ce:any,n:string)=>{const d=ce.lookupDefinition(n);return !d?null:{kind:'value' in d?'value':'operator',type:String(('value'in d?d.value.type:d.operator.signature)),constant:'value'in d?d.value.isConstant:undefined};};
const cases={
 literal:'let k = (n: integer) => n + 1\nk(1.5)',
 replacement:'let k = (n: integer) => n\nk = (s: string) => s\nk("a")',
 replacementBadCall:'let k = (n: integer) => n\nk = (s: string) => s\nk(1)',
 secondReplacement:'let k = (n: integer) => n\nk = (s: string) => s\nk = (n: integer) => n\nk("a")',
 constWrite:'const k = (n: integer) => n + 1\nk = (s: string) => s\nk("a")',
 aliasBefore:'let k = (n: integer) => n\nlet g = k\nk = (s: string) => s\ng(2)',
 aliasAfter:'let k = (n: integer) => n\nk = (s: string) => s\nlet g = k\ng("a")',
 aliasAfterBad:'let k = (n: integer) => n\nk = (s: string) => s\nlet g = k\ng(1)',
 literalEvidence:'let k = (n: integer) => n + 1\nlet x = 1.5\nk(x)',
 annotatedEvidence:'let k = (n: integer) => n + 1\nlet x: number = 1.5\nk(x)',
 unknownEvidence:'let k = (n: integer) => n + 1\nlet x = g()\nk(x)',
 scalarReplacement:'let x = 1\nx = "a"\nx',
 blockReplacement:'do { let k = (n: integer) => n; k = (s: string) => s; k = (n: integer) => n; k(2) }',
};
const out:any={cases:{},runs:[]};
for(const [name,source] of Object.entries(cases)) {const ce=new ComputeEngine();const checked=checkEpsil(ce,source);const result=executeEpsil(ce,source);out.cases[name]={source,check:codes(checked.diagnostics),value:result.value.json,diagnostics:codes(result.diagnostics),k:binding(ce,'k'),g:binding(ce,'g'),x:binding(ce,'x')};}
for(const scenario of ['letRerun','constRerun','replaceAcrossCells','annotatedAcrossCells','aliasAcrossCells']){
 const ce=new ComputeEngine();ce.pushScope();
 const sources=scenario==='letRerun'?['let k = (n: integer) => n\nk(2)','let k = (s: string) => s\nk("b")']:scenario==='constRerun'?['const k = (n: integer) => n\nk(2)','const k = (s: string) => s\nk("b")']:scenario==='replaceAcrossCells'?['let k = (n: integer) => n','k = (s: string) => s','k = (n: integer) => n','k("b")']:scenario==='annotatedAcrossCells'?['let k: (integer) -> integer = (n) => n','k = (s: string) => s','k(2)']:['let k = (n: integer) => n\nlet g = k','let k = (s: string) => s','g(2)'];
 const steps=[];
 for(const source of sources){const def=ce.lookupDefinition('k');const before=binding(ce,'k');const check=checkEpsil(ce,source);const afterCheck=binding(ce,'k');const sameAfterCheck=ce.lookupDefinition('k')===def;const result=executeEpsil(ce,source);steps.push({source,before,afterCheck,sameAfterCheck,check:codes(check.diagnostics),value:result.value.json,diagnostics:codes(result.diagnostics),after:binding(ce,'k'),sameAfterRun:ce.lookupDefinition('k')===def,g:binding(ce,'g')});}
 out.runs.push({scenario,steps});ce.popScope();
}
console.log(JSON.stringify(out,null,2));
