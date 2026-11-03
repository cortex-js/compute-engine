import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * In `mode: 'complex'`, the lane analysis (`isComplexValued`, the element
 * lane of a broadcast, the lane of a fold) and the emitter of each node
 * must give the same answer: a `{re, im}` object that reaches real code
 * (`*`, `Math.sqrt`, `+`) gives `NaN` or a string. Each test compiles a
 * program where the two disagreed, runs it, and compares the value with
 * the interpreter's. The value of a compiled program in the `complex` mode
 * is a JavaScript number when it is real.
 */

/** Run `expr` compiled to JavaScript in `mode` with `input`. */
function run(
  expr: ReturnType<ComputeEngine['box']>,
  input: Record<string, unknown>,
  mode: 'complex' | 'strict' = 'complex'
): unknown {
  const r = compile(expr, { to: 'javascript', mode } as any) as any;
  expect(r.success).toBe(true);
  return r.run(input);
}

/** The interpreter's value of `expr` with the symbols of `input` replaced. */
function interpreted(
  ce: ComputeEngine,
  expr: ReturnType<ComputeEngine['box']>,
  input: Record<string, unknown>
): unknown {
  const subs: Record<string, any> = {};
  for (const [k, v] of Object.entries(input))
    subs[k] = Array.isArray(v) ? ce.box(['List', ...v]) : ce.number(v as any);
  const value = expr.subs(subs).N();
  if (value.operator === 'List') return value.ops!.map((x) => x.re);
  return value.re;
}

describe('COMPLEX MODE: the lane analysis agrees with the emitter', () => {
  test('a power of a call on the complex lane, with a real node type', () => {
    // `f(x)^2` types `nan | real<0..>`, but `f` is emitted on the complex
    // lane, so the `Power` emitter squares a `{re, im}` value. Before the
    // fix the parent added `1` to it with the real `+`:
    // `"[object Object]1"`.
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    ce.declare('x', 'real');
    ce.declare('f', '(real) -> unknown');
    ce.assign('f', ce.parse('t \\mapsto \\sin(bt)'));
    const e = ce.parse('f(x)^2 + 1');
    const input = { b: 2, x: 0.7 };
    const value = run(e, input);
    expect(typeof value).toBe('number');
    expect(value).toBeCloseTo(Math.sin(1.4) ** 2 + 1, 12);
    // The body of `f` reads `b` from the engine, so the interpreter gets
    // the values by assignment rather than by substitution.
    ce.assign('b', 2);
    ce.assign('x', 0.7);
    expect(value).toBeCloseTo(e.N().re, 12);
  });

  test('a broadcast power of a list of integers, times a real', () => {
    // The node `10^i` types `list<number>`, and its closure was emitted with
    // `_SYS.cpow` over element parameters with no type. The parent closure
    // then multiplied that `{re, im}` object with `*`: `[NaN, NaN]`.
    const ce = new ComputeEngine();
    ce.declare('i', 'list<integer>');
    ce.declare('r', 'real');
    const e = ce.parse('r\\cdot 10^i');
    const input = { r: 0.5, i: [1, 2] };
    expect(run(e, input)).toEqual([5, 50]);
    expect(run(e, input, 'strict')).toEqual([5, 50]);
    expect(interpreted(ce, e, input)).toEqual([5, 50]);
  });

  test('a broadcast square root of a broadcast power', () => {
    // `Math.sqrt` was applied to the `{re, im}` result of `_SYS.cpow`:
    // `[NaN, NaN, NaN]`.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    const e = ce.box(['Sqrt', ['Power', 'L', 2]]);
    const input = { L: [4, 9, 16] };
    expect(run(e, input)).toEqual([4, 9, 16]);
    expect(interpreted(ce, e, input)).toEqual([4, 9, 16]);
    // The same program over a literal list, without constant folding.
    const literal = ce.box(['Sqrt', ['Power', ['List', 4, 9, 16], 2]]);
    const r = compile(literal, {
      to: 'javascript',
      mode: 'complex',
      constantFold: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.run({})).toEqual([4, 9, 16]);
  });

  test('a selection over a broadcast square root, without constant folding', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Which',
      ['Less', ['List', 4, 9, 16], 10],
      ['Sqrt', ['Power', ['List', 4, 9, 16], 2]],
      'True',
      0,
    ]);
    const r = compile(e, {
      to: 'javascript',
      mode: 'complex',
      constantFold: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.run({})).toEqual([4, 9, 0]);
    expect(e.evaluate().json).toEqual(['List', 4, 9, 0]);
  });

  test('a square root whose radicand has a wide type', () => {
    // With `x, y: real | signed_infinity`, the radicand types `nan | number`.
    // The `Sqrt` emitter writes `Math.sqrt` because the radicand is not
    // negative; the analysis read the wide type as complex, and the parent
    // multiplied the number as a `{re, im}` object: `{re: NaN, im: NaN}`.
    for (const t of ['real | signed_infinity', 'nan | real | signed_infinity']) {
      const ce = new ComputeEngine();
      ce.declare('x', t);
      ce.declare('y', t);
      const e = ce.parse('1-0.15\\sqrt{x^2+y^2}');
      const input = { x: 3, y: 4 };
      const value = run(e, input);
      expect(typeof value).toBe('number');
      expect(value).toBeCloseTo(0.25, 12);
      expect(value).toBeCloseTo(interpreted(ce, e, input) as number, 12);
    }
  });

  test('a product of a map whose callback is on the complex lane', () => {
    // `Product(L)` canonicalizes to `Reduce(L, Multiply, 1)`, whose builtin
    // combiner multiplied the `{re, im}` values of `f` with `*`: `NaN`.
    const ce = new ComputeEngine();
    ce.declare('P', 'list<real>');
    ce.parse('f(t) := t^2').evaluate();
    const input = { P: [1, 2, 3] };
    const sum = ce.box([
      'Add',
      ['Sum', ['Map', 'f', 'P']],
      ['Product', ['Map', 'f', 'P']],
    ]);
    expect(run(sum, input)).toBe(50);
    expect(run(sum, input, 'strict')).toBe(50);
    expect(interpreted(ce, sum, input)).toBe(50);
    const product = ce.box(['Product', ['Map', 'f', 'P']]);
    expect(run(product, input)).toBe(36);
    expect(interpreted(ce, product, input)).toBe(36);
  });

  test('a fold in the complex lane over an empty list or one element', () => {
    // A builtin fold in the complex lane makes a `{re, im}` object only in
    // a step of its combiner. Over an empty list the native `reduce` gave
    // the real seed as a plain number, and over one element with no seed it
    // gave that element. When the fold's type is non-real, nothing else
    // lifts the value, and the parent read `.re` of a number: `NaN`.
    const ce = new ComputeEngine();
    ce.declare('P', 'list<real>');
    ce.declare('L', 'list<complex>');
    ce.parse('f(t) := t^2').evaluate();
    const sqrt = ['Map', 'Sqrt', 'P'];
    const square = ['Map', 'f', 'P'];
    const seeded: any[] = [
      ['Product', sqrt],
      ['Sum', sqrt],
      ['Reduce', sqrt, 'Multiply', 2],
      ['Reduce', sqrt, 'Add', 0],
      ['Product', square],
      ['Sum', square],
      ['Reduce', square, 'Multiply', 2],
      ['Reduce', square, 'Add', 0],
    ];
    const seedless: any[] = [
      ['Reduce', sqrt, 'Multiply'],
      ['Reduce', sqrt, 'Add'],
      ['Reduce', square, 'Multiply'],
      ['Reduce', square, 'Add'],
    ];
    for (const mode of ['complex', 'strict'] as const) {
      for (const fold of seeded) {
        const e = ce.box(['Add', fold, 1]);
        for (const P of [[], [4]]) {
          const value = run(e, { P }, mode);
          expect(typeof value).toBe('number');
          expect(value).toBeCloseTo(interpreted(ce, e, { P }) as number, 12);
        }
      }
      // A seedless fold over an empty list has no value (the interpreter
      // gives `Nothing`), so only the one-element list is compared.
      for (const fold of seedless) {
        const e = ce.box(['Add', fold, 1]);
        const value = run(e, { P: [4] }, mode);
        expect(typeof value).toBe('number');
        expect(value).toBeCloseTo(interpreted(ce, e, { P: [4] }) as number, 12);
      }
      // A real seed over complex elements.
      for (const fold of [
        ['Reduce', 'L', 'Add', 0],
        ['Reduce', 'L', 'Multiply', 1],
      ]) {
        const e = ce.box(['Add', fold, 1]);
        const value = run(e, { L: [] }, mode);
        expect(typeof value).toBe('number');
        expect(value).toBe(interpreted(ce, e, { L: [] }));
      }
    }
  });

  test('a complex argument at a parameter that the definition reads on the real lane', () => {
    // The parameter `x` of `s` has the signature type `unknown`, so a call
    // lifts a wide argument to a `{re, im}` object; the use in `Floor`
    // narrows `x` to a real type, so the body reads it on the real lane:
    // `x + -Math.floor(x)`. Before the fix, `g(u)` gave the string
    // `"[object Object]NaN1"`. The call now passes the real projection:
    // the real part of a real value, `NaN` for a value with an imaginary
    // part (the interpreter gives an `incompatible-type` error there).
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.declare('v', 'number');
    ce.declare('w', 'complex');
    ce.declare('Z', 'list<number>');
    ce.parse('s(x) \\coloneq x - \\lfloor x\\rfloor').evaluate();
    ce.parse('g \\coloneq t \\mapsto s(t)+1').evaluate();
    const gu = ce.parse('g(u)');
    for (const mode of ['complex', 'strict'] as const) {
      const value = run(gu, { u: 0.25 }, mode);
      expect(value).toBe(1.25);
      expect(value).toBe(interpreted(ce, gu, { u: 0.25 }));
    }
    expect(run(ce.parse('g(v)'), { v: 2.25 })).toBe(1.25);
    // A complex input: real at `1.5 + 0i`, not real at `1.5 + i`.
    const gw = ce.parse('g(w)');
    expect(run(gw, { w: { re: 1.5, im: 0 } })).toBe(1.5);
    expect(run(gw, { w: { re: 1.5, im: 1 } })).toBeNaN();
    expect(run(ce.parse('s(w)'), { w: { re: 1.5, im: 1 } })).toBeNaN();
    // An element of a `list<number>`, lifted with `_SYS.cplx` at the call.
    const sz = ce.box(['Add', ['s', ['At', 'Z', 2]], 1]);
    expect(run(sz, { Z: [0.5, 3.75] })).toBe(1.75);
  });
});

describe('COMPLEX MODE: a parameter that binds a collection whole keeps its elements', () => {
  test('a list argument with a complex element is not converted', () => {
    // The parameter `p` binds the list whole (`tuple<number, number>`),
    // so its elements keep their own lanes: the call passes the list as
    // it is, and `p[1]·p[2]` at `t = 2` is `2 + 4i`, the interpreter's
    // value.
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.assign(
      'f',
      ce.box(['Function', ['Multiply', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    const e = ce.box([
      'f',
      ['List', ['Add', 1, ['Multiply', 'ImaginaryUnit', 't']], 2],
    ]);
    expect(run(e, { t: 2 })).toEqual({ re: 2, im: 4 });
    const expected = e.subs({ t: 2 }).N();
    expect([expected.re, expected.im]).toEqual([2, 4]);
  });
});
