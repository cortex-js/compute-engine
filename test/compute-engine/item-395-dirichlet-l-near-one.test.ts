/**
 * #395: `DirichletL(k, j, s)` of a real character next to s = 1, where the
 * Hurwitz form cancels its poles and the value comes from the Laurent series
 * at s = 1. Reference values are mpmath's `dirichlet(s, chi)` at 160 digits,
 * chi the Legendre symbol mod k (the quadratic character: j = 51 mod 101,
 * j = 499 mod 997).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';

const ce = new ComputeEngine();

const nearOne = (k: number, j: number, exponent: number) =>
  ce.box(['DirichletL', k, j, ['Add', 1, ['Power', 10, -exponent]]] as never);

const withPrecision = <T>(digits: number, f: () => T): T => {
  const saved = ce.precision;
  ce.precision = digits;
  try {
    return f();
  } finally {
    ce.precision = saved;
  }
};

describe('DirichletL of a real character next to s = 1', () => {
  test.each([
    [101, 51, 20, 30, '0.596668668017519143503351635082'],
    // s as a double is 1 here: the Hurwitz form cannot run at all.
    [101, 51, 16, 30, '0.596668668017519153402794009361'],
    [101, 51, 40, 30, '0.596668668017519143502361591841'],
    [997, 499, 20, 30, '0.762776260266816649276769072319'],
    [
      101,
      51,
      20,
      100,
      '0.5966686680175191435033516350823425893810716999460884482423825005357174322205056311582614206009010835',
    ],
  ])('DirichletL(%i, %i, 1 + 10^-%i) at %i digits', (k, j, e, digits, want) => {
    withPrecision(digits, () => {
      expect(nearOne(k, j, e).N().toString()).toBe(want);
    });
  });

  // The series would take seconds: the head stays unevaluated at once.
  test('past the cost cap the value stays unevaluated', () => {
    withPrecision(100, () => {
      const start = Date.now();
      expect(nearOne(997, 499, 20).N().operator).toBe('DirichletL');
      expect(Date.now() - start).toBeLessThan(500);
    });
  });

  test('the series checks the deadline', () => {
    withPrecision(30, () => {
      expect(() =>
        ce._withBudget({ steps: 2, label: 'test:timeout' }, () =>
          nearOne(997, 499, 20).N()
        )
      ).toThrow(CancellationError);
    });
  });
});

describe('StieltjesGamma at a high precision', () => {
  test('the kernel checks the deadline', () => {
    withPrecision(1000, () => {
      expect(() =>
        ce._withBudget({ steps: 2, label: 'test:timeout' }, () =>
          ce.box(['StieltjesGamma', 5, ['Rational', 1, 3]]).N()
        )
      ).toThrow(CancellationError);
    });
  });
});
