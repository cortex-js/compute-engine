import { ComputeEngine } from '../../src/compute-engine';

/**
 * Value-bracket declared types on the standard-library constants (ROADMAP
 * "Ranged types should carry sign…", constants follow-up; the trusted-
 * dictionary mechanism was user-ruled 2026-08-23).
 *
 * Two properties per constant:
 * - the declared type is the exact bracket (a pin — these are contracts);
 * - the numericized value INHABITS the bracket, judged by the literal's
 *   value-carrying handler type (`_literalType` — a literal's public type
 *   is its bare tier and cannot witness a range). This is the empirical
 *   check that backs the trusted-dictionary rule: library declarations
 *   skip the static value-vs-type refusal (an unevaluated constant's
 *   static type cannot witness a bracket) and are validated by
 *   `console.assert` in development builds; this test is the suite-level
 *   version of that assert, and it must FAIL if someone edits a bracket
 *   the value does not satisfy.
 */

const ce = new ComputeEngine();

const BRACKETED: [string, string][] = [
  ['ExponentialE', 'finite_real<2.718281828459045..2.718281828459046>'],
  ['e', 'finite_real<2.718281828459045..2.718281828459046>'],
  ['Pi', 'finite_real<3.141592653589793..3.141592653589794>'],
  ['EulerGamma', 'finite_real<0.5772156649015328..0.5772156649015329>'],
  ['CatalanConstant', 'finite_real<0.915965594177219..0.9159655941772191>'],
  // φ's value is the EXPRESSION `(1+√5)/2` — the constant the trusted-
  // dictionary rule exists for.
  ['GoldenRatio', 'finite_real<1.618033988749894..1.618033988749895>'],
];

describe('CONSTANT VALUE BRACKETS', () => {
  it.each(BRACKETED)('%s declares its bracket', (name, bracket) => {
    expect(ce.box(name).type.toString()).toBe(bracket);
  });

  it.each(BRACKETED)('%s’s value inhabits its bracket', (name, bracket) => {
    // Judged NUMERICALLY against the bracket's bounds: a high-precision
    // bignum's `_literalType` deliberately carries only its sign (the
    // machine-exactness test refuses values a double cannot hold), so the
    // type lattice cannot witness a 1-ulp bracket — but the rounded double
    // moves at most half an ulp, and the brackets are wider, so the
    // closed-bound comparison is decisive.
    const t = ce.type(bracket).type;
    expect(typeof t !== 'string' && t.kind === 'numeric').toBe(true);
    if (typeof t === 'string' || t.kind !== 'numeric') return;
    const n = ce.box(name).N();
    expect(n.isNumber).toBe(true);
    expect(n.re).toBeGreaterThanOrEqual(t.lower ?? -Infinity);
    expect(n.re).toBeLessThanOrEqual(t.upper ?? Infinity);
  });

  it('the sign reaches type-channel consumers', () => {
    // `√φ` and `ln(π)` are real off the declared brackets alone.
    expect(ce.box(['Sqrt', 'GoldenRatio']).type.toString()).toBe('finite_real');
    expect(ce.box(['Ln', 'Pi']).type.toString()).toBe('finite_real');
  });

  it('the trusted path is library-only: a user mismatch still throws', () => {
    // A user declaration whose value's STATIC type cannot witness the
    // declared bracket keeps the throwing check — trust is scoped to
    // `setSymbolDefinitions`, never to `ce.declare`.
    const e = new ComputeEngine();
    expect(() =>
      e.declare('badBracket', {
        type: 'finite_real<0..1>',
        value: e.parse('1+\\sqrt{5}'),
        isConstant: true,
      })
    ).toThrow();
  });
});
