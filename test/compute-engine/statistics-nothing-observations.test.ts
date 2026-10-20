import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const operators = ['Covariance', 'PopulationCovariance', 'Correlation'];

/** A lazy source preserves raw omitted cells; a List constructor removes them. */
function raw(
  ce: ComputeEngine,
  values: (number | string)[],
  name: string,
  onRead?: () => void
): Expression {
  ce.declare(name, {
    signature: '(integer) -> any',
    pure: false,
    evaluate: ([index]) => {
      onRead?.();
      return ce.box(values[index.re - 1]);
    },
  });
  return ce.box(['Map', name, ['Range', 1, values.length]]).evaluate();
}

describe('paired statistics omit whole observations', () => {
  test.each(operators)(
    '%s supports omitted rows and coordinates in pair input',
    (op) => {
      const ce = new ComputeEngine();
      let reads = 0;
      ce.declare('RowAt', {
        signature: '(integer) -> any',
        pure: false,
        evaluate: ([x]) => {
          reads++;
          if (x.re === 2) return ce.Nothing;
          return ce._fn('Tuple', [
            x,
            x.re === 4 ? ce.Nothing : ce.number(x.re === 5 ? 100 : x.re * 10),
          ]);
        },
      });
      const rows = ce.box(['Map', 'RowAt', ['Range', 1, 5]]).evaluate();
      const actual = ce.function(op, [rows]).evaluate();
      expect(reads).toBe(5);
      expect(
        actual.isSame(
          ce.box([op, ['List', 1, 3, 5], ['List', 10, 30, 100]]).evaluate()
        )
      ).toBe(true);
    }
  );

  test('omission does not excuse a malformed pair', () => {
    const ce = new ComputeEngine();
    ce.declare('BadRow', {
      signature: '(integer) -> any',
      evaluate: ([x]) => ce._fn('Tuple', [x, ce.Nothing, ce.number(8)]),
    });
    const rows = ce.box(['Map', 'BadRow', ['Range', 1, 3]]).evaluate();
    expect(ce.function('Covariance', [rows]).evaluate().operator).toBe('Error');
  });

  test('compilation refuses optional pair coordinates', () => {
    const ce = new ComputeEngine();
    ce.declare('rows', 'list<tuple<integer | nothing, integer>>');
    const compiled = compile(ce.box(['Covariance', 'rows']));
    expect(compiled.success).toBe(false);
    expect(compiled.error).toMatch(/Nothing/);
  });

  test.each(operators)('%s uses a common retained set for every term', (op) => {
    const ce = new ComputeEngine();
    const xs = raw(ce, [1, 'Nothing', 3, 4, 5], 'Left');
    const ys = raw(ce, [10, 20, 30, 'Nothing', 100], 'Right');
    const result = ce.function(op, [xs, ys]).evaluate();
    const expected = ce
      .box([op, ['List', 1, 3, 5], ['List', 10, 30, 100]])
      .evaluate();
    expect(result.isSame(expected)).toBe(true);
    expect(xs.count).toBe(5);
    expect(ys.count).toBe(5);
  });

  test.each(operators)('%s evaluates each source element only once', (op) => {
    const ce = new ComputeEngine();
    let left = 0;
    let right = 0;
    const xs = raw(ce, [1, 'Nothing', 3], 'Left', () => left++);
    const ys = raw(ce, [10, 20, 30], 'Right', () => right++);
    ce.function(op, [xs, ys]).evaluate();
    expect([left, right]).toEqual([3, 3]);
  });

  test.each(operators)('%s retains raw length mismatch diagnostics', (op) => {
    const ce = new ComputeEngine();
    const result = ce
      .function(op, [
        raw(ce, [1, 'Nothing', 3], 'Left'),
        raw(ce, [10, 30], 'Right'),
      ])
      .evaluate();
    expect(result.toString()).toMatch(/incompatible-dimensions.*3 vs 2/);
  });

  test.each(operators)(
    '%s applies its empty-input rule after all observations are omitted',
    (op) => {
      const ce = new ComputeEngine();
      const omitted = ce
        .function(op, [
          raw(ce, ['Nothing', 'Nothing'], 'Left'),
          raw(ce, [1, 2], 'Right'),
        ])
        .evaluate();
      expect(omitted.isSame(ce.box([op, ['List'], ['List']]).evaluate())).toBe(
        true
      );
    }
  );

  test.each(operators)(
    '%s propagates retained missing values, not skipped observations',
    (op) => {
      const ce = new ComputeEngine();
      const skipped = ce
        .function(op, [
          raw(ce, [1, 'Nothing', 3], 'Left'),
          raw(ce, [10, 'Missing', 30], 'Right'),
        ])
        .evaluate();
      expect(
        skipped.isSame(
          ce.box([op, ['List', 1, 3], ['List', 10, 30]]).evaluate()
        )
      ).toBe(true);
      const retained = ce
        .function(op, [
          raw(ce, [1, 'Missing', 3], 'MoreLeft'),
          ce.box(['List', 10, 20, 30]),
        ])
        .evaluate();
      expect(retained.isNaN).toBe(true);
    }
  );

  test.each(['machine', 50] as const)(
    'numeric precision %s uses only retained data',
    (precision) => {
      const ce = new ComputeEngine();
      ce.precision = precision;
      for (const op of operators) {
        const xs = raw(ce, [1.5, 'Nothing', 3.5], 'Left' + op);
        const ys = raw(ce, [10, 200, 30], 'Right' + op);
        const actual = ce.function(op, [xs, ys]).N();
        const expected = ce.box([op, ['List', 1.5, 3.5], ['List', 10, 30]]).N();
        expect(actual.re).toBeCloseTo(expected.re, 12);
      }
    }
  );

  test.each(operators)(
    '%s refuses compiled sources with possible omissions',
    (op) => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<real | nothing>');
      ce.declare('ys', 'list<real>');
      for (const to of ['javascript', 'python'] as const) {
        const compiled = compile(ce.box([op, 'xs', 'ys']), { to });
        expect(compiled.success).toBe(false);
        expect(compiled.error).toMatch(/Nothing/);
      }
    }
  );
});
