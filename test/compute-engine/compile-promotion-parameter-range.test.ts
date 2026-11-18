import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// In the JavaScript target's `complex` mode, a `Sqrt` (or `Ln`,
// `Log`, an even `Root`, a non-integer `Power`) whose operand is not
// provably non-negative takes the complex lane, and the whole kernel with
// it. The proof reads the ranged type of a symbol (`integer<1..16>`). These
// tests check that the range evidence available at three places reaches
// that proof:
//
// 1. the index of a comprehension over a range with integer literal bounds;
// 2. the declared parameter types of a user function;
// 3. the argument types at a call of a user function (the index of a `Sum`
//    or of a comprehension), through a specialization of the function.

function real(r: { run?: unknown }, args: Record<string, unknown>): number {
  const v = (r.run as (a: Record<string, unknown>) => unknown)(args);
  expect(typeof v).toBe('number');
  return v as number;
}

describe('comprehension index over a literal range', () => {
  const ce = new ComputeEngine();
  ce.declare('a', 'real');

  it('has a ranged type, and the list type has no range', () => {
    const k = ce.box([
      'Comprehension',
      'k',
      ['Element', 'k', ['Range', 1, 16]],
    ]);
    expect(k.type.toString()).toBe('list<integer>');
    const body = (k as unknown as { ops: { type: { toString(): string } }[] })
      .ops[0];
    expect(body.type.toString()).toBe('integer<1..16>');
  });

  it('types a radical of the index real', () => {
    const c = ce.parse(
      '\\left[\\sqrt{\\frac{k-0.5}{16}} \\operatorname{for} k = \\left[1...16\\right]\\right]'
    );
    expect(c.json).toEqual([
      'Comprehension',
      ['Sqrt', ['Multiply', ['Rational', 1, 16], ['Add', 'k', -0.5]]],
      ['Element', 'k', ['Range', 1, 16]],
    ]);
    expect(c.type.toString()).toBe('list<real>');
  });

  it('keeps the ranged type of the index after an evaluation', () => {
    const c = ce.box([
      'Comprehension',
      ['Sqrt', 'm'],
      ['Element', 'm', ['Range', 1, 16]],
    ]) as unknown as {
      ops: { ops: { type: { toString(): string } }[] }[];
      evaluate(o?: object): unknown;
    };
    const m = c.ops[0].ops[0];
    c.evaluate({ materialization: true });
    expect(m.type.toString()).toBe('integer<1..16>');
    const loop = ce.box([
      'Loop',
      ['Sqrt', 'j'],
      ['Element', 'j', ['Range', 1, 16]],
    ]) as unknown as {
      ops: { ops: { type: { toString(): string } }[] }[];
      evaluate(): unknown;
    };
    const j = loop.ops[0].ops[0];
    loop.evaluate();
    expect(j.type.toString()).toBe('integer<1..16>');
  });
});

describe('range evidence at the call sites of a user function', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('T', 'real');
    ce.declare('t', 'real');
    ce.assign(
      'p',
      ce.parse('(k) \\mapsto \\sqrt{\\frac{k - 0.5}{16}}\\cos(Tk)')
    );
    ce.assign('q', ce.parse('(k) \\mapsto \\cos(Tk) + k'));
    return ce;
  }

  it('a function whose body proves nothing more is not specialized', () => {
    const ce = engine();
    const r = compile(ce.parse('\\sum_{k=1}^{16} q(k)'), {
      to: 'javascript',
      mode: 'complex',
    });
    expect(r.success).toBe(true);
    expect(r.preamble ?? '').not.toContain('_fn_q_integer');
  });

  it('the range reaches a function called through another one', () => {
    // The Voronoi kernel of the Tycho corpus, reduced: `D` has no radical
    // of its own, and it is called from a comprehension and from a `Sum`
    // over `1..16`; `p` and `q`, called by `D` and by `u`, have one.
    const ce = new ComputeEngine();
    for (const n of ['x', 'y', 'k']) ce.declare(n, 'real');
    ce.declare('T', 'real<-10..10>');
    const defs: [string, string][] = [
      [
        'p',
        '(k) \\mapsto 1.45\\sqrt{\\frac{k - 0.5}{16}}\\cos(2.4k) + 0.14\\cos(T + 1.9k)',
      ],
      [
        'q',
        '(k) \\mapsto 0.95\\sqrt{\\frac{k - 0.5}{16}}\\sin(2.4k) + 0.1\\sin(2T + 2.7k)',
      ],
      ['D', '(x, y, k) \\mapsto (x - p(k))^2 + (y - q(k))^2'],
      [
        'F',
        '(x, y) \\mapsto \\min\\left(\\left[D(x, y, k) \\operatorname{for} k = \\left[1...16\\right]\\right]\\right)',
      ],
      ['n', '(x, y, k) \\mapsto e^{-5000(D(x, y, k) - F(x, y))}'],
      ['Z', '(x, y) \\mapsto \\sum_{k=1}^{16} n(x, y, k)'],
      [
        'u',
        '(x, y) \\mapsto \\frac{1}{Z(x, y)} \\sum_{k=1}^{16} p(k) n(x, y, k)',
      ],
    ];
    for (const [name, src] of defs) ce.assign(name, ce.parse(src));
    const e = ce.parse('F(x, y) + u(x, y)');
    const byDefault = compile(e, { to: 'javascript' });
    const strict = compile(e, { to: 'javascript', mode: 'strict' });
    expect(byDefault.success).toBe(true);
    expect(strict.success).toBe(true);
    const text = `${byDefault.code}\n${byDefault.preamble}`;
    expect(text).not.toContain('{ re:');
    expect(text).not.toContain('csqrt');
    for (const point of [
      { x: 0.3, y: 0.2, T: 1 },
      { x: -0.7, y: 0.9, T: 4 },
    ]) {
      expect(real(byDefault, point)).toBe(real(strict, point));
      // `T` is read by the bodies of `p` and `q`, which a substitution in
      // `e` does not reach: it is assigned for the interpreted value.
      ce.assign('T', point.T);
      const expected = e.subs({ x: point.x, y: point.y }).N().re;
      expect(real(byDefault, point)).toBeCloseTo(expected, 9);
    }
  });
});
