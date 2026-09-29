/**
 * Tycho item 332 (filed 2026-09-28), the part that is a defect: a block-local
 * `let` with a literal initial value stayed `unknown` on the routes that never
 * run the `Declare` (compilation), so the FIRST use of the local inferred the
 * callee's loose parameter type onto it (`Length` → `collection`, the `Join`
 * behind a spread → `collection<any>`), and the later assignment could only
 * widen that. The JavaScript target's array-shape gate then refused
 * `Length(queue)` in `while i <= Length(queue) { … queue = [...queue, g] … }`.
 *
 * Two mechanisms are pinned here:
 * 1. `canonicalBlock` hoists the type of a closed literal initial value,
 *    widened through the assignment table (`let i = 1` is `integer`, not the
 *    singleton `1`, so a loop condition is not folded).
 * 2. A reference to a hoisted local from a NESTED block (an `if` branch, a
 *    loop body) binds to the hoisted binding instead of declaring a second
 *    `unknown` copy in the nested scope.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import type { Expression } from '../../src/compute-engine/global-types';

function box(ce: ComputeEngine, source: string): Expression {
  const [ast, diagnostics] = parseEpsil(source);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return ce.box(ast!);
}

/** Evaluate and compile the program; both must agree with `expected`. */
function expectParity(source: string, expected: unknown): void {
  const ce = new ComputeEngine();
  const expr = box(ce, source);
  expect(expr.evaluate().json).toEqual(expected);
  const result = compile(expr, { to: 'javascript' });
  expect(result.success ? 'compiled' : result.error).toBe('compiled');
  if (result.success) expect(result.run({})).toEqual(expected);
}

function lastOperandType(source: string): string {
  const ce = new ComputeEngine();
  const expr = box(ce, source);
  const last = expr.ops![expr.ops!.length - 1];
  return (last.ops?.[0] ?? last).type.toString();
}

describe('Tycho item 332: a block-local let with a literal value is typed from it', () => {
  test('the positive control: a let list grown by a spread in a while loop', () => {
    expectParity(
      `let i = 1
let xs = []
while i <= 3 {
  xs = [...xs, i * i]
  i = i + 1
}
Length(xs)`,
      3
    );
  });

  test('Length of a let list read in the loop CONDITION before the loop grows it', () => {
    expectParity(
      `let queue = [[1, 2], [3, 4]]
let i = 1
while i <= Length(queue) {
  if i < 3 { queue = [...queue, [i, i]] }
  i = i + 1
}
Length(queue)`,
      4
    );
  });

  test('the element of a let list of lists is indexed inside the loop body', () => {
    expectParity(
      `let rows = [[1, 2], [3, 4]]
let total = 0
let i = 1
while i <= Length(rows) {
  let r = rows[i]
  total = total + r[1] * r[2]
  i = i + 1
}
total`,
      14
    );
  });

  test('a let counter hoists the tier integer, not the singleton literal type', () => {
    // With `i` typed as the literal `1`, `i <= 3` would fold to `true` and the
    // compiled loop would never end (or the sum would be wrong).
    expectParity(
      `let i = 1
let n = 0
while i <= 3 {
  n = n + i
  i = i + 1
}
n`,
      6
    );
    expect(lastOperandType(`let i = 1\ni`)).toBe('integer');
    expect(lastOperandType(`let s = "ab"\ns`)).toBe('string');
  });

  test('the hoisted type is list-shaped after the first use and the assignment', () => {
    expect(lastOperandType(`let xs = []\nxs = [...xs, 4]\nLength(xs)`)).toBe(
      'list<integer>'
    );
    expect(
      lastOperandType(`let xs = []\nif true { xs = [...xs, 4] }\nLength(xs)`)
    ).toBe('list<integer>');
    expect(
      lastOperandType(
        `let xs = []\nwhile false { xs = [...xs, 4] }\nLength(xs)`
      )
    ).toBe('list<integer>');
  });

  test('a nested-block reference binds to the hoisted binding, not a copy', () => {
    const ce = new ComputeEngine();
    const expr = box(
      ce,
      `let xs = []\nif true { xs = [...xs, 4] }\nLength(xs)`
    );
    const outer = expr.ops![2].ops![0]; // the `xs` of `Length(xs)`
    let inner: Expression | undefined;
    const walk = (e: Expression): void => {
      if (e.operator === 'Join') inner = e.ops![0];
      for (const op of e.ops ?? []) walk(op);
    };
    walk(expr.ops![1]);
    expect(inner).toBeDefined();
    expect(inner!.valueDefinition).toBe(outer.valueDefinition);
    expect(outer.valueDefinition?.type.toString()).toBe('list<integer>');
  });

  test('a declared type on the let still wins over the literal (Tycho item 235)', () => {
    expect(
      lastOperandType(
        `let d: list<number> = []\nif true { d = [...d, 1] }\nLength(d)`
      )
    ).toBe('list<number>');
  });

  test('a scalar literal widens by the assignment table: real after a float assignment', () => {
    const ce = new ComputeEngine();
    const expr = box(ce, `let x = 1\nx = x + 0.5\nx`);
    expect(expr.evaluate().json).toEqual(1.5);
    expect(expr.ops![2].type.toString()).toBe('real');
  });

  test('a let whose value mentions a symbol is left unknown until it runs', () => {
    // The value is not a closed literal, so nothing is hoisted from it: the
    // binding must not be typed by binding `y` in the enclosing scope before
    // the block's own locals exist.
    const ce = new ComputeEngine();
    ce.assign('y', 3);
    const expr = box(ce, `let z = y + 1\nz`);
    expect(expr.evaluate().json).toEqual(4);
  });
});
