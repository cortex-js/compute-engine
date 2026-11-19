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
 * is refused; the compiled code no longer reads it as one scalar. The
 * compiler can decline another operand first (the argument of `g` in the
 * complex mode): the code is then `outside-profile`, or `code` when given
 * (`Trace` of a call whose shape the type does not settle). */
function expectRefused(
  expr: any,
  mode: string,
  code = 'outside-profile'
): void {
  const r = compile(expr, { to: 'javascript', mode } as any);
  expect(r.success).toBe(false);
  if (r.diagnostic?.code === 'untyped-input')
    expect(r.unsupported).toContain('x');
  else expect(r.diagnostic?.code).toBe(code);
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
      expectRefused(expr, mode, 'unsettled-shape');
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
    ).toThrow(/h is not the library operator here/);
  });
});

describe('A SHADER READS THE STATIC LENGTH OF THE CALL THE SAME WAY (CE-377)', () => {
  test('glsl: a list with a complex element has no shader value, and the decline names the element', () => {
    const ce = complexListEngine();
    const expr = ce.box(['Add', ['At', ['v', 'x'], 2], 1]);
    expect(() => compile(expr, { to: 'glsl', fallback: false } as any)).toThrow(
      /Could not compile/
    );
  });
});
