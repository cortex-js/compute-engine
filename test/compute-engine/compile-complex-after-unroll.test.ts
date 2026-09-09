import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A `Sum` over a small constant range is unrolled by substituting the index at
 * the emitted-CODE level: the compile target maps the index NAME to a literal
 * and the same body expression is compiled once per term. The shape analysis
 * reads the body, where the index is still a free symbol, so a radicand such
 * as `1 − 0.025²(i − 0.5)²` had an unknown sign and the radical promoted to
 * the complex lane in every term — `_SYS.csqrt` over `{re, im}` objects for a
 * value that is a positive constant in each term.
 *
 * The unrolled terms now hand their index VALUES to the analysis, so the
 * radicand folds and the terms are real arithmetic. A radicand that folds
 * NEGATIVE still takes the complex kernel.
 */

const BODY =
  '\\sum_{i=1}^{6} (1 - j(1-\\sqrt{1-0.025^2(i-0.5)^2}))\\cdot s';

function compiledSource(ce: ComputeEngine, call: string): string {
  const r = compile(ce.parse(call), { to: 'javascript' });
  expect(r.success).toBe(true);
  return `${r.preamble ?? ''}\n${String(r.code)}`;
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('a radical over a constant radicand in an unrolled Sum', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('s', 'number');
    ce.declare('j', 'number');
    ce.parse(`B(s, j) := ${BODY}`).evaluate();
    return ce;
  }

  test('emits no complex square root and no complex product chain', () => {
    const source = compiledSource(engine(), 'B(s, j)');
    expect(count(source, '_SYS.csqrt')).toBe(0);
    expect(count(source, '_nre')).toBe(0);
    expect(source).toContain('Math.sqrt');
  });

  test('agrees with the interpreter', () => {
    const ce = engine();
    const r = compile(ce.parse('B(s, j)'), { to: 'javascript' });
    for (const [s, j] of [
      [2, 0.6],
      [1, 1],
      [3.5, -0.25],
      [-4, 0],
    ]) {
      const expected = ce.parse(`B(${s}, ${j})`).N().re;
      expect(r.run!({ s, j })).toBeCloseTo(expected, 12);
    }
  });

  test('the inline (non-definition) spelling agrees too', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'number');
    ce.declare('j', 'number');
    const e = ce.parse(BODY);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(`${r.preamble ?? ''}${String(r.code)}`).not.toContain('_SYS.csqrt');
    expect(r.run!({ s: 2, j: 0.6 })).toBeCloseTo(
      e.subs({ s: 2, j: 0.6 }).N().re,
      12
    );
  });

  // The lane the unrolled terms take is also the lane the ENCLOSING
  // expression must expect: a parent that reads `.re`/`.im` off a plain
  // number, or a real kernel handed a `{re, im}` object, is a silently wrong
  // value rather than a compile failure. Each consumer below keeps a free
  // variable inside the `Sum`, so the whole subtree cannot simply be folded
  // to a literal.
  describe('the enclosing expression agrees with the unrolled terms', () => {
    const R = '\\sqrt{1-0.025^2(i-0.5)^2}';
    const SUM = `\\sum_{i=1}^{6}(s+${R})`;
    const cases: [string, string][] = [
      ['a real-kernel consumer', `\\cos\\left(${SUM}\\right)`],
      ['a real-only head', `\\left|${SUM}\\right|`],
      ['a promoting head', `\\sqrt{${SUM}}`],
      ['a complex sibling', `${SUM} + z`],
      [
        'a nested Sum',
        `\\sum_{i=1}^{2}\\sum_{m=1}^{3}(s+\\sqrt{1-0.001(i m)^2})`,
      ],
    ];
    for (const [name, src] of cases)
      test(name, () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'number');
        ce.declare('z', 'complex');
        const e = ce.parse(src);
        const r = compile(e, { to: 'javascript' });
        expect(r.success).toBe(true);
        const value = r.run!({ s: 2, z: { re: 1, im: 3 } });
        const expected = e.subs({ s: 2, z: ce.box(['Complex', 1, 3]) }).N();
        if (typeof value === 'number') {
          expect(expected.im).toBe(0);
          expect(value).toBeCloseTo(expected.re, 10);
        } else {
          const v = value as { re: number; im: number };
          expect(v.re).toBeCloseTo(expected.re, 10);
          expect(v.im).toBeCloseTo(expected.im, 10);
        }
      });
  });

  test('an inner binder that REBINDS the index does not read its value', () => {
    // The index values an unrolled term hands to the analysis are keyed by
    // NAME. A binder inside the term that binds the same name — here a nested
    // `Sum` also over `i` — binds its own variable, so the outer term's value
    // must not be read inside it: at the outer `i = 3` the radicand `i − 2`
    // folds to the non-negative `1` and the radical would be emitted as the
    // real `Math.sqrt`, which answers NaN at the inner `i = 0`, where the
    // interpreter answers a complex value.
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    const e = ce.parse(
      '\\sum_{i=3}^{4}\\left(\\sqrt{i-2}+\\sum_{i=0}^{1} s\\sqrt{i-2}\\right)'
    );
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(`${r.preamble ?? ''}${String(r.code)}`).not.toContain('Math.sqrt(-');
    const value = r.run!({ s: 1 }) as { re: number; im: number };
    const expected = e.subs({ s: 1 }).N();
    expect(value.re).toBeCloseTo(expected.re, 10);
    expect(value.im).toBeCloseTo(expected.im, 10);
  });

  test('a radicand that folds NEGATIVE still takes the complex kernel', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'number');
    ce.parse('N(s) := \\sum_{i=1}^{6} \\sqrt{-1-(i-0.5)^2}\\cdot s').evaluate();
    const source = compiledSource(ce, 'N(s)');
    expect(count(source, '_SYS.csqrt')).toBe(6);
    const r = compile(ce.parse('N(s)'), { to: 'javascript' });
    const value = r.run!({ s: 2 }) as { re: number; im: number };
    expect(value.re).toBeCloseTo(0, 12);
    expect(value.im).toBeCloseTo(ce.parse('N(2)').N().im, 10);
  });
});

describe('a product with exactly one complex factor', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('a', 'number');
    ce.declare('b', 'number');
    ce.declare('c', 'number');
    ce.declare('z', 'complex');
    return ce;
  }

  test('a real factor scales the two components instead of running a complex step', () => {
    const ce = engine();
    const code = String(
      compile(ce.parse('a\\cdot b\\cdot z\\cdot c'), { to: 'javascript' }).code
    );
    // Each REAL factor is two multiplications in place. The four-product
    // complex step, with its two extra temporaries, is left for the one factor
    // that is actually complex.
    expect(code).toContain('_re = _re * _v1; _im = _im * _v1');
    expect(code).toContain('_re = _re * _v2; _im = _im * _v2');
    expect(count(code, '_nre')).toBe(2); // `_nre3`, declared then read
    expect(count(code, '_nre3 = _re * _v3.re - _im * _v3.im')).toBe(1);
  });

  test('a leading complex factor leaves no complex step at all', () => {
    const ce = engine();
    // Canonical ordering sorts the factors by name, so `p` comes first here
    // and every step after it is a real scaling.
    ce.declare('p', 'complex');
    ce.declare('w', 'number');
    ce.declare('y', 'number');
    const code = String(
      compile(ce.parse('p\\cdot w\\cdot y'), { to: 'javascript' }).code
    );
    expect(count(code, '_nre')).toBe(0);
    expect(code).toContain('let _re = _v0.re; let _im = _v0.im');
  });

  test('the accumulation keeps the argument order, so a scaling cannot overflow first', () => {
    // Collecting the real factors into ONE product and scaling by it once
    // re-associates the arithmetic: `b * y` is `1e200 * 1e200`, which
    // overflows, and the tiny complex factor can no longer bring it back.
    // Multiplying step by step in argument order stays finite.
    const ce = engine();
    ce.declare('p', 'complex');
    ce.declare('y', 'number');
    const r = compile(ce.parse('p\\cdot y\\cdot b'), { to: 'javascript' });
    const value = r.run!({
      p: { re: 1e-200, im: 1e-200 },
      y: 1e200,
      b: 1e200,
    }) as { re: number; im: number };
    expect(value.re).toBe(1e200);
    expect(value.im).toBe(1e200);
  });

  test('binds every factor once, in the order the operands are compiled', () => {
    const ce = engine();
    const code = String(
      compile(ce.parse('a\\cdot b\\cdot z\\cdot c'), { to: 'javascript' }).code
    );
    // Each operand is bound exactly once, and the bindings appear in operand
    // order — what keeps a factor with an effect evaluated where it was.
    expect(code.match(/const _v\d = /g)).toEqual([
      'const _v0 = ',
      'const _v1 = ',
      'const _v2 = ',
      'const _v3 = ',
    ]);
    for (const v of ['_.a', '_.b', '_.c', '_.z'])
      expect(count(code, v)).toBe(1);
  });

  test('agrees with the interpreter', () => {
    const ce = engine();
    const e = ce.parse('a\\cdot b\\cdot z\\cdot c');
    const r = compile(e, { to: 'javascript' });
    const value = r.run!({
      a: 2,
      b: 3,
      c: 5,
      z: { re: 1, im: -2 },
    }) as { re: number; im: number };
    const expected = e
      .subs({ a: 2, b: 3, c: 5, z: ce.box(['Complex', 1, -2]) })
      .N();
    expect(value.re).toBeCloseTo(expected.re, 12);
    expect(value.im).toBeCloseTo(expected.im, 12);
  });

  test('two complex factors keep the sequential complex chain', () => {
    const ce = engine();
    const e = ce.parse('a\\cdot z\\cdot b\\cdot z');
    const code = String(compile(e, { to: 'javascript' }).code);
    expect(count(code, '_nre')).toBeGreaterThan(0);
    const r = compile(e, { to: 'javascript' });
    const value = r.run!({ a: 2, b: 3, z: { re: 1, im: -2 } }) as {
      re: number;
      im: number;
    };
    const expected = e
      .subs({ a: 2, b: 3, z: ce.box(['Complex', 1, -2]) })
      .N();
    expect(value.re).toBeCloseTo(expected.re, 12);
    expect(value.im).toBeCloseTo(expected.im, 12);
  });
});

describe('an unrolled complex Sum nested inside another one', () => {
  // Each unrolled complex Sum binds one temporary per term; the temporaries
  // must be hygienic, or the inner block re-declares the outer sum's first
  // term and the emitted code throws reading `.re` of `undefined`.
  test('compiles and agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'number');
    const expr = ce.parse('\\sum_{i=3}^{4}\\sum_{m=0}^{1} s\\sqrt{m-2}');
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    const v = r.run!({ s: 2 }) as { re: number; im: number };
    const expected = expr.subs({ s: 2 }).N();
    expect(v.re).toBeCloseTo(expected.re, 10);
    expect(v.im).toBeCloseTo(expected.im, 10);
  });
});
