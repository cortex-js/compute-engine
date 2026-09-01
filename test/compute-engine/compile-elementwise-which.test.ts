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
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

const ce = new ComputeEngine();

/** Interpretation, projected the way a real (JavaScript) target represents it. */
function interpreted(expr: BoxedExpression): unknown {
  const project = (x: BoxedExpression): unknown => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    if (x.symbol === 'Nothing' || x.symbol === 'Undefined') return NaN;
    if (x.operator === 'Error') return NaN;
    if (x.operator === 'List') return (x.ops ?? []).map(project);
    return x.re;
  };
  return project(expr.N());
}

/** Compile `expr`, run it, and assert it matches interpretation. */
function parity(expr: BoxedExpression, vars?: object): unknown {
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
function code(expr: BoxedExpression): string {
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

  test('a NON-boolean condition cell fails closed at run time', () => {
    // `Which([10, 20], …)`: not a condition value in any cell. The compiled
    // artifact throws rather than picking a branch. The interpreter has no
    // branch to pick either, but it can hold the expression instead of
    // failing, which is what it does (undecidable-condition ruling
    // 2026-08-31); the shared requirement is that NEITHER lane answers 0.
    const expr = ce.box(['Which', ['List', 10, 20], 1, 'True', 0] as any);
    const r = compile(expr, { fallback: false })!;
    expect(r.success).toBe(true);
    expect(() => r.run!()).toThrow(/Condition must evaluate/);
    expect(expr.evaluate().operator).toBe('Which');
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
  test('an all-scalar `Which` compiles to the same ternary chain as before', () => {
    const expr = ce.parse(
      '\\begin{cases} 1 & x > 2 \\\\ 2 & x > 1 \\\\ 0 & \\text{otherwise}\\end{cases}'
    );
    expect(code(expr)).toBe('((2 < _.x) ? (1) : ((1 < _.x) ? (2) : (0)))');
  });

  test('an all-scalar `If` compiles to the same ternary as before', () => {
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
