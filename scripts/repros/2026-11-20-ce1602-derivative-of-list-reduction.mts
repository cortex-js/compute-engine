// CE-1602: the derivative of a number computed from a whole list (`Min` of
// a list) must stay a number. The corpus form is the left side of a row of
// the Desmos document `neyret/lwuwgb9ic5`:
//   |m_2 - m| / sqrt((d/dx (m_2 - m))^2 + (d/dy (m_2 - m))^2)
// with `m` the smallest and `m_2` the second smallest of the squared
// distances `d` to N points, `m_2 = Min(Apply(k ↦ {k = m: 10^9, k}, d))`.
//
// Run: npx tsx scripts/repros/2026-11-20-ce1602-derivative-of-list-reduction.mts
//
// Each line gives the time of `evaluate()`, the type and the operator of the
// value, and the number of nodes of its MathJSON. The control line is `Min`
// of two number arguments, whose chain rule is correct and must not change.
// READY when every derivative of a number is a number.
//
// Output at ff12bbeb1, before the fix (2026-11-20, load 3.3 on 18 cores):
//   minimal   D(Min([x^2, (x-1)^2]), x)   15 ms  vector<2>  List  49 nodes
//   control   D(Min(x^2, (x-1)^2), x)     7 ms  number  Add  48 nodes
//   N=20  D(g, x)     212 ms  vector<20>  Which  112,885 nodes
//   N=20  quotient    871 ms  vector<20>  Which  428,065 nodes
//   N=64  D(g, x)     1093 ms  vector<64>  Which  3,132,165 nodes
//   N=64  quotient    9784 ms  vector<64>  Which  12,298,693 nodes
//   NOT READY
// Output with the fix (same commit, same load):
//   minimal   D(Min([x^2, (x-1)^2]), x)   4 ms  number  D  12 nodes
//   control   D(Min(x^2, (x-1)^2), x)     11 ms  number  Add  48 nodes
//   N=20  D(g, x)     18 ms  number  Add  424 nodes
//   N=20  quotient    147 ms  number  Divide  6,020 nodes
//   N=64  D(g, x)     19 ms  number  Add  1,216 nodes
//   N=64  quotient    657 ms  number  Divide  49,932 nodes
//   READY
// Output with the derivative of `Min` of a list as the derivative of the
// selected element, and with the invariant `Min` of a walk evaluated once
// (CE-1609), load 4.1 on 18 cores. `D(g, x)` holds the closed form of the
// smallest distance, and a `D` for the second smallest, whose list is
// written with a function:
//   minimal   D(Min([x^2, (x-1)^2]), x)   11 ms  real  At  20 nodes
//   control   D(Min(x^2, (x-1)^2), x)     9 ms  number  Add  48 nodes
//   N=20  D(g, x)     34 ms  number  Add  610 nodes
//   N=20  quotient    100 ms  number  Divide  6,392 nodes
//   N=64  D(g, x)     41 ms  number  Add  1,842 nodes
//   N=64  quotient    233 ms  number  Divide  51,184 nodes
//   READY
import { performance } from 'node:perf_hooks';
import { ComputeEngine } from '../../src/compute-engine';

type Json = unknown;

const nodes = (e: Json): number =>
  Array.isArray(e) ? e.reduce((sum: number, x) => sum + nodes(x), 0) : 1;

let allNumbers = true;

function reading(label: string, json: Json, mustBeNumber = true): void {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  const expr = ce.expr(json as never);
  const start = performance.now();
  const value = expr.evaluate();
  const ms = Math.round(performance.now() - start);
  if (mustBeNumber && !value.type.matches('number')) allNumbers = false;
  console.log(
    `${label}  ${ms} ms  ${value.type}  ${value.operator}  ${nodes(value.json).toLocaleString('en-US')} nodes`
  );
}

/** The quotient of the corpus row for `n` points, and its `d/dx`. */
function corpus(n: number): { derivative: Json; quotient: Json } {
  // A fixed sequence, so that every run reads the same expression.
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const points = [
    'List',
    ...Array.from({ length: n }, () => ['Tuple', next(), next()]),
  ];
  const distances = [
    'Add',
    ['Power', ['Add', 'x', ['Negate', ['PointX', points]]], 2],
    ['Power', ['Add', 'y', ['Negate', ['PointY', points]]], 2],
  ];
  const smallest = ['Min', distances];
  const second = [
    'Min',
    [
      'Apply',
      [
        'Function',
        ['Block', ['Which', ['Equal', 'k', smallest], 1e9, 'True', 'k']],
        'k',
      ],
      distances,
    ],
  ];
  const gap = ['Add', ['Negate', smallest], second];
  return {
    derivative: ['D', gap, 'x'],
    quotient: [
      'Divide',
      ['Abs', gap],
      [
        'Sqrt',
        ['Add', ['Power', ['D', gap, 'x'], 2], ['Power', ['D', gap, 'y'], 2]],
      ],
    ],
  };
}

const x2 = ['Power', 'x', 2];
const shifted = ['Power', ['Add', 'x', -1], 2];
reading('minimal   D(Min([x^2, (x-1)^2]), x) ', [
  'D',
  ['Min', ['List', x2, shifted]],
  'x',
]);
reading('control   D(Min(x^2, (x-1)^2), x)   ', [
  'D',
  ['Min', x2, shifted],
  'x',
]);
for (const n of [20, 64]) {
  const { derivative, quotient } = corpus(n);
  reading(`N=${n}  D(g, x)   `, derivative);
  reading(`N=${n}  quotient  `, quotient);
}
console.log(allNumbers ? 'READY' : 'NOT READY');
