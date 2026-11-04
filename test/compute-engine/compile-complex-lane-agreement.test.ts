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

  test('a block local whose static type is real', () => {
    // The `Declare` of the local `k` says `unknown`, but the engine types
    // `k` from its value `⌊x⌋` (`integer`), so `Cos(k)` is real and the
    // parent `+` reads the block as real. The value must be the number
    // `cos 1 + 1`, not a string made from a `{re, im}` object.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const e = ce.box([
      'Add',
      ['Block', ['Declare', 'k', "'unknown'", ['Floor', 'x']], ['Cos', 'k']],
      ['Floor', 'x'],
    ]);
    for (const mode of ['complex', 'strict'] as const) {
      const value = run(e, { x: 1.3 }, mode);
      expect(typeof value).toBe('number');
      expect(value).toBeCloseTo(interpreted(ce, e, { x: 1.3 }) as number, 12);
    }
    // A local that a later binding makes complex keeps the complex lane.
    const c = ce.box([
      'Block',
      ['Declare', 'k', "'unknown'", 'x'],
      ['Assign', 'k', ['Multiply', 'k', 'ImaginaryUnit']],
      ['Add', 'k', 1],
    ]);
    expect(run(c, { x: 1.3 })).toEqual({ re: 1, im: 1.3 });
  });

  test('an assignment to a real block local has the value it stores', () => {
    // The assignment stores the real projection of `f(x)^2` in `k`, so a
    // block that ends with it, and an assignment used as an operand, are
    // real-valued: `Cos` and `+` read them as numbers. The language can
    // refuse both forms (a block with an assignment as an operand, an
    // assignment as an operand); the compilation then declines, which is
    // not a wrong value, so only a compiled program is checked.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('b', 'real');
    ce.declare('f', '(real) -> unknown');
    ce.assign('f', ce.box(['Function', ['Sin', ['Multiply', 'b', 't']], 't']));
    const assign = ['Assign', 'k', ['Power', ['f', 'x'], 2]];
    const y = Math.sin(2.6) ** 2;
    const trailing = ce.box([
      'Cos',
      ['Block', ['Declare', 'k', "'real'", 'x'], assign],
    ]);
    const operand = ce.box([
      'Block',
      ['Declare', 'k', "'unknown'", 'x'],
      ['Add', assign, 1],
    ]);
    for (const mode of ['complex', 'strict'] as const) {
      for (const [e, expected] of [
        [trailing, Math.cos(y)],
        [operand, y + 1],
      ] as const) {
        const r = compile(e, { to: 'javascript', mode } as any) as any;
        if (r.success)
          expect(r.run({ x: 1.3, b: 2 })).toBeCloseTo(expected, 12);
      }
    }
  });

  test('a real block local updated in a loop stays on the real lane', () => {
    // `k ⩴ ⌊x⌋; for j ∈ 1..2: k ⩴ k + j; cos(k) + ⌊x⌋`. The local is real
    // by its static type, so `Cos(k)` is emitted as `Math.cos`, as the
    // parent `+` reads it, and the value is the number `cos 4 + 1`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const e = ce.box([
      'Block',
      ['Declare', 'k', "'unknown'", ['Floor', 'x']],
      [
        'Loop',
        ['Assign', 'k', ['Add', 'k', 'j']],
        ['Element', 'j', ['Range', 1, 2]],
      ],
      ['Add', ['Cos', 'k'], ['Floor', 'x']],
    ]);
    for (const mode of ['complex', 'strict'] as const)
      expect(run(e, { x: 1.3 }, mode)).toBeCloseTo(Math.cos(4) + 1, 12);
  });

  test('a value computed on the complex lane is converted at every binding of a real local', () => {
    // `f(x)^2` is typed `real<0..>`, but `f` is emitted on the complex
    // lane, so the value is a `{re, im}` object. The local `k` is real by
    // its static type, so each binding converts the value to its real
    // part: in an `If`, in a `Loop`, and at a leaf of a destructuring
    // assignment. The value must be the number `f(x)^2 + 1`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('b', 'real');
    ce.declare('f', '(real) -> unknown');
    ce.assign('f', ce.box(['Function', ['Sin', ['Multiply', 'b', 't']], 't']));
    const assign = ['Assign', 'k', ['Power', ['f', 'x'], 2]];
    for (const nested of [
      ['If', ['Greater', 'x', 0], assign, ['Assign', 'k', 1]],
      ['Loop', assign, ['Element', 'j', ['Range', 1, 2]]],
      [
        'Assign',
        ['Tuple', 'k', 'm'],
        ['Tuple', ['Power', ['f', 'x'], 2], 1],
      ],
    ]) {
      const e = ce.box([
        'Block',
        ['Declare', 'k', "'unknown'", 'x'],
        ['Declare', 'm', "'unknown'", 0],
        nested,
        ['Add', 'k', 1],
      ]);
      for (const mode of ['complex', 'strict'] as const)
        expect(run(e, { x: 1.3, b: 2 }, mode)).toBeCloseTo(
          Math.sin(2.6) ** 2 + 1,
          12
        );
    }
  });

  test('a point returned by a definition with a real `where` local, in an inner product', () => {
    // The local `θ` of `p` has the static type `real`, so the call
    // `p(x)` is a point of real coordinates, and `Dot` writes out the
    // real sum of the products: `p` must emit real coordinates, because
    // the sum reads them as numbers. Found in the Tycho document
    // art/hyvhlz4chj, where the value was `NaN`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.parse('g(x) \\coloneq \\operatorname{mod}(x,1)').evaluate();
    ce.parse(
      'p(x) \\coloneq (\\cos\\theta, \\sin\\theta) \\operatorname{where} \\theta \\coloneq g(x)'
    ).evaluate();
    const e = ce.box(['Dot', ['p', 'x'], ['Tuple', 'x', 2]]);
    for (const mode of ['complex', 'strict'] as const) {
      const value = run(e, { x: 1.3 }, mode);
      expect(typeof value).toBe('number');
      expect(value).toBeCloseTo(interpreted(ce, e, { x: 1.3 }) as number, 12);
    }
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

describe('COMPLEX MODE: a run of a block does not change the lane of its locals', () => {
  // The scope of a block keeps the bindings of its last run, and a copy
  // made by `subs()` shares that scope. The compiler reads the type of a
  // block local from that scope. A run of a `Declare` with no declared type
  // gives the binding the static type of the local (`number`), not the type
  // of the value of the run (`2`, an `integer`). Otherwise the compiled code
  // puts `k` on the real lane and gives `NaN` at `x = -4`.
  test('a substituted copy of the block is evaluated first', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const e = ce.box([
      'Block',
      ['Declare', 'k', "'unknown'", ['Sqrt', 'x']],
      ['Add', 'k', 1],
    ]);
    expect(e.subs({ x: 4 }).evaluate().json).toEqual(3);
    expect(run(e, { x: -4 })).toEqual({ re: 1, im: 2 });
    const expected = e.subs({ x: -4 }).N();
    expect([expected.re, expected.im]).toEqual([1, 2]);
  });

  test('a substituted copy of an expression that holds the block is evaluated first', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const e = ce.box([
      'Add',
      [
        'Block',
        ['Declare', 'k', "'unknown'", ['Sqrt', 'x']],
        ['Add', 'k', 1],
      ],
      1,
    ]);
    expect(e.subs({ x: 4 }).evaluate().json).toEqual(4);
    expect(run(e, { x: -4 })).toEqual({ re: 2, im: 2 });
  });
});
