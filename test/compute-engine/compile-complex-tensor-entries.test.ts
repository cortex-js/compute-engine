/**
 * Folds (`Sum`/`Product` of one collection) whose elements are points, rows
 * or matrices, with real or complex entries.
 *
 * The compiled pipeline declines these folds, and the interpreter gives the
 * value. These tests pin the declines, the types of the folds and the
 * interpreter's values.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type C = { re: number; im: number };
const c = (re: number, im: number): C => ({ re, im });

/** The MathJSON of a run-time value; `tuples` spells the rows as points. */
function toJson(v: unknown, tuples = false, depth = 0): unknown {
  if (Array.isArray(v))
    return [
      tuples && depth === 1 ? 'Tuple' : 'List',
      ...v.map((x) => toJson(x, tuples, depth + 1)),
    ];
  if (typeof v === 'object' && v !== null)
    return ['Complex', (v as C).re, (v as C).im];
  return v;
}

const ROWS = [
  [c(1, 1), 2],
  [c(3, 1), 4],
];

describe('A PARENT EXPRESSION OVER A FOLD OF POINTS, ROWS OR MATRICES', () => {
  // `Sum(P)` over a list of points has the type `integer | tuple<…>` (the
  // sum of an empty list is `0`), so its shape is known only at run time,
  // and a sum with a point declines (rule R3 of "Shapes are settled at
  // compile time", `docs/COMPILATION-MODEL.md`). The compiled code tested
  // the value of `Sum(P)` at run time. The interpreter gives the point.
  test.each([
    ['real points', 'list<tuple<real, real>>', '(5, 7)'],
    ['complex points', 'list<tuple<complex, complex>>', '((5 + 2i), 7)'],
  ])('%s: a sum of the fold and a point declines', (_, type, evaluated) => {
    const ce = new ComputeEngine();
    ce.declare('P', type);
    const expr = ['Add', ['Sum', 'P'], ['Tuple', 1, 1]];
    const r = compile(ce.box(expr as any));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('outside-profile');
    const value =
      type === 'list<tuple<real, real>>'
        ? [
            [1, 2],
            [3, 4],
          ]
        : ROWS;
    const ce2 = new ComputeEngine();
    ce2.assign('P', ce2.box(toJson(value, true) as any));
    expect(ce2.box(expr as any).evaluate().toString()).toBe(evaluated);
  });

  test('Product of rows or square matrices has their shape', () => {
    const ce = new ComputeEngine();
    let count = 0;
    const typeOf = (type: string) => {
      const name = `X${(count += 1)}`;
      ce.declare(name, type);
      return ce.box(['Product', name]).type.toString();
    };
    expect(typeOf('list<matrix<real^2x2>>')).toBe(
      'integer | matrix<real^(2x2)>'
    );
    expect(typeOf('list<list<integer>>')).toBe('integer | list<integer>');
    expect(typeOf('matrix<integer^2x3>')).toBe('vector<integer^3>');
    // The product of two points is an error: the type stays `number`. Two
    // matrices that are not square do not multiply, but the length of the
    // list is not known, and the product of a list of one matrix is that
    // matrix: the type is `unknown`.
    expect(typeOf('list<tuple<real, real>>')).toBe('number');
    expect(typeOf('list<matrix<integer^2x3>>')).toBe('unknown');
  });
});

describe('FOLDS WHOSE SHAPE THE TYPE DID NOT GIVE', () => {
  const run = (type: string, expr: unknown, value: unknown): unknown => {
    const ce = new ComputeEngine();
    ce.declare('P', type);
    return compile(ce.box(expr as any), { fallback: false }).run!({
      P: value,
    });
  };

  test('a scalar times a sum of points refuses to compile', () => {
    // The scalar code `2 * <array>` ran to NaN.
    for (const type of [
      'list<tuple<real, real>>',
      'list<tuple<complex, complex>>',
    ])
      expect(() => run(type, ['Multiply', ['Sum', 'P'], 2], [])).toThrow(
        /Could not compile/
      );
  });

  test('Sum and Product of elements that are numbers or lists', () => {
    // An element typed `broadcastable<real>` can be a number or a list, and
    // compiled code does not test the shape of a value at run time: the
    // compilation declines with `unsettled-shape` (ROADMAP CE-805), and the
    // interpreter gives the value. Before, the scalar fold read two list
    // elements as numbers and gave NaN.
    const type = 'list<broadcastable<real>>';
    for (const [op, value, expected] of [
      ['Sum', [[1, 2], [3, 4]], '[4,6]'],
      ['Sum', [1, 2], '3'],
      ['Product', [[1, 2], [3, 4]], '[3,8]'],
    ] as const) {
      const ce = new ComputeEngine();
      ce.declare('P', type);
      const r = compile(ce.box([op, 'P'] as any));
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      const toJson = (v: unknown): unknown =>
        Array.isArray(v) ? ['List', ...v.map(toJson)] : v;
      ce.assign('P', ce.box(toJson(value) as any));
      expect(ce.box([op, 'P'] as any).evaluate().toString()).toBe(expected);
    }
    const ce = new ComputeEngine();
    ce.declare('P', type);
    expect(ce.box(['Sum', 'P']).type.toString()).toBe('broadcastable<real>');
    // The empty list sums to 0 and multiplies to 1: the type includes them
    // when the element type does not.
    ce.declare('Q', 'list<broadcastable<nan>>');
    expect(ce.box(['Sum', 'Q']).type.toString()).toBe(
      'broadcastable<nan> | integer'
    );
    expect(ce.box(['Product', 'Q']).type.toString()).toBe(
      'broadcastable<nan> | integer'
    );
    ce.assign('Q', ce.box(['List']));
    expect(ce.box(['Sum', 'Q']).evaluate().toString()).toBe('0');
    expect(ce.box(['Product', 'Q']).evaluate().toString()).toBe('1');
  });

  test('elements that are abstract collections refuse to compile', () => {
    // The scalar fold gave NaN for `[[1, 2], [3, 4]]`.
    expect(() => run('list<collection<real>>', ['Sum', 'P'], [])).toThrow(
      /Could not compile/
    );
  });
});

describe('SUM AND PRODUCT WITH NO OPERAND', () => {
  test('the operand is reported missing', () => {
    // `canonicalBigop` read the engine of an undefined operand and threw.
    const ce = new ComputeEngine();
    expect(ce.box(['Sum']).toString()).toBe('sum(Error("missing"))');
    expect(ce.box(['Product']).toString()).toBe('prod(Error("missing"))');
  });
});