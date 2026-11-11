import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TEST_PYTHON } from './test-python';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

/**
 * Three-valued (Kleene) lowering of `And`/`Or`/`Not` in compiled code.
 *
 * The interpreter is two-valued (user decision of 2026-11-02,
 * `docs/ERROR-MODEL.md`): a comparison with an absent operand is `False`, a
 * connective reads an absent operand as `False`, and a branch over it takes
 * its arm. The compiled JavaScript and Python targets still emit a
 * three-valued lowering when an operand of a connective may be absent: a
 * compiled `If`/`Which` then takes no arm and answers NaN, and a connective in
 * value position answers `undefined`. The compiled value computed from an
 * absent value is not specified (`docs/COMPILATION-MODEL.md`, "Caveats of
 * compiled code"), so this difference is allowed. The lowering is to be
 * removed in step 4 of `docs/plans/2026-11-02-compiler-contraction-plan.md`.
 *
 * The Kleene tables the emitted test implements:
 *
 *   `And` is decided when one operand is decided FALSE (that operand settles
 *   the result whatever its siblings hold) or when every operand is decided.
 *   `Or` is the mirror image, with a decided TRUE operand settling it.
 *   `Not` is decided exactly when its operand is.
 *
 * A declared type cannot name `missing` (`Missing` is a result only, user
 * decision of 2026-11-02), so an absent operand comes from a producer: here
 * an out-of-range read `At(B, 1)` of a symbol declared `list<boolean>`, given
 * an empty list. The tests compare the compiled value with the interpreter's
 * only where no operand is absent.
 *
 * A NaN operand is a present value: it decides an ordered comparison `false`
 * (user decision of 2026-10-20) and `NotEqual` `true` (user decision of
 * 2026-10-23). The cases that check this read symbols declared `real`
 * (`realEngine`).
 *
 * A condition every leaf of which is decided by construction keeps the plain
 * conditional expression it always had — pinned below, because the common
 * path must gain no code.
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

describe('COMPILE three-valued connectives — a declared absent input', () => {
  it('rejects a declared type that names missing', () => {
    // `Missing` is a result only: an input cannot be declared absent.
    const engine = new ComputeEngine();
    expect(() => engine.declare('x', 'real | missing')).toThrow(
      /cannot be declared/
    );
  });
});

describe('COMPILE connectives in condition position — a NaN operand', () => {
  const ce = realEngine();

  it('And takes the else arm when an operand is NaN (decided false)', () => {
    const expr = ['If', ['And', gt('x'), gt('y')], 1, -1];
    expect(js(ce, expr).run({ x: 1, y: NaN })).toBe(-1);
    expect(js(ce, expr).run({ x: NaN, y: 1 })).toBe(-1);
  });

  it('Or takes the else arm when its other operand is false', () => {
    const expr = ['If', ['Or', gt('x'), gt('y')], 1, -1];
    expect(js(ce, expr).run({ x: -1, y: NaN })).toBe(-1);
  });

  it('Not of a relation with a NaN operand is true', () => {
    // `NaN > 0` is decided false, so its negation is true.
    expect(js(ce, ['If', ['Not', gt('x')], 1, -1]).run({ x: NaN })).toBe(1);
  });

  it('Which continues past a clause that a NaN operand decides false', () => {
    const expr = ['Which', ['And', gt('x'), gt('y')], 1, gt('z'), 2, 'True', -1];
    expect(js(ce, expr).run({ x: 1, y: NaN, z: 5 })).toBe(2);
  });
});

describe('COMPILE three-valued connectives — an absent boolean read', () => {
  const ce = realEngine();
  ce.declare('B', 'list<boolean>');
  // `At(B, 1)` is absent when `B` is the empty list.
  const expr = ['If', ['And', ['At', 'B', 1], gt('x')], 1, -1];

  /** The interpreter's value of `json` with `B` and `x` bound. */
  const interpreted = (json: unknown, b: boolean[], x: number): unknown =>
    ce
      .expr(json as any)
      .subs({
        B: ce.expr(['List', ...b.map((v) => (v ? 'True' : 'False'))]),
        x,
      } as any)
      .evaluate().re;

  it('decides the present points as the interpreter does', () => {
    for (const [b, x] of [
      [[true], 1],
      [[true], -1],
      [[false], 1],
      [[false], -1],
    ] as Array<[boolean[], number]>)
      expect(js(ce, expr).run({ B: b, x })).toBe(interpreted(expr, b, x));
  });

  it('lets a decided FALSE relation settle it', () => {
    expect(js(ce, expr).run({ B: [], x: -1 })).toBe(-1);
    expect(interpreted(expr, [], -1)).toBe(-1);
  });

  it('reads a symbol declared boolean by its truthiness', () => {
    const real = realEngine();
    real.declare('b', 'boolean');
    const plain = ['If', ['And', 'b', gt('x')], 1, -1];
    const { code, run } = js(real, plain);
    expect(code).not.toContain('_.b === true');
    expect(run({ x: 1, b: true })).toBe(1);
    expect(run({ x: 1, b: false })).toBe(-1);
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
    // The comparison embeds the operand once, and common-subexpression
    // elimination folds the three `sin` calls into one binding INSIDE the
    // guarded position.
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
    // An UNDECIDED guard (`NaN ≠ 0`) must still reach it: `And(undecided,
    // false)` is `false`, so the second operand cannot be skipped. At
    // `x = NaN` the second operand is `0 < NaN`, decided false, so the `And`
    // is false.
    reads = 0;
    expect(run(vars(NaN))).toBe(-1);
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
      // `NaN ≠ 0` is undecided, so the call happens, and `Foo(NaN) > 0` is
      // decided false (user decision 2026-10-20), which settles the `And`.
      [{ x: NaN }, -1, 1],
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

  it('keeps the plain conditional expression for string inputs', () => {
    // A string comparison has no NaN value, and the host supplies every
    // input, so the connective needs no test.
    const and = js(ce, ['If', ['And', ['Less', 's', 't'], ['Less', 't', 's']], 1, -1]);
    expect(and.code).not.toContain('undefined');
    expect(and.run!({ s: 'a', t: 'b' })).toBe(-1);
    const or = js(ce, ['If', ['Or', ['Less', 's', 't'], ['Less', 't', 's']], 1, -1]);
    expect(or.code).not.toContain('undefined');
    expect(or.run!({ s: 'a', t: 'b' })).toBe(1);
    expect(or.run!({ s: 'a', t: 'a' })).toBe(-1);
  });
});

describe('COMPILE connectives — Python target', () => {
  const ce = realEngine();
  const python = new PythonTarget();
  const code = (mathJson: unknown): string =>
    python.compile(ce.expr(mathJson as any)).code;

  it('keeps the plain conditional when every leaf is an ordered comparison', () => {
    // A NaN operand decides `x > 0` false (user decision 2026-10-20), and
    // Python has no unsupplied variable, so the condition is decided by
    // construction.
    expect(code(['If', ['And', gt('x'), gt('y')], 1, -1])).toBe(
      '((1) if (0 < x and 0 < y) else (-1))'
    );
  });

  it('keeps the plain and over a real symbol', () => {
    // Over a `real` symbol `NaN ≠ 0` is decided (`True`, user decision
    // 2026-10-23), so the condition keeps the plain `and`, which
    // short-circuits.
    expect(
      code([
        'If',
        ['And', ['NotEqual', 'x', 0], ['Greater', ['Divide', 1, 'x'], 1]],
        1,
        -1,
      ])
    ).toBe('((1) if (((x) != (0)) and 1 < 1 / x) else (-1))');
  });
});

/**
 * Execution parity for the Python emissions above, run through the repo's
 * `./venv/bin/python3` the way `compile-python-parity.test.ts` does. Skipped
 * when that venv (with numpy) is not present, so a checkout without the
 * benchmark environment is never blocked.
 */
const VENV_PYTHON =
  TEST_PYTHON ?? '';
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

  // `NotEqual(name, 0)`.
  const ne = (name: string): unknown[] => ['NotEqual', name, 0];

  it('decides a NotEqual with a NaN operand true', () => {
    const source = python.compile(
      ce.expr(['If', ['And', ne('x'), ne('y')], 1, -1] as any)
    ).code;
    expect(runPython(source, { x: 1, y: NaN })).toBe('1');
    expect(runPython(source, { x: 0, y: NaN })).toBe('-1');
  });

  it('decides an ordered comparison with a NaN operand false', () => {
    const source = python.compile(
      ce.expr(['If', ['And', gt('x'), gt('y')], 1, -1] as any)
    ).code;
    expect(runPython(source, { x: 1, y: NaN })).toBe('-1');
    expect(runPython(source, { x: 1, y: 2 })).toBe('1');
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
    // `NaN ≠ 0` is `True` (user decision 2026-10-23), so the second conjunct
    // is reached, and `1 < 1/NaN` is decided false (user decision 2026-10-20):
    // `And` is false.
    expect(runPython(source, { x: NaN })).toBe('-1');
  });
});

describe('COMPILE three-valued connectives — GPU and interval targets untouched', () => {
  const ce = realEngine();
  const glsl = new GLSLTarget();
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
});

/**
 * `And`/`Or`/`Not` used as a VALUE, not as a branch condition. With an
 * operand that may be absent at run time (`undefined` in JavaScript), the
 * plain `&&`/`||`/`!` would decide by truthiness and return an operand; the
 * compiled code follows the Kleene tables instead. The absent operand is an
 * out-of-range read `At(BM, 1)` of a `list<boolean>` given an empty list.
 * Each answer over present operands is compared with the interpreter.
 */
describe('COMPILE three-valued connectives — value position', () => {
  const ce = new ComputeEngine();
  ce.declare('BM', 'list<boolean>');
  ce.declare('BN', 'list<boolean>');
  ce.declare('p', 'boolean');
  ce.declare('q', 'boolean');
  // Boxing declares nothing: an input compared with a number is declared
  ce.declare('x', 'real');
  const M = ['At', 'BM', 1];
  const N = ['At', 'BN', 1];

  /** A run-time value of a read; `undefined` makes the read absent. */
  const values: Array<boolean | undefined> = [true, false, undefined];
  /** The list that holds `v` at index 1, or the empty list. */
  const cell = (v: boolean | undefined): boolean[] =>
    v === undefined ? [] : [v];
  /** The interpreter's answer as the JavaScript value that spells it. */
  const interpreted = (
    json: unknown,
    m: boolean | undefined,
    n: boolean | undefined,
    x?: number
  ) => {
    const list = (v: boolean | undefined) =>
      ce.expr(['List', ...cell(v).map((b) => (b ? 'True' : 'False'))]);
    const s: Record<string, any> = { BM: list(m), BN: list(n) };
    if (x !== undefined) s.x = x;
    const r = ce
      .expr(json as any)
      .subs(s)
      .evaluate().symbol;
    return r === 'True' ? true : r === 'False' ? false : r;
  };

  const pairs = values.flatMap((a) => values.map((b) => [a, b] as const));

  // The interpreter is two-valued: its answer is always a boolean. The
  // compiled value is compared with it only where no operand is absent (see
  // the header).
  for (const head of ['And', 'Or']) {
    test.each(pairs)(`${head}(%s, %s) matches the interpreter`, (a, b) => {
      const json = [head, M, N];
      const expected = interpreted(json, a, b);
      expect(typeof expected).toBe('boolean');
      if (a !== undefined && b !== undefined)
        expect(js(ce, json).run({ BM: cell(a), BN: cell(b) })).toBe(expected);
    });
  }

  test.each(values)('Not(%s) matches the interpreter', (a) => {
    const json = ['Not', M];
    const expected = interpreted(json, a, true);
    expect(typeof expected).toBe('boolean');
    if (a !== undefined) expect(js(ce, json).run({ BM: cell(a) })).toBe(expected);
  });

  it('does not evaluate an operand after a settling one', () => {
    // The second operand follows `&&`, so it is evaluated only when the
    // first operand is not `false`. (The run-time wrapper reads every entry
    // of `vars` up front, so the order is checked on the code.)
    const json = ['And', M, ['Greater', ['Divide', 1, 'x'], 1]];
    const { code, run } = js(ce, json);
    expect(code.indexOf('&&')).toBeLessThan(code.indexOf('1 / _.x'));
    for (const [m, x] of [
      [false, 0.5],
      [true, 0.5],
      [true, 2],
    ] as Array<[boolean, number]>)
      expect(run({ BM: [m], x })).toBe(interpreted(json, m, true, x));
  });

  it('keeps the plain infix spelling when every operand is a decided boolean', () => {
    // A comparison over a parameter compiles to a JavaScript comparison,
    // which is always `true` or `false`: a parameter is not read off the
    // vars object, so it is not an unsupplied variable.
    expect(
      js(ce, ['Function', ['And', ['Greater', 't', 0], ['Less', 't', 1]], 't'])
        .code
    ).toBe('(t) => 0 < t && t < 1');
    expect(
      js(ce, [
        'Function',
        ['Or', ['Greater', 't', 0], ['Not', ['Less', 't', 1]]],
        't',
      ]).code
    ).toBe('(t) => 0 < t || !(t < 1)');
  });

  it('a comparison over a variable is the plain comparison', () => {
    // The host supplies every input, so the comparison has no test for an
    // input left out.
    const and = js(ce, ['And', ['Greater', 'x', 0], ['Less', 'x', 1]]);
    expect(and.code).toBe('0 < _.x && _.x < 1');
    expect(and.run({ x: 0.5 })).toBe(true);
    expect(and.run({ x: 2 })).toBe(false);
  });

  it('a symbol declared boolean keeps the plain infix spelling', () => {
    // The host supplies every input with a value of its declared type, so
    // a `boolean` symbol is `true` or `false`.
    const and = js(ce, ['And', 'p', 'q']);
    expect(and.code).toBe('_.p && _.q');
    expect(and.run({ p: true, q: false })).toBe(false);
    expect(and.run({ p: true, q: true })).toBe(true);
    const not = js(ce, ['Not', 'p']);
    expect(not.run({ p: false })).toBe(true);
    expect(not.run({ p: true })).toBe(false);
  });

  it('keeps the plain Python and when every operand is a decided boolean', () => {
    const python = new PythonTarget();
    expect(python.compile(ce.expr(['And', 'p', 'q'] as any)).code).toBe(
      'p and q'
    );
  });
});
