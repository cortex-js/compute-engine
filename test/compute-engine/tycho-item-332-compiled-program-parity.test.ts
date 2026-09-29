/**
 * Tycho item 332: Epsil programs that compiled to JavaScript and ran to a
 * wrong answer.
 *
 * The Apollonian-gasket programs below answered 4 when compiled and 224 when
 * interpreted. Three defects combined:
 *
 * 1. A `for` loop variable was classified from its TYPE while the loop header
 *    bound it to the elements the source list EMITS. With `d = 2·√(…)` of an
 *    unknown-sign radicand (a `{re, im}` object on the JavaScript target),
 *    `for k in [a + d, a − d]` bound `k` to objects that the body compared
 *    and divided as numbers: `0 < k` was always false, so no circle was ever
 *    added. The loop variable is now bound complex when every element is
 *    complex-valued, and a source whose elements disagree is a lane mismatch
 *    (the `auto` mode then compiles again under the complex discipline).
 * 2. The check that a real-bound block local is never assigned a complex
 *    value did not enter the braced body of a `for`/`while`/`if` (a nested
 *    `Block`), nor mask the loop's variables: `r = r + 1 / k` inside such a
 *    body assigned an object to `r` and the next turn concatenated it into a
 *    string.
 * 3. `Max(0, x)` for a real `x` typed `real`, so `√(Max(0, x))` typed
 *    `complex` and took the complex lane. `Max`/`Min` over scalar real
 *    operands now carry the operands' range (`Max(0, x)` is `real<0..>`).
 * 4. A local typed from its value (`let e = circles[j]`) and a `for` index
 *    typed from its collection (`for t in [p, q, r]`) read the type of the
 *    value when the statement was canonicalized. An assignment LATER in the
 *    same loop (`circles = [...circles, (k, x, y, depth)]`, `k: number`)
 *    widened `circles`, but `e` kept real elements. The complex lane stores
 *    a `number` as a `{re, im}` object and reads a `real` as a JavaScript
 *    number, so `e[1] - k` was not a number, the de-duplication test never
 *    matched, and the compiled gasket never ended. The block now reads every
 *    such value type again after all its statements are canonicalized,
 *    until no type changes. An element read of a union of tuple types now
 *    also reads each tuple at the index, instead of widening over all slots.
 *
 * Every program is checked for parity between `evaluate()` and the compiled
 * `run()`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { parseEpsil } from '../../src/epsil/parse-epsil';

function numeric(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v !== null && typeof v === 'object' && 're' in v) {
    const z = v as { re: number; im: number };
    if (z.im !== 0) throw new Error(`complex result ${z.re} + ${z.im}i`);
    return z.re;
  }
  throw new Error(`not a number: ${JSON.stringify(v)}`);
}

function compiled(source: string, ce = new ComputeEngine()) {
  const [program] = parseEpsil(source);
  const expr = ce.box(program);
  const result = compile(expr, { to: 'javascript' });
  return { expr, result };
}

/** The interpreted and the compiled value of an Epsil program. */
function parity(source: string): { evaluated: number; compiled: number } {
  const { expr, result } = compiled(source);
  if (!result.success) throw new Error(`did not compile: ${source}`);
  return {
    evaluated: expr.evaluate().N().re,
    compiled: numeric(result.run!({})),
  };
}

function expectParity(source: string, expected: number): void {
  const { evaluated, compiled } = parity(source);
  expect(evaluated).toBeCloseTo(expected, 10);
  expect(compiled).toBeCloseTo(expected, 10);
}

describe('Compiled program parity (Tycho item 332)', () => {
  test('positive control: a while loop appends to a list', () => {
    expectParity(
      `let xs = []
let i = 1
while i <= 3 { xs = [...xs, i]; i = i + 1 }
Length(xs)`,
      3
    );
  });

  test('a for loop over the two roots of a clamped square root', () => {
    // 1 / (2 (1 + √2))
    expectParity(
      `let g = [2, 3]
let a = g[1]
let d = 2 * Sqrt(Max(0, a))
let r = 0
for k in [a + d, a - d] { if k > 0 { r = r + 1 / k } }
r`,
      1 / (2 * (1 + Math.SQRT2))
    );
  });

  test('a comparison chain on the loop variable', () => {
    expectParity(
      `let g = [2, -3]
let a = g[1]
let b = g[2]
let d = 2 * Sqrt(Max(0, a * b + 7))
let n = 0
for k in [a + d, a - d] { if k > 0 && 1 / k >= 0.008 { n = n + 1 } }
n`,
      1
    );
  });

  test('a loop variable over complex elements, compared', () => {
    // k = -4 ± 2i: `k > 0` is never true.
    expectParity(
      `let g = [-4, 9]
let a = g[1]
let d = Sqrt(a)
let n = 0
for k in [a + d, a - d] { if k > 0 { n = n + 1 } }
n`,
      0
    );
  });

  test('an accumulator of complex values in a loop body', () => {
    // 1/(-4 + 2i) + 1/(-4 - 2i) = -8/20
    expectParity(
      `let a = -4
let d = Sqrt(a)
let r = 0
for k in [a + d, a - d] { r = r + 1 / k }
r`,
      -0.4
    );
  });

  test('a loop variable over pairs of complex values', () => {
    expectParity(
      `let g = [-4, 9]
let a = g[1]
let d = Sqrt(a)
let n = 0
for z in [[a + d, 1 + d], [a - d, 1 - d]] {
  let x = z[1] * z[2]
  if Re(x) < 0 { n = n + 1 }
}
n`,
      2
    );
  });

  test('a loop variable over complex and real elements escalates', () => {
    const source = `let g = [-4, 9]
let a = g[1]
let d = Sqrt(a)
let r = 0
for k in [d, 1] { if k == 1 { r = r + 1 } }
r`;
    expectParity(source, 1);
    const { result } = compiled(source);
    expect(result.escalation).toMatchObject({ boundary: 'Loop index' });
  });

  test('Max(0, x) is non-negative, so its square root is real', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('n', 'integer');
    expect(ce.parse('\\max(0, x)').type.toString()).toBe('real<0..>');
    expect(ce.parse('\\max(0, n)').type.toString()).toBe('integer<0..>');
    expect(ce.parse('\\min(1, x)').type.toString()).toBe('real<..1>');
    expect(ce.parse('\\sqrt{\\max(0, x)}').type.toString()).toBe('real');
    const result = compile(ce.parse('\\sqrt{\\max(0, x)}'), {
      to: 'javascript',
    });
    expect(result.code).toBe('Math.sqrt(Math.max(0, _.x))');
    expect(result.run!({ x: -3 })).toBe(0);
    expect(result.run!({ x: 9 })).toBe(3);
  });

  test('a local read from a list a later statement of the loop widens', () => {
    // `circles` starts as `list<tuple<integer, integer>>`; the loop appends
    // a tuple whose first element is `number` (`Sqrt(4d)`, `d: integer`).
    // `e` must be typed from the widened list, not from the first one.
    expectParity(
      `let circles = [(2, 0)]
let d = 1
let count = 0
let i = 1
while i <= 3 {
  let e = circles[i]
  if Abs(e[1] - 2) < 1e-6 { count = count + 1 }
  circles = [...circles, (Sqrt(4 * d), 0)]
  i = i + 1
}
count`,
      3
    );
  });

  test('a loop index over a list of locals a later statement widens', () => {
    expectParity(
      `let ps = [(2, 0)]
let d = 1
let count = 0
let i = 1
while i <= 3 {
  let p = ps[i]
  for t in [p] { if Abs(t[1] - 2) < 1e-6 { count = count + 1 } }
  ps = [...ps, (Sqrt(4 * d), 0)]
  i = i + 1
}
count`,
      3
    );
  });

  test('a local whose type grows on every turn of a loop still compiles', () => {
    // `xs = (xs, 1)` nests one tuple level per turn, so re-reading the
    // assignment's type never reaches a fixpoint. The types are then bounded
    // in depth, which ends the growth and keeps `xs` a tuple.
    expectParity(
      `let xs = (1, 2)
let i = 1
while i <= 3 { xs = (xs, 1); i = i + 1 }
let y = xs[2]
y + i`,
      5
    );
  });

  test('an element read of a union of tuple types reads each tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'tuple<tuple<integer, real>, integer> | tuple<real, real>');
    expect(ce.box(['At', 'g', 1]).type.toString()).toBe(
      'real | tuple<integer, real>'
    );
    expect(ce.box(['At', 'g', 2]).type.toString()).toBe('real');
  });

  test('Apollonian gasket (tuples), first 30 gaps, interpreter parity', () => {
    // The interpreter takes about half a second for 30 gaps.
    expectParity(
      GASKET_TUPLES.replace(
        'while i <= Length(queue) {',
        'while i <= Min(Length(queue), 30) {'
      ),
      34
    );
  });

  // The interpreter answers 224 for both programs (measured with
  // `executeEpsil`, about 20 s each, so not re-run here).
  test('Apollonian gasket, circles and gaps as tuples', () => {
    const { result } = compiled(GASKET_TUPLES);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(224);
  });

  test('Apollonian gasket, circles and gaps as flat lists', () => {
    const { result } = compiled(GASKET_FLAT_LISTS);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(224);
  });
});

// Tycho `scripts/repros/2026-09-28-epsil-gasket-compile/b-inlined-tuples.epsil`
const GASKET_TUPLES = `
let circles = [(2, 0.5, 0, 1), (2, -0.5, 0, 1), (3, 0, 0.6666666666666666, 1), (3, 0, -0.6666666666666666, 1)]
let queue = [((-1, 0, 0), (2, 0.5, 0), (3, 0, 0.6666666666666666), 2), ((-1, 0, 0), (2, -0.5, 0), (3, 0, 0.6666666666666666), 2), ((2, 0.5, 0), (2, -0.5, 0), (3, 0, 0.6666666666666666), 2), ((-1, 0, 0), (2, 0.5, 0), (3, 0, -0.6666666666666666), 2), ((-1, 0, 0), (2, -0.5, 0), (3, 0, -0.6666666666666666), 2), ((2, 0.5, 0), (2, -0.5, 0), (3, 0, -0.6666666666666666), 2)]
let i = 1
while i <= Length(queue) {
  let gap = queue[i]
  let p = gap[1]; let q = gap[2]; let r = gap[3]; let depth = gap[4]
  let ka = p[1]; let kb = q[1]; let kc = r[1]
  let disc = 2 * Sqrt(Max(0, ka * kb + kb * kc + kc * ka))
  let ax = ka * p[2]; let ay = ka * p[3]
  let bx = kb * q[2]; let by = kb * q[3]
  let cx = kc * r[2]; let cy = kc * r[3]
  let sx = ax + bx + cx; let sy = ay + by + cy
  let px = (ax * bx - ay * by) + (bx * cx - by * cy) + (cx * ax - cy * ay)
  let py = (ax * by + ay * bx) + (bx * cy + by * cx) + (cx * ay + cy * ax)
  let m = Sqrt(px^2 + py^2)
  let rx = 2 * Sqrt(Max(0, (m + px) / 2))
  let ry = 2 * Sqrt(Max(0, (m - px) / 2))
  if py < 0 { ry = -ry }
  for k in [ka + kb + kc + disc, ka + kb + kc - disc] {
    for z in [(sx + rx, sy + ry), (sx - rx, sy - ry)] {
      let x = z[1] / k
      let y = z[2] / k
      let good = k > 0 && 1 / k >= 0.008
      for t in [p, q, r] {
        let d = Sqrt((x - t[2])^2 + (y - t[3])^2)
        let rt = 1 / t[1]
        if !(Abs(d - Abs(1 / k + rt)) < 1e-6 || Abs(d - Abs(1 / k - rt)) < 1e-6) { good = false }
      }
      if good {
        let j = 1
        while j <= Length(circles) {
          let e = circles[j]
          if Abs(e[1] - k) < 1e-6 && Abs(e[2] - x) < 1e-6 && Abs(e[3] - y) < 1e-6 { good = false }
          j = j + 1
        }
      }
      if good {
        let c = (k, x, y)
        circles = [...circles, (k, x, y, depth)]
        queue = [...queue, (p, q, c, depth + 1), (p, r, c, depth + 1), (q, r, c, depth + 1)]
      }
    }
  }
  i = i + 1
}
Length(circles)
`;

// Tycho `scripts/repros/2026-09-28-epsil-gasket-compile/c-inlined-flat-lists.epsil`
const GASKET_FLAT_LISTS = `
let circles = [[2, 0.5, 0, 1], [2, -0.5, 0, 1], [3, 0, 0.6666666666666666, 1], [3, 0, -0.6666666666666666, 1]]
let queue = [[-1, 0, 0, 2, 0.5, 0, 3, 0, 0.6666666666666666, 2], [-1, 0, 0, 2, -0.5, 0, 3, 0, 0.6666666666666666, 2], [2, 0.5, 0, 2, -0.5, 0, 3, 0, 0.6666666666666666, 2], [-1, 0, 0, 2, 0.5, 0, 3, 0, -0.6666666666666666, 2], [-1, 0, 0, 2, -0.5, 0, 3, 0, -0.6666666666666666, 2], [2, 0.5, 0, 2, -0.5, 0, 3, 0, -0.6666666666666666, 2]]
let i = 1
while i <= Length(queue) {
  let g = queue[i]
  let ka = g[1]; let kb = g[4]; let kc = g[7]; let depth = g[10]
  let disc = 2 * Sqrt(Max(0, ka * kb + kb * kc + kc * ka))
  let ax = ka * g[2]; let ay = ka * g[3]
  let bx = kb * g[5]; let by = kb * g[6]
  let cx = kc * g[8]; let cy = kc * g[9]
  let sx = ax + bx + cx; let sy = ay + by + cy
  let px = (ax * bx - ay * by) + (bx * cx - by * cy) + (cx * ax - cy * ay)
  let py = (ax * by + ay * bx) + (bx * cy + by * cx) + (cx * ay + cy * ax)
  let m = Sqrt(px^2 + py^2)
  let rx = 2 * Sqrt(Max(0, (m + px) / 2))
  let ry = 2 * Sqrt(Max(0, (m - px) / 2))
  if py < 0 { ry = -ry }
  for k in [ka + kb + kc + disc, ka + kb + kc - disc] {
    for z in [[sx + rx, sy + ry], [sx - rx, sy - ry]] {
      let x = z[1] / k
      let y = z[2] / k
      let good = k > 0 && 1 / k >= 0.008
      for t in [[g[1], g[2], g[3]], [g[4], g[5], g[6]], [g[7], g[8], g[9]]] {
        let d = Sqrt((x - t[2])^2 + (y - t[3])^2)
        let rt = 1 / t[1]
        if !(Abs(d - Abs(1 / k + rt)) < 1e-6 || Abs(d - Abs(1 / k - rt)) < 1e-6) { good = false }
      }
      if good {
        let j = 1
        while j <= Length(circles) {
          let e = circles[j]
          if Abs(e[1] - k) < 1e-6 && Abs(e[2] - x) < 1e-6 && Abs(e[3] - y) < 1e-6 { good = false }
          j = j + 1
        }
      }
      if good {
        circles = [...circles, [k, x, y, depth]]
        queue = [...queue, [g[1], g[2], g[3], g[4], g[5], g[6], k, x, y, depth + 1], [g[1], g[2], g[3], g[7], g[8], g[9], k, x, y, depth + 1], [g[4], g[5], g[6], g[7], g[8], g[9], k, x, y, depth + 1]]
      }
    }
  }
  i = i + 1
}
Length(circles)
`;

/** The type of the symbol `name` where it is an operand of an `Add` in the
 * canonical form of `source`, and the evaluated value of the program. */
function operandTypeInSum(
  source: string,
  name: string
): { type: string | undefined; value: string } {
  const ce = new ComputeEngine();
  const [program] = parseEpsil(source);
  const expr = ce.box(program);
  let type: string | undefined;
  const walk = (e: typeof expr): void => {
    if (e.operator === 'Add')
      for (const op of e.ops!)
        if (op.symbol === name) type = op.type.toString();
    for (const op of e.ops ?? []) walk(op);
  };
  walk(expr);
  return { type, value: expr.evaluate().toString() };
}

describe('Evidence read again after the block is canonicalized (Tycho item 332)', () => {
  // A later assignment in the loop widens the collection's element type to
  // `any`. The index was typed `integer` from the first read of the
  // collection, and the second read gives no type: the index must be widened
  // to `unknown`, not keep `integer`.
  test('a loop index whose collection loses its element type is widened to unknown', () => {
    const source = `let xs = [1, 2]
let s = 0
let n = 0
let y: any = 5
while n < 2 {
  for t in xs { s = s + t }
  xs = [...xs, y]
  n = n + 1
}
s`;
    expect(operandTypeInSum(source, 't')).toEqual({
      type: 'unknown',
      value: '11',
    });
    expectParity(source, 11);
  });

  test('the leaves of a loop pattern whose collection loses its tuple type are widened to unknown', () => {
    expect(
      operandTypeInSum(
        `let ps = [(1, 2)]
let s = 0
let n = 0
let y: any = (3, 4)
while n < 2 {
  for (p, q) in ps { s = s + q }
  ps = [...ps, y]
  n = n + 1
}
s`,
        'q'
      )
    ).toEqual({ type: 'unknown', value: '8' });
  });

  // The element type becomes a union of two tuple types. Each arm is read
  // and the leaf types are joined: `q` holds `2` and then `2.5`.
  test('a loop pattern over a union of tuple types joins the leaf types of the arms', () => {
    expect(
      operandTypeInSum(
        `let ps = [(1, 2)]
let s = 0
let n = 0
while n < 2 {
  for (p, q) in ps { s = s + q }
  ps = [...ps, ("a", 2.5)]
  n = n + 1
}
s`,
        'q'
      )
    ).toEqual({ type: 'real', value: '6.5' });
  });

  test('a destructuring assignment from a union of tuple types joins the leaf types of the arms', () => {
    expect(
      operandTypeInSum(
        `let ps = [(1, 2)]
let s = 0
let n = 0
while n < 2 {
  (a, b) := ps[1]
  s = s + b
  ps = [("a", 2.5), ...ps]
  n = n + 1
}
s`,
        'b'
      )
    ).toEqual({ type: 'real', value: '4.5' });
  });

  test('a destructuring assignment whose value loses its tuple type widens its leaves to unknown', () => {
    expect(
      operandTypeInSum(
        `let ps = [(1, 2)]
let s = 0
let n = 0
let y: any = (3, 4)
while n < 2 {
  (a, b) := ps[1]
  s = s + b
  ps = [y, ...ps]
  n = n + 1
}
s`,
        'b'
      )
    ).toEqual({ type: 'unknown', value: '6' });
  });

  // A destructuring `let` records the type of each leaf, as a destructuring
  // assignment does.
  test('a destructuring let records the type of each leaf', () => {
    expect(
      operandTypeInSum(
        `let ps = [(1, 2)]
let s = 0
let n = 0
while n < 2 {
  let (a, b) = ps[1]
  s = s + b
  ps = [("a", 2.5), ...ps]
  n = n + 1
}
s`,
        'b'
      )
    ).toEqual({ type: 'real', value: '4.5' });
  });

  // The leaves of a destructuring `let` are block locals: a leaf named `i`
  // is not the imaginary unit.
  test('a leaf of a destructuring let shadows a constant of the same name', () => {
    expectParity(
      `let (i, x) = (2, 3)
i + x`,
      5
    );
    // Evaluated only: a destructuring `let` in a `while` body does not
    // compile yet (the compiler reports it in value position).
    const ce = new ComputeEngine();
    const [program] = parseEpsil(`let n = 0
while n < 4 {
  let (i, x) = (2, 3)
  n = n + i
}
n`);
    expect(ce.box(program).evaluate().toString()).toBe('4');
  });

  // A `let` that is not directly in a `Block` (here the body of a `Loop`)
  // declares its name in its own scope at run time. It must not record its
  // value's type on a binding of the same name in an enclosing scope, here
  // the free symbol `x` of the global scope.
  test('a let records no type on a binding of an enclosing scope', () => {
    const ce = new ComputeEngine();
    const x = ce.box('x');
    expect(x.type.toString()).toBe('unknown');
    ce.box([
      'Block',
      [
        'Loop',
        [
          'Declare',
          'x',
          ['Dictionary', ['KeyValuePair', "'value'", ['List', 1, 2]]],
        ],
        ['Element', 'k', ['Range', 1, 2]],
      ],
      'x',
    ]);
    expect(ce.box('x').type.toString()).toBe('unknown');
  });

  // `At` over a union of tuple types reads each tuple at the index. An
  // absent arm (`nothing`) is kept as it is, and an alias of a tuple type is
  // read as that tuple.
  test('At over a union of tuple types reads each arm', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<integer, string>', { alias: true });
    ce.declare('p', 'pt');
    ce.declare('h', 'pt | tuple<string, boolean> | nothing');
    ce.declare(
      'g',
      'tuple<integer, string> | tuple<string, boolean> | nothing'
    );
    expect(ce.box(['At', 'p', 1]).type.toString()).toBe('integer');
    expect(ce.box(['At', 'h', 1]).type.toString()).toBe(
      'integer | nothing | string'
    );
    expect(ce.box(['At', 'h', 2]).type.toString()).toBe(
      'boolean | nothing | string'
    );
    expect(ce.box(['At', 'g', 1]).type.toString()).toBe(
      'integer | nothing | string'
    );
  });
});
