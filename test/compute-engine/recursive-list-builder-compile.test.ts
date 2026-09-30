/**
 * A recursive Epsil program that builds a list through a local copied from
 * an untyped parameter compiles (row 339 of the Tycho ledger,
 * `tycho/docs/COMPUTE_ENGINE.md`, 2026-09-29). Two mechanisms:
 *
 * - `let out = acc` records `acc` as the initializer alias of `out`
 *   (`_initializerAlias`), so the first use that narrows `out` to a
 *   collection narrows `acc` too; before, `acc` stayed untyped and a call
 *   `f([0])` broadcast over the list.
 * - a self-call in a `function` clause body types `unknown` while the
 *   clause canonicalizes and installs (`_recursionKnotNames`); before, the
 *   knot's bare `function` type made `out = f(n - 1, out)` a broadcast
 *   guess that widened `out` past the list its spread gives.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';

function box(src: string) {
  const [program, diagnostics] = parseEpsil(src);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const ce = new ComputeEngine();
  const expr = ce.box(resolveLibraryNames(program, src, ce));
  return { ce, expr };
}

function signatureOf(expr: any, name: string): string | undefined {
  let found: string | undefined;
  const walk = (e: any) => {
    if (e.operator === 'DefineFunction' && e.op1.symbol === name)
      found = String(e.op2.type);
    for (const op of e.ops ?? []) walk(op);
  };
  walk(expr);
  return found;
}

function compiled(expr: any): unknown {
  const result = compile(expr, { to: 'javascript' });
  if (!result.success) throw new Error(result.error);
  return result.run({});
}

describe('a local copied from an untyped parameter (Tycho row 339)', () => {
  test('the parameter learns the collection type from the use of the local', () => {
    const { expr } = box(
      'function f(acc) { let out = acc; out = [...out, 1]; out }\nf([0])'
    );
    expect(signatureOf(expr, 'f')).toBe(
      '(acc: collection<any>) -> collection<any>'
    );
    expect(compiled(expr)).toEqual([0, 1]);
    expect(expr.evaluate().toString()).toBe('[0,1]');
  });

  test('a local reassigned from an untyped call before its use forwards nothing', () => {
    const { ce, expr } = box(
      'function f(acc) { let out = acc; out = g(acc); out + 1 }\nf(2)'
    );
    // `g` is unknown, so `out = g(acc)` records no evidence and `out` stays
    // `unknown`; the narrowing by `out + 1` must not reach `acc`.
    expect(signatureOf(expr, 'f')).toBe('(unknown) any -> number');
    expect(ce._recursionKnots.size).toBe(0);
  });

  test('a captured outer local as the initializer is narrowed like a parameter', () => {
    const { expr } = box(
      'let acc = g()\nfunction f() { let out = acc; out = [...out, 1]; out }\nf()'
    );
    expect(signatureOf(expr, 'f')).toBe('() -> collection<any>');
  });

  test('a local assigned before its use forwards nothing', () => {
    const { expr } = box(
      'function g(acc) { let out = acc; out = 5; out + 1 }\ng(2)'
    );
    expect(signatureOf(expr, 'g')).toBe('(unknown) -> number');
    expect(expr.evaluate().toString()).toBe('6');
  });

  test('a recursive list builder compiles', () => {
    const { expr } = box(
      'function f(n, acc) { let out = acc; if n > 0 { out = [...out, n]; out = f(n - 1, out) }; out }\nf(3, [])'
    );
    expect(signatureOf(expr, 'f')).toBe(
      '(unknown, acc: collection<any>) any -> collection<any>'
    );
    expect(compiled(expr)).toEqual([3, 2, 1]);
    expect(expr.evaluate().toString()).toBe('[3,2,1]');
  });

  test('a self-call with a whole parameter derives the base clause result', () => {
    const { expr } = box(
      'function r(xs, n) { if n <= 0 { mean(xs) } else { r(xs, n - 1) } }\nr([1, 2, 3], 2)'
    );
    expect(signatureOf(expr, 'r')).toBe(
      '(xs: collection<any> | value, unknown) any -> number'
    );
    expect(expr.evaluate().toString()).toBe('2');
  });
});

describe('the natural recursive gasket program compiles (Tycho row 339)', () => {
  const PROGRAM = `// A circle is the tuple (k, x, y): curvature and centre.
const minR = 0.008
// Complex square root of (re, im), principal branch.
function csqrt(re, im) {
  let m = sqrt(re^2 + im^2)
  let a = sqrt(max(0, (m + re) / 2))
  let b = sqrt(max(0, (m - re) / 2))
  (a, b) if im >= 0 else (a, -b)
}
// The four candidates for a circle tangent to a, b and c.
function fourth(a, b, c) {
  let ka = a[1]; let kb = b[1]; let kc = c[1]
  let disc = 2 * sqrt(max(0, ka * kb + kb * kc + kc * ka))
  // kz = k * z as (re, im)
  let ax = ka * a[2]; let ay = ka * a[3]
  let bx = kb * b[2]; let by = kb * b[3]
  let cx = kc * c[2]; let cy = kc * c[3]
  let sx = ax + bx + cx; let sy = ay + by + cy
  let px = (ax * bx - ay * by) + (bx * cx - by * cy) + (cx * ax - cy * ay)
  let py = (ax * by + ay * bx) + (bx * cy + by * cx) + (cx * ay + cy * ax)
  let (rx, ry) = csqrt(px, py)
  rx = 2 * rx; ry = 2 * ry
  let out: list<tuple<number, number, number>> = []
  for k in [ka + kb + kc + disc, ka + kb + kc - disc] {
    for (zx, zy) in [(sx + rx, sy + ry), (sx - rx, sy - ry)] {
      out = [...out, (k, zx / k, zy / k)]
    }
  }
  out
}
function tangent(p, q) {
  let d = sqrt((p[2] - q[2])^2 + (p[3] - q[3])^2)
  let rp = 1 / p[1]; let rq = 1 / q[1]
  abs(d - abs(rp + rq)) < 1e-6 || abs(d - abs(rp - rq)) < 1e-6
}
function seen(acc, c) {
  count(acc, e => abs(e[1] - c[1]) < 1e-6 && abs(e[2] - c[2]) < 1e-6 && abs(e[3] - c[3]) < 1e-6) > 0
}
function ok(p, q, r, c) {
  c[1] > 0 && 1 / c[1] >= minR && tangent(c, p) && tangent(c, q) && tangent(c, r)
}
const outer = (-1, 0, 0)
const A = (2, 0.5, 0)
const B = (2, -0.5, 0)
let cands = fourth(outer, A, B)
let C = first(filter(cands, c => c[1] > 0 && c[3] > 0))
let D = first(filter(cands, c => c[1] > 0 && c[3] < 0))
let circles = [(A[1], A[2], A[3], 1), (B[1], B[2], B[3], 1), (C[1], C[2], C[3], 1), (D[1], D[2], D[3], 1)]
// Fill the gap (p, q, r): every admitted candidate is added at \`depth\`, and
// the three gaps it makes are filled by recursive calls.
function fill(p, q, r, depth, acc) {
  let out = acc
  for c in fourth(p, q, r) {
    if ok(p, q, r, c) && !seen(out, c) {
      out = [...out, (c[1], c[2], c[3], depth)]
      out = fill(p, q, c, depth + 1, out)
      out = fill(p, r, c, depth + 1, out)
      out = fill(q, r, c, depth + 1, out)
    }
  }
  out
}
for gap in [(outer, A, C), (outer, B, C), (A, B, C), (outer, A, D), (outer, B, D), (A, B, D)] {
  circles = fill(gap[1], gap[2], gap[3], 2, circles)
}
let counts = listFrom(map(d => count(circles, c => c[4] == d), 1..12))
(length(circles), counts)`;

  test('the JavaScript target computes the 224 circles', () => {
    const { expr } = box(PROGRAM);
    expect(compiled(expr)).toEqual([
      224,
      [4, 6, 18, 54, 86, 28, 8, 8, 4, 4, 4, 0],
    ]);
  });

  // The accumulator annotated: before 2026-09-30 one annotation made the
  // whole derived signature a contract, and the inferred slot `r` refused
  // `gap[3]`, typed `missing | tuple<…>` from `first(filter(…))`. Only the
  // annotated slot is enforced now.
  test('the variant with an annotated accumulator compiles too', () => {
    const annotated = PROGRAM.replace(
      'function fill(p, q, r, depth, acc) {',
      'function fill(p, q, r, depth, acc: list<tuple<number, number, number, number>>) {'
    );
    expect(annotated).not.toBe(PROGRAM);
    const { expr } = box(annotated);
    expect(compiled(expr)).toEqual([
      224,
      [4, 6, 18, 54, 86, 28, 8, 8, 4, 4, 4, 0],
    ]);
  });
});
