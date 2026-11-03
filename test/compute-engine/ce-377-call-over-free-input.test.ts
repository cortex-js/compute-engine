/**
 * ROADMAP CE-377 (landed 2026-10-23): compiled code declined a call of a
 * user function whose argument is an untyped free input.
 *
 * With `g := t ↦ [t, 2]` and a free input `x`, the signature of `g` says
 * only what its body proves, `(unknown) -> list<unknown>`, so the engine
 * types `g(x)[1]` as `unknown`. The emitted code reads an untyped free input
 * as one scalar (`x + 1` compiles to `_.x + 1`), so the compiler types an
 * operand with each such input read as a number, with the engine's own
 * derivation (`BaseCompiler.typeWithFreeInputsAsNumbers`): `g(x)` is a
 * `vector<2>` and `g(x)[1]` a number. The scalar-arithmetic guard of the
 * JavaScript target no longer refuses the operand, and the shader targets
 * read the static length of the call's result the same way.
 *
 * Since the compiled code must know the shape of each input from its type
 * (`docs/COMPILATION-MODEL.md`, "Fail closed"), the JavaScript target
 * refuses an untyped free input with the diagnostic `untyped-input`. The
 * tests of the JavaScript target check the refusal and the interpreted
 * value. The tests that need a parameter compile `(x) ↦ expr`: with `x`
 * declared `any` the shape of the argument of `g(x)` is not settled and the
 * compilation declines (`unsettled-shape`); with `x` declared `real` or
 * `list<real>` the call is direct or a static map, and the compiled value is
 * the interpreter's.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const MODES = ['strict', 'complex'] as const;

/** Expect the compilation of `expr` on the JavaScript target, in the mode
 * `mode`, to be refused because the input `x` has no type. The compiled code
 * must know the shape of each input from its type, so an untyped free input
 * is refused; the compiled code no longer reads it as one scalar. */
function expectRefused(expr: any, mode: string): void {
  const r = compile(expr, { to: 'javascript', mode } as any);
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('untyped-input');
  expect(r.unsupported).toContain('x');
}

/** The value of the compiled function `(x) ↦ expr`, whose parameter `x` is
 * declared `type`, called with `x`. */
function jsRoot(expr: any, mode: string, x: unknown, type: string): unknown {
  const fn = expr.engine.box([
    'Function',
    expr.json,
    ['Typed', 'x', { str: type }],
  ]);
  return (
    compile(fn, { to: 'javascript', mode, fallback: false } as any) as any
  ).run(x);
}

/** Expect the compilation of `(x) ↦ expr`, whose parameter `x` is declared
 * `any`, to decline: the shape of the argument of the call of `g` is not
 * settled. */
function expectUnsettledRoot(expr: any, mode: string): void {
  const fn = expr.engine.box([
    'Function',
    expr.json,
    ['Typed', 'x', { str: 'any' }],
  ]);
  const r = compile(fn, { to: 'javascript', mode } as any);
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('unsettled-shape');
  expect(r.unsupported).toContain('x');
}

function listEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('g', ce.box(['Function', ['List', 't', 2], 't']));
  ce.assign(
    'm',
    ce.box(['Function', ['List', ['List', 't', 1], ['List', 2, 3]], 't'])
  );
  return ce;
}

// `v` builds a list whose second element is the global `k`, which holds `i`.
function complexListEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('k', ce.parse('\\imaginaryI'));
  ce.declare('v', { signature: '(unknown) -> unknown' });
  ce.assign('v', ce.parse('s \\mapsto [s, k]'));
  return ce;
}

function realListEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('v', { signature: '(unknown) -> unknown' });
  ce.assign('v', ce.parse('s \\mapsto [s, 2s]'));
  return ce;
}

describe('A CALL OF A USER FUNCTION OVER AN UNTYPED FREE INPUT (CE-377)', () => {
  for (const mode of MODES) {
    test(`${mode}: g(x)[1] + g(x)[2], g := t ↦ [t, 2]`, () => {
      const ce = listEngine();
      const expr = ce.box([
        'Add',
        ['At', ['g', 'x'], 1],
        ['At', ['g', 'x'], 2],
      ]);
      expect(ce.box(['At', ['g', 'x'], 1]).type.toString()).toBe('unknown');
      expectRefused(expr, mode);
      expect(expr.subs({ x: 3 }).N().re).toBe(5);
    });

    test(`${mode}: Trace(m(x)) + 1, m := t ↦ [[t, 1], [2, 3]]`, () => {
      const ce = listEngine();
      const expr = ce.box(['Add', ['Trace', ['m', 'x']], 1]);
      expectRefused(expr, mode);
      expect(expr.subs({ x: 2 }).N().re).toBe(6);
    });

    test(`${mode}: Sum(1 + v(x)[2], k from 1 to 3), v := s ↦ [s, k], k = i`, () => {
      const ce = complexListEngine();
      const expr = ce.box([
        'Sum',
        ['Add', 1, ['At', ['v', 'x'], 2]],
        ['Limits', 'k', 1, 3],
      ]);
      expectRefused(expr, mode);
      const value = expr.subs({ x: 2 }).N();
      expect([value.re, value.im]).toEqual([3, 3]);
    });

    test(`${mode}: an absent element keeps its marker: g(x)[5] + 1 is NaN at x = 3`, () => {
      // `g(3)` is `[3, 2]`, a list of numbers, and the element 5 is absent:
      // a numeric absence, `NaN`, in the interpreter. The compilation is
      // refused, because `x` has no type.
      const ce = listEngine();
      const expr = ce.box(['Add', ['At', ['g', 'x'], 5], 1]);
      expectRefused(expr, mode);
      expect(expr.subs({ x: 3 }).N().isNaN).toBe(true);
    });
  }

  test('complex: a complex value of the input flows through the call', () => {
    const ce = listEngine();
    const expr = ce.box(['Add', ['At', ['g', 'x'], 1], ['At', ['g', 'x'], 2]]);
    expectRefused(expr, 'complex');
  });

  test('strict: only the type reads the input as a number; the call maps over a declared list', () => {
    // As a free input, `x` is refused. As a parameter of the root function
    // declared `any`, the shape of the argument is not settled, and the
    // compilation declines. Declared `list<real>`, the call maps `g` over
    // the list: `g([1, 2])` is `[[1, 2], [2, 2]]`, and the sum of its two
    // elements is `[3, 4]`. Declared `real`, the call is direct.
    const ce = listEngine();
    const expr = ce.box(['Add', ['At', ['g', 'x'], 1], ['At', ['g', 'x'], 2]]);
    expectRefused(expr, 'strict');
    expectUnsettledRoot(expr, 'strict');
    expect(jsRoot(expr, 'strict', [1, 2], 'list<real>')).toEqual([3, 4]);
    expect(
      expr
        .subs({ x: ce.box(['List', 1, 2]) })
        .evaluate()
        .toString()
    ).toBe('[3,4]');
    expect(jsRoot(expr, 'strict', 3, 'real')).toBe(5);
  });

  test('complex: an input that holds a list at run time is read as the lane reads every free input', () => {
    // The complex lane reads a free input as one complex scalar
    // (`_SYS.cplx(_.x)`), with no run-time shape dispatch: `x + 1` is `NaN`
    // at `x = [1, 2]`. The use `x + 1` narrows the type of `x` to `number`
    // by inference, so `x` has a type, and a list there breaks the host's
    // input contract.
    {
      const ce = listEngine();
      const value = (
        compile(ce.box(['Add', 'x', 1]), {
          to: 'javascript',
          mode: 'complex',
          fallback: false,
        } as any) as any
      ).run({ x: [1, 2] }) as { re: number };
      expect(value.re).toBeNaN();
    }
    // In the two blocks below, `x` has no type, so it is refused as a free
    // input, and the function `(x) ↦ expr` with the parameter `x` declared
    // `any` declines. Declared `list<real>`, the parameter keeps the
    // interpreter's value.
    // `h(x) + 1` with `h := t ↦ 2t` does not narrow the type of `x`: the
    // call maps `h` over the list, and the `+` maps over the result of the
    // call, so the value is the interpreter's `[3, 5]`.
    {
      const ce = listEngine();
      ce.assign('h', ce.box(['Function', ['Multiply', 2, 't'], 't']));
      const expr = ce.box(['Add', ['h', 'x'], 1]);
      expectRefused(expr, 'complex');
      expectUnsettledRoot(expr, 'complex');
      expect(jsRoot(expr, 'complex', [1, 2], 'list<real>')).toEqual([3, 5]);
      expect(
        expr
          .subs({ x: ce.box(['List', 1, 2]) })
          .evaluate()
          .toString()
      ).toBe('[3,5]');
    }
    // `g(x)[1]` is the list `[1, 2]` for the list `x = [1, 2]`, and the sum
    // is the interpreter's `[2, 3]`.
    const ce = listEngine();
    const expr = ce.box(['Add', ['At', ['g', 'x'], 1], 1]);
    expectRefused(expr, 'complex');
    expectUnsettledRoot(expr, 'complex');
    expect(jsRoot(expr, 'complex', [1, 2], 'list<real>')).toEqual([2, 3]);
    expect(
      expr
        .subs({ x: ce.box(['List', 1, 2]) })
        .evaluate()
        .toString()
    ).toBe('[2,3]');
  });
});

describe('THE DECLINE NAMES AN OPERAND THAT ONLY MAY BE A LIST (CE-377)', () => {
  test('h(x) + 1 with h declared (unknown) -> unknown and no body', () => {
    // No body to read, so `h(x)` stays of unknown type. The complex lane
    // admits an operand that may be a list (ROADMAP CE-215.2), so the
    // decline is now the one of the call itself: `h` has no body, and the
    // target has no lowering for it. (The message said "a list-valued
    // operand" for an operand that only may be one at run time, and then
    // named the operand and its type.)
    const ce = new ComputeEngine();
    ce.declare('h', { signature: '(unknown) -> unknown' });
    const expr = ce.box(['Add', ['h', 'x'], 1]);
    expect(() =>
      compile(expr, {
        to: 'javascript',
        mode: 'complex',
        fallback: false,
      } as any)
    ).toThrow(/Could not compile `h`: .* has no lowering for it/);
  });
});

describe('A SHADER READS THE STATIC LENGTH OF THE CALL THE SAME WAY (CE-377)', () => {
  for (const to of ['glsl', 'wgsl'] as const)
    test(`${to}: v(x)[2] + 1, v := s ↦ [s, 2s]`, () => {
      // The engine types `v(x)` as `list<unknown>`, which states no length,
      // and the shader declined the index ("the base (type `list<unknown>`)
      // has no statically known length"). The shader reads a free input as a
      // float, so `v(x)` is a `vector<2>`, and the read is a swizzle.
      const ce = realListEngine();
      const expr = ce.box(['Add', ['At', ['v', 'x'], 2], 1]);
      const result = compile(expr, { to, fallback: false } as any) as any;
      expect(result.code).toBe('(_fn_v(x)).y + 1.0');
    });

  test('glsl: Sum(v(x)[2] + k, k from 1 to 3) hoists the read out of the loop', () => {
    const ce = realListEngine();
    const expr = ce.box([
      'Sum',
      ['Add', ['At', ['v', 'x'], 2], 'k'],
      ['Limits', 'k', 1, 3],
    ]);
    const result = compile(expr, { to: 'glsl', fallback: false } as any) as any;
    // The `2s` makes `s` a number (ROADMAP CE-32), so `v(x)` is typed
    // `vector<2>`, as with `s ↦ [s, 2\cdot s]`: the call is bound once to a
    // `vec2`, and its second component once to a `float`, before the loop.
    expect(result.code).toContain(
      'vec2 _tv1 = _fn_v(x);\nfloat _tv2 = _tv1.y;'
    );
  });

  test('glsl: a list with a complex element has no shader value, and the decline names the element', () => {
    const ce = complexListEngine();
    const expr = ce.box(['Add', ['At', ['v', 'x'], 2], 1]);
    expect(() => compile(expr, { to: 'glsl', fallback: false } as any)).toThrow(
      /element 2 \(`k`\) is itself vector-valued/
    );
  });
});
