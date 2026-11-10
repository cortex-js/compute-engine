// Calls a body with the loop in a per-call arrow function (as A) and one
// without it (as D), with a full collection between rounds; V8 traces when
// each one is optimized.
const sys = { at: (a, i) => a[i - 1] };
const withIife = new Function('_SYS', `return function iifeForm(H) { const f = (x) => x * 0.5; return (() => { let s = 0; for (let k = 1; k <= 1024; k++) s += f(_SYS.at(H, k)); return s; })(); };`)(sys);
const without = new Function('_SYS', `return function plainForm(H) { const f = (x) => x * 0.5; let s = 0; for (let k = 1; k <= 1024; k++) s += f(_SYS.at(H, k)); return s; };`)(sys);
const H = Array.from({ length: 1024 }, (_, i) => i / 7);
let sink = 0;
for (let round = 0; round < 4; round++) {
  console.log(`--- round ${round}: full collection`);
  globalThis.gc();
  for (const [name, fn] of [['iifeForm', withIife], ['plainForm', without]]) {
    const t0 = process.hrtime.bigint();
    for (let c = 0; c < 100; c++) sink += fn(H);
    console.log(`${name}: ${Number(process.hrtime.bigint() - t0) / 100} ns per call`);
  }
}
console.log(sink > 0);
