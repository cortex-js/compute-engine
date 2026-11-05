/**
 * Arithmetic on points whose components are on the extended real line, with
 * NaN (`real | signed_infinity | nan`), gives components of that type, as
 * the same arithmetic on scalars of that type does.
 *
 * Before the fix the component types were joined, and the join widens
 * `+oo | -oo` to `infinity`, which admits the complex infinity: `P + Q` and
 * `2P` were `tuple<infinity | nan | real, …>`, and a symbol declared
 * `tuple<real | signed_infinity | nan, …>` could not be assigned them.
 */
import { ComputeEngine } from '../../src/compute-engine';

const E = 'real | signed_infinity | nan';
const ET = 'nan | real | signed_infinity';
const POINT = `tuple<${ET}, ${ET}>`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('a', E);
  ce.declare('b', E);
  ce.declare('x', 'real');
  ce.declare('g', 'real<1..>');
  ce.declare('P', `tuple<${E}, ${E}>`);
  ce.declare('Q', `tuple<${E}, ${E}>`);
  ce.declare('S', `tuple<${E}, ${E}>`);
  ce.declare('T', 'tuple<real | signed_infinity, real>');
  return ce;
}

describe('EXTENDED REAL POINT ARITHMETIC', () => {
  const ce = engine();
  test.each<[string, string]>([
    // The scalar controls.
    ['a+b', ET],
    ['2a', ET],
    ['a/2', ET],
    ['P+Q', POINT],
    ['P-Q', POINT],
    ['-P', POINT],
    ['2P', POINT],
    ['P\\cdot 2', POINT],
    ['aP', POINT],
    // `0 · ∞` is NaN.
    ['xP', POINT],
    ['P/2', POINT],
    // A scalar quotient kept as `Divide`, and the same quotient of a point.
    ['a/g', ET],
    ['P/g', POINT],
    ['P+(1,2)', POINT],
    // `2 · ±∞` is `±∞`, never NaN, and so is `±∞ / 2`.
    ['2T', 'tuple<real | signed_infinity, real>'],
    ['T/2', 'tuple<real | signed_infinity, real>'],
    // `+∞ + −∞` is NaN.
    ['T+T', `tuple<${ET}, real>`],
  ])('%s', (latex, type) => {
    expect(ce.parse(latex).type.toString()).toBe(type);
  });

  test('a point sum or product can be assigned to a point of the same type', () => {
    const ce = engine();
    for (const latex of ['P+Q', 'P-Q', '2P', 'P/2'])
      expect(() => ce.assign('S', ce.parse(latex))).not.toThrow();
  });

  test('the values have the static type', () => {
    const ce = engine();
    for (const [p, q] of [
      [['Tuple', 'PositiveInfinity', 1], ['Tuple', 'NegativeInfinity', 2]],
      [['Tuple', 'NaN', -3], ['Tuple', 0.5, 'PositiveInfinity']],
    ] as const) {
      ce.assign('P', ce.box(p));
      ce.assign('Q', ce.box(q));
      for (const latex of ['P+Q', 'P-Q', '-P', '2P', 'P/2']) {
        const e = ce.parse(latex);
        const v = e.evaluate();
        expect(v.type.matches(e.type)).toBe(true);
      }
    }
  });

  test('a float that holds an integer, scaled by a rational, is real', () => {
    // `2.0 / 3` evaluates to an inexact float, so the component is `real`,
    // not `rational`, with or without an infinite component beside it.
    const ce = engine();
    for (const first of ['PositiveInfinity', 5]) {
      const e = ce.box([
        'Multiply',
        ['Rational', 1, 3],
        ['Tuple', first, { num: '2.0' }],
      ]);
      const t = e.type.type;
      expect(typeof t === 'object' && t.kind === 'tuple').toBe(true);
      if (typeof t === 'object' && t.kind === 'tuple')
        expect(t.elements[1].type).toBe('real');
      const v = e.evaluate();
      expect(v.type.matches(e.type)).toBe(true);
    }
  });
});

/**
 * A list of points beside a point, or beside another list of points, is
 * added point by point, and each point sum has the component types of a sum
 * of two points. Before the fix the cell of a list plus a point was the join
 * of the point types, so `L + (1, 1)` and `L + P` were
 * `list<tuple<infinity | nan | real, …>>`, and a symbol declared
 * `list<tuple<real | signed_infinity | nan, …>>` could not be assigned them.
 */
describe('EXTENDED REAL POINT LIST ARITHMETIC', () => {
  const LIST = `list<${POINT}>`;
  function listEngine(): ComputeEngine {
    const ce = engine();
    ce.declare('L', `list<tuple<${E}, ${E}>>`);
    ce.declare('M', `list<tuple<${E}, ${E}>>`);
    ce.declare('R', `list<tuple<${E}, ${E}>>`);
    return ce;
  }
  const ce = listEngine();
  test.each<[string, string]>([
    ['L+(1,1)', LIST],
    ['(1,1)+L', LIST],
    ['L+P', LIST],
    ['P+L', LIST],
    ['L-P', LIST],
    ['L+M', LIST],
    ['L-M', LIST],
    ['-L', LIST],
    ['2L', LIST],
    ['L\\cdot 2', LIST],
    ['xL', LIST],
    ['aL', LIST],
  ])('%s', (latex, type) => {
    expect(ce.parse(latex).type.toString()).toBe(type);
  });

  test('a sum with a list of points can be assigned to a list of points of the same type', () => {
    const ce = listEngine();
    for (const latex of ['L+(1,1)', 'L+P', 'L-P', 'L+M', '2L'])
      expect(() => ce.assign('R', ce.parse(latex))).not.toThrow();
  });

  test('the values have the static type', () => {
    const ce = listEngine();
    ce.assign(
      'L',
      ce.box([
        'List',
        ['Tuple', 'PositiveInfinity', 1],
        ['Tuple', 'NaN', 'NegativeInfinity'],
      ])
    );
    ce.assign('P', ce.box(['Tuple', 'NegativeInfinity', 2]));
    for (const latex of ['L+(1,1)', 'L+P', 'L-P', 'P+L']) {
      const e = ce.parse(latex);
      const v = e.evaluate();
      expect(v.type.matches(e.type)).toBe(true);
    }
  });
});

/**
 * A value declared as a point or a list of points
 * (`list<tuple<E, E>> | tuple<E, E>`) is added and scaled arm by arm, and each
 * arm has the types of the sections above: `2U`, `U + U`, `(6, 0) + U`, `-U`
 * and `U/2` all have E components, never `infinity`, which admits the
 * complex infinity. The 3-D union is the same.
 */
describe('EXTENDED REAL POINT-OR-POINT-LIST UNION ARITHMETIC', () => {
  for (const dim of [2, 3]) {
    const point = Array(dim).fill(E).join(', ');
    const declared = `list<tuple<${point}>> | tuple<${point}>`;
    const UNION = `list<tuple<${Array(dim).fill(ET).join(', ')}>> | tuple<${Array(dim).fill(ET).join(', ')}>`;
    const literal = `(${[6, 0, 1].slice(0, dim).join(',')})`;
    function unionEngine(): ComputeEngine {
      const ce = new ComputeEngine();
      ce.declare('a', E);
      ce.declare('U', declared);
      ce.declare('V', declared);
      ce.declare('W', declared);
      return ce;
    }
    const ce = unionEngine();
    test.each<string>([
      '2U',
      'U\\cdot 2',
      'aU',
      '-U',
      'U/2',
      'U+U',
      'U+V',
      'U-V',
      `${literal}+U`,
      `U-${literal}`,
    ])(`${dim}-D: %s`, (latex) => {
      expect(ce.parse(latex).type.toString()).toBe(UNION);
    });

    test(`${dim}-D: the result can be assigned to a symbol of the union type`, () => {
      const ce = unionEngine();
      for (const latex of ['2U', 'U+V', `${literal}+U`, 'U/2'])
        expect(() => ce.assign('W', ce.parse(latex))).not.toThrow();
    });

    test(`${dim}-D: the values have the static type`, () => {
      const ce = unionEngine();
      const p = ['PositiveInfinity', 'NaN', 'NegativeInfinity'].slice(0, dim);
      const q = [1, 'NegativeInfinity', 0.5].slice(0, dim);
      for (const [u, v] of [
        [['Tuple', ...p], ['Tuple', ...q]],
        [['List', ['Tuple', ...p], ['Tuple', ...q]], ['Tuple', ...q]],
        [['Tuple', ...q], ['List', ['Tuple', ...p], ['Tuple', ...q]]],
        [
          ['List', ['Tuple', ...p]],
          ['List', ['Tuple', ...q]],
        ],
      ]) {
        ce.assign('U', ce.box(u as any));
        ce.assign('V', ce.box(v as any));
        for (const latex of ['2U', 'U+V', 'U-V', `${literal}+U`]) {
          const e = ce.parse(latex);
          const value = e.evaluate();
          expect(value.type.matches(e.type)).toBe(true);
        }
      }
    });
  }
});

/**
 * Two lists of points whose components are themselves points are added
 * point by point, and every imaginary component is closed at each depth:
 * `[((i, i), 1)] + [((-i, -i), 2)]` is `[((0, 0), 3)]`, which is real.
 */
describe('NESTED POINT LIST SUM', () => {
  test('an imaginary component of a nested point is complex', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'list<tuple<tuple<imaginary, imaginary>, integer>>');
    ce.declare('B', 'list<tuple<tuple<imaginary, imaginary>, integer>>');
    const e = ce.parse('A+B');
    expect(e.type.toString()).not.toContain('imaginary');
    ce.assign('A', ce.box(['List', ['Tuple', ['Tuple', 'ImaginaryUnit', 'ImaginaryUnit'], 1]]));
    ce.assign('B', ce.box(['List', ['Tuple', ['Tuple', ['Negate', 'ImaginaryUnit'], ['Negate', 'ImaginaryUnit']], 2]]));
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});
