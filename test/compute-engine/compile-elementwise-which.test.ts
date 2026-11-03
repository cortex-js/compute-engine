/**
 * COMPILED element-wise `Which`/`If` selection (`_SYS.select`).
 *
 * The interpreter side landed 2026-07-27 (ratified spec:
 * `docs/BROADCAST-MODEL.md`, R1–R4); this is the
 * JavaScript compile target's lowering of the same semantics. Tycho compiles
 * its drawing paths, so a piecewise-over-lists in a plotted expression hits
 * the compile path, which used to fail closed on a non-scalar condition.
 *
 * The spine of every case is INTERPRETER PARITY: the compiled value must equal
 * the interpreted one, projected the way a real target represents it (an error
 * cell — the `Missing`-condition cell of R4′ — is NaN, as is the no-match cell
 * of R4 and the `incompatible-dimensions` result of R3).
 *
 * `Which`/`If` are `lazy` heads, so the box and parse routes deliver operands
 * unbound; both are probed alongside the pre-boxed route.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

const ce = new ComputeEngine();
ce.declare('x', 'real');

/** Interpretation, projected the way a real (JavaScript) target represents it. */
function interpreted(expr: Expression): unknown {
  const project = (x: Expression): unknown => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    if (x.symbol === 'Nothing' || x.symbol === 'Missing') return NaN;
    if (x.operator === 'Error') return NaN;
    if (x.operator === 'List') return (x.ops ?? []).map(project);
    return x.re;
  };
  return project(expr.N());
}

/** Compile `expr`, run it, and assert it matches interpretation. */
function parity(expr: Expression, vars?: object): unknown {
  const r = compile(expr, { fallback: false });
  expect(r?.success).toBe(true);
  const value = r!.run!(vars ?? {});
  expect(value).toEqual(interpreted(expr));
  return value;
}

/** Assert that `expr` is a static error of the selection rule of
 * 2026-11-02, so that the compilation declines. */
function declines(expr: Expression): void {
  expect(expr.isValid).toBe(false);
  expect(() => compile(expr, { fallback: false })).toThrow(
    /invalid expression/
  );
}

/**
 * The emitted source, with compile-time constant folding turned off.
 *
 * Most cases here are hand-checked tables of literal conditions and arms, so
 * the whole `Which` is a constant subtree that the compiler would otherwise
 * evaluate and emit as a literal list — the assertions below are about the
 * `_SYS.select` LOWERING, which folding short-circuits. `parity()` keeps
 * folding on, so the folded value is still checked against the interpreter.
 */
function code(expr: Expression): string {
  return compile(expr, { fallback: false, constantFold: false })!.code ?? '';
}

describe('element-wise selection: the small hand-checked tables', () => {
  test('a boolean-list condition with a default clause (R1)', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False', 'True'],
      1,
      'True',
      0,
    ] as any);
    expect(code(expr)).toContain('_SYS.select');
    expect(parity(expr)).toEqual([1, 0, 1]);
  });

  test('a LIST-valued arm is indexed at the selected position (R1)', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False', 'True'],
      ['List', 10, 20, 30],
      'True',
      0,
    ] as any);
    expect(parity(expr)).toEqual([10, 0, 30]);
  });

  test('a SCALAR condition lifts to every position (R1)', () => {
    // The first clause is scalar `False` and captures nothing; the list
    // condition drives the shape.
    const expr = ce.box([
      'Which',
      'False',
      99,
      ['List', 'True', 'False'],
      1,
      'True',
      0,
    ] as any);
    expect(parity(expr)).toEqual([1, 0]);
  });

  test('first-match precedence across three clauses (R1)', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False', 'False'],
      1,
      ['List', 'True', 'True', 'False'],
      2,
      'True',
      3,
    ] as any);
    expect(parity(expr)).toEqual([1, 2, 3]);
  });

  test('every condition scalar: the arm is returned WHOLE, not indexed', () => {
    // A list-valued ARM alone does not activate element-wise selection: the
    // conditions decide, and a scalar `Which` answers the arm as a value.
    const expr = ce.box([
      'Which',
      ['Greater', 3, 2],
      ['List', 1, 2],
      'True',
      0,
    ] as any);
    expect(code(expr)).not.toContain('_SYS.select');
    expect(parity(expr)).toEqual([1, 2]);
  });
});

describe('element-wise selection: absence and no-match (R4/R4′)', () => {
  test('no default clause: an unmatched position is NaN (R4)', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False', 'False'],
      1,
    ] as any);
    expect(parity(expr)).toEqual([1, NaN, NaN]);
  });

  test('all-False conditions: every position is NaN', () => {
    const expr = ce.box(['Which', ['List', 'False', 'False'], 1] as any);
    expect(parity(expr)).toEqual([NaN, NaN]);
  });

  test('a `Missing` condition cell is the absent cell, and CONSUMES the position (R4′)', () => {
    // The interpreter answers a positioned "condition is absent" ERROR cell
    // there — NaN on a real target — and the position is never offered to the
    // later default clause (position 2 takes the default `0`, position 1 does
    // not).
    const expr = ce.box([
      'Which',
      ['List', 'True', 'Missing', 'False'],
      1,
      'True',
      0,
    ] as any);
    // Selection rule of 2026-11-02: a list condition with a `Missing` cell
    // is a static error (it was `[1, NaN, 0]` on both lanes).
    declines(expr);
  });

  test('a LIFTED (scalar) absent condition ends the walk', () => {
    // The interpreter answers a whole-expression "condition is absent" error
    // — NaN on a real target — and never falls through to the later clause.
    const expr = ce.box([
      'Which',
      'Missing',
      1,
      ['List', 'True', 'False'],
      2,
    ] as any);
    expect(expr.evaluate().operator).toBe('Error');
    expect(parity(expr)).toEqual(NaN);
  });

  test('an empty-list condition answers the empty list', () => {
    const expr = ce.box(['Which', ['List'], 1, 'True', 0] as any);
    expect(parity(expr)).toEqual([]);
  });

  test('a NON-boolean condition cell fails closed', () => {
    // `Which([10, 20], …)`: not a condition value in any cell, and the
    // literal's type says so, so the condition is an `incompatible-type`
    // error operand at boxing (provably non-boolean condition ruling): the
    // invalid expression never compiles, and the interpreter answers the
    // condition's error. The shared requirement stands: NEITHER lane
    // answers 0.
    const expr = ce.box(['Which', ['List', 10, 20], 1, 'True', 0] as any);
    expect(expr.errors).toHaveLength(1);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /invalid expression/
    );
    expect(expr.evaluate().operator).toBe('Error');
    // A condition declared as a bare `list` does not settle a flat list of
    // booleans, so it is a static error too (selection rule of 2026-11-02;
    // it compiled, and the compiled code threw at run time).
    ce.declare('runtimeCells', 'list');
    declines(ce.box(['Which', 'runtimeCells', 1, 'True', 0] as any));
  });
});

describe('element-wise selection: length policy (R3)', () => {
  test('condition/condition mismatch projects to NaN', () => {
    const expr = ce.box([
      'Which',
      ['List', 'False', 'False'],
      1,
      ['List', 'True', 'True', 'True'],
      2,
    ] as any);
    // The lengths are known statically and differ: a static error
    // (selection rule of 2026-11-02; both lanes gave NaN).
    declines(expr);
  });

  test('condition/arm mismatch projects to NaN', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False', 'True'],
      ['List', 7, 8],
    ] as any);
    // The lengths are known statically and differ: a static error
    // (selection rule of 2026-11-02; both lanes gave NaN).
    declines(expr);
  });

  test('arm/arm mismatch projects to NaN', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False', 'True'],
      ['List', 1, 2, 3],
      'True',
      ['List', 9, 9],
    ] as any);
    // The lengths are known statically and differ: a static error
    // (selection rule of 2026-11-02; both lanes gave NaN).
    declines(expr);
  });
});

describe('element-wise selection: the `If` forms', () => {
  test('If(cond, then, else) is the two-clause Which', () => {
    const expr = ce.box(['If', ['List', 'True', 'False'], 1, 0] as any);
    expect(code(expr)).toContain('_SYS.select');
    expect(parity(expr)).toEqual([1, 0]);
  });

  test('If with a list-valued branch indexes it', () => {
    const expr = ce.box([
      'If',
      ['List', 'True', 'False', 'True'],
      ['List', 10, 20, 30],
      0,
    ] as any);
    expect(parity(expr)).toEqual([10, 0, 30]);
  });

  test('If over a `Missing` cell keeps the position (R4′)', () => {
    const expr = ce.box([
      'If',
      ['List', 'True', 'Missing', 'False'],
      1,
      0,
    ] as any);
    // A `Missing` cell is a static error (selection rule of 2026-11-02;
    // both lanes gave `[1, NaN, 0]`).
    declines(expr);
  });

  test('If length mismatch projects to NaN', () => {
    const expr = ce.box([
      'If',
      ['List', 'True', 'False', 'True'],
      ['List', 1, 2],
      0,
    ] as any);
    // The lengths are known statically and differ: a static error
    // (selection rule of 2026-11-02; both lanes gave NaN).
    declines(expr);
  });
});

describe('element-wise selection: route parity', () => {
  // `Which`/`If` are lazy heads: held operands arrive UNBOUND on the box and
  // parse routes (the standing failure class — cf. `find-fit.test.ts`).
  const expected = [1, 0, 1];

  test('the box route', () => {
    expect(
      parity(
        ce.box(['Which', ['List', 'True', 'False', 'True'], 1, 'True', 0] as any)
      )
    ).toEqual(expected);
  });

  test('the parse route', () => {
    // A LaTeX piecewise over a list-valued comparison.
    const expr = ce.parse(
      '\\begin{cases} 1 & [1,2,3] > 2 \\\\ 0 & \\text{otherwise}\\end{cases}'
    );
    expect(code(expr)).toContain('_SYS.select');
    expect(parity(expr)).toEqual([0, 0, 1]);
  });

  test('the pre-boxed function route', () => {
    expect(
      parity(
        ce.function('Which', [
          ce.box(['List', 'True', 'False', 'True'] as any),
          ce.box(1),
          ce.True,
          ce.box(0),
        ])
      )
    ).toEqual(expected);
  });
});

describe('element-wise selection: arm evaluation (R2)', () => {
  // A custom compiled function is the only side effect a compiled artifact
  // can carry, so it is what "the arm ran" is observed with. It is emitted
  // into the artifact as SOURCE, so its counter has to be reachable by name
  // from the generated code — hence the global rather than a closure.
  function withTicker(): {
    engine: ComputeEngine;
    calls: () => number;
    options: object;
  } {
    const engine = new ComputeEngine();
    engine.declare('Tick', { signature: '(number) -> number' });
    (globalThis as any).__armTicks = 0;
    return {
      engine,
      calls: () => (globalThis as any).__armTicks as number,
      options: {
        fallback: false,
        functions: {
          Tick: (x: number) => {
            (globalThis as any).__armTicks += 1;
            return x;
          },
        },
      },
    };
  }

  test('an UNSELECTED arm is never evaluated', () => {
    const { engine, calls, options } = withTicker();
    const expr = engine.box([
      'Which',
      ['List', 'False', 'False'],
      ['Tick', 7],
      'True',
      0,
    ] as any);
    const r = compile(expr, options as any)!;
    expect(r.success).toBe(true);
    expect(r.run!()).toEqual([0, 0]);
    expect(calls()).toBe(0);
  });

  test('a selected arm is evaluated ONCE, whole, however many positions took it', () => {
    const { engine, calls, options } = withTicker();
    const expr = engine.box([
      'Which',
      ['List', 'True', 'True', 'True'],
      ['Tick', 7],
      'True',
      0,
    ] as any);
    const r = compile(expr, options as any)!;
    expect(r.success).toBe(true);
    expect(r.run!()).toEqual([7, 7, 7]);
    expect(calls()).toBe(1);
  });

  test('a clause after a lifted `True` never evaluates its arm', () => {
    const { engine, calls, options } = withTicker();
    const expr = engine.box([
      'Which',
      ['List', 'True', 'False'],
      1,
      'True',
      0,
      ['Equal', ['List', 1, 2], 2],
      ['Tick', 7],
    ] as any);
    const r = compile(expr, options as any)!;
    expect(r.success).toBe(true);
    expect(r.run!()).toEqual([1, 0]);
    expect(calls()).toBe(0);
  });
});

describe('element-wise selection: the Game-of-Life witness (Tycho item 102)', () => {
  test('a 3-clause selection over a 900-cell board agrees with interpretation', () => {
    const engine = new ComputeEngine();
    // A deterministic pseudo-random board and neighbour count.
    const cells = 900;
    const board: number[] = [];
    const counts: number[] = [];
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < cells; i++) {
      board.push(next() < 0.4 ? 1 : 0);
      counts.push(Math.floor(next() * 9));
    }
    const S = engine.box(['List', ...board] as any);
    const n = engine.box(['List', ...counts] as any);
    // `S → {n=3: 1, n=2: S, 0}`
    const expr = engine.box([
      'Which',
      ['Equal', n, 3],
      1,
      ['Equal', n, 2],
      S,
      'True',
      0,
    ] as any);
    const r = compile(expr, { fallback: false })!;
    expect(r.success).toBe(true);
    const value = r.run!() as number[];
    const expected = counts.map((c, i) => (c === 3 ? 1 : c === 2 ? board[i] : 0));
    expect(value).toEqual(expected);
    expect(value).toEqual(interpreted(expr));
  });
});

describe('element-wise selection: what stays unchanged', () => {
  // A scalar condition still compiles to a ternary CHAIN, never to
  // `_SYS.select` — that is what these two cases exist to pin. A NaN `x`
  // decides `x > 2` false (user decision 2026-10-20), and the host supplies
  // every input, so the chain has no operand test.
  test('an all-scalar `Which` compiles to a ternary chain, not `_SYS.select`', () => {
    const expr = ce.parse(
      '\\begin{cases} 1 & x > 2 \\\\ 2 & x > 1 \\\\ 0 & \\text{otherwise}\\end{cases}'
    );
    expect(code(expr)).toBe(
      '((2 < _.x) ? (1) : ((1 < _.x) ? (2) : (0)))'
    );
    expect(code(expr)).not.toContain('_SYS.select');
  });

  test('an all-scalar `If` compiles to a ternary, not `_SYS.select`', () => {
    expect(code(ce.box(['If', ['Greater', 'x', 2], 1, 0] as any))).toBe(
      '((2 < _.x) ? (1) : (0))'
    );
  });

  test('a complex-valued arm over a list condition selects element-wise', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False'],
      ['Complex', 1, 2],
      'True',
      0,
    ] as any);
    // `constantFold: false`: every operand is a literal, so the compiler
    // would otherwise evaluate the subtree and emit its value, never
    // reaching the element-wise lowering this test pins.
    expect(code(expr)).toContain('_SYS.select');
    // A complex cell is the target's `{ re, im }` object, sitting beside a
    // real cell in the same array — the convention every compiled array
    // already uses. `interpreted()` above projects a number to its real part,
    // so the full cell-by-cell parity table lives in
    // `compile-which-complex-selection.test.ts` instead of here.
    expect(
      compile(expr, { fallback: false, constantFold: false })!.run!({})
    ).toEqual([{ re: 1, im: 2 }, 0]);
    // The SCALAR complex conditional is untouched.
    const scalar = ce.box([
      'Which',
      ['Greater', 'x', 1],
      ['Complex', 1, 2],
      'True',
      0,
    ] as any);
    expect(compile(scalar, { fallback: false })!.success).toBe(true);
  });

  test('no other target emits the JavaScript selection helper', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False'],
      1,
      'True',
      0,
    ] as any);
    for (const to of ['glsl', 'wgsl', 'interval-js', 'python']) {
      let source = '';
      try {
        source = compile(expr, { to, fallback: false } as any)?.code ?? '';
      } catch {
        source = '';
      }
      expect(source).not.toContain('_SYS.select');
    }
  });

  test('the JavaScript target is the one that carries the hook', () => {
    expect(typeof new JavaScriptTarget().createTarget().selection).toBe(
      'function'
    );
  });
});

/**
 * A mask of rank 2 or more (`M < 3` over a matrix `M`) selects node by node
 * (`selectNested` in the runtime, `evaluateElementwiseSelection` in the
 * interpreter). The compiled value must be the interpreter's: an error is
 * `NaN` for the whole value, as for R3, and an absent cell is `NaN` or, for
 * a cell that is not a number, `undefined`.
 */
describe('element-wise selection: a mask of rank 2 or more', () => {
  // Selection rule of 2026-11-02: a condition is a boolean or a flat list of
  // booleans, and an arm is a scalar or a flat list. A mask of rank 2 (a
  // comparison of a matrix), an uneven mask and an arm whose elements are
  // lists are static errors, so the compilation declines. Before, the
  // JavaScript target selected them node by node (`selectNested`).
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  test.each([
    ['If(M < 3, M, 0)', ['If', ['Less', M, 3], M, 0]],
    ['If(M < 3, 1, 0)', ['If', ['Less', M, 3], 1, 0]],
    ['Which(M < 2, 10, True, 0)', ['Which', ['Less', M, 2], 10, 'True', 0]],
    [
      'an uneven mask',
      ['If', ['List', ['List', 'True'], ['List', 'False', 'True']], 7, 0],
    ],
    [
      'an arm whose elements are lists',
      ['If', ['List', 'True', 'False'], ['List', ['List', 1], ['List', 2]], 0],
    ],
    ['a string arm', ['If', ['List', 'True', 'False'], "'a'", "'b'"]],
  ])('%s declines', (_label, json) => {
    declines(ce.box(json as any));
  });
});


/**
 * An UNDECIDED scalar condition (ruling 2026-09-02).
 *
 * A compiled `If`/`Which` whose condition is not exactly `true` or `false` at
 * run time takes NO branch and answers NaN — the numeric codomain's absence
 * marker, the same value the element-wise lowering above gives a no-match cell
 * (R4). The interpreter holds such an application inert, so neither lane
 * answers an arm.
 *
 * Before the ruling the compiled lane chose an arm by JavaScript truthiness:
 * `If(x > 0, 1, -1)` answered `-1` at `x = NaN` (because `NaN > 0` is an
 * ordinary `false`), `If(b, 1, -1)` answered `-1` for an unsupplied `b` and
 * `1` for `b = "a"`.
 *
 * The user decision of 2026-10-20 (Tycho rows 411 and 413) made a NaN operand
 * of an ordered comparison or an `Equal` decide it `false` again, so
 * `If(x > 0, 1, -1)` answers `-1` at `x = NaN`. An unsupplied variable and a
 * non-boolean condition value are still undecided.
 */
describe('compiled If/Which take no branch on an undecided condition', () => {
  /** A private engine: `b` is used as a boolean, which retypes it for the
   * engine's lifetime, and the suite above shares one engine across cases. */
  function make(): ComputeEngine {
    const engine = new ComputeEngine();
    engine.declare('x', 'number');
    // `b` may be absent, so a condition over it is read by its value.
    engine.declare('b', 'boolean | missing');
    return engine;
  }

  function run(expr: Expression, vars: object): unknown {
    const r = compile(expr, { fallback: false })!;
    expect(r.success).toBe(true);
    return r.run!(vars);
  }

  test('a NaN operand makes `If(x > 0, 1, -1)` take the else arm', () => {
    // User decision 2026-10-20 (Tycho rows 411 and 413): an ordered
    // comparison with a NaN operand is `false`, in a branch condition too.
    // Before it, the compiled `If` answered NaN here.
    const engine = make();
    const expr = engine.box(['If', ['Greater', 'x', 0], 1, -1]);
    expect(run(expr, { x: NaN })).toBe(-1);
    // A free `x` is unknown, not NaN: the interpreter holds the application
    // rather than choosing an arm.
    expect(expr.evaluate().operator).toBe('If');
  });

  test('a decided condition still picks the right arm', () => {
    const engine = make();
    const expr = engine.box(['If', ['Greater', 'x', 0], 1, -1]);
    expect(run(expr, { x: 2 })).toBe(1);
    expect(run(expr, { x: -2 })).toBe(-1);
  });

  test('`Which(x > 0, 1, True, 2)` answers the default arm at NaN', () => {
    // User decision 2026-10-20: `NaN > 0` is `false`, so the selection goes
    // on to the default clause (before it, the answer was NaN).
    const engine = make();
    const expr = engine.box(['Which', ['Greater', 'x', 0], 1, 'True', 2]);
    expect(run(expr, { x: NaN })).toBe(2);
    expect(run(expr, { x: 2 })).toBe(1);
    expect(run(expr, { x: -2 })).toBe(2);
  });

  test('a `Which` with no default whose conditions are all false at NaN answers NaN', () => {
    // At `x = NaN` both conditions are `false` (user decision 2026-10-20),
    // and a `Which` with no clause selected answers NaN, its no-match value.
    const engine = make();
    const expr = engine.box([
      'Which',
      ['Greater', 'x', 0],
      1,
      ['Less', 'x', 0],
      2,
    ]);
    expect(run(expr, { x: NaN })).toBeNaN();
    expect(run(expr, { x: 3 })).toBe(1);
    expect(run(expr, { x: -3 })).toBe(2);
  });

  test('an absent boolean condition answers NaN, not the else arm', () => {
    const engine = make();
    const expr = engine.box(['If', 'b', 1, -1]);
    expect(run(expr, { b: undefined })).toBeNaN();
  });

  test('a boolean condition value selects an arm', () => {
    const engine = make();
    const expr = engine.box(['If', 'b', 1, -1]);
    expect(run(expr, { b: true })).toBe(1);
    expect(run(expr, { b: false })).toBe(-1);
  });

  test('the NaN propagates out of the arithmetic the `If` sits in', () => {
    // A NaN `x` decides the condition `false` (user decision 2026-10-20),
    // so the else arm is taken there.
    const engine = make();
    const expr = engine.box(['Add', 1, ['If', ['Greater', 'x', 0], 1, -1]]);
    expect(run(expr, { x: NaN })).toBe(0);
    expect(run(expr, { x: 2 })).toBe(2);
  });

  test('a condition that is an application is EVALUATED once', () => {
    // The `=== true` / `=== false` pair inspects the condition twice. A
    // variable read is simply emitted twice; anything else is bound to an
    // arrow parameter first, so its effects and its cost happen once.
    const engine = new ComputeEngine();
    engine.declare('x', 'number');
    const source =
      compile(engine.box(['If', ['IsMissing', 'x'], 1, -1]), {
        fallback: false,
      })!.code ?? '';
    expect(source).toContain('(_CND)');
    expect(source.split('Number.isNaN').length - 1).toBe(1);
  });

  test('a variable declared real takes no test', () => {
    // A NaN operand decides the comparison `false` (user decision
    // 2026-10-20), and the host supplies every input.
    const engine = new ComputeEngine();
    engine.declare('r', 'real');
    const r = compile(engine.box(['If', ['Greater', 'r', 0], 1, -1]), {
      fallback: false,
    })!;
    expect(r.code).toBe('((0 < _.r) ? (1) : (-1))');
    expect(r.run!({ r: 2 })).toBe(1);
    expect(r.run!({ r: -2 })).toBe(-1);
  });

  test('the same for `Which`, and for a `number`-declared variable', () => {
    const engine = new ComputeEngine();
    engine.declare('r', 'real');
    engine.declare('x', 'number');
    const w = compile(engine.box(['Which', ['Greater', 'r', 0], 1, 'True', 2]), {
      fallback: false,
    })!;
    expect(w.run!({ r: 2 })).toBe(1);
    const n = compile(engine.box(['Which', ['Greater', 'x', 0], 1, 'True', 2]), {
      fallback: false,
    })!;
    // A NaN `x` takes the default arm (user decision 2026-10-20).
    expect(n.run!({ x: NaN })).toBe(2);
    expect(n.run!({ x: 2 })).toBe(1);
  });

  test('a COMPUTED operand takes no test', () => {
    // A NaN value decides the comparison `false` (user decision 2026-10-20).
    const engine = new ComputeEngine();
    engine.declare('r', 'real');
    const r = compile(
      engine.box(['If', ['Greater', ['Multiply', 2, 'r'], 0], 1, -1]),
      { fallback: false }
    )!;
    expect(r.code).toBe('((0 < 2 * _.r) ? (1) : (-1))');
    expect(r.run!({ r: NaN })).toBe(-1);
    expect(r.run!({ r: 2 })).toBe(1);
    expect(r.run!({ r: -2 })).toBe(-1);
  });

  test('a literal operand takes no test', () => {
    // The comparison of a `number` input with a literal is the plain
    // comparison.
    const engine = make();
    const source =
      compile(engine.box(['If', ['Greater', 'x', 0], 1, -1]), {
        fallback: false,
      })!.code ?? '';
    expect(source).toBe('((0 < _.x) ? (1) : (-1))');
  });

  test('a computed operand is EVALUATED once, not three times', () => {
    // `Sin(x)` appears once, in the comparison.
    const engine = make();
    const expr = engine.box(['If', ['Greater', ['Sin', 'x'], 0], 1, -1]);
    const r = compile(expr, { fallback: false })!;
    expect(r.code!.split('Math.sin').length - 1).toBe(1);
    expect(r.run!({ x: 1 })).toBe(1);
    expect(r.run!({ x: 4 })).toBe(-1);
    // A NaN `x` decides `Sin(x) > 0` false.
    expect(r.run!({ x: NaN })).toBe(-1);
  });

  test('`Not` over a boolean value is decided three-valued', () => {
    // `Not` is lowered by exchanging the two constants the decided tests
    // compare against, never by an emitted `!`: `!undefined` is a confident
    // `true`, so the `!` used to hand `If(Not(b), 1, 2)` the first arm for an
    // absent `b`.
    const engine = make();
    const expr = engine.box(['If', ['Not', 'b'], 1, 2]);
    expect(run(expr, { b: undefined })).toBeNaN();
    expect(run(expr, { b: true })).toBe(2);
    expect(run(expr, { b: false })).toBe(1);
  });

  test('`Not` over a relation', () => {
    // At `x = NaN`, `x > 0` is `false` and its negation `true` (user
    // decision 2026-10-20).
    const engine = make();
    const expr = engine.box(['If', ['Not', ['Greater', 'x', 0]], 1, 2]);
    expect(run(expr, { x: NaN })).toBe(1);
    expect(run(expr, { x: -1 })).toBe(1);
    expect(run(expr, { x: 1 })).toBe(2);
  });
});

describe('the selection rule of 2026-11-02: the NaN point cell', () => {
  test('a restriction of a point by a list of conditions', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('v', 'list<real>');
    const expr = ce2.box(['If', ['Greater', 'v', 0], ['Tuple', 1, 2]]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.restrict(');
    expect(r.run!({ v: [-1, 2] })).toEqual([
      [NaN, NaN],
      [1, 2],
    ]);
    ce2.assign('v', ce2.box(['List', -1, 2]));
    expect(expr.evaluate().toString()).toBe('[(NaN, NaN),(1, 2)]');
  });

  test('a restriction of a list of points by a list of conditions', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('v', 'list<real>');
    ce2.declare('p', 'list<tuple<real, real>>');
    const expr = ce2.box(['If', ['Greater', 'v', 0], 'p']);
    const r = compile(expr, { fallback: false });
    expect(r.run!({ v: [-1, 2], p: [[1, 1], [2, 2]] })).toEqual([
      [NaN, NaN],
      [2, 2],
    ]);
  });
});
