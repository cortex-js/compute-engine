import { ComputeEngine } from '../../src/compute-engine';

/**
 * Collection-aware result typing for `Multiply` (and the `Add` widening it
 * feeds) on DECLARED matrix/vector symbols — decision (d) of the
 * matrix-operator typing design: make the declared path airtight.
 *
 * NOTE: declaring `matrix`/`vector` types retypes a symbol for the engine's
 * lifetime, so each test uses a FRESH `new ComputeEngine()` and never touches
 * the shared test engine.
 */
describe('Matrix-operator typing (declared symbols)', () => {
  function engine() {
    const ce = new ComputeEngine();
    ce.declare('X', 'matrix');
    ce.declare('Y', 'matrix');
    ce.declare('v', 'vector');
    return ce;
  }

  test('scalar × matrix → matrix', () => {
    const e = engine().parse('2Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('matrix − matrix → matrix (poison via canonical -1·Y term)', () => {
    const e = engine().parse('X-Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('scalar·matrix + scalar·matrix → matrix', () => {
    const e = engine().parse('3X+2Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('matrix × matrix → matrix', () => {
    const e = engine().parse('XY');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('det(matrix × matrix) is valid and typed number', () => {
    const e = engine().parse('\\det(XY)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  test('Trace(scalar × matrix) → number', () => {
    const e = engine().parse('\\operatorname{Trace}(2Y)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  test('scalar × vector → vector (v’s declared type)', () => {
    const ce = engine();
    const e = ce.parse('2v');
    expect(e.isValid).toBe(true);
    // `vector` is the alias for `list<number>`; the product carries v's type.
    expect(e.type.toString()).toBe(ce.symbol('v').type.toString());
  });

  // --- Already-correct rows: guard against regression ---

  test('matrix + matrix → matrix', () => {
    expect(engine().parse('X+Y').type.toString()).toBe('matrix');
  });

  test('-matrix → matrix', () => {
    expect(engine().parse('-Y').type.toString()).toBe('matrix');
  });

  test('matrix^2 → matrix', () => {
    expect(engine().parse('X^2').type.toString()).toBe('matrix');
  });

  test('matrix^{-1} → matrix', () => {
    expect(engine().parse('X^{-1}').type.toString()).toBe('matrix');
  });

  test('det(matrix + scalar·matrix) → number', () => {
    const e = engine().parse('\\det(X+2Y)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  test('matrix + scalar keeps the honest union (leave as-is)', () => {
    expect(engine().parse('X+1').type.toString()).toBe('finite_integer | matrix');
  });

  test('vector + vector → list<number> (acceptable)', () => {
    expect(engine().parse('v+v').type.toString()).toBe('list<number>');
  });
});

describe('Matrix-operator typing (undeclared symbols)', () => {
  test('det(A+2B) repairs fresh bottom-up numeric inference', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\det(A+2B)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
    expect(ce.symbol('A').type.toString()).toBe('matrix');
    expect(ce.symbol('B').type.toString()).toBe('matrix');
  });

  test('does not rewrite an inference made by an earlier expression', () => {
    const ce = new ComputeEngine();
    ce.parse('A+1');
    const e = ce.parse('\\det(A)');
    expect(e.isValid).toBe(false);
    expect(ce.symbol('A').type.matches('number')).toBe(true);
  });

  test('fails closed for an ambiguous product of fresh symbols', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\det(x y)');
    expect(e.isValid).toBe(false);
  });
});

describe('Multiply numeric typing (regression — must be unchanged)', () => {
  test('(2)(3) types finite_integer and evaluates to 6', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('(2)(3)');
    expect(e.type.toString()).toBe('finite_integer');
    expect(e.evaluate().toString()).toBe('6');
  });

  test('2x for a scalar x is unchanged (finite_number)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('2x').type.toString()).toBe('finite_number');
  });
});

/**
 * Fresh-matrix-inference repair — the P1–P11 behavior matrix (probe-verified
 * 2026-07-18, pinned when the repair's provenance moved from an eager
 * inferred-symbol snapshot to the forward log recorded by
 * `BoxedSymbol.infer()`; see
 * docs/plans/2026-07-18-expected-type-inference-context.md §0). Each test
 * uses a fresh engine: the repair retypes symbols for the engine's lifetime.
 */
describe('Fresh-matrix-inference repair (P-matrix pins)', () => {
  const sym = (ce: ComputeEngine, name: string) =>
    ce.box(name).type.toString();

  test('P1: Det(A+B), both fresh → valid, both matrix', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Determinant', ['Add', 'A', 'B']]).isValid).toBe(true);
    expect(sym(ce, 'A')).toBe('matrix');
    expect(sym(ce, 'B')).toBe('matrix');
  });

  test('P2: prior numeric inference wins — invalid, A stays number', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', 'A', 1]).evaluate();
    expect(ce.box(['Determinant', ['Add', 'A', 'B']]).isValid).toBe(false);
    expect(sym(ce, 'A')).toBe('number');
  });

  test('P3: Det(a·A), both fresh → ambiguous product never guessed', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Determinant', ['Multiply', 'a', 'A']]).isValid).toBe(
      false
    );
    expect(sym(ce, 'a')).toBe('number');
    expect(sym(ce, 'A')).toBe('number');
  });

  test('P4: Det(2·A) → literal scalar is unambiguous, A matrix', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Determinant', ['Multiply', 2, 'A']]).isValid).toBe(true);
    expect(sym(ce, 'A')).toBe('matrix');
  });

  test('P5: Negate / integer Power / Subtract forms all promote', () => {
    {
      const ce = new ComputeEngine();
      expect(ce.box(['Determinant', ['Negate', 'A']]).isValid).toBe(true);
      expect(sym(ce, 'A')).toBe('matrix');
    }
    {
      const ce = new ComputeEngine();
      expect(ce.box(['Determinant', ['Power', 'A', 2]]).isValid).toBe(true);
      expect(sym(ce, 'A')).toBe('matrix');
    }
    {
      const ce = new ComputeEngine();
      expect(ce.box(['Determinant', ['Subtract', 'A', 'B']]).isValid).toBe(
        true
      );
      expect(sym(ce, 'A')).toBe('matrix');
      expect(sym(ce, 'B')).toBe('matrix');
    }
  });

  test('P6: non-strict engine — no repair, fresh symbols infer number', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    expect(ce.box(['Determinant', ['Add', 'A', 'B']]).isValid).toBe(true);
    expect(sym(ce, 'A')).toBe('number');
  });

  test('P7: nested sub-operator — Det(Dot(u,v)): inner signature governs, no matrix promotion', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Determinant', ['Dot', 'u', 'v']]);
    // Dot returns a scalar, so the outer Determinant(matrix) mismatches; the
    // repair must not promote u/v — they carry Dot's own parameter typing.
    expect(e.isValid).toBe(false);
    expect(sym(ce, 'u')).toBe('list<number> | matrix');
    expect(sym(ce, 'v')).toBe('list<number> | matrix');
  });

  test('P8: Det(A·M) with declared M: matrix — no unnecessary promotion', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix');
    expect(ce.box(['Determinant', ['Multiply', 'A', 'M']]).isValid).toBe(
      true
    );
    expect(sym(ce, 'A')).toBe('number');
  });

  test('P9: Det(A·v) with declared v: vector — failed repair rolls A back to number', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'vector');
    expect(ce.box(['Determinant', ['Multiply', 'A', 'v']]).isValid).toBe(
      false
    );
    expect(sym(ce, 'A')).toBe('number');
  });

  test('P10: Det(A/A) — argument folds to 1, invalid, A ends number', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Determinant', ['Divide', 'A', 'A']]).isValid).toBe(false);
    expect(sym(ce, 'A')).toBe('number');
  });

  test('P11: Det(f(A)) — A never enters numeric inference, not force-typed', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Determinant', ['f', 'A']]).isValid).toBe(true);
    expect(sym(ce, 'A')).toBe('unknown');
  });

  test('supplied optional argument still repairs (CharacteristicPolynomial)', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['CharacteristicPolynomial', ['Add', 'A', 'B'], 'x']).isValid
    ).toBe(true);
    expect(sym(ce, 'A')).toBe('matrix');
  });

  test('union parameter (matrix|vector) still repairs (LinearSolve)', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix');
    expect(ce.box(['LinearSolve', 'M', ['Add', 'A', 'B']]).isValid).toBe(
      true
    );
    expect(sym(ce, 'A')).toBe('matrix');
  });

  test('non-plannable term excludes only itself: Det(A + Cos(t)·B)', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Determinant',
      ['Add', 'A', ['Multiply', ['Cos', 't'], 'B']],
    ]);
    expect(e.isValid).toBe(true);
    expect(sym(ce, 't')).toBe('number');
    expect(sym(ce, 'A')).toBe('matrix');
    expect(sym(ce, 'B')).toBe('matrix');
  });
});
