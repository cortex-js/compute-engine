import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { expectTypeBetween } from '../utils';

const statistics = [
  'Mean',
  'Median',
  'Variance',
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
  'Kurtosis',
  'Skewness',
  'Mode',
  'Quartiles',
  'InterquartileRange',
];
const aggregates = [
  'Sum',
  'Product',
  'Min',
  'Max',
  'Infimum',
  'Supremum',
  ...statistics,
];

function fixture(
  values: (number | string)[],
  precision: 'machine' | number = 'machine'
) {
  const ce = new ComputeEngine();
  ce.precision = precision;
  let reads = 0;
  ce.declare('Datum', {
    signature: '(integer) -> any',
    pure: false,
    evaluate: ([i]) => {
      reads++;
      return ce.box(values[i.re - 1]);
    },
  });
  const source = ce.box(['Map', 'Datum', ['Range', 1, values.length]]);
  return { ce, source, reads: () => reads };
}

function sameNumeric(actual: Expression, expected: Expression) {
  if (expected.isNaN) expect(actual.isNaN).toBe(true);
  else if (expected.isNumber && !expected.isExact)
    expect(actual.re).toBeCloseTo(expected.re, 12);
  else expect(actual.isSame(expected)).toBe(true);
}

describe('numeric aggregates skip immediate Nothing without compacting the source', () => {
  test.each(aggregates)(
    '%s agrees with explicitly retained data in one traversal',
    (op) => {
      const { ce, source, reads } = fixture([1, 'Nothing', 3, 4, 5, 5]);
      const actual = ce.function(op, [source]).evaluate();
      const expected = ce.box([op, ['List', 1, 3, 4, 5, 5]]).evaluate();
      sameNumeric(actual, expected);
      expect(reads()).toBe(6);
      expect(source.count).toBe(6);
      expect(reads()).toBe(6);
    }
  );

  test.each(aggregates)(
    '%s uses its ordinary empty-input rule for all-omitted data',
    (op) => {
      const { ce, source, reads } = fixture(['Nothing', 'Nothing', 'Nothing']);
      const actual = ce.function(op, [source]).evaluate();
      const expected = ce.box([op, ['List']]).evaluate();
      sameNumeric(actual, expected);
      expect(reads()).toBe(3);
    }
  );

  test.each(['machine', 50] as const)(
    'numeric precision %s uses retained observations',
    (precision) => {
      for (const op of aggregates) {
        const { ce, source, reads } = fixture(
          [1.5, 'Nothing', 3.5, 4.5, 5.5],
          precision
        );
        const actual = ce.function(op, [source]).N();
        const expected = ce.box([op, ['List', 1.5, 3.5, 4.5, 5.5]]).N();
        sameNumeric(actual, expected);
        expect(reads()).toBe(5);
      }
    }
  );

  test.each(aggregates)('%s still propagates retained Missing', (op) => {
    const { ce, source } = fixture([1, 'Nothing', 'Missing', 3]);
    sameNumeric(
      ce.function(op, [source]).evaluate(),
      ce.box([op, ['List', 1, 'Missing', 3]]).evaluate()
    );
  });

  test.each(statistics)(
    '%s does not silently drop a nonnumeric datum',
    (op) => {
      const { ce, source } = fixture([1, 'Nothing', 'True', 3]);
      expect(ce.function(op, [source]).evaluate().operator).toBe('Error');
    }
  );

  test('Mean counts retained values, while Length and ListFrom keep their separate rules', () => {
    const { ce, source } = fixture([1, 'Nothing', 3]);
    expect(ce.function('Length', [source]).evaluate().re).toBe(3);
    expect(ce.function('Mean', [source]).evaluate().re).toBe(2);
    expect(ce.function('ListFrom', [source]).evaluate().json).toEqual([
      'List',
      1,
      3,
    ]);
  });

  test('Mean does not treat a nested collection as an omitted datum', () => {
    const ce = new ComputeEngine();
    const nested = ce.box(['List', ['List', 1, 3], 5]);
    expect(ce.function('Mean', [nested]).evaluate().operator).toBe('Error');
  });

  test('retained errors still outrank numeric absence', () => {
    const ce = new ComputeEngine();
    ce.declare('Datum', {
      signature: '(integer) -> any',
      pure: false,
      evaluate: ([i]) =>
        i.re === 1
          ? ce.Nothing
          : i.re === 2
            ? ce.NaN
            : ce.error('unexpected-argument'),
    });
    const source = ce.box(['Map', 'Datum', ['Range', 1, 3]]);
    expect(ce.function('Mean', [source]).evaluate().operator).toBe('Error');
  });

  test('Mean, Sum and Product derive numeric types from retained scalar elements', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer | nothing>');
    expectTypeBetween(ce.box(['Mean', 'xs']), { atMost: 'rational | nan' });
    expectTypeBetween(ce.box(['Sum', 'xs']), { atMost: 'integer' });
    expectTypeBetween(ce.box(['Product', 'xs']), { atMost: 'integer' });
    ce.declare('omitted', 'list<nothing>');
    expectTypeBetween(ce.box(['Product', 'omitted']), { atMost: 'integer' });
    expectTypeBetween(ce.box(['Sum', 'omitted']), { atMost: 'integer' });
    expectTypeBetween(ce.box(['Mean', 'omitted']), {
      atMost: 'rational | nan',
    });
  });

  test.each(aggregates)('%s refuses compiled omission-capable inputs', (op) => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer | nothing>');
    for (const to of ['javascript', 'python'] as const) {
      const result = compile(ce.box([op, 'xs']), { to });
      expect(result.success).toBe(false);
      // Some targets do not support the operator at all; either refusal is sound.
      if (op !== 'Infimum' && op !== 'Supremum')
        expect(result.error).toMatch(/Nothing/);
    }
  });

  test('compiled union sources are checked arm by arm', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer | nothing> | tuple<integer, integer>');
    expect(compile(ce.box(['Mean', 'xs'])).success).toBe(false);
  });

  test('compiled tuple sources cannot hide omission through their common element type', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'tuple<integer | nothing, integer>');
    const result = compile(ce.box(['Mean', 'xs']));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Nothing/);
  });

  test.each(['Sum', 'Product', 'Mean'])(
    '%s keeps the omission rule under evaluateAsync',
    async (op) => {
      const { ce, source, reads } = fixture([1, 'Nothing', 3]);
      sameNumeric(
        await ce.function(op, [source]).evaluateAsync(),
        ce.box([op, ['List', 1, 3]]).evaluate()
      );
      expect(reads()).toBe(3);
    }
  );

  test.each(['row', 'call'] as const)(
    'Sum of a collection-valued %s keeps its numeric type and compile refusal',
    (kind) => {
      const ce = new ComputeEngine();
      ce.declare('rows', 'list<list<integer | nothing>>');
      ce.declare('producer', '(integer) -> list<integer | nothing>');
      ce.declare('index', 'integer');
      const source =
        kind === 'row'
          ? ce.box(['At', 'rows', 1])
          : ce.box(['producer', 'index']);
      const sum = ce.function('Sum', [source]);
      // Sum's collection canonicalization deliberately preserves the aggregate head.
      expect(sum.operator).toBe('Sum');
      expectTypeBetween(sum, { atMost: 'number' });
      const result = compile(sum);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing/);
    }
  );

  test('ordinary numeric Mean still compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<real>');
    const result = compile(ce.box(['Mean', 'xs']));
    expect(result.success).toBe(true);
    expect(result.run!({ xs: [1, 3] })).toBe(2);
  });
});
