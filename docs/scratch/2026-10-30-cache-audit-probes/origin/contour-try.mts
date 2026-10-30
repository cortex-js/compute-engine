import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
const extra: any[] = [
  ['ContourIntegrate', ['Divide', 1, ['Add', ['Power', 'z', 6], 1]], 'z', ['CircleContour', ['Rational', 1, 2], 1]],
  ['ContourIntegrate', ['Divide', 1, ['Multiply', ['Add', ['Power', 'z', 2], 2], ['Add', ['Power', 'z', 2], 3]]], 'z', ['CircleContour', ['Complex', 0, 1], 1]],
  ['ContourIntegrate', ['Divide', ['Power', 'z', 2], ['Subtract', ['Power', 'z', 4], 2]], 'z', ['CircleContour', 1, 1]],
  ['ContourIntegrate', ['Divide', ['Exp', 'z'], ['Add', ['Power', 'z', 3], 1]], 'z', ['CircleContour', ['Rational',1,2], 1]],
  ['ContourIntegrate', ['Divide', ['Sin', 'z'], ['Multiply', ['Subtract', 'z', B()], ['Add', ['Power', 'z', 2], 1]]], 'z', ['CircleContour', 0, 3]],
];
function B() { return ['Add', 1, ['Sqrt', 2]]; }
for (let rep = 0; rep < 3; rep++) {
  const ce = new ComputeEngine();
  const out: string[] = [];
  for (const c of extra) {
    const t0 = performance.now();
    const r = ce.box(c).evaluate();
    out.push(`${(performance.now() - t0).toFixed(0)}ms ${r.toString().slice(0, 90)}`);
  }
  if (rep === 2) console.log(process.env.CE_CACHE_OFF ?? 'none', '\n' + out.join('\n'));
}
