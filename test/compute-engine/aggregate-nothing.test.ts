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

describe('numeric aggregates over a Nothing element', () => {
  test.each(aggregates)('%s still propagates retained Missing', (op) => {
    const { ce, source } = fixture([1, 'Missing', 3]);
    sameNumeric(
      ce.function(op, [source]).evaluate(),
      ce.box([op, ['List', 1, 'Missing', 3]]).evaluate()
    );
  });

  test.each(statistics)(
    '%s does not silently drop a nonnumeric datum',
    (op) => {
      const { ce, source } = fixture([1, 'True', 3]);
      expect(ce.function(op, [source]).evaluate().operator).toBe('Error');
    }
  );

  test('a Nothing element is kept: Length and ListFrom count it, Mean gives an incompatible-type error', () => {
    const { ce, source } = fixture([1, 'Nothing', 3]);
    expect(ce.function('Length', [source]).evaluate().re).toBe(3);
    const mean = ce.function('Mean', [source]).evaluate();
    expect(mean.operator).toBe('Error');
    expect(JSON.stringify(mean.json)).toMatch(/incompatible-type/);
    expect(ce.function('ListFrom', [source]).evaluate().json).toEqual([
      'List',
      1,
      'Nothing',
      3,
    ]);
  });

  test('a sum or product of one Nothing term gives the error of two terms', () => {
    const ce = new ComputeEngine();
    for (const op of ['Sum', 'Product']) {
      const one = ce.box([op, ['List', 'Nothing']]).evaluate();
      const two = ce.box([op, ['List', 1, 'Nothing']]).evaluate();
      expect(one.operator).toBe('Error');
      expect(one.op1.json).toEqual(two.op1.json);
    }
  });

  test.each(['Max', 'Min', 'Supremum', 'Infimum'])(
    '%s: a Nothing datum is an error, which outranks NaN',
    (op) => {
      const ce = new ComputeEngine();
      const result = ce.box([op, ['List', 'NaN', 'Nothing']]).evaluate();
      expect(result.operator).toBe('Error');
      expect(JSON.stringify(result.json)).toMatch(/incompatible-type/);
    }
  );

  test('Mean does not treat a nested collection as a number', () => {
    const ce = new ComputeEngine();
    const nested = ce.box(['List', ['List', 1, 3], 5]);
    expect(ce.function('Mean', [nested]).evaluate().operator).toBe('Error');
  });

  test.each(aggregates)(
    '%s refuses compiled inputs that can hold Nothing',
    (op) => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<integer | nothing>');
      for (const to of ['javascript', 'python'] as const) {
        const result = compile(ce.box([op, 'xs']), { to });
        expect(result.success).toBe(false);
        // Some targets do not support the operator at all; either refusal is sound.
        if (op !== 'Infimum' && op !== 'Supremum')
          expect(result.error).toMatch(/Nothing/);
      }
    }
  );

  test('compiled union sources are checked arm by arm', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer | nothing> | tuple<integer, integer>');
    expect(compile(ce.box(['Mean', 'xs'])).success).toBe(false);
  });

  test('compiled tuple sources cannot hide Nothing through their common element type', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'tuple<integer | nothing, integer>');
    const result = compile(ce.box(['Mean', 'xs']));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Nothing/);
  });

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
