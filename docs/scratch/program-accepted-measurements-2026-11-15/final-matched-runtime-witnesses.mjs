import assert from 'node:assert/strict';
import fs from 'node:fs';
const roots={baseline:'/private/tmp/program-only-accepted-baseline-20261115',candidate:'/private/tmp/program-only-accepted-candidate-20261115'};
const cases=[
 ['shared-Limit-sum','function f(){let L=[1,2];limit(sum(L),1)};f()'],
 ['shared-Limit-length','function f(){let L=[1,2];limit(length(L),1)};f()'],
 ['division-zero-let','let x=0;x/x'],
 ['division-zero-const','const x=0;x/x'],
 ['division-zero-alias-let','let x=0;let y=x;y/y'],
 ['division-zero-alias-const','const x=0;const y=x;y/y'],
 ['library-constant-quotient','Pi/Pi'],
 ['earlier-const-default','const W=5;function f(k=W){k+1};f()'],
];
const rows=[];
for(const [arm,root] of Object.entries(roots)){
 const mod=await import(root+'/ce/dist/esm-min/epsil.js');
 for(const [id,source] of cases){
  const ce=new mod.ComputeEngine(),result=mod.executeEpsil(ce,source);
  rows.push({arm,id,source,value:result.value.toString(),json:result.value.json,type:result.value.type.toString(),diagnostics:result.diagnostics});
  fs.writeFileSync(new URL('./runtime-witnesses.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
  if(arm==='candidate'&&id.startsWith('division-zero-'))assert.equal(result.value.toString(),'NaN',arm+' '+id+' must remain NaN');
  if(id==='library-constant-quotient')assert.equal(result.value.re,1);
  if(id==='earlier-const-default')assert.equal(result.value.re,6);
  if(id==='shared-Limit-sum')assert.equal(result.value.re,arm==='baseline'?1:3);
  if(id==='shared-Limit-length'&&arm==='candidate')assert.equal(result.value.re,2);
 }
}
fs.writeFileSync(new URL('./runtime-witnesses.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
console.log('Runtime consumer controls passed; exact baseline/candidate witnesses retained.');
