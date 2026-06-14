// one (op, prec) cell in a fresh process. usage: node _cell.mjs <SRC|bundlePath> <op> <prec> [budgetMs]
const [src, op, precS, ms] = [process.argv[2], process.argv[3], +process.argv[4], +(process.argv[5]||400)];
const { ComputeEngine } = src === 'SRC'
  ? await import('../../src/compute-engine/index.ts') : await import(src);
const OPS = {
  ln:(c)=>['Ln',c+2], exp:(c)=>['Exp',['Divide',c+1,c+3]],
  sin:(c)=>['Sin',['Divide',c+1,c+3]], cos:(c)=>['Cos',['Divide',c+1,c+3]],
  tan:(c)=>['Tan',['Divide',c+1,c+3]], atan:(c)=>['Arctan',c+2],
  asin:(c)=>['Arcsin',['Divide',c+1,c+3]], sqrt:(c)=>['Sqrt',c+2],
};
const ce=new ComputeEngine(); ce.precision=precS; const b=OPS[op]; let c=0;
for(let i=0;i<5;i++) ce.box(b(c++)).N();
let n=0; const t0=process.hrtime.bigint(); let e=0n; const L=BigInt(ms)*1000000n;
do{ce.box(b(c++)).N();n++;if((n&3)===0)e=process.hrtime.bigint()-t0;}while(e<L);
console.log((Number(process.hrtime.bigint()-t0)/n/1e6).toFixed(3));
