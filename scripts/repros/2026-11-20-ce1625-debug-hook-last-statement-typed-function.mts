// CE-1625: the last statement of the body of a function that declares a
// return type or an effect calls no debug hook of `executeEpsilAsync()`.
//
// Run: npx tsx scripts/repros/2026-11-20-ce1625-debug-hook-last-statement-typed-function.mts
//
// Each line gives a function, and the statements of its body for which
// `beforeStatement` was called during `f(1000)`. READY when every line lists
// every statement of the body.
//
// Output at af8263034fb9f22add3c3621ab48458acac2dec6 (2026-11-20):
//   function f(t) { let k = t; k + 1 }  |  "let k = t" "k + 1"
//   function f(t: number) { let k = t; k + 1 }  |  "let k = t" "k + 1"
//   function f(t) -> number { let k = t; k + 1 }  |  "let k = t"
//   function f(t) scope { a = a + t; b = b + 1 }  |  "a = a + t"
//   function f(t) scope { a = a + t }  |
//   function f(t) random -> number { let k = t; k + random(1..2) }  |  "let k = t"
//   NOT READY
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsilAsync } from '../../src/epsil/execute-epsil';

const cases: [definition: string, statements: number][] = [
  ['function f(t) { let k = t; k + 1 }', 2],
  ['function f(t: number) { let k = t; k + 1 }', 2],
  ['function f(t) -> number { let k = t; k + 1 }', 2],
  ['function f(t) scope { a = a + t; b = b + 1 }', 2],
  ['function f(t) scope { a = a + t }', 1],
  ['function f(t) random -> number { let k = t; k + random(1..2) }', 2],
];

let ready = true;
for (const [definition, statements] of cases) {
  const ce = new ComputeEngine();
  const source = `let a = 0\nlet b = 0\n${definition}\nf(1000)`;
  const called: string[] = [];
  await executeEpsilAsync(ce, source, {
    debug: {
      beforeStatement: (at) => {
        if (at.callDepth > 0)
          called.push(JSON.stringify(source.slice(at.range[0], at.range[1])));
      },
    },
  });
  if (called.length !== statements) ready = false;
  console.log(`${definition}  |  ${called.join(' ')}`);
}
console.log(ready ? 'READY' : 'NOT READY');
