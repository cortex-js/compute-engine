import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const operators = ['Covariance', 'PopulationCovariance', 'Correlation'];

/** A lazy source: each element is computed when the operator reads it. */
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

describe('paired statistics and a Nothing observation', () => {
  test.each(operators)(
    '%s gives an incompatible-type error for a Nothing observation',
    (op) => {
      const ce = new ComputeEngine();
      const result = ce
        .function(op, [
          raw(ce, [1, 'Nothing', 3], 'Left'),
          raw(ce, [10, 20, 30], 'Right'),
        ])
        .evaluate();
      expect(result.operator).toBe('Error');
      expect(JSON.stringify(result.json)).toMatch(/incompatible-type/);
    }
  );

  test('a malformed pair gives an error', () => {
    const ce = new ComputeEngine();
    ce.declare('BadRow', {
      signature: '(integer) -> any',
      evaluate: ([x]) => ce._fn('Tuple', [x, ce.number(5), ce.number(8)]),
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

  test.each(operators)('%s evaluates each source element only once', (op) => {
    const ce = new ComputeEngine();
    let left = 0;
    let right = 0;
    const xs = raw(ce, [1, 2, 3], 'Left', () => left++);
    const ys = raw(ce, [10, 20, 30], 'Right', () => right++);
    ce.function(op, [xs, ys]).evaluate();
    expect([left, right]).toEqual([3, 3]);
  });

  test.each(operators)('%s retains raw length mismatch diagnostics', (op) => {
    const ce = new ComputeEngine();
    const result = ce
      .function(op, [raw(ce, [1, 2, 3], 'Left'), raw(ce, [10, 30], 'Right')])
      .evaluate();
    expect(result.toString()).toMatch(/incompatible-dimensions.*3 vs 2/);
  });

  test.each(operators)('%s propagates a retained Missing value', (op) => {
    const ce = new ComputeEngine();
    const retained = ce
      .function(op, [
        raw(ce, [1, 'Missing', 3], 'MoreLeft'),
        ce.box(['List', 10, 20, 30]),
      ])
      .evaluate();
    // A retained `Missing` datum gives `Missing` (`NaN` before 2026-11-02).
    expect(retained.symbol).toBe('Missing');
  });

  test.each(operators)(
    '%s refuses compiled sources whose elements can be Nothing',
    (op) => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<real | nothing>');
      ce.declare('ys', 'list<real>');
      for (const to of ['javascript', 'python'] as const) {
        const compiled = compile(ce.box([op, 'xs', 'ys']), { to });
        expect(compiled.success).toBe(false);
        // The operand type is not a subtype of the parameter type.
        expect(compiled.error).toMatch(/incompatible-type/);
      }
    }
  );
});
