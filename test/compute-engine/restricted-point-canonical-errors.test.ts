/**
 * A RESTRICTED POINT — a point with a condition, `When((0,1), c)`, or a
 * `Which` with point branches and no default — is typed `missing | tuple<…>`.
 * When present it is a point, so the shapes that have no meaning for a point
 * have no meaning for it either, whatever the value of the condition:
 *
 * - a product of two points (`no-product-between-points`);
 * - a division by a point (`no-division-by-point`);
 * - a point plus a number or a list of numbers (`incompatible-type`).
 *
 * These are errors when the expression is created (at canonicalization), as
 * they are for a point without a condition. This matches Desmos, which rejects
 * `P Q`, `t/P`, `P/Q`, `P + 1` and `P + [10,20,30]` for
 * `P = (0,1)\{0<t\}` whatever the value of `t` (user decision 2026-09-25).
 *
 * The same rule applies to a LIST OF POINTS, restricted or not: arithmetic
 * with a list of points applies to each point, so a list of points times a
 * point, a division by a list of points, and a list of points plus a number
 * or a list of numbers are the same errors. Desmos rejects them statically
 * ("Cannot multiply a list of points by a point", "Cannot divide a number by
 * a list of points", "Cannot add a list of points and a number").
 */

import { ComputeEngine } from '../../src/compute-engine';

const P = '(0,1)\\left\\{0<t\\right\\}';
const Q = '(2,3)\\left\\{0<t\\right\\}';
const W = '\\begin{cases}(0,1) & t>0\\end{cases}';

function errorCode(e: { json: unknown }): string | undefined {
  const j = e.json as unknown[];
  if (!Array.isArray(j) || j[0] !== 'Error') return undefined;
  const code = (j[1] as unknown[])?.[1];
  return typeof code === 'string' ? code.replace(/'/g, '') : undefined;
}

describe.each([1, -1])('Restricted point shapes, t = %d', (tv) => {
  const ce = new ComputeEngine();
  ce.assign('t', tv);

  test.each([
    ['product of two restricted points', `${P}\\cdot${Q}`],
    ['juxtaposition of two restricted points', `${P}${Q}`],
    ['restricted point times a point', `${P}\\cdot(2,3)`],
    ['point times a restricted point', `(2,3)\\cdot${P}`],
    ['point without a condition times a point', `(0,1)(2,3)`],
    ['Which with a point branch times a point', `${W}\\cdot(2,3)`],
  ])('%s is no-product-between-points', (_l, latex) => {
    const e = ce.parse(latex);
    expect(e.isValid).toBe(false);
    expect(errorCode(e)).toBe('no-product-between-points');
  });

  test.each([
    ['number divided by a restricted point', `t/${P}`],
    ['fraction over a restricted point', `\\frac{t}{${P}}`],
    ['restricted point over a restricted point', `${P}/${Q}`],
    ['point over a restricted point', `(2,3)/${P}`],
    ['restricted point over a point', `${P}/(2,3)`],
    ['number divided by a point', `t/(0,1)`],
    ['number divided by a Which with a point branch', `t/${W}`],
  ])('%s is no-division-by-point', (_l, latex) => {
    const e = ce.parse(latex);
    expect(e.isValid).toBe(false);
    expect(errorCode(e)).toBe('no-division-by-point');
  });

  test.each([
    ['restricted point plus a number', `${P}+1`],
    ['restricted point plus a list of numbers', `${P}+[10,20,30]`],
    ['point plus a list of numbers', `(0,1)+[10,20,30]`],
    [
      'restricted point plus a restricted list',
      `${P}+[10,20,30]\\left\\{[1,2,3]>2\\right\\}`,
    ],
    [
      'point plus a restricted list',
      `(0,1)+[10,20,30]\\left\\{[1,2,3]>2\\right\\}`,
    ],
    ['Which with a point branch plus a list', `${W}+[10,20,30]`],
  ])('%s is incompatible-type', (_l, latex) => {
    const e = ce.parse(latex);
    expect(e.isValid).toBe(false);
    expect(errorCode(e)).toBe('incompatible-type');
  });

  test.each([
    ['restricted point divided by a number', `${P}/t`],
    ['number times a restricted point', `t${P}`],
    ['negated restricted point', `-${P}`],
    ['sum of two restricted points', `${P}+${Q}`],
    ['restricted point plus a point', `${P}+(2,3)`],
    ['point plus a list of points', `(0,1)+[(1,2),(3,4)]`],
    ['list of numbers times a restricted point', `[1,2,3]\\cdot${P}`],
  ])('%s stays valid', (_l, latex) => {
    expect(ce.parse(latex).isValid).toBe(true);
  });
});

describe('Declared restricted point and number list', () => {
  const ce = new ComputeEngine();
  ce.declare('q', 'missing | tuple<number, number>');
  ce.declare('p', 'tuple<number, number>');
  ce.declare('L', 'list<number>');
  ce.declare('M', 'list<tuple<number, number>>');

  test.each([
    [['Multiply', 'q', 'p'], 'no-product-between-points'],
    [['Multiply', 'q', 'q'], 'no-product-between-points'],
    [['Divide', 1, 'q'], 'no-division-by-point'],
    [['Divide', 'q', 'q'], 'no-division-by-point'],
    [['Add', 'q', 'L'], 'incompatible-type'],
    [['Add', 'p', 'L'], 'incompatible-type'],
  ])('%j is %s', (json, code) => {
    const e = ce.box(json as never);
    expect(e.isValid).toBe(false);
    expect(errorCode(e)).toBe(code);
  });

  test.each([
    [['Divide', 'q', 2]],
    [['Multiply', 2, 'q']],
    [['Add', 'q', 'p']],
    [['Add', 'q', 'M']],
    [['Dot', 'q', 'p']],
    // An element whose type is not known is not proof of a list of numbers.
    [['Add', 'p', ['List', 'x', 1]]],
  ])('%j stays valid', (json) => {
    expect(ce.box(json as never).isValid).toBe(true);
  });
});

const LP = '[(0,1),(4,5)]';
/** A restricted list of points: one condition for the whole list. */
const LR = '[(0,1),(4,5)]\\left\\{0<t\\right\\}';
/** A list of points restricted element by element (a list condition). */
const LE = '[(0,1),(4,5)]\\left\\{[1,2]>1\\right\\}';

describe.each([1, -1])('List of points shapes, t = %d', (tv) => {
  const ce = new ComputeEngine();
  ce.assign('t', tv);
  ce.assign('L', ce.parse(LP));

  test.each([
    ['list of points times a point', `${LP}\\cdot(1,1)`],
    ['juxtaposition of a list of points and a point', `${LP}(1,1)`],
    ['point times a list of points', `(1,1)\\cdot${LP}`],
    ['restricted list of points times a point', `${LR}(2,3)`],
    ['element-restricted list of points times a point', `${LE}(2,3)`],
    ['list of points times a restricted point', `${LP}\\cdot${P}`],
    ['list of points times a list of points', `${LP}\\cdot${LP}`],
    ['assigned list of points times a point', `L\\cdot(2,3)`],
  ])('%s is no-product-between-points', (_l, latex) => {
    const e = ce.parse(latex);
    expect(e.isValid).toBe(false);
    expect(errorCode(e)).toBe('no-product-between-points');
  });

  test.each([
    ['list of points divided by a point', `${LP}/(1,1)`],
    ['number divided by a list of points', `2/${LP}`],
    ['number divided by a restricted list of points', `t/${LR}`],
    ['number divided by an element-restricted list', `t/${LE}`],
    ['number divided by an assigned list of points', `t/L`],
    ['list of numbers divided by a list of points', `[1,2]/${LP}`],
    ['point divided by a list of points', `(1,1)/${LP}`],
    ['restricted point divided by a list of points', `${P}/${LP}`],
    ['list of points divided by a list of points', `${LP}/${LP}`],
  ])('%s is no-division-by-point', (_l, latex) => {
    const e = ce.parse(latex);
    expect(e.isValid).toBe(false);
    expect(errorCode(e)).toBe('no-division-by-point');
  });

  test.each([
    ['list of points plus a number', `${LP}+1`],
    ['restricted list of points plus a number', `${LR}+1`],
    ['element-restricted list of points plus a number', `${LE}+1`],
    ['assigned list of points plus a number', `L+1`],
    ['list of points plus a list of numbers', `${LP}+[1,2]`],
    ['list of numbers plus a list of points', `[1,2]+${LP}`],
    ['restricted list of points plus a list of numbers', `${LR}+[1,2]`],
    [
      'list of points plus a restricted list of numbers',
      `${LP}+[1,2]\\left\\{[1,2]>1\\right\\}`,
    ],
  ])('%s is incompatible-type', (_l, latex) => {
    const e = ce.parse(latex);
    expect(e.isValid).toBe(false);
    expect(errorCode(e)).toBe('incompatible-type');
  });

  // The value of each valid shape is the one the interpreter gave before
  // lists of points were checked at canonicalization.
  test.each([
    ['list of numbers times a point', '[1,2,3](0,1)', '[(0, 1),(0, 2),(0, 3)]'],
    ['list of points times a number', `${LP}\\cdot2`, '[(0, 2),(8, 10)]'],
    ['list of points divided by a number', `${LP}/2`, '[(0, 1/2),(2, 5/2)]'],
    ['negated list of points', `-${LP}`, '[(0, -1),(-4, -5)]'],
    ['list of points plus a point', `${LP}+(1,1)`, '[(1, 2),(5, 6)]'],
    ['sum of two lists of points', `${LP}+${LP}`, '[(0, 2),(8, 10)]'],
    [
      'list of points times a list of numbers',
      `${LP}\\cdot[1,2]`,
      '[(0, 1),(8, 10)]',
    ],
    [
      'list of points divided by a list of numbers',
      `${LP}/[1,2]`,
      '[(0, 1),(2, 5/2)]',
    ],
    ['assigned list of points times a number', 'L\\cdot 2', '[(0, 2),(8, 10)]'],
  ])('%s stays valid', (_l, latex, value) => {
    const e = ce.parse(latex);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe(value);
  });

  test('restricted list of points times a number follows the condition', () => {
    const v = ce.parse(`${LR}\\cdot2`).evaluate();
    if (tv > 0) expect(v.toString()).toBe('[(0, 2),(8, 10)]');
    else expect(v.json).toBe('Missing');
  });

  test('list of numbers times a restricted point follows the condition', () => {
    const e = ce.parse(`[1,2,3]${P}`);
    expect(e.isValid).toBe(true);
    const v = e.evaluate();
    if (tv > 0) expect(v.toString()).toBe('[(0, 1),(0, 2),(0, 3)]');
    else expect(v.json).toEqual(['List', 'Missing', 'Missing', 'Missing']);
  });
});

describe('Declared list of points', () => {
  const ce = new ComputeEngine();
  ce.declare('p', 'tuple<number, number>');
  ce.declare('M', 'list<tuple<number, number>>');
  ce.declare('R', 'missing | list<tuple<number, number>>');
  ce.declare('E', 'list<missing | tuple<number, number>>');
  ce.declare('N', 'list<number>');
  ce.declare('U', 'list<number | tuple<number, number>>');
  ce.declare('A', 'list<any>');

  test.each([
    [['Multiply', 'M', 'p'], 'no-product-between-points'],
    [['Multiply', 'R', ['Tuple', 1, 2]], 'no-product-between-points'],
    [['Multiply', 'E', 'p'], 'no-product-between-points'],
    [['Divide', 1, 'M'], 'no-division-by-point'],
    [['Divide', 'N', 'R'], 'no-division-by-point'],
    [['Divide', 'p', 'E'], 'no-division-by-point'],
    [['Add', 'M', 1], 'incompatible-type'],
    [['Add', 'R', 'N'], 'incompatible-type'],
    [['Add', 'E', ['List', 1, 2]], 'incompatible-type'],
  ])('%j is %s', (json, code) => {
    const e = ce.box(json as never);
    expect(e.isValid).toBe(false);
    expect(errorCode(e)).toBe(code);
  });

  test.each([
    [['Multiply', 2, 'M']],
    [['Multiply', 'N', 'M']],
    [['Divide', 'R', 2]],
    [['Divide', 'M', 'N']],
    [['Negate', 'E']],
    [['Add', 'M', 'p']],
    [['Add', 'M', 'R']],
    [['Multiply', 'N', 'p']],
    // A type that only MAY be a list of points is not proof.
    [['Add', ['List', 'x', ['Tuple', 1, 2]], 1]],
    [['Multiply', 'U', 'p']],
    [['Divide', 1, 'A']],
  ])('%j stays valid', (json) => {
    expect(ce.box(json as never).isValid).toBe(true);
  });

  test('a product with a list of 3D points does not suggest Cross', () => {
    const e = ce.parse('[(1,2,3),(3,4,5)]\\cdot(1,1,1)');
    expect(JSON.stringify(e.json)).toContain('no-cross');
  });
});

// The canonical error for a list of points times a point suggests `Dot`, so
// `Dot` must accept a restricted list of points and a restricted point. When
// the condition is not decided, the restriction moves to the product. When it
// is false, the operand is absent and the product is the absence marker of
// its codomain: `NaN` for the product of two points (a number), `Missing` for
// a list of points (a list).
describe('Dot of a restricted point or a restricted list of points', () => {
  const RL = [
    'When',
    ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ['Less', 0, 't'],
  ];
  const RP = ['When', ['Tuple', 1, 2], ['Less', 0, 't']];

  function value(json: unknown, t?: number): string {
    const ce = new ComputeEngine();
    if (t !== undefined) ce.assign('t', t);
    const e = ce.box(json as never);
    expect(e.isValid).toBe(true);
    return e.evaluate().toString();
  }

  test.each([
    [
      'a restricted list of points and a point',
      ['Dot', RL, ['Tuple', 1, 1]],
      '[3 {0 < t},7 {0 < t}]',
      '[3,7]',
      '"Missing"',
    ],
    [
      'a point and a restricted list of points',
      ['Dot', ['Tuple', 1, 1], RL],
      '[3 {0 < t},7 {0 < t}]',
      '[3,7]',
      '"Missing"',
    ],
    [
      'a restricted list of points and a list of points',
      ['Dot', RL, ['List', ['Tuple', 1, 0], ['Tuple', 0, 1]]],
      '[1 {0 < t},4 {0 < t}]',
      '[1,4]',
      '"Missing"',
    ],
    [
      'a restricted point and a point',
      ['Dot', RP, ['Tuple', 1, 1]],
      '3 {0 < t}',
      '3',
      'NaN',
    ],
    [
      'a restricted point and a restricted list of points',
      ['Dot', RP, RL],
      '[5 {0 < t},11 {0 < t}]',
      '[5,11]',
      '"Missing"',
    ],
    [
      'a restricted vector and a vector',
      ['Dot', ['When', ['List', 1, 2], ['Less', 0, 't']], ['List', 1, 1]],
      '3 {0 < t}',
      '3',
      'NaN',
    ],
  ])('%s', (_l, json, free, present, absent) => {
    expect(value(json)).toBe(free);
    expect(value(json, 2)).toBe(present);
    expect(value(json, -1)).toBe(absent);
  });

  test('the parsed restricted list of points, as the canonical error suggests', () => {
    const ce = new ComputeEngine();
    const product = ce.parse('[(1,2),(3,4)]\\left\\{0<t\\right\\}\\cdot(1,1)');
    expect(product.isValid).toBe(false);
    expect(JSON.stringify(product.json)).toContain('Dot');
    const e = ce.box([
      'Dot',
      ce.parse('[(1,2),(3,4)]\\left\\{0<t\\right\\}').json,
      ['Tuple', 1, 1],
    ] as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('[3 {0 < t},7 {0 < t}]');
  });

  test('an element-wise restriction answers NaN at an absent point', () => {
    expect(
      value([
        'Dot',
        [
          'When',
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
          ['List', 'True', 'False'],
        ],
        ['Tuple', 1, 1],
      ])
    ).toBe('[3,NaN]');
  });

  test('the type carries the absent case of a list result only', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Dot', RL, ['Tuple', 1, 1]] as never).type.toString()).toBe(
      'list<integer> | missing'
    );
    expect(ce.box(['Dot', RP, ['Tuple', 1, 1]] as never).type.toString()).toBe(
      'number'
    );
  });

  test('an absent operand is admitted and answers Missing', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Dot', 'Missing', ['Tuple', 1, 1]] as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().json).toBe('Missing');
  });
});
