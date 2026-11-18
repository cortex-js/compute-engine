import { ComputeEngine, compile } from '../../src/compute-engine';
import { isLaneMismatchError } from '../../src/compute-engine/compilation/diagnostics';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * The STRICT compile discipline and its entry checks
 * (`docs/COMPILATION-MODEL.md`).
 *
 * Under `mode: 'strict'` a complex-shaped value reaching a binding the
 * compilation shaped REAL is a `LaneMismatch` decline (`code:
 * 'lane-mismatch'`, `kind: 'correctness'`, a user-legible `binding`), where
 * before it either compiled silently wrong or was served by a per-call-site
 * lane specialization. The rule is in force for `mode: 'strict'` (the
 * default) ONLY: `mode: 'complex'` has a single lane and never declines here
 * (see `BaseCompiler.strictLanes`).
 *
 * The D3 entry check applies in every mode: a `{re, im}` bound at `run()` to a
 * free symbol or lambda parameter analyzed real throws a `TypeError`; a plain
 * number bound to a `complex`-typed one is lifted.
 */

const p = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  { str: type },
];

function engineWith(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('z', 'complex');
  ce.declare('L', 'list<complex>');
  // `b(x) := 2x` — a wide (unannotated) parameter.
  ce.assign('b', ce.parse('x \\mapsto 2x'));
  // `c(x: complex) := x + 1` — a declared-complex parameter.
  ce.assign('c', ce.box(['Function', ['Add', 'x', 1], p('x', 'complex')]));
  // `h(x, y) := x + 2y` — two wide parameters.
  ce.assign('h', ce.parse('(x, y) \\mapsto x + 2y'));
  return ce;
}

function declineOf(
  ce: ComputeEngine,
  expr: MathJsonExpression,
  mode: 'strict' | 'complex' = 'strict'
): { message?: string; value?: string } | undefined {
  try {
    compile(ce.box(expr), { mode, fallback: false, constantFold: false });
    return undefined;
  } catch (e) {
    if (isLaneMismatchError(e)) return e.diagnostic;
    throw e;
  }
}

describe('strict mode — LaneMismatch declines at the §3 boundaries', () => {
  it('user-function parameter: a complex-typed argument to a wide parameter', () => {
    const ce = engineWith();
    const d = declineOf(ce, ['b', 'z']);
    expect(d).toBeDefined();
    expect(d!.message).toContain('an argument of b that is not real');
    expect(d!.value).toBe('z');
    // The payload reaches a `success: false` result as `diagnostic`.
    const r = compile(ce.box(['b', 'z']), { mode: 'strict' });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('lane-mismatch');
    expect(r.diagnostic?.kind).toBe('correctness');
  });

  it('…and a complex-shaped EXPRESSION argument, and either position of a binary function', () => {
    const ce = engineWith();
    expect(declineOf(ce, ['b', ['Add', 't', 'z']])?.value).toBe('Add(t, z)');
    expect(declineOf(ce, ['h', 'z', 2])?.message).toContain(
      'an argument of h that is not real'
    );
    expect(declineOf(ce, ['h', 2, 'z'])?.message).toContain(
      'an argument of h that is not real'
    );
  });

  it('a declared-complex parameter is NOT a mismatch (the call coerces into it)', () => {
    const ce = engineWith();
    expect(declineOf(ce, ['c', 'z'])).toBeUndefined();
    const r = compile(ce.box(['c', 'z']), { mode: 'strict', fallback: false });
    expect(r.run!({ z: { re: 1, im: 2 } })).toEqual({ re: 2, im: 2 });
    // The reverse direction: a real argument is coerced (unchanged).
    expect(compile(ce.box(['c', 2]), { mode: 'strict' }).run!({})).toBe(3);
  });

  it('Block local: a later complex-shaped assignment to a local first bound real', () => {
    const ce = engineWith();
    const d = declineOf(ce, [
      'Block',
      ['Declare', 'k', "'unknown'", 1],
      ['Assign', 'k', ['Add', 'k', ['Multiply', 2, 'ImaginaryUnit']]],
      ['Add', ['Abs', 'k'], 2],
    ]);
    expect(d?.message).toContain('a value that is not real');
    // …including one nested in a conditional statement.
    const nested = declineOf(ce, [
      'Block',
      ['Declare', 'k', "'unknown'", 't'],
      [
        'If',
        ['Less', 't', 0],
        ['Assign', 'k', ['Multiply', 'k', 'ImaginaryUnit']],
      ],
      ['Add', 'k', 1],
    ]);
    expect(nested).toBeDefined();
    // A local whose FIRST binding is complex is complex-shaped: no mismatch.
    expect(
      declineOf(ce, [
        'Block',
        ['Declare', 'k', "'unknown'", ['Multiply', 2, 'ImaginaryUnit']],
        ['Add', ['Abs', 'k'], 2],
      ])
    ).toBeUndefined();
  });
});

describe('D3 — the entry check of the JavaScript runner (every mode)', () => {
  it('a {re, im} for a free symbol analyzed real throws a TypeError naming it', () => {
    const ce = new ComputeEngine();
    for (const mode of ['strict'] as const) {
      const r = compile(ce.parse('2x + 1'), { mode, fallback: false });
      expect(() => r.run!({ x: { re: 1, im: 1 } })).toThrow(
        /"x" was compiled as a real number/
      );
      expect(r.run!({ x: 3 })).toBe(7);
    }
    // Under the complex discipline a wide `x` is complex-shaped: the object
    // is accepted and a number lifted (step 3).
    const cx = compile(ce.parse('2x + 1'), {
      mode: 'complex',
      fallback: false,
    });
    expect(cx.run!({ x: { re: 1, im: 1 } })).toEqual({ re: 3, im: 2 });
    expect(cx.run!({ x: 3 })).toBe(7);
  });

  it('a plain number for a complex-typed symbol is lifted at entry', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const r = compile(ce.parse('z^2 + z'), { fallback: false });
    expect(r.run!({ z: 2 })).toBe(6);
    expect(r.run!({ z: { re: 2, im: 0 } })).toBe(6);
    expect(r.run!({ z: { re: 1, im: 2 } })).toEqual({ re: -2, im: 6 });
    // The vars object is not mutated by the lift.
    const vars = { z: 2 };
    r.run!(vars);
    expect(vars.z).toBe(2);
  });

  it('a lambda argument: unannotated (wide) parameter throws, complex-annotated lifts', () => {
    const ce = new ComputeEngine();
    const wide = compile(
      ce.box(['Function', ['Add', ['Multiply', 2, 'q'], 1], 'q']),
      { fallback: false }
    );
    expect(() => wide.run!({ re: 1, im: 1 } as never)).toThrow(
      /argument 1 was compiled as a real number/
    );
    expect(wide.run!(3 as never)).toBe(7);
    const typed = compile(
      ce.box(['Function', ['Add', ['Power', 'q', 2], 'q'], p('q', 'complex')]),
      { fallback: false }
    );
    expect(typed.run!(2 as never)).toBe(6);
    expect(typed.run!({ re: 1, im: 2 } as never)).toEqual({ re: -2, im: 6 });
  });

  it('a free symbol INFERRED complex from a declared-complex parameter accepts either shape', () => {
    // The FORM-3 runtime coercion of `compile-complex.test.ts`: `w` is
    // inferred complex from `Q`'s signature, so it is complex-shaped and the
    // entry check lifts a number rather than refusing an object.
    const ce = new ComputeEngine();
    ce.declare('Q', '(complex) -> complex');
    ce.assign('Q', ce.box(['Function', ['Add', 'x', ['Complex', 0, 1]], 'x']));
    const r = compile(ce.box(['Q', 'w']), {
      fallback: false,
      constantFold: false,
    });
    expect(r.run!({ w: 2 })).toEqual({ re: 2, im: 1 });
    expect(r.run!({ w: { re: 1, im: -1 } })).toBe(1);
  });

  it('entryChecks: false disables the check (the implicit-compilation contract)', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('2x + 1'), {
      fallback: false,
      entryChecks: false,
    });
    // Garbage in, garbage out — the caller owns the contract.
    expect(Number.isNaN(r.run!({ x: { re: 1, im: 1 } }) as number)).toBe(true);
  });
});
