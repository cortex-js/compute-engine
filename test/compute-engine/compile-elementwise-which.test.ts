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
    const interp = ce
      .box(['Which', ['List', 'True', 'Missing', 'False'], 1, 'True', 0] as any)
      .evaluate();
    expect(interp.ops![1].operator).toBe('Error');
    expect(parity(expr)).toEqual([1, NaN, 0]);
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
    // A condition whose cells are knowable only at run time still compiles,
    // and the compiled artifact throws rather than picking a branch.
    ce.declare('runtimeCells', 'list');
    const late = ce.box(['Which', 'runtimeCells', 1, 'True', 0] as any);
    const r = compile(late, { fallback: false })!;
    expect(r.success).toBe(true);
    expect(() => r.run!({ runtimeCells: [10, 20] })).toThrow(
      /Condition must evaluate/
    );
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
    expect(parity(expr)).toEqual(NaN);
  });

  test('condition/arm mismatch projects to NaN', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False', 'True'],
      ['List', 7, 8],
    ] as any);
    expect(parity(expr)).toEqual(NaN);
  });

  test('arm/arm mismatch projects to NaN', () => {
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False', 'True'],
      ['List', 1, 2, 3],
      'True',
      ['List', 9, 9],
    ] as any);
    expect(parity(expr)).toEqual(NaN);
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
    expect(parity(expr)).toEqual([1, NaN, 0]);
  });

  test('If length mismatch projects to NaN', () => {
    const expr = ce.box([
      'If',
      ['List', 'True', 'False', 'True'],
      ['List', 1, 2],
      0,
    ] as any);
    expect(parity(expr)).toEqual(NaN);
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
  // `_SYS.select` — that is what these two cases exist to pin. The chain now
  // carries the operand test the undecided-condition ruling (2026-09-02)
  // added: an unsupplied `x` leaves `x > 2` undecided, and the compiled
  // artifact must answer NaN rather than pick the else arm. A NaN `x` decides
  // `x > 2` false (user decision 2026-10-20), so the test has no NaN
  // conjunct (`_.x === _.x`) any more. See the "compiled If/Which take no
  // branch on an undecided condition" describe below.
  test('an all-scalar `Which` compiles to a ternary chain, not `_SYS.select`', () => {
    const expr = ce.parse(
      '\\begin{cases} 1 & x > 2 \\\\ 2 & x > 1 \\\\ 0 & \\text{otherwise}\\end{cases}'
    );
    expect(code(expr)).toBe(
      '((_.x !== undefined) ? ((2 < _.x) ? (1) : ((_.x !== undefined) ? ((1 < _.x) ? (2) : (0)) : NaN)) : NaN)'
    );
    expect(code(expr)).not.toContain('_SYS.select');
  });

  test('an all-scalar `If` compiles to a ternary, not `_SYS.select`', () => {
    expect(code(ce.box(['If', ['Greater', 'x', 2], 1, 0] as any))).toBe(
      '((_.x !== undefined) ? ((2 < _.x) ? (1) : (0)) : NaN)'
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
  const MATRIX = [
    [1, 2],
    [3, 4],
  ];
  /** A JavaScript value as MathJSON: an array is a `List`. */
  const toJson = (v: unknown, points = false): unknown =>
    Array.isArray(v)
      ? [points ? 'Tuple' : 'List', ...v.map((x) => toJson(x))]
      : v === true
        ? 'True'
        : v === false
          ? 'False'
          : v;
  /** An absent cell (`NaN`, `undefined`, `Missing`, an error) as one value,
   * so the two lanes compare. */
  const ABSENT = 'absent';
  const normalized = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalized)
      : v === undefined || (typeof v === 'number' && Number.isNaN(v))
        ? ABSENT
        : v;
  const projected = (x: Expression): unknown => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    if (x.symbol === 'Missing' || x.operator === 'Error') return ABSENT;
    if (x.operator === 'List' || x.operator === 'Tuple')
      return (x.ops ?? []).map(projected);
    if (x.string !== undefined) return x.string;
    return x.re;
  };

  /** Compile `expr` with the declarations, run it on `vars`, and compare it
   * with the interpreter's value for the same assignments. */
  function compiledAndInterpreted(
    declarations: Record<string, string>,
    expr: unknown,
    vars: Record<string, unknown>,
    pointLists: string[] = []
  ): { compiled: unknown; interpreted: unknown; raw: unknown } {
    const c = new ComputeEngine();
    for (const [name, type] of Object.entries(declarations))
      c.declare(name, type as any);
    const r = compile(c.box(expr as any), { fallback: false });
    expect(r?.success).toBe(true);
    const raw = r!.run!(vars as any);
    const i = new ComputeEngine();
    for (const [name, type] of Object.entries(declarations))
      i.declare(name, type as any);
    for (const [name, value] of Object.entries(vars)) {
      const json = pointLists.includes(name)
        ? ['List', ...(value as unknown[][]).map((p) => toJson(p, true))]
        : toJson(value);
      i.assign(name, i.box(json as any));
    }
    return {
      compiled: normalized(raw),
      interpreted: normalized(projected(i.box(expr as any).N())),
      raw,
    };
  }

  const M = { M: 'matrix<integer^(2x2)>' };
  const cases: Array<
    [string, Record<string, string>, unknown, Record<string, unknown>, unknown]
  > = [
    [
      'If(M < 3, M, 0)',
      M,
      ['If', ['Less', 'M', 3], 'M', 0],
      { M: MATRIX },
      [
        [1, 2],
        [0, 0],
      ],
    ],
    [
      'If(M < 3, 1, 0)',
      M,
      ['If', ['Less', 'M', 3], 1, 0],
      { M: MATRIX },
      [
        [1, 1],
        [0, 0],
      ],
    ],
    [
      'Which(M < 2, 10, M < 4, M, True, 0)',
      M,
      ['Which', ['Less', 'M', 2], 10, ['Less', 'M', 4], 'M', 'True', 0],
      { M: MATRIX },
      [
        [10, 2],
        [3, 0],
      ],
    ],
    [
      'If(M < 3, M)',
      M,
      ['If', ['Less', 'M', 3], 'M'],
      { M: MATRIX },
      [
        [1, 2],
        [ABSENT, ABSENT],
      ],
    ],
    // An arm of lower rank than the mask is refused, as `M + [10, 20]` is.
    [
      'If(M < 3, [10, 20], 0)',
      M,
      ['If', ['Less', 'M', 3], ['List', 10, 20], 0],
      { M: MATRIX },
      ABSENT,
    ],
    [
      'If(M < 3, [10, 20, 30], 0)',
      M,
      ['If', ['Less', 'M', 3], ['List', 10, 20, 30], 0],
      { M: MATRIX },
      ABSENT,
    ],
    // An arm that no position selects is not evaluated.
    [
      'If(M < 0, [10, 20, 30], 0)',
      M,
      ['If', ['Less', 'M', 0], ['List', 10, 20, 30], 0],
      { M: MATRIX },
      [
        [0, 0],
        [0, 0],
      ],
    ],
    [
      'If(M < 3, (1, 2), (0, 0))',
      M,
      ['If', ['Less', 'M', 3], ['Tuple', 1, 2], ['Tuple', 0, 0]],
      { M: MATRIX },
      [
        [
          [1, 2],
          [1, 2],
        ],
        [
          [0, 0],
          [0, 0],
        ],
      ],
    ],
    [
      'If(M < 3, "a")',
      M,
      ['If', ['Less', 'M', 3], { str: 'a' }],
      { M: MATRIX },
      [
        ['a', 'a'],
        [ABSENT, ABSENT],
      ],
    ],
    [
      'a mask whose rows have different lengths',
      { R: 'list<list<boolean>>' },
      ['If', 'R', 7, 0],
      { R: [[true], [false, true]] },
      [[7], [0, 7]],
    ],
    [
      'masks of rank 1 and 2',
      { M: 'matrix<integer^(2x2)>', V: 'list<integer>' },
      ['Which', ['Less', 'V', 3], 'M', ['Less', 'M', 2], 0, 'True', 5],
      { M: MATRIX, V: [1, 5] },
      [
        [1, 2],
        [5, 5],
      ],
    ],
    [
      'a broadcastable operand holding a matrix',
      { B: 'broadcastable<number>' },
      ['If', ['Less', 'B', 0], ['Negate', 'B'], 'B'],
      {
        B: [
          [1, -2],
          [-3, 4],
        ],
      },
      [
        [1, 2],
        [3, 4],
      ],
    ],
    [
      'a mask of lower rank than a broadcastable arm',
      { B: 'broadcastable<number>', C: 'broadcastable<number>' },
      ['If', ['Less', 'C', 0], 'B', 0],
      { C: [-1, 1], B: MATRIX },
      [[1, 2], 0],
    ],
  ];
  test.each(cases)('%s', (_label, declarations, expr, vars, expected) => {
    const { compiled, interpreted } = compiledAndInterpreted(
      declarations,
      expr,
      vars
    );
    expect(compiled).toEqual(expected);
    expect(compiled).toEqual(interpreted);
  });

  test('an unmatched cell of a numeric arm is NaN at the depth of the cell', () => {
    // The cells of `M` are numbers, its rows are not: the absence value of
    // each depth is passed (`_SYS.absentByDepth`).
    const { raw } = compiledAndInterpreted(M, ['If', ['Less', 'M', 3], 'M'], {
      M: MATRIX,
    });
    expect(raw).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
  });

  test('a list of points is whole at the depth of its points', () => {
    // At the rows of the mask, an element of `P` is a point, which is one
    // value: an arm of lower rank than the mask, refused as in the
    // interpreter.
    const { compiled, interpreted } = compiledAndInterpreted(
      { M: 'matrix<integer^(2x2)>', P: 'list<tuple<integer, integer>>' },
      ['If', ['Less', 'M', 3], 'P', ['Tuple', 0, 0]],
      { M: MATRIX, P: MATRIX },
      ['P']
    );
    expect(compiled).toEqual(ABSENT);
    expect(compiled).toEqual(interpreted);
  });

  test('an arm whose type does not give the depth of its points throws under a nested mask', () => {
    // A point is an array in compiled code, like a row, so without the depth
    // of its points the helper read each point of `P` as a row of the mask:
    // `If(C, P, 0)` was `[[1, 0], [0, 4]]`. The interpreter refuses the
    // point arm, of lower rank than the mask (`incompatible-dimensions`).
    // The element type of a `tensor<tuple<…>>` is the union `tuple<…> |
    // tensor<tuple<…>>`, and the elements of `list<any>`, `list<unknown>`
    // and a bare `list` may be points. The selection compiles, and the run
    // throws where an element of the arm is an array and the mask is still
    // a list one level down (`_SYS.pointDepthUnknown`).
    const C = [
      [true, false],
      [false, true],
    ];
    for (const type of [
      'tensor<tuple<integer, integer>>',
      'list<any>',
      'list<unknown>',
      'list',
    ]) {
      const c = new ComputeEngine();
      c.declare('C', 'matrix<boolean^(2x2)>');
      c.declare('P', type as any);
      const expr = ['If', 'C', 'P', 0];
      const r = compile(c.box(expr as any), { fallback: false });
      expect(r?.success).toBe(true);
      expect(() => r!.run!({ C, P: MATRIX } as any)).toThrow(RangeError);
      expect(() => r!.run!({ C, P: MATRIX } as any)).toThrow(
        /does not give the depth of its points/
      );
      // The interpreter refuses the same selection over points.
      c.assign('C', c.box(toJson(C) as any));
      c.assign('P', c.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
      expect(c.box(expr as any).evaluate().operator).toBe('Error');
    }
    // A mask that is flat at run time: the arm is an ordinary list arm, on
    // the fused loop and on the generic selection (`cse: false`).
    for (const cse of [true, false]) {
      const c = new ComputeEngine();
      c.declare('S', 'list');
      const r = compile(c.box(['If', ['Less', 'S', 3], 'S', 0] as any), {
        fallback: false,
        cse,
      });
      expect(r?.success).toBe(true);
      expect(r!.code).toContain('_SYS.pointDepthUnknown');
      expect(r!.run!({ S: [1, 5] } as any)).toEqual([1, 0]);
    }
    // A mask that is provably flat, with a bare `list` arm of numbers.
    expect(
      compiledAndInterpreted(
        { V: 'list<boolean>', P: 'list' },
        ['If', 'V', 'P', 0],
        { V: [true, false], P: [1, 2] }
      )
    ).toMatchObject({ compiled: [1, 0], interpreted: [1, 0] });
    // The guard of the fused loop sends a matrix to the generic selection,
    // which reaches the check.
    const c = new ComputeEngine();
    c.declare('S', 'list');
    const fused = compile(c.box(['If', ['Less', 'S', 3], 'S', 0] as any), {
      fallback: false,
      constantFold: false,
    });
    expect(fused!.code).toContain('_SYS.numericSelectionInputs(');
    expect(() => fused!.run!({ S: MATRIX } as any)).toThrow(RangeError);
    // A matrix arm and a broadcastable arm still give the interpreter's
    // value.
    for (const type of ['matrix<integer^(2x2)>', 'broadcastable<number>'])
      expect(
        compiledAndInterpreted(
          { C: 'matrix<boolean^(2x2)>', P: type },
          ['If', 'C', 'P', 0],
          { C, P: MATRIX }
        )
      ).toMatchObject({
        compiled: [
          [1, 0],
          [0, 4],
        ],
        interpreted: [
          [1, 0],
          [0, 4],
        ],
      });
  });

  test('a flat mask keeps its code', () => {
    // The absence value of each depth and the depth of the points of a list
    // arm are passed only when the mask may have rank 2 or more.
    const c = new ComputeEngine();
    c.declare('V', 'list<integer>');
    c.declare('P', 'list<tuple<integer, integer>>');
    const source =
      compile(c.box(['If', ['Less', 'V', 3], 'P', ['Tuple', 0, 0]] as any), {
        fallback: false,
        constantFold: false,
      })?.code ?? '';
    expect(source).not.toContain('_SYS.wholeAt');
    expect(source).not.toContain('_SYS.absentByDepth');
  });

  test('the interval and Python targets refuse a condition that may be a list', () => {
    // These targets have no element-wise selection. A condition that is a
    // list was refused; one that MAY be a list (`B < 0` for a broadcastable
    // `B`) is refused too, where a conditional expression read the
    // truthiness of an array. Before, the Python compile of `B < 0`
    // overflowed the stack.
    for (const [declarations, expr] of [
      [M, ['If', ['Less', 'M', 3], 'M', 0]],
      [{ B: 'broadcastable<number>' }, ['If', ['Less', 'B', 0], 0, 'B']],
      [
        { B: 'broadcastable<number>' },
        ['Which', ['Less', 'B', 0], 0, 'True', 'B'],
      ],
      [{ B: 'broadcastable<number>' }, ['When', 1, ['Less', 'B', 0]]],
      [
        { B: 'broadcastable<number>' },
        ['Which', ['Less', 'B', 0], 1, 'True', 0],
      ],
    ] as Array<[Record<string, string>, unknown]>) {
      for (const to of ['interval-js', 'python']) {
        const c = new ComputeEngine();
        for (const [name, type] of Object.entries(declarations))
          c.declare(name, type as any);
        let success: boolean | undefined;
        let message = '';
        try {
          success = compile(c.box(expr as any), {
            to,
            fallback: false,
          } as any)?.success;
        } catch (e) {
          message = (e as Error).message;
        }
        expect(success).not.toBe(true);
        expect(message).not.toMatch(/call stack/);
      }
    }
    // The comparison alone still compiles on Python.
    const c = new ComputeEngine();
    c.declare('B', 'broadcastable<number>');
    expect(
      compile(c.box(['Less', 'B', 0] as any), {
        to: 'python',
        fallback: false,
      } as any)?.success
    ).toBe(true);
    // A shader target is exempt: a shader variable is a uniform of a fixed
    // type, never a list.
    for (const to of ['glsl', 'wgsl'])
      expect(
        compile(c.box(['When', 1, ['Less', 'B', 0]] as any), {
          to,
          fallback: false,
        } as any)?.success
      ).toBe(true);
  });

  test('compiled JavaScript restricts by a condition that may be a list', () => {
    // The conditional expression `c ? 1 : NaN` read the array of `B < 0` as
    // true: `When(1, B < 0)` was `1` for `B = [-1, 2]`, where the
    // interpreter answers `[1, NaN]`. Such a condition now takes the helper
    // of a list of conditions (`_SYS.restrict`), which reads a condition
    // that is not an array at run time as one scalar condition.
    const declarations = { B: 'broadcastable<number>' };
    for (const expr of [
      ['When', 1, ['Less', 'B', 0]],
      ['When', ['List', 1, 2], ['Less', 'B', 0]],
    ])
      for (const B of [-1, 2, [-1, 2]]) {
        const { compiled, interpreted } = compiledAndInterpreted(
          declarations,
          expr,
          { B }
        );
        expect(compiled).toEqual(interpreted);
      }
    const c = new ComputeEngine();
    c.declare('B', 'broadcastable<number>');
    const r = compile(c.box(['When', 1, ['Less', 'B', 0]] as any), {
      fallback: false,
    });
    expect(r!.code).toContain('_SYS.restrict(');
    expect(r!.run!({ B: -1 } as any)).toBe(1);
    expect(r!.run!({ B: 2 } as any)).toBeNaN();
    expect(r!.run!({ B: [-1, 2] } as any)).toEqual([1, NaN]);
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
    engine.declare('b', 'boolean');
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

  test('an unsupplied boolean condition answers NaN, not the else arm', () => {
    const engine = make();
    const expr = engine.box(['If', 'b', 1, -1]);
    expect(run(expr, {})).toBeNaN();
  });

  test('an unsupplied NUMERIC variable answers NaN, not the else arm', () => {
    // `_.x` is `undefined`, and `0 < undefined` is an ordinary `false`, so the
    // comparison used to hand the else arm a confident wrong answer — while
    // `x + 1` on the same vars object has always answered NaN.
    const engine = make();
    expect(run(engine.box(['If', ['Greater', 'x', 0], 1, -1]), {})).toBeNaN();
    expect(
      run(engine.box(['Which', ['Greater', 'x', 0], 1, 'True', 2]), {})
    ).toBeNaN();
  });

  test('a non-boolean condition value answers NaN, not JavaScript truthiness', () => {
    const engine = make();
    const expr = engine.box(['If', 'b', 1, -1]);
    // `"a"` is truthy in JavaScript; the compiled artifact used to answer 1.
    expect(run(expr, { b: 'a' } as any)).toBeNaN();
    expect(run(expr, { b: 0 } as any)).toBeNaN();
    expect(run(expr, { b: true })).toBe(1);
    expect(run(expr, { b: false })).toBe(-1);
  });

  test('the NaN propagates out of the arithmetic the `If` sits in', () => {
    // An unsupplied `x` leaves the condition undecided. A NaN `x` decides it
    // `false` (user decision 2026-10-20), so the else arm is taken there.
    const engine = make();
    const expr = engine.box(['Add', 1, ['If', ['Greater', 'x', 0], 1, -1]]);
    expect(run(expr, {})).toBeNaN();
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

  test('an unsupplied variable answers NaN whatever its declared type', () => {
    // `real` excludes NaN in the type lattice, but that says nothing about
    // what the caller supplies: `r` may be left out of the vars object, and
    // every comparison against `undefined` is `false`. So a `real`-declared
    // operand carries the same test a `number`-declared one does. The test
    // has no NaN conjunct: a NaN operand decides the comparison `false`
    // (user decision 2026-10-20).
    const engine = new ComputeEngine();
    engine.declare('r', 'real');
    const r = compile(engine.box(['If', ['Greater', 'r', 0], 1, -1]), {
      fallback: false,
    })!;
    expect(r.code).toBe(
      '((_.r !== undefined) ? ((0 < _.r) ? (1) : (-1)) : NaN)'
    );
    expect(r.run!({} as any)).toBeNaN();
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
    expect(w.run!({} as any)).toBeNaN();
    expect(w.run!({ r: 2 })).toBe(1);
    const n = compile(engine.box(['Which', ['Greater', 'x', 0], 1, 'True', 2]), {
      fallback: false,
    })!;
    expect(n.run!({} as any)).toBeNaN();
    // A NaN `x` takes the default arm (user decision 2026-10-20).
    expect(n.run!({ x: NaN })).toBe(2);
    expect(n.run!({ x: 2 })).toBe(1);
  });

  test('a COMPUTED operand over an unsupplied variable answers NaN too', () => {
    // `2r` is `real`-typed, so the type promises it is never NaN — but the
    // promise does not survive an absent input: `2 * undefined` is NaN at run
    // time and `0 < NaN` is an ordinary `false`. An unsupplied variable must
    // leave the branch undecided (ruled 2026-09-02), while a NaN value decides
    // the comparison `false` (user decision 2026-10-20). So the test is on the
    // variable the operand reads, `_.r !== undefined`, whatever arithmetic
    // surrounds it. Before the 2026-10-20 decision the product was bound to a
    // temporary and tested for NaN.
    const engine = new ComputeEngine();
    engine.declare('r', 'real');
    const r = compile(
      engine.box(['If', ['Greater', ['Multiply', 2, 'r'], 0], 1, -1]),
      { fallback: false }
    )!;
    expect(r.code).toBe(
      '((_.r !== undefined) ? ((0 < 2 * _.r) ? (1) : (-1)) : NaN)'
    );
    expect(r.run!({} as any)).toBeNaN();
    expect(r.run!({ r: NaN })).toBe(-1);
    expect(r.run!({ r: 2 })).toBe(1);
    expect(r.run!({ r: -2 })).toBe(-1);
  });

  test('a literal operand takes no test', () => {
    // A fragment the compiler already reduced to a finite number decides every
    // comparison it takes part in, so `x > 0` guards `x` and not the `0`.
    const engine = make();
    const source =
      compile(engine.box(['If', ['Greater', 'x', 0], 1, -1]), {
        fallback: false,
      })!.code ?? '';
    expect(source).toBe(
      '((_.x !== undefined) ? ((0 < _.x) ? (1) : (-1)) : NaN)'
    );
  });

  test('a computed operand is EVALUATED once, not three times', () => {
    // Before the user decision of 2026-10-20 the decidedness test named the
    // operand twice more (a NaN test), so the operand was bound to a
    // temporary. Now the test names only the variable `x` the operand reads
    // (`_.x !== undefined`), and `Sin(x)` appears once, in the comparison.
    const engine = make();
    const expr = engine.box(['If', ['Greater', ['Sin', 'x'], 0], 1, -1]);
    const r = compile(expr, { fallback: false })!;
    expect(r.code!.split('Math.sin').length - 1).toBe(1);
    expect(r.run!({ x: 1 })).toBe(1);
    expect(r.run!({ x: 4 })).toBe(-1);
    // A NaN `x` decides `Sin(x) > 0` false; an unsupplied `x` decides nothing.
    expect(r.run!({ x: NaN })).toBe(-1);
    expect(r.run!({} as any)).toBeNaN();
  });

  test('`Not` over a boolean value is decided three-valued', () => {
    // `Not` is lowered by exchanging the two constants the decided tests
    // compare against, never by an emitted `!`: `!undefined` is a confident
    // `true`, so the `!` used to hand `If(Not(b), 1, 2)` the first arm for an
    // unsupplied `b` — and the second arm for a truthy non-boolean.
    const engine = make();
    const expr = engine.box(['If', ['Not', 'b'], 1, 2]);
    expect(run(expr, {})).toBeNaN();
    expect(run(expr, { b: 'a' } as any)).toBeNaN();
    expect(run(expr, { b: true })).toBe(2);
    expect(run(expr, { b: false })).toBe(1);
  });

  test('`Not` over a relation keeps the operand test', () => {
    // `Not` changes neither operand of the comparison under it, so the
    // decidedness test is the one the bare relation takes.
    // At `x = NaN`, `x > 0` is `false` and its negation `true` (user
    // decision 2026-10-20); an unsupplied `x` is still undecided.
    const engine = make();
    const expr = engine.box(['If', ['Not', ['Greater', 'x', 0]], 1, 2]);
    expect(run(expr, { x: NaN })).toBe(1);
    expect(run(expr, {})).toBeNaN();
    expect(run(expr, { x: -1 })).toBe(1);
    expect(run(expr, { x: 1 })).toBe(2);
  });
});
