/**
 * CE-1073: a compiled `Loop` that is a statement is a block statement.
 *
 * The JavaScript code of a `Loop` is an arrow function that is called at once
 * (`(() => { for (…) {…} })()`), because a `Loop` can be an operand. Where the
 * loop is a statement of a block or of a loop body, its value is discarded,
 * and the code is the block `{ for (…) {…} }`. V8 keeps a local that an inner
 * function writes in a heap context, so a loop over such locals ran up to two
 * times slower in the arrow function (the Buddhabrot step of Tycho: 2.1 ms
 * against 1.1 ms for one call of 5,000 samples).
 *
 * An `If` with an else, with a `Loop` in a branch, in a statement of a block,
 * is an `if` statement for the same reason.
 *
 * These tests check the emitted text and that each value is the value of the
 * interpreter: the scope of the loop index, `break` in nested loops, and a
 * `Return` in the loop that is the last statement of a function (that loop is
 * not a statement, and keeps the arrow function).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  ce.declare('n', 'integer');
});

function epsil(source: string): Expression {
  const [json, diagnostics] = parseEpsil(source);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return ce.box(resolveLibraryNames(json, source, ce) as any);
}

/** The code of `expr`, after a check that it compiles and that its value is
 * the value of the interpreter for each `n`. */
function checked(expr: Expression, ns: number[]): string {
  const r = compile(expr, { fallback: false });
  expect(r.success).toBe(true);
  for (const n of ns) {
    ce.assign('n', n);
    const expected = expr.evaluate().re;
    expect(r.run!({ n }) as number).toBe(expected);
  }
  return r.code;
}

/** A loop wrapped in an arrow function that is called at once. */
const WRAPPED_LOOP = /\(\(\) => \{\s*(for \(|while \(|\{ const _tv)/;

describe('CE-1073: a Loop statement is a block statement', () => {

  test('a loop index does not change a local with the same name', () => {
    const code = checked(
      epsil(`let k = 100
let s = 0
for k in 1..n { s = s + k }
s + k
`),
      [0, 3, 10]
    );
    expect(code).not.toMatch(WRAPPED_LOOP);
  });

  test('a break in the inner loop leaves only the inner loop', () => {
    const code = checked(
      epsil(`let s = 0
for j in 1..n {
  for k in 1..10 { if k > j { break }; s = s + k }
  s = s + 1000
}
s
`),
      [0, 2, 12]
    );
    expect(code).not.toMatch(WRAPPED_LOOP);
  });

  test('a loop in the else branch, with a continue in an inner loop', () => {
    const code = checked(
      epsil(`let s = 0
if n < 3 { s = -1 } else {
  for j in 1..n {
    for k in 1..j { if k % 2 == 0 { continue }; s = s + k }
  }
}
s
`),
      [1, 3, 8]
    );
    expect(code).toContain('} else {');
    expect(code).not.toMatch(WRAPPED_LOOP);
  });

  test('a Which statement with a Return in a branch declines', () => {
    const f = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 's', { dict: { value: 0 } }],
        [
          'Which',
          ['Greater', 'm', 0],
          [
            'Block',
            ['If', ['Greater', 'm', 5], ['Return', 1]],
            ['Assign', 's', 2],
          ],
          'True',
          ['Assign', 's', 3],
        ],
        's',
      ],
      ['Typed', 'm', "'integer'"],
    ] as any);
    expect(ce.box(['Apply', f.json, 8] as any).evaluate().re).toBe(1);
    expect(compile(f).success).toBe(false);
  });

  test('an interval loop in statement position is a block statement', () => {
    ce.declare('x', 'real');
    const r = compile(
      epsil(`let s = 0
for k in 1..n { s = s + k * x }
s
`),
      { to: 'interval-js', fallback: false }
    );
    expect(r.success).toBe(true);
    const v = r.run!({ n: 3, x: { lo: 1, hi: 2 } }) as any;
    expect(v.value).toEqual({ lo: 6, hi: 12 });
  });
});
