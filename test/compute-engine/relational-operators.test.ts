import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('Approximate equality operators', () => {
  describe('Approx (≈)', () => {
    test('Equal numbers are approximately equal', () => {
      expect(ce.expr(['Approx', 3, 3]).evaluate().json).toBe('True');
    });

    test('Numbers within tolerance are approximately equal', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['Approx', 1, 1 + tol / 2]).evaluate().json
      ).toBe('True');
    });

    test('Numbers outside tolerance are not approximately equal', () => {
      expect(ce.expr(['Approx', 1, 2]).evaluate().json).toBe('False');
    });

    test('Pi ≈ 3.14159265 within tolerance', () => {
      expect(
        ce.expr(['Approx', 'Pi', 3.141592653589793]).evaluate().json
      ).toBe('True');
    });

    test('Pi is not approximately 3', () => {
      expect(ce.expr(['Approx', 'Pi', 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: all close', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['Approx', 1, 1 + tol / 3, 1 + tol / 4]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: one pair not close', () => {
      expect(
        ce.expr(['Approx', 1, 1.0000001, 5]).evaluate().json
      ).toBe('False');
    });

    test('Single argument returns True', () => {
      expect(ce.expr(['Approx', 3]).evaluate().json).toBe('True');
    });

    test('Symbolic arguments return undefined', () => {
      const result = ce.expr(['Approx', 'x', 'y']).evaluate();
      // When evaluate can't determine a result, it returns the expression
      expect(result.operator).toBe('Approx');
    });
  });

  describe('TildeFullEqual (≅)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['TildeFullEqual', 5, 5]).evaluate().json).toBe('True');
    });

    test('Numbers within tolerance', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['TildeFullEqual', 2, 2 + tol / 2]).evaluate().json
      ).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['TildeFullEqual', 1, 2]).evaluate().json
      ).toBe('False');
    });
  });

  describe('TildeEqual (≃)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['TildeEqual', 7, 7]).evaluate().json).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['TildeEqual', 1, 100]).evaluate().json
      ).toBe('False');
    });
  });

  describe('ApproxEqual (≊)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['ApproxEqual', 10, 10]).evaluate().json).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['ApproxEqual', 0, 1]).evaluate().json
      ).toBe('False');
    });
  });

  describe('ApproxNotEqual', () => {
    test('Different numbers are approximately not equal', () => {
      expect(
        ce.expr(['ApproxNotEqual', 1, 2]).evaluate().json
      ).toBe('True');
    });

    test('Close numbers are not approximately-not-equal', () => {
      expect(
        ce.expr(['ApproxNotEqual', 5, 5]).evaluate().json
      ).toBe('False');
    });
  });
});

describe('Negated approximate equality operators', () => {
  describe('NotApprox', () => {
    test('Different numbers', () => {
      expect(ce.expr(['NotApprox', 1, 2]).evaluate().json).toBe('True');
    });

    test('Same numbers', () => {
      expect(ce.expr(['NotApprox', 3, 3]).evaluate().json).toBe('False');
    });
  });

  describe('NotTildeFullEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotTildeFullEqual', 1, 100]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotTildeFullEqual', 5, 5]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotTildeEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotTildeEqual', 1, 50]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotTildeEqual', 7, 7]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotApproxEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotApproxEqual', 0, 1]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotApproxEqual', 10, 10]).evaluate().json
      ).toBe('False');
    });
  });
});

describe('Ordering operators', () => {
  describe('Precedes (≺)', () => {
    test('2 ≺ 5', () => {
      expect(ce.expr(['Precedes', 2, 5]).evaluate().json).toBe('True');
    });

    test('5 ≺ 2 is false', () => {
      expect(ce.expr(['Precedes', 5, 2]).evaluate().json).toBe('False');
    });

    test('3 ≺ 3 is false', () => {
      expect(ce.expr(['Precedes', 3, 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: 1 ≺ 2 ≺ 3', () => {
      expect(
        ce.expr(['Precedes', 1, 2, 3]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: 1 ≺ 3 ≺ 2 is false', () => {
      expect(
        ce.expr(['Precedes', 1, 3, 2]).evaluate().json
      ).toBe('False');
    });

    test('Symbolic arguments return undefined', () => {
      const result = ce.expr(['Precedes', 'x', 'y']).evaluate();
      expect(result.operator).toBe('Precedes');
    });
  });

  describe('Succeeds (≻)', () => {
    test('5 ≻ 2', () => {
      expect(ce.expr(['Succeeds', 5, 2]).evaluate().json).toBe('True');
    });

    test('2 ≻ 5 is false', () => {
      expect(ce.expr(['Succeeds', 2, 5]).evaluate().json).toBe('False');
    });

    test('3 ≻ 3 is false', () => {
      expect(ce.expr(['Succeeds', 3, 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: 3 ≻ 2 ≻ 1', () => {
      expect(
        ce.expr(['Succeeds', 3, 2, 1]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: 3 ≻ 1 ≻ 2 is false', () => {
      expect(
        ce.expr(['Succeeds', 3, 1, 2]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotPrecedes', () => {
    test('5 does not precede 2', () => {
      expect(ce.expr(['NotPrecedes', 5, 2]).evaluate().json).toBe('True');
    });

    test('2 does not precede 5 is false', () => {
      expect(ce.expr(['NotPrecedes', 2, 5]).evaluate().json).toBe('False');
    });
  });

  describe('NotSucceeds', () => {
    test('2 does not succeed 5', () => {
      expect(ce.expr(['NotSucceeds', 2, 5]).evaluate().json).toBe('True');
    });

    test('5 does not succeed 2 is false', () => {
      expect(ce.expr(['NotSucceeds', 5, 2]).evaluate().json).toBe('False');
    });
  });
});

describe('LaTeX round-trip', () => {
  test('\\approx parses and evaluates', () => {
    const expr = ce.parse('3.14 \\approx 3.14');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\cong parses and evaluates', () => {
    const expr = ce.parse('5 \\cong 5');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\prec parses and evaluates', () => {
    const expr = ce.parse('1 \\prec 2');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\succ parses and evaluates', () => {
    const expr = ce.parse('5 \\succ 3');
    expect(expr.evaluate().json).toBe('True');
  });
});
