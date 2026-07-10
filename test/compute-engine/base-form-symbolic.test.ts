import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';

/**
 * Symbolic-base numerals: a decimal numeral subscripted by a *symbol*
 * (`161_b`, `161_{b}`) parses to `BaseForm(digitPolynomial, b)`, where the
 * value slot is the positional expansion of the digits in the base symbol.
 * The polynomial makes arithmetic and solving work; the base symbol lets the
 * serializer reconstruct the numeral. See `parseBaseFormNumeral` /
 * `baseFormSymbolicDigits` in `latex-syntax/dictionary/definitions-core.ts`.
 */

describe('Symbolic-base numerals — parse', () => {
  test('multi-digit numeral → BaseForm of digit polynomial', () => {
    expect(ce.parse('161_{b}').json).toEqual([
      'BaseForm',
      ['Add', ['Power', 'b', 2], ['Multiply', 6, 'b'], 1],
      'b',
    ]);
  });

  test('unbraced symbolic base parses the same', () => {
    expect(ce.parse('161_b').json).toEqual([
      'BaseForm',
      ['Add', ['Power', 'b', 2], ['Multiply', 6, 'b'], 1],
      'b',
    ]);
  });

  test('single-digit numeral → BaseForm(digit, b)', () => {
    expect(ce.parse('7_b').json).toEqual(['BaseForm', 7, 'b']);
  });

  test('literal integer base still yields the concrete value (regression)', () => {
    expect(ce.parse('10111_2').json).toEqual(['BaseForm', 23, 2]);
    expect(ce.parse('2748_{16}').json).toEqual(['BaseForm', 10056, 16]);
  });

  test('non-numeral bases are unchanged (inert Subscript / symbol)', () => {
    // `x_{2}` and `a_n` are NOT numeral-lhs cases, so they keep the generic
    // (inert) subscript reading — a single symbol, unchanged by this feature.
    expect(ce.parse('x_{2}').json).toEqual('x_2');
    expect(ce.parse('a_n').json).toEqual('a_n');
  });
});

describe('Symbolic-base numerals — arithmetic', () => {
  test('161_b + 134_b evaluates to the polynomial sum 2b² + 9b + 5', () => {
    const sum = ce.parse('161_{b}+134_{b}').evaluate();
    expect(sum.isSame(ce.parse('2b^2+9b+5'))).toBe(true);
  });

  test('symbolic path agrees with the literal path at bases 8, 10, 16', () => {
    for (const base of [8, 10, 16]) {
      // Fresh engine so the shared test engine never gets a bound `b`.
      const fresh = new ComputeEngine();
      const symbolic = fresh
        .parse('161_{b}+134_{b}')
        .evaluate()
        .subs({ b: base })
        .evaluate();
      const literal = ce.parse(`161_{${base}}+134_{${base}}`).evaluate();
      expect(symbolic.isSame(literal)).toBe(true);
    }
  });
});

describe('Symbolic-base numerals — solve', () => {
  test('161_b + 134_b = 315_b solves for b', () => {
    // b² + 6b + 1 + b² + 3b + 4 = 3b² + b + 5 reduces to b² − 8b = 0,
    // roots {0, 8}. b = 0 is present and intentionally NOT filtered here
    // (base-validity filtering is out of scope for the solver).
    const roots = ce
      .parse('161_{b}+134_{b}=315_{b}')
      .solve('b')!
      .map((r) => r.re);
    expect(new Set(roots)).toEqual(new Set([0, 8]));
  });

  test('each root satisfies the LITERAL evaluation (b = 8: both sides 205)', () => {
    // 161₈ + 134₈ = 113 + 92 = 205 = 315₈.
    const lhs = ce.parse('161_{8}+134_{8}').evaluate();
    const rhs = ce.parse('315_{8}').evaluate();
    expect(lhs.isSame(205)).toBe(true);
    expect(rhs.isSame(205)).toBe(true);
    expect(lhs.isSame(rhs)).toBe(true);
  });
});

describe('Symbolic-base numerals — serialize / round-trip', () => {
  test('161_{b} round-trips to LaTeX', () => {
    expect(ce.parse('161_{b}').latex).toBe('161_{b}');
  });

  test('single-digit and higher-degree numerals round-trip', () => {
    expect(ce.parse('7_b').latex).toBe('7_{b}');
    expect(ce.parse('1000_b').latex).toBe('1000_{b}');
  });

  test('parse-then-add serializes back to the two numerals', () => {
    expect(ce.parse('161_{b}+134_{b}').latex).toBe('161_{b}+134_{b}');
  });

  test('non-digit coefficient (>9) falls back to the functional form', () => {
    // A coefficient of 12 is not a single base-symbol digit, so this is NOT a
    // valid numeral expansion: keep the readable operatorname form rather than
    // emitting nonsense like `(12)_b`.
    const bf = ce.box(['BaseForm', ['Multiply', 12, 'b'], 'b']);
    expect(bf.latex).toBe('\\operatorname{BaseForm}(12b, b)');
  });
});
