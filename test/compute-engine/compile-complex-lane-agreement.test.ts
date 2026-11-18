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
