/**
 * ROADMAP CE-502: the type of an element-wise application over an operand
 * of type `unknown`.
 *
 * With `Lu: list<unknown>` and no value, the element read `Lu[1]` is typed
 * `unknown`. Its value can be a number, a ragged list or a point. A call
 * (`k(Lu[1])`, `k: (real) -> real`) and an arithmetic operation (`2·Lu[1]`)
 * map a ragged list at its leaves and map a point component-wise, so with
 * `Lu := [[[1], [2, 3]]]` the value of `2·Lu[1]` is `[[2], [4, 6]]`, and
 * with `Lu := [(1, 2)]` it is `(2, 4)`. These applications were typed
 * `broadcastable<real>` and `broadcastable<number>` (`R | tensor<R>`), which
 * holds neither value.
 *
 * The type is now `R | list<R | list<any>>`, which holds a list of any depth
 * and shape, with a `tuple` arm when `R` is numeric. The same form is the
 * type of an element-wise application over an operand of that form, so
 * `\sin(2·Lu[1])` and `2·Lu[1] + 1` keep it. The reducer prints
 * `number | list<number | list<any>> | tuple` as
 * `list<list<any> | number | tuple> | number | tuple`.
 *
 * The use-driven inference of a valueless symbol is not changed: `x + 1`
 * declares `x: number`.
 *
 * Each test reads the static type BEFORE `Lu` is assigned: an assigned value
 * narrows the type, and the check would then prove nothing.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describe as describeOperand } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { typeToString } from '../../src/common/type/serialize';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type MathJson = Parameters<ComputeEngine['box']>[0];

const OPEN_NUMBER = 'list<list<any> | number | tuple> | number | tuple';
const OPEN_REAL = 'list<list<any> | real | tuple> | real | tuple';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('k', '(real) -> real');
  ce.assign('k', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
  ce.declare('Lu', 'list<unknown>');
  return ce;
}

const EL: MathJson = ['At', 'Lu', 1];

const NUMBER: MathJson = ['List', 3];
const VECTOR: MathJson = ['List', ['List', 1, 2]];
const RAGGED: MathJson = ['List', ['List', ['List', 1], ['List', 2, 3]]];
const POINT: MathJson = ['List', ['Tuple', 1, 2]];

/** The static type of `expr`, read before `Lu` is assigned, and for each
 * value of `Lu`: the value of `expr`, and whether the static type holds the
 * type of that value. */
function typeAndValues(
  expr: MathJson,
  values: MathJson[]
): { type: string; values: [string, boolean][] } {
  return {
    type: engine().box(expr).type.toString(),
    values: values.map((v) => {
      const ce = engine();
      const e = ce.box(expr);
      const staticType = e.type.type;
      ce.assign('Lu', ce.box(v));
      const result = e.evaluate();
      return [result.toString(), isSubtype(result.type.type, staticType)];
    }),
  };
}

describe('CE-502: an application over an operand of type unknown', () => {
  test('k(Lu[1]) with k: (real) -> real', () => {
    expect(typeAndValues(['k', EL], [NUMBER, VECTOR, RAGGED, POINT])).toEqual({
      type: OPEN_REAL,
      values: [
        ['6', true],
        ['[2,4]', true],
        ['[[2],[4,6]]', true],
        ['(2, 4)', true],
      ],
    });
  });

  test('2·Lu[1]', () => {
    expect(
      typeAndValues(['Multiply', 2, EL], [NUMBER, VECTOR, RAGGED, POINT])
    ).toEqual({
      type: OPEN_NUMBER,
      values: [
        ['6', true],
        ['[2,4]', true],
        ['[[2],[4,6]]', true],
        ['(2, 4)', true],
      ],
    });
  });

  test('sin(Lu[1]) and Lu[1] < 2', () => {
    const sin = typeAndValues(['Sin', EL], [NUMBER, RAGGED, POINT]);
    expect(sin.type).toBe(OPEN_NUMBER);
    expect(sin.values.every(([, holds]) => holds)).toBe(true);
    const less = typeAndValues(['Less', EL, 2], [NUMBER, RAGGED, POINT]);
    expect(less.type).toBe('boolean | list<boolean | list<any>>');
    expect(less.values.every(([, holds]) => holds)).toBe(true);
  });

  test('an application over an operand of the open form keeps the form', () => {
    for (const [expr, type] of [
      [['Sin', ['Multiply', 2, EL]], OPEN_NUMBER],
      [['Multiply', ['k', EL], 3], OPEN_REAL],
    ] as [MathJson, string][]) {
      const r = typeAndValues(expr, [NUMBER, VECTOR, RAGGED, POINT]);
      expect(r.type).toBe(type);
      expect(r.values.map(([v, holds]) => (holds ? 'ok' : v))).toEqual([
        'ok',
        'ok',
        'ok',
        'ok',
      ]);
    }
    // A point plus a number is refused: for `Lu := [(1, 2)]` the value is an
    // `incompatible-type` error, and the operation fails closed.
    const sum = typeAndValues(
      ['Add', ['Multiply', 2, EL], 1],
      [NUMBER, VECTOR, RAGGED, POINT]
    );
    expect(sum.type).toBe(OPEN_NUMBER);
    expect(sum.values.map(([v, holds]) => (holds ? 'ok' : v))).toEqual([
      'ok',
      'ok',
      'ok',
      'Error(ErrorCode("incompatible-type", "tuple", "number"))',
    ]);
  });

  test('the parse route gives the same type', () => {
    const ce = engine();
    expect(ce.parse('2\\mathrm{Lu}[1]').type.toString()).toBe(OPEN_NUMBER);
    expect(ce.parse('f(x)+1').type.toString()).toBe(OPEN_NUMBER);
  });

  test('the descriptor route gives the same type', () => {
    const ce = engine();
    const el = ce.box(EL);
    const derived = (op: string, ops: MathJson[]): string => {
      const t = deriveApplicationType(
        ce,
        op,
        ops.map((x) => describeOperand(ce.box(x)))
      );
      return t === undefined ? 'undefined' : typeToString(t);
    };
    expect(derived('k', [el.json])).toBe(OPEN_REAL);
    expect(derived('Multiply', [2, el.json])).toBe(OPEN_NUMBER);
    expect(derived('Sin', [['Multiply', 2, el.json]])).toBe(OPEN_NUMBER);
  });

  test('an operand declared broadcastable<unknown> can hold a ragged list', () => {
    // `broadcastable<unknown>` is `unknown | list<unknown>`: its value can be
    // a ragged list too.
    for (const expr of [
      ['k', 'b'],
      ['Multiply', 2, 'b'],
    ] as MathJson[]) {
      const ce = engine();
      ce.declare('b', 'broadcastable<unknown>');
      const e = ce.box(expr);
      const staticType = e.type.type;
      expect(e.type.toString()).not.toMatch(/^broadcastable/);
      ce.assign('b', ce.box(['List', ['List', 1], ['List', 2, 3]]));
      const value = e.evaluate();
      expect(value.toString()).toBe('[[2],[4,6]]');
      expect(isSubtype(value.type.type, staticType)).toBe(true);
    }
  });

  test('a list beside Lu[1]', () => {
    // The list is mapped, and each cell is combined with `Lu[1]`, whose
    // value can be a ragged list: `[1, 2] + Lu[1]` is `[[2], [4, 5]]` for
    // `Lu := [[[1], [2, 3]]]`. It was typed `vector<integer^2>`.
    const r = typeAndValues(['Add', ['List', 1, 2], EL], [NUMBER, RAGGED]);
    expect(r).toEqual({
      type: 'list<list<list<any> | number | tuple> | number | tuple>',
      values: [
        ['[4,5]', true],
        ['[[2],[4,5]]', true],
      ],
    });
  });

  test('an element of Lu[1] can be a point', () => {
    // A point is a value of `Lu[1]` at any depth, so the `tuple` arm is also
    // an arm of the elements of the list arm: for `Lu := [[(1, 2)]]`,
    // `2·Lu[1]` is `[(2, 4)]`.
    const POINTS: MathJson = ['List', ['List', ['Tuple', 1, 2]]];
    const TWO_POINTS: MathJson = [
      'List',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ];
    for (const expr of [
      ['Multiply', 2, EL],
      ['Sin', EL],
      ['Power', EL, 2],
      ['Add', EL, EL],
      ['Floor', EL],
      ['k', EL],
    ] as MathJson[]) {
      const r = typeAndValues(expr, [POINTS, TWO_POINTS]);
      expect([expr, r.values.map(([, holds]) => holds)]).toEqual([
        expr,
        [true, true],
      ]);
    }
    expect(typeAndValues(['Multiply', 2, EL], [POINTS]).values).toEqual([
      ['[(2, 4)]', true],
    ]);
  });

  test('a whole-collection comparison with Lu[1] can be one boolean', () => {
    // `[1, 2] = Lu[1]` compares two lists as whole values when `Lu[1]` is a
    // list: it is `True` for `Lu := [[1, 2]]`.
    for (const op of ['Equal', 'NotEqual']) {
      const r = typeAndValues(
        [op, ['List', 1, 2], EL],
        [VECTOR, NUMBER, RAGGED]
      );
      expect(r.values.map(([, holds]) => holds)).toEqual([true, true, true]);
      expect(r.values[0][0]).toBe(op === 'Equal' ? '"True"' : '"False"');
    }
  });

  test('Rank over the open form does not compile to the shape of a point', () => {
    // The value of `2h(x)` can be a point, whose rank is 0, while the
    // compiled run-time shape of its array is `[2]`. The compilation is
    // refused, and the interpreter answers.
    const ce = engine();
    ce.declare('h', '(number) -> unknown');
    ce.assign('h', ce.box(['Function', ['Tuple', 't', 't'], 't']));
    for (const op of ['Rank', 'Shape']) {
      const expr = ce.box([op, ['Multiply', 2, ['h', 'x']]]);
      expect(() =>
        compile(expr, { to: 'javascript', fallback: false })
      ).toThrow(/can be a tuple/);
    }
  });

  test('a compiled application over the open form runs as before', () => {
    // The compiled code checks the value at run time and maps over an array
    // at any depth, as it does for a `broadcastable<number>` operand.
    const ce = engine();
    ce.declare('h', '(number) -> unknown');
    ce.assign('h', ce.box(['Function', ['Multiply', 3, 't'], 't']));
    const result = compile(ce.box(['Add', ['Multiply', 2, ['h', 'x']], 1]), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.success).toBe(true);
    expect(result.run!({ x: 2 })).toBe(13);
  });

  test('the inference of a valueless symbol is not changed', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x+1').type.toString()).toBe('number');
    expect(ce.symbol('x').type.toString()).toBe('number');
    expect(ce.parse('g := x \\mapsto x + 10').evaluate().type.toString()).toBe(
      '(x: unknown) -> number'
    );
  });
});
