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
  expect(diagnostics).toEqual([]);
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
  test('the witness of the issue: nested loops with a break', () => {
    const code = checked(
      epsil(`let s = 0
for k in 1..n { let a = 0
  for m in 1..20 { a = a + k * m; if a > 100 { break } }
  s = s + a }
s
`),
      [0, 1, 7, 50]
    );
    expect(code).not.toMatch(WRAPPED_LOOP);
    expect(code).toMatchInlineSnapshot(`
      "(() => {
      let s = 0;
      {
      { const _tv1 = 1; const _tv2 = _.n; const _tv3 = (_tv2 >= _tv1 ? 1 : -1); const _tv4 = _SYS.rangeCount(_tv1, _tv2, _tv3); if (_tv4 > 4294967295) throw new RangeError('Invalid array length'); for (let _tv5 = 0; _tv5 < _tv4; _tv5++) { const k = _tv1 + _tv3 * _tv5; let a = 0; {
      for (let m = 1; m <= 20; m++) {
      a = k * m + a; if (100 < a) { break }
      }
      }; s = a + s } }
      };
      return s
      })()"
    `);
  });

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

  test('a counted loop with literal bounds and a bare loop', () => {
    const code = checked(
      epsil(`let s = 0
for k in 1..10 { s = s + k * n }
let t = 0
while t <= n { t = t + 1 }
s + t
`),
      [0, 4]
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

  test('an if with an else and a loop in a branch is an if statement', () => {
    const code = checked(
      epsil(`let s = 0
if n > 5 { for k in 1..n { s = s + k } } else { s = 1 }
s
`),
      [2, 9]
    );
    expect(code).toContain('if (5 < _.n) {');
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

  test('a branch with a list local that a loop writes keeps the in-place write', () => {
    const expr = epsil(`let s = 0
if n > 0 { let xs = [0, 0, 0, 0, 0]; for k in 1..5 { xs[k] = k * n }; s = xs[2] } else { s = 1 }
s
`);
    const code = checked(expr, [0, 4]);
    expect(code).toContain('replaceAtInPlace');
    expect(compile(expr, { fallback: false }).warnings ?? []).toEqual([]);
  });

  test('a destructured list local of a branch keeps the in-place write', () => {
    const expr = epsil(`let s = 0
if n > 0 { let (xs, t) = ([0, 0, 0, 0, 0], 1); for k in 1..5 { xs[k] = k * n }; s = xs[2] + t } else { s = 1 }
s
`);
    const code = checked(expr, [0, 4]);
    expect(code).toContain('replaceAtInPlace');
    expect(compile(expr, { fallback: false }).warnings ?? []).toEqual([]);
  });

  test('a list local of a loop body does not keep the conditional expression', () => {
    const code = checked(
      epsil(`let s = 0
if n > 0 { for k in 1..n { let xs = [0, 0]; xs[1] = k; s = s + xs[1] } } else { s = 1 }
s
`),
      [0, 5]
    );
    expect(code).toContain('if (0 < _.n) {');
    expect(code).not.toMatch(WRAPPED_LOOP);
  });

  test('a target with its own If function keeps it', () => {
    const r = compile(
      epsil(`let s = 0
if n > 5 { for k in 1..n { s = s + k } } else { s = 1 }
s
`),
      { fallback: false, functions: { If: 'myIf' } }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('myIf(');
    expect(r.code).not.toContain('if (5 < _.n)');
  });

  test('a Return in the last loop of a function keeps the arrow function', () => {
    const f = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 's', { dict: { value: 0 } }],
        [
          'Loop',
          [
            'Block',
            ['Assign', 's', ['Add', 's', 1]],
            ['If', ['Greater', 's', 'm'], ['Return', ['Multiply', 2, 's']]],
          ],
        ],
      ],
      ['Typed', 'm', "'integer'"],
    ] as any);
    const r = compile(f, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(WRAPPED_LOOP);
    const run = r.run as unknown as (m: number) => number;
    expect(run(10)).toBe(22);
    expect(ce.box(['Apply', f.json, 10] as any).evaluate().re).toBe(22);
  });
});
