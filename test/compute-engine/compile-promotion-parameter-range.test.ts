import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Under the JavaScript target's default `auto` mode, a `Sqrt` (or `Ln`,
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

  it('compiles the radical on the real lane', () => {
    const c = ce.parse(
      '\\left[a\\sqrt{\\frac{k-0.5}{16}} \\operatorname{for} k = \\left[1...16\\right]\\right]'
    );
    const r = compile(c, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
    expect(r.code).toContain('Math.sqrt(0.0625 * (k + -0.5))');
    expect(r.code).not.toContain('csqrt');
    const v = (r.run as (a: object) => number[])({ a: 2 });
    const n = ce
      .box([
        'Comprehension',
        ['Multiply', 2, ['Sqrt', ['Divide', ['Subtract', 'k', 0.5], 16]]],
        ['Element', 'k', ['Range', 1, 16]],
      ])
      .N();
    expect(v.length).toBe(16);
    v.forEach((x, i) => expect(x).toBeCloseTo(n.at(i + 1)!.re, 12));
  });
});

describe('declared parameter types of a user function', () => {
  const lambda = (ce: ComputeEngine) =>
    ce.box(['Function', ['Sqrt', ['Divide', ['Subtract', 'k', 0.5], 16]], 'k']);

  it.each(['(integer<1..16>) -> unknown', '(real<1..16>) -> unknown'])(
    'the body of p declared %s compiles on the real lane',
    (signature) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'integer<1..16>');
      ce.declare('p', signature);
      ce.assign('p', lambda(ce));
      const call = ce.box(['p', 'x']);
      expect(call.type.toString()).toBe('real');
      const r = compile(call, { to: 'javascript' });
      expect(r.success).toBe(true);
      expect(r.promoted).toBe(false);
      expect(r.mode).toBe('strict');
      expect(r.preamble).toContain(
        'const _fn_p = (k) => Math.sqrt(0.0625 * (k + -0.5));'
      );
      for (const x of [3, 11]) {
        const expected = ce.box(['p', x]).N().re;
        expect(real(r, { x })).toBeCloseTo(expected, 14);
      }
    }
  );

  it('a declared type that proves nothing keeps the complex lane', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.declare('p', '(integer) -> unknown');
    ce.assign('p', lambda(ce));
    const r = compile(ce.box(['p', 'x']), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(true);
    expect(r.preamble).toContain('_SYS.csqrt');
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

  it('a Sum index specializes the function to its range', () => {
    const ce = engine();
    const e = ce.parse('\\sum_{k=1}^{16} p(k)');
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
    expect(r.preamble).toMatch(
      /const _fn_p_integer_1___ = \(k\) => Math\.cos\(_\.T \* k\) \* Math\.sqrt\(0\.0625 \* \(k \+ -0\.5\)\);/
    );
    expect(r.preamble).not.toContain('csqrt');
    for (const T of [0.3, 1.7]) {
      // The body of `p` with `T` replaced by its value.
      const expected = ce
        .box([
          'Sum',
          [
            'Multiply',
            ['Sqrt', ['Divide', ['Subtract', 'k', 0.5], 16]],
            ['Cos', ['Multiply', T, 'k']],
          ],
          ['Limits', 'k', 1, 16],
        ])
        .N().re;
      expect(real(r, { T })).toBeCloseTo(expected, 12);
    }
  });

  it('the definition for a wide argument stays generic', () => {
    const ce = engine();
    const e = ce.parse('\\sum_{k=1}^{16} p(k) + p(t)');
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    // The call `p(t)` has an argument of unknown sign: its definition
    // promotes.
    expect(r.promoted).toBe(true);
    expect(r.preamble).toContain('const _fn_p = (k) =>');
    expect(r.preamble).toContain('_SYS.csqrt');
    expect(r.preamble).toContain(
      'const _fn_p_integer_1___ = (k) => Math.cos(_.T * k) * Math.sqrt(0.0625 * (k + -0.5));'
    );
  });

  it('call sites with different ranges share one specialization', () => {
    const ce = engine();
    const e = ce.parse('\\sum_{k=1}^{16} p(k) + \\sum_{j=1}^{8} p(j)');
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
    expect(r.preamble?.match(/const _fn_p_/g)?.length).toBe(1);
  });

  it('a function whose body proves nothing more is not specialized', () => {
    const ce = engine();
    const r = compile(ce.parse('\\sum_{k=1}^{16} q(k)'), { to: 'javascript' });
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
    const auto = compile(e, { to: 'javascript' });
    const strict = compile(e, { to: 'javascript', mode: 'strict' });
    expect(auto.success).toBe(true);
    expect(strict.success).toBe(true);
    expect(auto.promoted).toBe(false);
    expect(auto.mode).toBe('strict');
    const text = `${auto.code}\n${auto.preamble}`;
    expect(text).not.toContain('{ re:');
    expect(text).not.toContain('csqrt');
    // The specialization of `n` takes the invariant `F(x, y)` as an extra
    // parameter, computed once per sum, as the strict compile does.
    expect(auto.preamble).toMatch(/_fn_n_[a-z0-9_]*\$inv0/);
    for (const point of [
      { x: 0.3, y: 0.2, T: 1 },
      { x: -0.7, y: 0.9, T: 4 },
    ]) {
      expect(real(auto, point)).toBe(real(strict, point));
      // `T` is read by the bodies of `p` and `q`, which a substitution in
      // `e` does not reach: it is assigned for the interpreted value.
      ce.assign('T', point.T);
      const expected = e.subs({ x: point.x, y: point.y }).N().re;
      expect(real(auto, point)).toBeCloseTo(expected, 9);
    }
  });
});
