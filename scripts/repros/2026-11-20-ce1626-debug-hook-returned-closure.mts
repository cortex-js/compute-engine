// CE-1626: a statement of a function that another function returned calls
// no debug hook of `executeEpsilAsync()` when it uses a parameter of the
// function that made it: the substitution of the parameter's value rebuilds
// the statement without its `sourceOffsets`.
//
// Run: npx tsx scripts/repros/2026-11-20-ce1626-debug-hook-returned-closure.mts
//
// Each line gives the body of the returned function, and the statements of
// that body for which `beforeStatement` was called during `h(5)`. READY when
// every line lists every statement of the body.
//
// Output at af8263034fb9f22add3c3621ab48458acac2dec6 (2026-11-20):
//   let z = t + 1; z  |  "let z = t + 1" "z"
//   let z = t + k; z  |  "z"
//   let z = t + k; let w = z * k; w + k  |
//   NOT READY
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsilAsync } from '../../src/epsil/execute-epsil';

const bodies: [body: string, statements: number][] = [
  ['let z = t + 1; z', 2],
  ['let z = t + k; z', 2],
  ['let z = t + k; let w = z * k; w + k', 3],
];

let ready = true;
for (const [body, statements] of bodies) {
  const ce = new ComputeEngine();
  const source = `function mk(k) { t => do { ${body} } }\nlet h = mk(2)\nh(5)`;
  const start = source.indexOf(body);
  const end = start + body.length;
  const called: string[] = [];
  await executeEpsilAsync(ce, source, {
    debug: {
      beforeStatement: (at) => {
        const [s, e] = at.range;
        if (s >= start && e <= end)
          called.push(JSON.stringify(source.slice(s, e)));
      },
    },
  });
  if (called.length !== statements) ready = false;
  console.log(`${body}  |  ${called.join(' ')}`);
}
console.log(ready ? 'READY' : 'NOT READY');
