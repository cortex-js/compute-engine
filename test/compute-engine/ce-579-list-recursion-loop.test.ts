/**
 * A list-building recursion `F(n) = Which(n = D - 1, [p(n)], True,
 * Join([p(n)], F(n + 1)))` compiles on the JavaScript target to a loop over
 * its step (`_SYS.listRecursion`), whatever the declaration of `F`:
 *
 *  - `F` assigned with no declaration. The assignment makes an operator
 *    definition, which keeps the literal it applies (`_lambdaLiteral`).
 *    `listRecursionPlan` did not recognize the recursive call through that
 *    definition, so neither the compiler nor the interpreter used the loop.
 *  - `F` declared `function`, then assigned. Its parameter is open, so the
 *    scalar call `F(0)` gets a call-shape specialization with the parameter
 *    typed `number`. That copy is emitted under the ordinary name, but the
 *    loop was tried only with no specialization (since 0.172.0).
 *  - `F` declared `(real) -> list`. The loop declined every parameter that
 *    has an entry in the complex-parameter frame, and a parameter declared
 *    real has one too (with the value `false`).
 *
 * The recursive arrow overflows the JavaScript call stack near 5,000 levels.
 * The loop builds 10,000 elements.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type Variant = 'assign only' | 'declare function' | 'declare (real) -> list';

const VARIANTS: Variant[] = [
  'assign only',
  'declare function',
  'declare (real) -> list',
];

const point = [
  'Tuple',
  'n',
  ['Multiply', 2, 'n'],
  ['Divide', 'n', ['Add', 'D', -1]],
];

function setup(
  variant: Variant,
  D?: number,
  defaultIterationLimit = false
): ComputeEngine {
  const ce = new ComputeEngine();
  if (!defaultIterationLimit) ce.iterationLimit = 100_000;
  ce.declare('D', 'real');
  if (D !== undefined) ce.assign('D', D);
  if (variant === 'declare function') ce.declare('F', 'function');
  if (variant === 'declare (real) -> list') ce.declare('F', '(real) -> list');
  ce.assign(
    'F',
    ce.box([
      'Function',
      [
        'Block',
        [
          'Which',
          ['Equal', 'n', ['Add', 'D', -1]],
          ['List', point],
          'True',
          ['Join', ['List', point], ['F', ['Add', 'n', 1]]],
        ],
      ],
      'n',
    ] as any)
  );
  return ce;
}

/** The error both routes give when the loop of `F` reaches the iteration
 * limit `n`, as a pattern that matches the whole message. */
const limitError = (n: number, op = 'F'): RegExp =>
  new RegExp(`^Iteration limit of ${n} exceeded while evaluating ${op}\\(\\)$`);

describe('CE-579: a list-building recursion compiles to a loop', () => {
  for (const variant of VARIANTS) {
    it(`${variant}: builds 10,000 elements with the loop`, () => {
      const ce = setup(variant);
      const r = compile(ce.box(['F', 0]), {
        to: 'javascript',
        fallback: false,
      });
      expect(r.success).toBe(true);
      expect(String(r.preamble)).toContain('_SYS.listRecursion("F"');
      const D = 10_000;
      const out = r.run!({ D }) as number[][];
      expect(out).toHaveLength(D);
      expect(out[0]).toEqual([0, 0, 0]);
      expect(out[D - 1]).toEqual([D - 1, 2 * (D - 1), 1]);
    });

    it(`${variant}: gives the values of the interpreter`, () => {
      for (const start of [0, 3]) {
        const D = 8;
        const ce = setup(variant, D);
        const expected = [...ce.box(['F', start]).evaluate().each()].map((p) =>
          p.ops!.map((c) => c.re)
        );
        expect(expected).toHaveLength(D - start);
        const r = compile(ce.box(['F', start]), {
          to: 'javascript',
          fallback: false,
        });
        expect(String(r.preamble)).toContain('_SYS.listRecursion');
        const out = r.run!({}) as number[][];
        expect(out).toHaveLength(expected.length);
        out.forEach((p, i) => {
          expect(p).toHaveLength(3);
          for (let k = 0; k < 3; k++)
            expect(p[k]).toBeCloseTo(expected[i][k], 12);
        });
      }
    });

    it(`${variant}: a start that never reaches the base case reports the iteration limit`, () => {
      // A non-integer start, and a start past the base case: the guard
      // `n = D - 1` is never true. The interpreter and the loop both stop at
      // the iteration limit, instead of overflowing the call stack.
      for (const start of [0.5, 9]) {
        const ce = setup(variant, 5);
        ce.iterationLimit = 500;
        expect(() => ce.box(['F', start]).evaluate()).toThrow(limitError(500));
        const r = compile(ce.box(['F', start]), {
          to: 'javascript',
          fallback: false,
        });
        expect(() => r.run!({})).toThrow(limitError(500));
      }
    });

    it(`${variant}: with D unassigned, the compiled call is undefined`, () => {
      // `D` has no value: the guard reads it as absent, and the compiled
      // body is `undefined`, as the recursive arrow gave before.
      const ce = setup(variant);
      const r = compile(ce.box(['F', 0]), {
        to: 'javascript',
        fallback: false,
      });
      expect(String(r.preamble)).toContain('_SYS.listRecursion');
      expect(r.run!({})).toBeUndefined();
    });
  }

  it('a parameter declared real is tested at each step, as the checking shim tests it', () => {
    // `G(n) = Which(n > 5, [n], True, Join([n], G(n + 1/(n - 1))))`. From
    // `n = 1` the next argument is `1 + 1/0`, which is `Infinity` in
    // JavaScript, not a finite real. The loop tests the next argument with
    // the test of the checking shim, and the step that fails it has no
    // value: the whole call is `undefined`, the value compiled code has for
    // a list with no value (the recursive arrow threw a `TypeError` when it
    // spread the `NaN` of the shim).
    const ce = new ComputeEngine();
    ce.declare('G', '(real) -> list');
    ce.assign(
      'G',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Which',
            ['Greater', 'n', 5],
            ['List', 'n'],
            'True',
            [
              'Join',
              ['List', 'n'],
              ['G', ['Add', 'n', ['Divide', 1, ['Subtract', 'n', 1]]]],
            ],
          ],
        ],
        'n',
      ] as any)
    );
    const ok = compile(ce.box(['G', 2]), { to: 'javascript', fallback: false });
    const preamble = String(ok.preamble);
    expect(preamble).toContain('_SYS.listRecursion("G"');
    expect(preamble).toContain('Number.isFinite(_SYS.creal(_$0))');
    const expected = [...ce.box(['G', 2]).evaluate().each()].map((x) => x.re);
    const out = ok.run!({}) as number[];
    expect(out).toHaveLength(expected.length);
    out.forEach((x, i) => expect(x).toBeCloseTo(expected[i], 12));
    const bad = compile(ce.box(['G', 1]), {
      to: 'javascript',
      fallback: false,
    });
    expect(bad.run!({})).toBeUndefined();
  });

  it('declare (real) -> list: F(NaN) runs the body with NaN on both routes', () => {
    // A user function with one clause accepts `NaN` at a numeric parameter,
    // `real` included, and its body runs with it (`docs/ERROR-MODEL.md`, "A
    // user function accepts `NaN` at a numeric parameter — RULED
    // 2026-09-30"). The guard `n = D - 1` is never true for `NaN`, so both
    // routes stop at the iteration limit. The checking shim of compiled
    // code answered `NaN` without running the body.
    const ce = setup('declare (real) -> list', 5);
    ce.iterationLimit = 500;
    ce.declare('y', 'number');
    const r = compile(ce.box(['F', 'y']), {
      to: 'javascript',
      fallback: false,
    });
    expect(String(r.preamble)).toContain('_SYS.listRecursion("F"');
    expect(() => r.run!({ y: NaN })).toThrow(limitError(500));
    expect(() => ce.box(['F', 'NaN']).evaluate()).toThrow(limitError(500));
  });

  for (const variant of VARIANTS) {
    it(`${variant}: the loop stops at the default iteration limit, as the interpreter does`, () => {
      // The compiled loop counts its steps against `ce.iterationLimit`
      // (1024 by default), as the interpreter's loop does. The recursive
      // arrow had no such limit and overflowed the call stack near 5,000
      // levels instead.
      const small = setup(variant, 1000, true);
      expect(small.iterationLimit).toBe(1024);
      expect([...small.box(['F', 0]).evaluate().each()]).toHaveLength(1000);
      const r1 = compile(small.box(['F', 0]), {
        to: 'javascript',
        fallback: false,
      });
      expect(r1.run!({})).toHaveLength(1000);

      const large = setup(variant, 2000, true);
      expect(() => large.box(['F', 0]).evaluate()).toThrow(limitError(1024));
      const r2 = compile(large.box(['F', 0]), {
        to: 'javascript',
        fallback: false,
      });
      expect(() => r2.run!({})).toThrow(limitError(1024));
    });
  }

  describe('the arguments of the first step are tested too', () => {
    // `F(n) = Which(n >= 3, [n], True, Join([n], F(n + 1)))`.
    function declared(sig: string): ComputeEngine {
      const ce = new ComputeEngine();
      ce.iterationLimit = 300;
      ce.declare('F', sig);
      ce.assign(
        'F',
        ce.box([
          'Function',
          [
            'Block',
            [
              'Which',
              ['GreaterEqual', 'n', 3],
              ['List', 'n'],
              'True',
              ['Join', ['List', 'n'], ['F', ['Add', 'n', 1]]],
            ],
          ],
          'n',
        ] as any)
      );
      return ce;
    }

    it('(real) -> list with x = Infinity: no value on either route', () => {
      // The interpreter refuses `+oo` at a `real` parameter. A symbol
      // declared `real` cannot hold it; a symbol declared `number` can, and
      // the call is then an `incompatible-type` error.
      const ce = declared('(real) -> list');
      ce.declare('x', 'real');
      expect(() => ce.assign('x', Infinity)).toThrow();
      const r = compile(ce.box(['F', 'x']), {
        to: 'javascript',
        fallback: false,
      });
      expect(String(r.code)).toBe('_fn_F(_.x)');
      // The first step of the loop tests the argument and has no value.
      expect(r.run!({ x: Infinity })).toBeUndefined();
      ce.declare('w', 'number');
      const rw = compile(ce.box(['F', 'w']), {
        to: 'javascript',
        fallback: false,
      });
      // The checking shim at the call site fails before the loop starts. It
      // gives `undefined`, the marker of the collection result.
      expect(String(rw.code)).toBe('_fn_F$t(_.w)');
      expect(rw.run!({ w: Infinity })).toBeUndefined();
      ce.assign('w', Infinity);
      expect(ce.box(['F', 'w']).evaluate().toString()).toMatch(
        /^Error\(ErrorCode\("incompatible-type", "real"/
      );
    });

    it('(real) -> list with x = NaN: both routes run the body until the iteration limit', () => {
      const ce = declared('(real) -> list');
      ce.declare('x', 'number');
      const r = compile(ce.box(['F', 'x']), {
        to: 'javascript',
        fallback: false,
      });
      expect(() => r.run!({ x: NaN })).toThrow(limitError(300));
      ce.assign('x', NaN);
      expect(() => ce.box(['F', 'x']).evaluate()).toThrow(limitError(300));
    });

    it('(integer) -> list with k = 0.5: no value on either route', () => {
      const ce = declared('(integer) -> list');
      ce.declare('k', 'integer');
      expect(() => ce.assign('k', 0.5)).toThrow();
      const r = compile(ce.box(['F', 'k']), {
        to: 'javascript',
        fallback: false,
      });
      expect(String(r.code)).toBe('_fn_F(_.k)');
      expect(r.run!({ k: 0.5 })).toBeUndefined();
      ce.declare('w', 'number');
      const rw = compile(ce.box(['F', 'w']), {
        to: 'javascript',
        fallback: false,
      });
      expect(rw.run!({ w: 0.5 })).toBeUndefined();
      ce.assign('w', 0.5);
      expect(ce.box(['F', 'w']).evaluate().toString()).toMatch(
        /^Error\(ErrorCode\("incompatible-type", "integer"/
      );
    });
  });

  it('the interpreter checks each next argument against the declared parameter type', () => {
    // `F: (integer) -> list`, `F(n) = Which(n >= 2, [n], True, Join([n],
    // F(n + 1/2)))`. The recursive call `F(1/2)` is refused, as the direct
    // call is, and its error is the value of `F(0)`. Before, the loop of the
    // interpreter ran the step on `1/2` and gave `[0, 1/2, 1, 3/2, 2]`.
    const ce = new ComputeEngine();
    ce.declare('F', '(integer) -> list');
    ce.assign(
      'F',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Which',
            ['GreaterEqual', 'n', 2],
            ['List', 'n'],
            'True',
            ['Join', ['List', 'n'], ['F', ['Add', 'n', ['Rational', 1, 2]]]],
          ],
        ],
        'n',
      ] as any)
    );
    const direct = ce
      .box(['F', ['Rational', 1, 2]])
      .evaluate()
      .toString();
    expect(direct).toMatch(/^Error\(ErrorCode\("incompatible-type", "integer"/);
    expect(ce.box(['F', 0]).evaluate().toString()).toBe(direct);
    // Compiled code: the step at `1/2` fails the test of the checking shim
    // and has no value, so the call is `undefined`.
    const r = compile(ce.box(['F', 0]), { to: 'javascript', fallback: false });
    expect(String(r.preamble)).toContain('_SYS.listRecursion("F"');
    expect(r.run!({})).toBeUndefined();
    // NaN at the numeric parameter is accepted: `F(NaN)` runs the body.
    ce.iterationLimit = 50;
    expect(() => ce.box(['F', 'NaN']).evaluate()).toThrow(limitError(50));
  });

  it('the recursive arrow gives undefined when its recursive call fails the check', () => {
    // `F: (integer) -> list`, `F(n) = Which(n >= 2, [n], True,
    // Join(F(n + 1/2), [n]))`. The recursive call is the first operand of
    // `Join`, so the loop declines and `F` compiles to the recursive arrow.
    // The checking shim refuses `1/2` and gives `undefined`, the marker of
    // the collection result, and the `Join` tests its operand before the
    // spread (`absentCollectionOperandGuard`). It threw a `TypeError` when
    // it spread the `NaN` the shim gave before. The interpreter answers the
    // `incompatible-type` error.
    const ce = new ComputeEngine();
    ce.declare('F', '(integer) -> list');
    ce.assign(
      'F',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Which',
            ['GreaterEqual', 'n', 2],
            ['List', 'n'],
            'True',
            ['Join', ['F', ['Add', 'n', ['Rational', 1, 2]]], ['List', 'n']],
          ],
        ],
        'n',
      ] as any)
    );
    expect(ce.box(['F', 0]).evaluate().toString()).toMatch(
      /^Error\(ErrorCode\("incompatible-type", "integer"/
    );
    const r = compile(ce.box(['F', 0]), { to: 'javascript', fallback: false });
    const preamble = String(r.preamble);
    expect(preamble).not.toContain('_SYS.listRecursion');
    expect(preamble).toContain(': undefined;');
    expect(preamble).toContain('(_tv1 === undefined) ? undefined :');
    expect(r.run!({})).toBeUndefined();
  });
});
