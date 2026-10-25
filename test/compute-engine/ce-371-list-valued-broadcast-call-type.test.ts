/**
 * ROADMAP CE-371: the type of a call that maps a function with a list result
 * over an operand whose depth the type does not state.
 *
 * The case: `h := (t: number) ↦ [t, 2t]`, whose result for one number is a
 * `vector<2>`. A list operand of any depth is mapped at its leaves, so with
 * `x = [[1, 2], [3]]` the value of `h(x)` is `[[[1, 2], [2, 4]], [[3, 6]]]`,
 * a list of matrices. The call was typed `broadcastable<vector<2>>` (a
 * vector or a list of vectors) for `x: any` and for
 * `x: broadcastable<number>`, which does not hold that value, and the index
 * `h(x)[1]` was typed `missing | number | vector<2>`, which does not hold
 * the matrix `[[1, 2], [2, 4]]`.
 *
 * User decision 2026-10-25: with `R` the result of the function for one
 * element,
 *
 * - over an operand of a top type (`any`, `unknown`) the call is typed
 *   `R | list<R | list<any>>`, which holds a list of any depth and shape;
 * - over a tensor operand (`broadcastable<number>`, `tensor<number>`), whose
 *   value is regular, the call is typed `R | tensor<cells of R>`.
 *
 * The reducer prints `vector<2> | list<vector<2> | list<any>>` as
 * `list<list<any> | number>`, and `vector<2> | tensor<number>` as `tensor`.
 *
 * Each test reads the static type BEFORE `x` is assigned: an assigned value
 * narrows the type, and the check would then prove nothing.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type MathJson = Parameters<ComputeEngine['box']>[0];

function engine(xType: string, body = '[t, 2t]'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('h', 'function');
  ce.assign('h', ce.parse(`(t: \\mathrm{number}) \\mapsto ${body}`));
  ce.declare('x', { type: xType });
  return ce;
}

/** The static type of `expr`, read before `x` is assigned, and for each
 * value of `x`: the value of `expr`, and whether the static type holds the
 * type of that value. */
function typeAndValues(
  ce: ComputeEngine,
  expr: MathJson,
  values: MathJson[]
): { type: string; values: [string, boolean][] } {
  const e = ce.box(expr);
  const staticType = e.type.type;
  return {
    type: e.type.toString(),
    values: values.map((v) => {
      ce.assign('x', ce.box(v));
      const result = e.evaluate();
      return [result.toString(), isSubtype(result.type.type, staticType)];
    }),
  };
}

const NUMBER: MathJson = 3;
const VECTOR: MathJson = ['List', 1, 2, 3];
const RAGGED: MathJson = ['List', ['List', 1, 2], ['List', 3]];
const MATRIX: MathJson = ['List', ['List', 1, 2], ['List', 3, 4]];
const EMPTY: MathJson = ['List'];

describe('CE-371: an operand of a top type', () => {
  test('h(x) with x: any', () => {
    expect(
      typeAndValues(
        engine('any'),
        ['h', 'x'],
        [NUMBER, VECTOR, RAGGED, MATRIX, EMPTY]
      )
    ).toEqual({
      type: 'list<list<any> | number>',
      values: [
        ['[3,6]', true],
        ['[[1,2],[2,4],[3,6]]', true],
        ['[[[1,2],[2,4]],[[3,6]]]', true],
        ['[[[1,2],[2,4]],[[3,6],[4,8]]]', true],
        ['[]', true],
      ],
    });
  });

  test('h(x)[1] with x: any', () => {
    expect(
      typeAndValues(
        engine('any'),
        ['At', ['h', 'x'], 1],
        [NUMBER, VECTOR, RAGGED, MATRIX, EMPTY]
      )
    ).toEqual({
      type: 'list<any> | missing | number',
      values: [
        ['3', true],
        ['[1,2]', true],
        ['[[1,2],[2,4]]', true],
        ['[[1,2],[2,4]]', true],
        ['"Missing"', true],
      ],
    });
  });

  test('h(x) with x: list<any>', () => {
    expect(
      typeAndValues(
        engine('list<any>'),
        ['h', 'x'],
        [VECTOR, RAGGED, MATRIX, EMPTY]
      )
    ).toEqual({
      type: 'list<list<any>>',
      values: [
        ['[[1,2],[2,4],[3,6]]', true],
        ['[[[1,2],[2,4]],[[3,6]]]', true],
        ['[[[1,2],[2,4]],[[3,6],[4,8]]]', true],
        ['[]', true],
      ],
    });
  });

  test('a boolean result: t ↦ t > 0 with x: any', () => {
    // `broadcastable<boolean>` does not hold the ragged value
    // `[[True, True], [True]]`.
    expect(
      typeAndValues(
        engine('any', 't > 0'),
        ['h', 'x'],
        [NUMBER, RAGGED, MATRIX]
      )
    ).toEqual({
      type: 'boolean | list<boolean | list<any>>',
      values: [
        ['"True"', true],
        ['[["True","True"],["True"]]', true],
        ['[["True","True"],["True","True"]]', true],
      ],
    });
  });
});

describe('CE-371: a tensor operand', () => {
  test.each(['broadcastable<number>', 'tensor<number>'])(
    'h(x) and h(x)[1] with x: %s',
    (xType) => {
      // A tensor declaration refuses the ragged value, so only regular values
      // are read.
      const values =
        xType === 'tensor<number>'
          ? [VECTOR, MATRIX]
          : [NUMBER, VECTOR, MATRIX];
      const call = typeAndValues(engine(xType), ['h', 'x'], values);
      expect(call.type).toBe('tensor');
      expect(call.values.every(([, holds]) => holds)).toBe(true);
      const index = typeAndValues(engine(xType), ['At', ['h', 'x'], 1], values);
      expect(index.type).toBe('missing | number | tensor');
      expect(index.values.every(([, holds]) => holds)).toBe(true);
    }
  );

  test('a declared tensor refuses a ragged value', () => {
    const ce = engine('broadcastable<number>');
    expect(() => ce.assign('x', ce.box(RAGGED))).toThrow();
  });
});

describe('CE-371: compiled consequences', () => {
  /** For each value of `x`: the interpreted and the compiled value as JSON
   * text, or `'declined'` when the expression does not compile. */
  function compiledAndInterpreted(
    ce: ComputeEngine,
    expr: MathJson,
    values: unknown[]
  ): [string, string][] | 'declined' {
    const e = ce.box(expr);
    let run: (vars: Record<string, unknown>) => unknown;
    try {
      run = (
        compile(e, {
          to: 'javascript',
          fallback: false,
        } as never) as unknown as {
          run: (vars: Record<string, unknown>) => unknown;
        }
      ).run;
    } catch {
      return 'declined';
    }
    const toJson = (v: unknown): MathJson =>
      Array.isArray(v)
        ? (['List', ...v.map(toJson)] as MathJson)
        : (v as MathJson);
    return values.map((v) => {
      ce.assign('x', ce.box(toJson(v)));
      const interpreted = e.evaluate().N().toString();
      return [interpreted, JSON.stringify(run({ x: v }))];
    });
  }

  test('Max(h(x)[1], 1) and Min(h(x)[1], 1) decline', () => {
    // A compiled `Max` or `Min` over an element typed `list<any>` declines:
    // such a list may hold `Nothing` elements, which compiled code cannot
    // represent yet.
    for (const head of ['Max', 'Min'])
      expect(
        compiledAndInterpreted(
          engine('any'),
          [head, ['At', ['h', 'x'], 1], 1],
          [3]
        )
      ).toBe('declined');
  });

  test('h(x)[1]^2 compiles and agrees for a number and a vector element', () => {
    // With a matrix element (`x = [[1, 2], [3, 4]]`) the interpreter gives
    // the matrix power and the compiled code squares each entry: ROADMAP
    // CE-216.2, which needs a compiled representation of points that is not
    // a row. That case is not read here.
    expect(
      compiledAndInterpreted(
        engine('any'),
        ['Power', ['At', ['h', 'x'], 1], 2],
        [3, [1, 2]]
      )
    ).toEqual([
      ['9', '9'],
      ['[1,4]', '[1,4]'],
    ]);
  });
});
