/**
 * CE-1724: the budget of the pass `inline` (`INLINE_BUDGET`) bounds the
 * growth of the program, measured at the start of each round of the passes,
 * not the sum of the sizes of the copies. A copy of `p(k)` with a constant
 * `k` folds to a few instructions; counted at its size before the fold,
 * the copies in the written-out sums of `F`, `Z`, `u`, `v` and `B` spent
 * the budget, and `H`, reached last, kept 16 calls of `n`, each of which
 * computed `F(x, y)` again: twice the sines and cosines of the same formula
 * with `n` written out.
 *
 * The witness is Tycho's showcase entry `voronoi-diagram`, with its rows as
 * user functions.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

const ROWS: [string, string][] = [
  ['p(k)', '1.45\\sqrt{\\frac{k - 0.5}{16}}\\cos(2.4k) + 0.14\\cos(T + 1.9k)'],
  ['q(k)', '0.95\\sqrt{\\frac{k - 0.5}{16}}\\sin(2.4k) + 0.1\\sin(2T + 2.7k)'],
  ['D(x, y, k)', '(x - p(k))^2 + (y - q(k))^2'],
  ['F(x, y)', '\\min(\\lbrack D(x, y, 1), D(x, y, 2), D(x, y, 3), D(x, y, 4), D(x, y, 5), D(x, y, 6), D(x, y, 7), D(x, y, 8), D(x, y, 9), D(x, y, 10), D(x, y, 11), D(x, y, 12), D(x, y, 13), D(x, y, 14), D(x, y, 15), D(x, y, 16)\\rbrack)'],
  ['n(x, y, k)', 'e^{-5000(D(x, y, k) - F(x, y))}'],
  ['Z(x, y)', '\\sum_{k=1}^{16} n(x, y, k)'],
  ['u(x, y)', '\\frac{1}{Z(x, y)} \\sum_{k=1}^{16} p(k) n(x, y, k)'],
  ['v(x, y)', '\\frac{1}{Z(x, y)} \\sum_{k=1}^{16} q(k) n(x, y, k)'],
  ['H(x, y)', '\\frac{1}{Z(x, y)} \\sum_{k=1}^{16} \\operatorname{mod}(0.567k, 1) n(x, y, k)'],
  ['B(x, y)', '\\sum_{k=1}^{16} \\exp\\left(-\\frac{D(x, y, k) - F(x, y)}{0.015\\sqrt{(p(k) - u(x, y))^2 + (q(k) - v(x, y))^2 + 0.0004}}\\right)'],
];

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('T', 'real');
for (const [head] of ROWS) ce.declare(head.slice(0, 1), 'function');
for (const [head, body] of ROWS) ce.parse(`${head} := ${body}`).evaluate();

const HEATMAP = ce.parse(
  '\\operatorname{Which}(F(x,y) < 0.0008, 0, 1.3 < B(x,y), 0, \\operatorname{True}, 0.8H(x,y) + 0.12)'
);

const POINTS = [
  { x: 0.1, y: -0.2, T: 1 },
  { x: 0.15, y: 0.35, T: 0.5 },
  { x: -0.4, y: 0.2, T: 1.3 },
  { x: 0.6, y: -0.3, T: 4 },
];

/** The text of the user function `name` in the compiled text `t`. */
const functionText = (t: string, name: string) =>
  new RegExp(`const u\\d+_${name} = [\\s\\S]*?\\n};`).exec(t)?.[0] ?? '';

describe('CE-1724: the budget of the pass inline is the growth of the program', () => {
  const r = compile(HEATMAP, { to: 'javascript', fallback: false });
  const text = `${r.preamble ?? ''}\n${r.code}`;

  test('the heatmap compiles, and gives the value of the interpreter', () => {
    expect(r.success).toBe(true);
    for (const point of POINTS) {
      const want = ce.withValues(
        Object.fromEntries(
          Object.entries(point).map(([k, v]) => [k, ce.number(v)])
        ) as never,
        () => HEATMAP.evaluate().N().re
      );
      const got = (r.run as (x: object) => number)(point);
      expect([point, Math.abs(got - want) <= 1e-9]).toEqual([point, true]);
    }
  });

  test('H holds a copy of each call of n, and one call of F', () => {
    const h = functionText(text, 'H');
    expect(h).not.toBe('');
    expect(h).not.toMatch(/u\d+_n\(/);
    expect(h.match(/u\d+_F\(/g)?.length).toBe(1);
  });
});

describe('CE-1724: the instructions that the other passes give back do not lift the bound', () => {
  test('copies that fold still stop at the budget of the rule repeated', () => {
    // A copy of `w(x, j)` with a constant `j` folds its cosine and its
    // square root, and keeps a sum, a sine, a product and a sum (4
    // instructions), less the call it replaces: it grows the program by at
    // least 3. 2,000 such copies would grow it by 6,000 instructions, past
    // `INLINE_BUDGET.repeated` (4,000): calls stay.
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('w', 'function');
    engine.parse('w(q, j) := \\sin(q + j) \\cos(2.4j)\\sqrt{j}').evaluate();
    const terms = Array.from({ length: 2000 }, (_, i) => ['w', 'x', i + 1]);
    const sum = engine.box(['Add', ...terms] as never);
    const r = compile(sum, { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    const left = (`${r.preamble ?? ''}\n${r.code}`.match(/u\d+_w\(/g) ?? [])
      .length;
    expect(left).toBeGreaterThan(0);
    expect((2000 - left) * 3).toBeLessThanOrEqual(4000);
    const want = engine.withValues({ x: engine.number(0.3) } as never, () =>
      sum.evaluate().N().re
    );
    const got = (r.run as (x: object) => number)({ x: 0.3 });
    expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-9 * Math.abs(want));
  });
});
