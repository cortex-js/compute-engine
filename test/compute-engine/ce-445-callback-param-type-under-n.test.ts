import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// The parameter of a function literal passed to `Map` has no annotation. The
// engine types it from the elements of the source (`integer` for
// `Range(1, 3)`). An assignment to the parameter in the body is checked
// against that type by `evaluate()`. The numeric routes (`.N()` and
// `evaluate({ numericApproximation: true })`) must make the same check: they
// rebuild the callback to approximate each element, and the rebuilt callback
// lost the inferred type, so any value was accepted (ROADMAP CE-445).

const ce = new ComputeEngine();

function allRoutes(json: MathJsonExpression): [string, string, string] {
  const expr = ce.box(json);
  return [
    expr.evaluate().toString(),
    expr.N().toString(),
    expr.evaluate({ numericApproximation: true }).toString(),
  ];
}

function callback(
  body: MathJsonExpression,
  source: MathJsonExpression = ['Range', 1, 3]
): MathJsonExpression {
  return ['Map', ['Function', ['Block', body, 'q'], 'q'], source];
}

function inClosure(json: MathJsonExpression): MathJsonExpression {
  // The callback reads `c`, a local of the enclosing block. This takes the
  // other branch of the numeric rebuild, which applies the callback as it is.
  return ['Block', ['Assign', 'c', 2], json];
}

describe('CE-445: an inferred callback parameter type under the numeric routes', () => {
  test('assigning a non-integer real is refused on every route', () => {
    for (const r of allRoutes(callback(['Assign', 'q', ['Add', 'q', 0.5]])))
      expect(r).toMatch(/incompatible-type", "integer", "real"/);
  });

  test('assigning a list is refused on every route', () => {
    for (const r of allRoutes(callback(['Assign', 'q', ['List', 1, 2]])))
      expect(r).toMatch(/incompatible-type", "integer", "vector<integer\^2>"/);
  });

  test('a list source gives the same result', () => {
    for (const r of allRoutes(
      callback(['Assign', 'q', ['Add', 'q', 0.5]], ['List', 1, 2, 3])
    ))
      expect(r).toMatch(/incompatible-type", "integer", "real"/);
  });

  test('a float that is an integer value is accepted on every route', () => {
    expect(allRoutes(callback(['Assign', 'q', ['Add', 'q', 1.0]]))).toEqual([
      '[2,3,4]',
      '[2,3,4]',
      '[2,3,4]',
    ]);
  });

  test('a rational source still approximates its elements', () => {
    expect(
      allRoutes(
        callback(
          ['Assign', 'q', ['Add', 'q', 1]],
          ['List', ['Rational', 1, 2], ['Rational', 1, 3]]
        )
      )
    ).toEqual([
      '[3/2,4/3]',
      '[1.5,1.33333333333333333333]',
      '[1.5,1.33333333333333333333]',
    ]);
  });

  describe('a callback that reads a local of an enclosing block', () => {
    test('assigning a non-integer real is refused on every route', () => {
      for (const r of allRoutes(
        inClosure(callback(['Assign', 'q', ['Add', 'q', 0.5]]))
      ))
        expect(r).toMatch(/incompatible-type", "integer", "real"/);
    });

    test('assigning a string is refused on every route', () => {
      for (const r of allRoutes(
        inClosure(callback(['Assign', 'q', { str: 'a' }] as MathJsonExpression))
      ))
        expect(r).toMatch(/incompatible-type", "integer", "string"/);
    });

    test('a rational source gets float arguments under N', () => {
      expect(
        allRoutes(
          inClosure([
            'Map',
            ['Function', ['Divide', 'q', 'c'], 'q'],
            ['List', ['Rational', 1, 2], ['Rational', 1, 3]],
          ])
        )
      ).toEqual([
        '[1/4,1/6]',
        '[0.25,0.166666666666666666667]',
        '[0.25,0.166666666666666666667]',
      ]);
    });
  });

  describe('the N operator over a lazy Map', () => {
    // `N(Map(…))` takes another route than the `.N()` method: it applies
    // the callback to the elements inside `N` (`elementOf()`, core.ts).
    const viaN = (json: MathJsonExpression, digits?: number): string =>
      ce
        .box(digits === undefined ? ['N', json] : ['N', json, digits])
        .evaluate()
        .toString();

    test('assigning a non-integer real is refused', () => {
      const json = callback(['Assign', 'q', ['Add', 'q', 0.5]]);
      expect(viaN(json)).toMatch(/incompatible-type", "integer", "real"/);
      expect(viaN(json, 30)).toMatch(/incompatible-type", "integer", "real"/);
    });

    test('assigning a string is refused', () => {
      expect(
        viaN(callback(['Assign', 'q', { str: 'a' }] as MathJsonExpression))
      ).toMatch(/incompatible-type", "integer", "string"/);
    });

    test('a float that is an integer value is accepted', () => {
      expect(viaN(callback(['Assign', 'q', ['Add', 'q', 1.0]]))).toBe(
        '[2,3,4]'
      );
    });

    test('a rational source gets float arguments', () => {
      expect(
        viaN(
          callback(
            ['Assign', 'q', ['Add', 'q', 1]],
            ['List', ['Rational', 1, 2], ['Rational', 1, 3]]
          )
        )
      ).toBe('[1.5,1.33333333333333333333]');
    });
  });

  describe('a declared symbol gives the same result on both routes', () => {
    test('in a block', () => {
      for (const r of allRoutes([
        'Block',
        ['Declare', 'q', "'integer'"],
        ['Assign', 'q', 0.5],
        'q',
      ]))
        expect(r).toMatch(/incompatible-type", "integer", "0.5"/);
      expect(
        allRoutes([
          'Block',
          ['Declare', 'q', "'integer'"],
          ['Assign', 'q', 2.0],
          'q',
        ])
      ).toEqual(['2', '2', '2']);
    });

    test('at the top level', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('q', 'integer');
      expect(ce2.box(['Assign', 'q', 0.5]).evaluate().toString()).toMatch(
        /incompatible-type/
      );
      expect(ce2.box(['Assign', 'q', 0.5]).N().toString()).toMatch(
        /incompatible-type/
      );
      expect(
        ce2
          .box(['Assign', 'q', ['List', 1, 2]])
          .N()
          .toString()
      ).toMatch(/incompatible-type/);
    });
  });
});
