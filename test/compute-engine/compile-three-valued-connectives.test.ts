import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

/**
 * Three-valued (Kleene) lowering of `And`/`Or`/`Not` in branch-condition
 * position.
 *
 * A compiled `If`/`Which` takes an arm only when its condition is exactly
 * `true` or `false` when the function runs; otherwise the value is NaN, the
 * numeric absence marker (ruling 2026-09-02, `docs/ERROR-MODEL.md` §7). A
 * connective used to be decided by JavaScript truthiness instead, so
 * `If(x > 0 ∧ y > 0, 1, -1)` at `x = 1, y = NaN` took the else arm on the
 * strength of an `&&` that answered `false` from no evidence. It now answers
 * NaN, and the interpreter agrees: it holds the same `If` when one operand is
 * unknown and the other cannot settle it.
 *
 * The Kleene tables the emitted test implements:
 *
 *   `And` is decided when one operand is decided FALSE (that operand settles
 *   the result whatever its siblings hold) or when every operand is decided.
 *   `Or` is the mirror image, with a decided TRUE operand settling it.
 *   `Not` is decided exactly when its operand is.
 *
 * A condition every leaf of which is decided by construction keeps the plain
 * conditional expression it always had — pinned below, because the common path
 * must gain no code.
 */

/** `Greater(name, 0)`, the relation these suites build their conditions from. */
const gt = (name: string): unknown[] => ['Greater', name, 0];

/** How many times `fragment` appears in `code`, as plain text. */
function occurrences(code: string, fragment: string): number {
  let count = 0;
  for (let at = code.indexOf(fragment); at !== -1; at = code.indexOf(fragment, at + 1))
    count += 1;
  return count;
}

/** A fresh engine with the real symbols these conditions read. */
function realEngine(): ComputeEngine {
  const engine = new ComputeEngine();
  engine.declare('x', 'real');
  engine.declare('y', 'real');
  engine.declare('z', 'real');
  return engine;
}

/** Compile for the JavaScript target with no fold and no interpreter fallback. */
function js(
  engine: ComputeEngine,
  mathJson: unknown
): { code: string; run: (vars: Record<string, unknown>) => unknown } {
  const result = compile(engine.expr(mathJson as any), {
    fallback: false,
    constantFold: false,
  });
  expect(result.success).toBe(true);
  return {
    code: result.code,
    run: result.run as (vars: Record<string, unknown>) => unknown,
  };
}

describe('COMPILE three-valued And in condition position', () => {
  const ce = realEngine();
  const expr = ['If', ['And', gt('x'), gt('y')], 1, -1];

  it('answers NaN when one operand is undecided and the other is true', () => {
    expect(js(ce, expr).run({ x: 1, y: NaN })).toBeNaN();
  });

  it('takes the then arm when both operands are decided true', () => {
    expect(js(ce, expr).run({ x: 1, y: 2 })).toBe(1);
  });

  it('takes the else arm when a DECIDED FALSE operand settles it', () => {
    // `And(False, undecided)` is `False` — the false operand wins whatever the
    // other one holds, which is the short-circuit case that already agreed.
    expect(js(ce, expr).run({ x: -1, y: NaN })).toBe(-1);
    // …and the same when the false operand is the SECOND one, where the
    // emitted `&&` never reaches it as a decided value.
    expect(js(ce, expr).run({ x: NaN, y: -1 })).toBe(-1);
  });

  it('takes the else arm when both operands are decided false', () => {
    expect(js(ce, expr).run({ x: -1, y: -2 })).toBe(-1);
  });

  it('answers NaN when NEITHER operand is decided', () => {
    expect(js(ce, expr).run({ x: NaN, y: NaN })).toBeNaN();
  });

  it('applies the table to an n-ary And', () => {
    // The table is n-ary, not a left fold of pairs: one term per operand for
    // "this operand settles it", plus one for "every operand is decided".
    const ternary = [
      'If',
      ['And', gt('x'), gt('y'), ['Greater', 'x', 1]],
      1,
      -1,
    ];
    // The THIRD operand is decided false at `x = 1`, so the whole `And` is.
    expect(js(ce, ternary).run({ x: 1, y: NaN })).toBe(-1);
    // Nothing is decided false and `y` is undecided.
    expect(js(ce, ternary).run({ x: 2, y: NaN })).toBeNaN();
    expect(js(ce, ternary).run({ x: 2, y: 3 })).toBe(1);
  });

  it('agrees with the interpreter, which holds the same If', () => {
    const boxed = ce.expr(expr as any);
    // Unknown ∧ unknown: held.
    expect(boxed.evaluate().operator).toBe('If');
    // True ∧ unknown: held — the compiled lane answers NaN at `y = NaN`.
    expect(boxed.subs({ x: 1 } as any).evaluate().operator).toBe('If');
    // False ∧ unknown: decided `False`, so the else arm — as compiled.
    expect(boxed.subs({ x: -1 } as any).evaluate().toString()).toBe('-1');
  });
});

describe('COMPILE three-valued Or in condition position', () => {
  const ce = realEngine();
  const expr = ['If', ['Or', gt('x'), gt('y')], 1, -1];

  it('takes the then arm when a DECIDED TRUE operand settles it', () => {
    expect(js(ce, expr).run({ x: 1, y: NaN })).toBe(1);
    expect(js(ce, expr).run({ x: NaN, y: 1 })).toBe(1);
  });

  it('answers NaN when one operand is undecided and the other is false', () => {
    expect(js(ce, expr).run({ x: -1, y: NaN })).toBeNaN();
  });

  it('takes the else arm when both operands are decided false', () => {
    expect(js(ce, expr).run({ x: -1, y: -2 })).toBe(-1);
  });

  it('agrees with the interpreter, which holds the same If', () => {
    const boxed = ce.expr(expr as any);
    // True ∨ unknown: decided `True`, so the then arm — as compiled.
    expect(boxed.subs({ x: 1 } as any).evaluate().toString()).toBe('1');
    // False ∨ unknown: held — the compiled lane answers NaN.
    expect(boxed.subs({ x: -1 } as any).evaluate().operator).toBe('If');
  });
});

describe('COMPILE three-valued Not in condition position', () => {
  const ce = realEngine();

  it('leaves an undecided operand undecided', () => {
    const expr = ['If', ['Not', ['And', gt('x'), gt('y')]], 1, -1];
    expect(js(ce, expr).run({ x: 1, y: NaN })).toBeNaN();
    // `Not(And(False, undecided))` is `Not(False)`, so the then arm.
    expect(js(ce, expr).run({ x: -1, y: NaN })).toBe(1);
    expect(js(ce, expr).run({ x: 1, y: 2 })).toBe(-1);
  });

  it('leaves an undecided RELATION undecided', () => {
    const expr = ['If', ['Not', gt('x')], 1, -1];
    expect(js(ce, expr).run({ x: NaN })).toBeNaN();
    expect(js(ce, expr).run({ x: -1 })).toBe(1);
  });

  it('negates a decided operand INSIDE a connective', () => {
    // `And(Not(x > 0), y > 0)`: the `Not` is decided exactly when `x > 0` is,
    // and the negation is applied to that decided value.
    const expr = ['If', ['And', ['Not', gt('x')], gt('y')], 1, -1];
    // `Not(True)` is `False`, which settles the `And` whatever `y` holds.
    expect(js(ce, expr).run({ x: 1, y: NaN })).toBe(-1);
    // `Not(False)` is `True`, which settles nothing.
    expect(js(ce, expr).run({ x: -1, y: NaN })).toBeNaN();
    expect(js(ce, expr).run({ x: -1, y: 2 })).toBe(1);
  });

  it('never negates the undecided value itself', () => {
    // `!undefined` is a confident `true`. The emitted `!` therefore sits in
    // the branch the value has already been found decided in.
    const { code } = js(ce, ['If', ['Not', ['And', gt('x'), gt('y')]], 1, -1]);
    expect(code).toContain('=== undefined ? undefined : !');
  });
});

describe('COMPILE three-valued connectives — nesting', () => {
  const ce = realEngine();
  // `(x > 0 ∧ y > 0) ∨ z > 0`.
  const expr = ['If', ['Or', ['And', gt('x'), gt('y')], gt('z')], 1, -1];

  it('lets a decided TRUE disjunct settle an undecided conjunct', () => {
    expect(js(ce, expr).run({ x: 1, y: NaN, z: 1 })).toBe(1);
  });

  it('stays undecided when neither the conjunct nor the disjunct settles it', () => {
    expect(js(ce, expr).run({ x: 1, y: NaN, z: -1 })).toBeNaN();
  });

  it('lets a decided FALSE conjunct settle the disjunction', () => {
    // `Or(And(False, undecided), False)` is `Or(False, False)` — decided.
    expect(js(ce, expr).run({ x: -1, y: NaN, z: -1 })).toBe(-1);
  });

  it('decides the ordinary points', () => {
    expect(js(ce, expr).run({ x: 1, y: 2, z: -1 })).toBe(1);
    expect(js(ce, expr).run({ x: -1, y: -2, z: -3 })).toBe(-1);
  });

  it('writes every operand exactly once, however deep the nesting', () => {
    const { code } = js(ce, expr);
    for (const operand of ['0 < _.x', '0 < _.y', '0 < _.z'])
      expect(occurrences(code, operand)).toBe(1);
  });

  it('does not reach the disjunct when the conjunction already settles it', () => {
    // A `true` conjunction settles the `Or`, so `z` is never read. The D3
    // entry check reads every free symbol once per call, which would fire the
    // counting getter independently of the emitted code, so it is off here.
    const result = compile(ce.expr(expr as any), {
      fallback: false,
      constantFold: false,
      entryChecks: false,
    });
    let reads = 0;
    const answer = (result.run as (v: Record<string, unknown>) => unknown)({
      x: 1,
      y: 2,
      get z() {
        reads += 1;
        return 5;
      },
    });
    expect(answer).toBe(1);
    expect(reads).toBe(0);
  });
});

describe('COMPILE three-valued connectives — a value-shaped leaf', () => {
  const ce = realEngine();
  ce.declare('b', 'boolean');
  const expr = ['If', ['And', 'b', gt('x')], 1, -1];

  it('answers NaN for an unsupplied boolean', () => {
    // `_.b` reads as `undefined`, which is neither `true` nor `false`.
    expect(js(ce, expr).run({ x: 1 })).toBeNaN();
  });

  it('lets a decided FALSE boolean settle it', () => {
    expect(js(ce, expr).run({ x: NaN, b: false })).toBe(-1);
    expect(js(ce, expr).run({ x: 1, b: false })).toBe(-1);
  });

  it('answers NaN for a true boolean beside an undecided relation', () => {
    expect(js(ce, expr).run({ x: NaN, b: true })).toBeNaN();
  });

  it('decides the ordinary points', () => {
    expect(js(ce, expr).run({ x: 1, b: true })).toBe(1);
    expect(js(ce, expr).run({ x: -1, b: true })).toBe(-1);
  });

  it('tests the boolean for being a boolean, not for truthiness', () => {
    const { code } = js(ce, expr);
    expect(code).toContain(
      '(_.b === true ? true : _.b === false ? false : undefined)'
    );
    // A truthy non-boolean decides nothing.
    expect(js(ce, expr).run({ x: 1, b: 'yes' })).toBeNaN();
    expect(js(ce, expr).run({ x: 1, b: 1 })).toBeNaN();
  });
});

describe('COMPILE three-valued connectives — unsupplied numeric variable', () => {
  const ce = realEngine();

  it('treats a missing variable as undecided, not as false', () => {
    // An absent entry of the vars object reads as `undefined`, and every
    // comparison against it is `false` — which is why the test carries a
    // `!== undefined` conjunct beside the NaN one.
    const expr = ['If', ['And', gt('x'), gt('y')], 1, -1];
    expect(js(ce, expr).run({ y: 2 })).toBeNaN();
    // …and a decided false sibling still settles it.
    expect(js(ce, expr).run({ y: -2 })).toBe(-1);
  });
});

describe('COMPILE three-valued connectives — Which clause chains', () => {
  const ce = realEngine();
  const expr = ['Which', ['And', gt('x'), gt('y')], 1, gt('z'), 2, 'True', -1];

  it('ends the search on an undecided clause', () => {
    // The later clause WOULD have matched; an undecided clause stops the
    // search all the same, with the value a search that matched nothing has.
    expect(js(ce, expr).run({ x: 1, y: NaN, z: 5 })).toBeNaN();
  });

  it('continues past a clause a decided FALSE operand settles', () => {
    expect(js(ce, expr).run({ x: -1, y: NaN, z: 5 })).toBe(2);
    expect(js(ce, expr).run({ x: -1, y: NaN, z: -5 })).toBe(-1);
  });

  it('takes a decided clause', () => {
    expect(js(ce, expr).run({ x: 1, y: 2, z: 5 })).toBe(1);
  });
});

describe('COMPILE three-valued connectives — statement-form If', () => {
  const ce = realEngine();
  // `r := 0; if (x > 0 ∧ y > 0) r := 1; r := r + 10; r`
  const block = [
    'Block',
    ['Declare', 'r', 'real', 0],
    ['If', ['And', gt('x'), gt('y')], ['Assign', 'r', 1]],
    ['Assign', 'r', ['Add', 'r', 10]],
    'r',
  ];

  it('runs neither branch on an undecided condition, and carries on', () => {
    expect(js(ce, block).run({ x: 1, y: NaN })).toBe(10);
  });

  it('runs neither branch when a decided FALSE operand settles it', () => {
    // `And(False, undecided)` is `False`: the branch is skipped for the
    // ordinary reason, and the next statement still runs.
    expect(js(ce, block).run({ x: -1, y: NaN })).toBe(10);
  });

  it('runs the branch on a decided true condition', () => {
    expect(js(ce, block).run({ x: 1, y: 2 })).toBe(11);
  });

  it('binds the three-valued value once and tests it for `true`', () => {
    // The statement form has no value of its own, so it inspects the
    // condition's three-valued value against `true` in a block-scoped
    // constant — the same shape a value-tested condition already used.
    const { code } = js(ce, block);
    expect(code).toContain('const _CND = (');
    expect(code).toContain('if (_CND === true) {');
  });
});

describe('COMPILE three-valued connectives — the guard idiom', () => {
  const ce = realEngine();
  ce.declare('u', 'real');
  ce.declare('Foo', { signature: '(number) -> number', evaluate: ([v]) => v });

  /** `x ≠ 0 ∧ sin(6u/x)² + sin(6u/x) + sin(6u/x) > 0`, in condition position. */
  const guarded = [
    'If',
    [
      'And',
      ['NotEqual', 'x', 0],
      [
        'Greater',
        [
          'Add',
          ['Power', ['Sin', ['Divide', ['Multiply', 6, 'u'], 'x']], 2],
          ['Sin', ['Divide', ['Multiply', 6, 'u'], 'x']],
          ['Sin', ['Divide', ['Multiply', 6, 'u'], 'x']],
        ],
        0,
      ],
    ],
    1,
    -1,
  ];

  it('emits a costly operand once, behind the guard', () => {
    // `entryChecks: false`: the D3 entry check of the runner reads every free
    // symbol once per call, which would fire the counting getter below
    // independently of the emitted code.
    const result = compile(ce.expr(guarded as any), {
      fallback: false,
      entryChecks: false,
    });
    expect(result.success).toBe(true);
    // The comparison embeds the operand once and the decidedness test names it
    // twice more, so it is bound to a parameter the three of them read — and
    // common-subexpression elimination folds the three `sin` calls into one
    // binding INSIDE the guarded position.
    expect(occurrences(result.code, 'Math.sin')).toBe(1);
    expect(result.code).toContain('const _cse');
    expect(result.code.indexOf('_tv1 === false')).toBeLessThan(
      result.code.indexOf('const _cse')
    );

    // At `x = 0` the guarded operand evaluates NOTHING: a getter counts every
    // read of `u`, which only the guarded code performs.
    let reads = 0;
    const run = result.run as (v: Record<string, unknown>) => unknown;
    const vars = (x: number): Record<string, unknown> => ({
      x,
      get u() {
        reads += 1;
        return 0.3;
      },
    });
    expect(run(vars(0))).toBe(-1);
    expect(reads).toBe(0);
    // Past the guard it runs, once.
    reads = 0;
    expect(run(vars(1))).toBe(1);
    expect(reads).toBe(1);
    // An UNDECIDED guard must still reach it: `And(undecided, false)` is
    // `false`, so the second operand cannot be skipped.
    reads = 0;
    expect(run(vars(NaN))).toBeNaN();
    expect(reads).toBe(1);
  });

  it('calls a registered function only when the guard lets it through', () => {
    // A `functions` option entry is STRINGIFIED into the compiled kernel, so
    // it cannot close over a test-local variable; the counter is a global the
    // stringified source can still reach.
    const counter = globalThis as unknown as { __threeValuedFooCalls: number };
    const expr = [
      'If',
      ['And', ['NotEqual', 'x', 0], ['Greater', ['Foo', 'x'], 0]],
      1,
      -1,
    ];
    const result = compile(ce.expr(expr as any), {
      fallback: false,
      constantFold: false,
      entryChecks: false,
      functions: {
        Foo: (v: unknown) => {
          (globalThis as unknown as { __threeValuedFooCalls: number })
            .__threeValuedFooCalls++;
          return v as number;
        },
      },
    });
    expect(result.success).toBe(true);
    const run = result.run as (v: Record<string, unknown>) => unknown;
    for (const [vars, value, calls] of [
      // The guard is decided FALSE: the call must not happen at all.
      [{ x: 0 }, -1, 0],
      // The guard is decided true, or undecided: the call happens once.
      [{ x: 2 }, 1, 1],
      [{ x: -2 }, -1, 1],
      [{ x: NaN }, NaN, 1],
    ] as Array<[Record<string, unknown>, number, number]>) {
      counter.__threeValuedFooCalls = 0;
      const answer = run(vars);
      if (Number.isNaN(value)) expect(answer).toBeNaN();
      else expect(answer).toBe(value);
      expect(counter.__threeValuedFooCalls).toBe(calls);
    }
  });
});

describe('COMPILE three-valued connectives — no new code on the common path', () => {
  const ce = new ComputeEngine();
  ce.declare('s', 'string');
  ce.declare('t', 'string');

  it('leaves a connective every leaf of which is decided by construction alone', () => {
    // A string comparison has no undecided value to guard against — no
    // operand of it can be NaN or missing — so the analysis reports "decided
    // by construction" and the plain conditional expression is emitted.
    const and = js(ce, ['If', ['And', ['Less', 's', 't'], ['Less', 't', 's']], 1, -1]);
    expect(and.code).toBe(
      '(((_SYS.ct(_.s) < _SYS.ct(_.t)) && (_SYS.ct(_.t) < _SYS.ct(_.s))) ? (1) : (-1))'
    );
    const or = js(ce, ['If', ['Or', ['Less', 's', 't'], ['Less', 't', 's']], 1, -1]);
    expect(or.code).toBe(
      '(((_SYS.ct(_.s) < _SYS.ct(_.t)) || (_SYS.ct(_.t) < _SYS.ct(_.s))) ? (1) : (-1))'
    );
  });
});

describe('COMPILE three-valued connectives — Python target', () => {
  const ce = realEngine();
  ce.declare('b', 'boolean');
  const python = new PythonTarget();
  const code = (mathJson: unknown): string =>
    python.compile(ce.expr(mathJson as any)).code;

  /** The Python selection around a three-valued value, with the given arms. */
  const selection = (then: string, otherwise: string): string =>
    `(lambda _CND: ((${then}) if (isinstance(_CND, (bool, np.bool_)) and _CND) ` +
    `else ((${otherwise}) if isinstance(_CND, (bool, np.bool_)) ` +
    "else float('nan'))))";

  it('spells the And table with lambdas, None and float NaN', () => {
    expect(code(['If', ['And', gt('x'), gt('y')], 1, -1])).toBe(
      selection('1', '-1') +
        '((lambda _tv1: (False if _tv1 is not None and not _tv1 else ' +
        '(lambda _tv2: (_tv2 if _tv1 is not None and _tv1 else ' +
        '(False if _tv2 is not None and not _tv2 else None)))' +
        '(((0 < y) if y == y else None))))(((0 < x) if x == x else None)))'
    );
  });

  it('mirrors the Or table', () => {
    expect(code(['If', ['Or', gt('x'), gt('y')], 1, -1])).toBe(
      selection('1', '-1') +
        '((lambda _tv1: (True if _tv1 is not None and _tv1 else ' +
        '(lambda _tv2: (_tv2 if _tv1 is not None and not _tv1 else ' +
        '(True if _tv2 is not None and _tv2 else None)))' +
        '(((0 < y) if y == y else None))))(((0 < x) if x == x else None)))'
    );
  });

  it('negates only a decided value, never None', () => {
    const source = code(['If', ['Not', ['And', gt('x'), gt('y')]], 1, -1]);
    expect(source).toContain(
      '(lambda _tv3: (None if _tv3 is None else not _tv3))'
    );
    expect(source).not.toContain('logical_not');
  });

  it('tests a value-shaped leaf with isinstance', () => {
    const source = code(['If', ['And', 'b', gt('x')], 1, -1]);
    expect(source).toContain('((b) if isinstance(b, (bool, np.bool_)) else None)');
  });

  it('keeps the second operand inside a lambda that may not be entered', () => {
    // The guard idiom: `1 / x` sits in the argument of a `lambda` reached only
    // when `x != 0` has not already answered `False`.
    const source = code([
      'If',
      ['And', ['NotEqual', 'x', 0], ['Greater', ['Divide', 1, 'x'], 1]],
      1,
      -1,
    ]);
    expect(source).toContain(
      '(lambda _tv2: ((1 < _tv2) if _tv2 == _tv2 else None))(1 / x)'
    );
    expect(source.indexOf('_tv1 is not None and not _tv1')).toBeLessThan(
      source.indexOf('(1 / x)')
    );
  });
});

/**
 * Execution parity for the Python emissions above, run through the repo's
 * `./venv/bin/python3` the way `compile-python-parity.test.ts` does. Skipped
 * when that venv (with numpy) is not present, so a checkout without the
 * benchmark environment is never blocked.
 */
const VENV_PYTHON = path.join(process.cwd(), 'venv', 'bin', 'python3');
function venvHasNumpy(): boolean {
  try {
    if (!fs.existsSync(VENV_PYTHON)) return false;
    execFileSync(VENV_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const describePython = venvHasNumpy() ? describe : describe.skip;

describePython('COMPILE three-valued connectives — Python execution', () => {
  const ce = realEngine();
  const python = new PythonTarget();

  /** Run one emitted Python expression with `x`, `y` bound, and report it. */
  function runPython(source: string, vars: Record<string, number>): string {
    const bindings = Object.entries(vars)
      .map(
        ([name, value]) =>
          `${name} = ${Number.isNaN(value) ? "float('nan')" : value}`
      )
      .join('\n');
    const script = `import numpy as np\n${bindings}\nprint(repr(${source}))\n`;
    return execFileSync(VENV_PYTHON, ['-c', script], {
      encoding: 'utf-8',
    }).trim();
  }

  it('matches the JavaScript answers for And', () => {
    const source = python.compile(
      ce.expr(['If', ['And', gt('x'), gt('y')], 1, -1] as any)
    ).code;
    expect(runPython(source, { x: 1, y: NaN })).toBe('nan');
    expect(runPython(source, { x: -1, y: NaN })).toBe('-1');
    expect(runPython(source, { x: 1, y: 2 })).toBe('1');
  });

  it('matches the JavaScript answers for Or', () => {
    const source = python.compile(
      ce.expr(['If', ['Or', gt('x'), gt('y')], 1, -1] as any)
    ).code;
    expect(runPython(source, { x: 1, y: NaN })).toBe('1');
    expect(runPython(source, { x: -1, y: NaN })).toBe('nan');
    expect(runPython(source, { x: -1, y: -2 })).toBe('-1');
  });

  it('runs the guard idiom at zero without raising', () => {
    // `1 / 0` and `1 / 0.0` both raise in Python (ZeroDivisionError), so the
    // guard has to keep short-circuiting: at `x = 0` the first conjunct is
    // decided `False` and the division must never be evaluated. An eagerly
    // bound operand would abort the call instead of answering the else arm.
    const source = python.compile(
      ce.expr([
        'If',
        ['And', ['NotEqual', 'x', 0], ['Greater', ['Divide', 1, 'x'], 1]],
        1,
        -1,
      ] as any)
    ).code;
    expect(runPython(source, { x: 0 })).toBe('-1');
    expect(runPython(source, { x: 0.5 })).toBe('1');
    expect(runPython(source, { x: 4 })).toBe('-1');
    expect(runPython(source, { x: NaN })).toBe('nan');
  });
});

describe('COMPILE three-valued connectives — GPU and interval targets untouched', () => {
  const ce = realEngine();
  const glsl = new GLSLTarget();
  const wgsl = new WGSLTarget();
  const cond = ['And', gt('x'), ['Less', 'y', 1]];

  it('keeps the GLSL JavaScript-style selection', () => {
    // The shader targets are RULED to keep truthiness selection: NaN
    // propagation is not guaranteed on every driver, so a NaN-valued
    // no-branch answer cannot be relied on there (ROADMAP, "Open items from
    // the undecided-condition ruling"). Their `If`/`Which` entries are
    // consulted before this analysis, and their emissions are unchanged.
    expect(glsl.compile(ce.expr(['If', cond, 1, -1] as any)).code).toBe(
      '((0.0 < x && y < 1.0) ? (1.0) : (-1.0))'
    );
    expect(glsl.compile(ce.expr(['Which', cond, 1, 'True', -1] as any)).code).toBe(
      '((0.0 < x && y < 1.0) ? (1.0) : ((-1.0)))'
    );
  });

  it('keeps the WGSL select()', () => {
    expect(wgsl.compile(ce.expr(['If', cond, 1, -1] as any)).code).toBe(
      'select(-1.0, 1.0, 0.0 < x && y < 1.0)'
    );
    expect(wgsl.compile(ce.expr(['Which', cond, 1, 'True', -1] as any)).code).toBe(
      'select((-1.0), 1.0, 0.0 < x && y < 1.0)'
    );
  });
});
