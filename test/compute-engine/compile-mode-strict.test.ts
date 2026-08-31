import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
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
 * lane specialization. The rule is in force for `mode: 'strict'` ONLY: since
 * step 4 (2026-08-16) the default `auto` answers the same mismatch by
 * escalating the whole compilation to `mode: 'complex'`, which has a single
 * lane and never declines here (see `BaseCompiler.strictLanes`).
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
  mode: 'strict' | 'auto' | 'complex' = 'strict'
): { boundary?: string; binding?: string; value?: string } | undefined {
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
    expect(d!.boundary).toBe('user-function parameter');
    expect(d!.binding).toBe('the parameter `x` of `b`');
    expect(d!.value).toBe('z');
    // The payload reaches a `success: false` result as `diagnostic`.
    const r = compile(ce.box(['b', 'z']), { mode: 'strict' });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('lane-mismatch');
    expect(r.diagnostic?.kind).toBe('correctness');
    expect(r.error).toContain("mode: 'complex'");
  });

  it('…and a complex-shaped EXPRESSION argument, and either position of a binary function', () => {
    const ce = engineWith();
    expect(declineOf(ce, ['b', ['Add', 't', 'z']])?.value).toBe('t+z');
    expect(declineOf(ce, ['h', 'z', 2])?.binding).toBe(
      'the parameter `x` of `h`'
    );
    expect(declineOf(ce, ['h', 2, 'z'])?.binding).toBe(
      'the parameter `y` of `h`'
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

  it('a broadcast over a complex-typed list into a wide parameter: b(L)', () => {
    const ce = engineWith();
    const d = declineOf(ce, ['b', 'L']);
    expect(d?.boundary).toBe('user-function parameter');
    expect(d?.value).toBe('L');
  });

  it('user-function VALUE position: Map(b, L) with a wide parameter', () => {
    const ce = engineWith();
    const d = declineOf(ce, ['Map', 'b', 'L']);
    expect(d?.boundary).toBe('user-function value position');
    expect(d?.binding).toBe('the parameter `x` of `b`');
    expect(d?.value).toBe('L');
    // A declared-complex callback parameter is fine.
    expect(declineOf(ce, ['Map', 'c', 'L'])).toBeUndefined();
    expect(
      compile(ce.box(['Map', 'c', 'L']), { mode: 'strict', fallback: false })
        .run!({ L: [{ re: 1, im: 1 }] })
    ).toEqual([{ re: 2, im: 1 }]);
  });

  it('multi-clause clause parameter: a complex argument where a clause parameter is wide', () => {
    const ce = engineWith();
    const clause = (name: string, fn: MathJsonExpression) =>
      ce.box(['DefineFunction', name, fn]).evaluate();
    clause('T', ['Function', 0, p('k', '0')]);
    clause('T', ['Function', ['Add', 'k', 1], p('k', 'number')]);
    const d = declineOf(ce, ['T', 'z']);
    expect(d?.boundary).toBe('multi-clause clause parameter');
    expect(d?.binding).toBe('parameter 1 of the multi-clause function `T`');
    // Every clause parameter typed complex or real-only: no mismatch — a
    // real-only clause rejects the value at dispatch, a complex one is
    // coerced into.
    clause('U', ['Function', ['Multiply', 'k', 10], p('k', 'real')]);
    clause('U', ['Function', ['Add', 'k', 1], p('k', 'complex')]);
    expect(declineOf(ce, ['U', 'z'])).toBeUndefined();
  });

  it('protocol member parameter: a complex argument where a candidate parameter is wide', () => {
    const ce = new ComputeEngine();
    const diags = executeEpsil(
      ce,
      `protocol Wide { function wide(self: Self, k: number) -> number }
type real is Wide { function wide(self: Self, k: number) -> number { k + 1 } }`
    ).diagnostics;
    expect(diags).toEqual([]);
    ce.declare('w', 'complex');
    const d = declineOf(ce, ['wide', 2, 'w']);
    expect(d?.boundary).toBe('protocol member parameter');
    expect(d?.binding).toBe('parameter 2 of the protocol member `wide`');
  });

  it('Block local: a later complex-shaped assignment to a local first bound real', () => {
    const ce = engineWith();
    const d = declineOf(ce, [
      'Block',
      ['Assign', 'k', 1],
      ['Assign', 'k', ['Add', 'k', ['Multiply', 2, 'ImaginaryUnit']]],
      ['Add', ['Abs', 'k'], 2],
    ]);
    expect(d?.boundary).toBe('Block local');
    expect(d?.binding).toBe('the local `k`');
    // …including one nested in a conditional statement.
    const nested = declineOf(ce, [
      'Block',
      ['Assign', 'k', 't'],
      [
        'If',
        ['Less', 't', 0],
        ['Assign', 'k', ['Multiply', 'k', 'ImaginaryUnit']],
      ],
      ['Add', 'k', 1],
    ]);
    expect(nested?.boundary).toBe('Block local');
    // A local whose FIRST binding is complex is complex-shaped: no mismatch.
    expect(
      declineOf(ce, [
        'Block',
        ['Assign', 'k', ['Multiply', 2, 'ImaginaryUnit']],
        ['Add', ['Abs', 'k'], 2],
      ])
    ).toBeUndefined();
  });

  it('nothing declines under auto (it escalates instead) or complex (single lane)', () => {
    const ce = engineWith();
    expect(declineOf(ce, ['b', 'z'], 'auto')).toBeUndefined();
    const auto = compile(ce.box(['b', 'z']), { mode: 'auto', fallback: false });
    // Lane specialization is gone: `auto` retries the whole compilation under
    // the complex discipline (compile-mode step 4, 2026-08-16), so there is a
    // single `_fn_b` and the mismatch is reported as the escalation cause.
    expect(auto.success).toBe(true);
    // The call's result carries the idempotent `_SYS.cplx` of the
    // lift-at-use rule: `b`'s declared result `number` counts as a
    // WIDE numeric type since the finite-by-default flip put `complex` below
    // that name. The wrap does not change the value, and `_fn_b` is still
    // emitted once — reached from both branches of the runtime broadcast guard
    // the call site carries, since `z`'s complex type is no proof that `run()`
    // will not supply an array.
    expect(auto.code).toBe(
      '_SYS.cplx(((_tv1) => Array.isArray(_tv1) ? ' +
        '_SYS.bcastFn((_tv2) => _fn_b(_tv2), _tv1) : _fn_b(_tv1))(_.z))'
    );
    expect(auto.mode).toBe('complex');
    expect(auto.escalation?.boundary).toBe('user-function parameter');
    expect(auto.escalation?.binding).toBe('the parameter `x` of `b`');
    expect(auto.escalation?.value).toBe('z');
    // …and the value matches the interpreter's `b(1 + 2i) = 2 + 4i`.
    expect(auto.run!({ z: { re: 1, im: 2 } })).toEqual({ re: 2, im: 4 });
    // Complex mode: one emission of `b`, its wide parameter lifted at use.
    expect(declineOf(ce, ['b', 'z'], 'complex')).toBeUndefined();
    const cx = compile(ce.box(['b', 'z']), {
      mode: 'complex',
      fallback: false,
    });
    expect(cx.code).toBe(
      '_SYS.cplx(((_tv1) => Array.isArray(_tv1) ? ' +
        '_SYS.bcastFn((_tv2) => _fn_b(_tv2), _tv1) : _fn_b(_tv1))(_.z))'
    );
    expect(cx.run!({ z: { re: 1, im: 2 } })).toEqual({ re: 2, im: 4 });
  });

  it("strict mode keeps today's typed-complex programs: z² + z, Reduce over a complex list", () => {
    const ce = engineWith();
    const r = compile(ce.parse('z^2 + z'), { mode: 'strict', fallback: false });
    expect(r.run!({ z: { re: 1, im: 2 } })).toEqual({ re: -2, im: 6 });
    const red = compile(
      ce.box([
        'Reduce',
        'L',
        ['Function', ['Add', 'a', ['Multiply', 2, 'x']], 'a', 'x'],
        0,
      ]),
      { mode: 'strict', fallback: false }
    );
    expect(red.success).toBe(true);
    expect(red.mode).toBe('strict');
    expect(red.promoted).toBe(false);
    expect(red.escalation).toBeUndefined();
    expect(
      red.run!({
        L: [
          { re: 1, im: 2 },
          { re: 0, im: 1 },
        ],
      })
    ).toEqual({
      re: 2,
      im: 6,
    });
  });
});

describe('D3 — the entry check of the JavaScript runner (every mode)', () => {
  it('a {re, im} for a free symbol analyzed real throws a TypeError naming it', () => {
    const ce = new ComputeEngine();
    for (const mode of ['strict', 'auto'] as const) {
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

  it('booleans, strings and arrays pass through untouched', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'string');
    ce.declare('v', 'list<number>');
    const r = compile(ce.box(['Tuple', ['Length', 's'], ['Sum', 'v']]), {
      fallback: false,
    });
    expect(r.run!({ s: 'abc' as never, v: [1, 2, 3] as never })).toEqual([
      3, 6,
    ]);
  });
});

describe('closed ROADMAP entries (2026-08-16)', () => {
  it('a MULTI-CLAUSE function with a declared complex parameter is handed the lifted argument', () => {
    // ROADMAP "A MULTI-CLAUSE function with a declared `complex` parameter
    // compiles silently wrong": `S(w)` at `w = 2` returned `{re: null}`.
    const ce = new ComputeEngine();
    const clause = (name: string, fn: MathJsonExpression) =>
      ce.box(['DefineFunction', name, fn]).evaluate();
    clause('S', ['Function', 0, p('z', '0')]);
    clause('S', ['Function', ['Add', 'z', 1], p('z', 'complex')]);
    ce.declare('w', 'complex');
    const r = compile(ce.box(['S', 'w']), {
      fallback: false,
      constantFold: false,
    });
    expect(r.run!({ w: 2 })).toBe(3);
    expect(r.run!({ w: { re: 0, im: 1 } })).toEqual({ re: 1, im: 1 });
    // Dispatch is decided on the NORMALIZED value: the value clause `S(0)`
    // is selected for `0` in either shape (a `{re: 0, im: 0}` IS `0`).
    expect(r.run!({ w: 0 })).toBe(0);
    expect(r.run!({ w: { re: 0, im: 0 } })).toBe(0);
    expect(ce.box(['S', 2]).evaluate().toString()).toBe('3');
    // A real-typed clause receives the real number, a complex-typed one the
    // lifted object — each helper in the shape its body was compiled for.
    clause('R', ['Function', ['Multiply', 'x', 10], p('x', 'real')]);
    clause('R', ['Function', ['Add', 'x', 1], p('x', 'complex')]);
    const rr = compile(ce.box(['R', 'w']), {
      fallback: false,
      constantFold: false,
    });
    expect(rr.run!({ w: 2 })).toBe(20);
    expect(rr.run!({ w: { re: 3, im: 0 } })).toBe(30);
    expect(rr.run!({ w: { re: 0, im: 1 } })).toEqual({ re: 1, im: 1 });
  });

  it('a PROTOCOL member whose parameter is declared complex is handed the argument wrapped', () => {
    // ROADMAP "A protocol MEMBER whose parameter is declared `complex` is
    // handed the argument unwrapped": `scale(2, w)` at `w = 3` returned
    // `{re: null}`.
    const ce = new ComputeEngine();
    const diags = executeEpsil(
      ce,
      `protocol Scaler { function scale(self: Self, k: complex) -> complex }
type real is Scaler { function scale(self: Self, k: complex) -> complex { k + 1 } }`
    ).diagnostics;
    expect(diags).toEqual([]);
    ce.declare('w', 'complex');
    const r = compile(ce.box(['scale', 2, 'w']), {
      fallback: false,
      constantFold: false,
    });
    expect(r.code).toContain('_SYS.cplx(_.w)');
    expect(r.run!({ w: 3 })).toBe(4);
    expect(r.run!({ w: { re: 0, im: 1 } })).toEqual({ re: 1, im: 1 });
  });
});
