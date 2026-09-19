import { ComputeEngine } from '../../src/compute-engine';

/**
 * The static type of `PointList` over list components carries the list's
 * WIDTH when every list component carries one and they agree, as the
 * evaluated value does. A consumer that declares a symbol from the static
 * type (`Q = PointList(…)`) then keeps the width for the reads that need it
 * (`PointX(Q)` types `vector<n>`, not `list<number>`).
 */
describe('POINTLIST STATIC WIDTH', () => {
  const ce = new ComputeEngine();
  const typeOf = (latex: string) => ce.parse(latex).type.toString();

  test('list components of one width give that width', () => {
    expect(
      typeOf(
        '\\operatorname{PointList}(\\lbrack0.1, 0.4, 0.8\\rbrack, \\lbrack0.2, 0.7, 0.3\\rbrack)'
      )
    ).toBe('list<tuple<real, real>^3>');
    // The static type agrees with the value's.
    expect(
      ce
        .parse(
          '\\operatorname{PointList}(\\lbrack0.1, 0.4, 0.8\\rbrack, \\lbrack0.2, 0.7, 0.3\\rbrack)'
        )
        .evaluate()
        .type.toString()
    ).toBe('list<tuple<real, real>^3>');
  });

  test('a scalar component is repeated and does not affect the width', () => {
    expect(typeOf('\\operatorname{PointList}(\\lbrack1,2,3\\rbrack, 5)')).toBe(
      'list<tuple<integer, integer>^3>'
    );
  });

  test('a declared vector width is carried too', () => {
    const engine = new ComputeEngine();
    engine.declare('V', 'vector<4>');
    expect(
      engine.parse('\\operatorname{PointList}(V, V)').type.toString()
    ).toBe('list<tuple<number, number>^4>');
    expect(
      engine
        .parse('\\operatorname{PointX}(\\operatorname{PointList}(V, V))')
        .type.toString()
    ).toBe('vector<4>');
  });

  test('components of different widths pair up to the shortest', () => {
    // `PointList([1,2,3], [4,5])` is two points (the pairing contract of
    // `docs/BROADCAST-MODEL.md`), and the type says so.
    const source =
      '\\operatorname{PointList}(\\lbrack1,2,3\\rbrack, \\lbrack4,5\\rbrack)';
    expect(typeOf(source)).toBe('list<tuple<integer, integer>^2>');
    expect(ce.parse(source).evaluate().json).toEqual([
      'List',
      ['Tuple', 1, 4],
      ['Tuple', 2, 5],
    ]);
  });

  test('an unknown width leaves the width off', () => {
    const engine = new ComputeEngine();
    engine.declare('L', 'list<number>');
    expect(
      engine
        .parse('\\operatorname{PointList}(L, \\lbrack4,5\\rbrack)')
        .type.toString()
    ).toBe('list<tuple<number, integer>>');
  });
});
