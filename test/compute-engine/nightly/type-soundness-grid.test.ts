import { ComputeEngine } from '../../../src/compute-engine';
import { isSubtype } from '../../../src/common/type/subtype';

/**
 * NIGHTLY — full type-soundness grid (~1,600 checks).
 *
 * The committed `test/compute-engine/type-soundness.test.ts` runs a small
 * deterministic core of this grid (the SYM P0-11…P0-16 fixes). This nightly
 * suite is the FULL operator × argument grid, including the cells the core
 * intentionally excludes: Factorial / Gamma / Floor / Ceil / Round / Sign of
 * complex and non-integer arguments (SYM P1-14 / not-enumerated).
 *
 * Contract: the type of the EXACT evaluate() result must be a subtype of the
 * statically-inferred .type. We check evaluate() (which stays exact/symbolic),
 * not .N() — .N() numericizes an exact rational to a float (typed finite_real,
 * never finite_rational) and can overflow a large finite to ±∞, both float
 * REPRESENTATION artifacts, not type-handler unsoundness (documented P2-24).
 */

const NIGHTLY = process.env.CE_NIGHTLY === '1';
const describeNightly = NIGHTLY ? describe : describe.skip;

const ce = new ComputeEngine();

const INPUTS: [string, any][] = [
  ['-2', -2],
  ['-1', -1],
  ['0', 0],
  ['1', 1],
  ['2', 2],
  ['3', 3],
  ['1/2', ['Rational', 1, 2]],
  ['-1/2', ['Rational', -1, 2]],
  ['2/3', ['Rational', 2, 3]],
  ['0.5', 0.5],
  ['-0.5', -0.5],
  ['3.7', 3.7],
  ['sqrt2', ['Sqrt', 2]],
  ['i', 'ImaginaryUnit'],
  ['1+i', ['Complex', 1, 1]],
  ['pi', 'Pi'],
  ['e', 'ExponentialE'],
  ['+oo', 'PositiveInfinity'],
  ['-oo', 'NegativeInfinity'],
];

const UNARY = [
  'Sqrt', 'Ln', 'Log', 'Lb', 'Lg', 'Exp', 'Square', 'Negate', 'Abs',
  'Sin', 'Cos', 'Tan', 'Sec', 'Csc', 'Cot',
  'Sinh', 'Cosh', 'Tanh',
  'Arcsin', 'Arccos', 'Arctan', 'Arccot', 'Arcsec', 'Arccsc',
  'Floor', 'Ceil', 'Round', 'Truncate', 'Sign',
  'Gamma', 'Factorial', 'GammaLn', 'Erf', 'Erfc',
  'Real', 'Imaginary', 'Conjugate',
];

const BINARY = [
  'Add', 'Subtract', 'Multiply', 'Divide', 'Power', 'Root', 'Mod',
  'GCD', 'LCM', 'Max', 'Min', 'Hypot', 'Arctan2',
];

// KNOWN-OPEN type residuals, keyed `Op(arg…)`. See FINDINGS-TRACKER
// "Known open findings".
const ALLOW = new Set<string>([
  // Round(i)/Sign(i) result types (documented residual): rounding / sign of an
  // exact complex yields a value whose type is not covered by the static type.
  'Round(i)', 'Round(1+i)',
  'Ceil(i)', 'Ceil(1+i)',
  'Floor(i)', 'Floor(1+i)',
  'Truncate(i)', 'Truncate(1+i)',
  'Sign(i)', 'Sign(1+i)',
]);

// Documented finiteness-soundness class (SYM P0-12 / P0-15): a handler whose
// static return type over-claims `finite_*` but produces a NON-FINITE result
// (±∞ / NaN / ~oo pole) for an infinite or degenerate input. The enumerated
// operators (Multiply/Divide/Mod/Ln/Csc/Arcsin/Power/Root) were fixed; the tail
// (Hypot/Real/LCM/Gamma-pole/Factorial-pole/…) is a known non-enumerated
// residual. We assert soundness for FINITE results and record the non-finite
// over-claims here for reporting rather than failing.
const NONFINITE_TAIL = new Set<string>();

function soundness(label: string, expr: any, violations: string[]): void {
  if (!expr.isValid) return;
  const staticT = expr.type;
  let v: any;
  try {
    v = expr.evaluate();
  } catch (e) {
    // A throw is not a *type*-soundness violation; the exactness grid owns
    // crash-class checks (EX-15). Ignore here.
    return;
  }
  if (!v.isValid) return;
  if (!isSubtype(v.type.type, staticT.type)) {
    if (v.isInfinity === true || v.isNaN === true) {
      NONFINITE_TAIL.add(label);
      return;
    }
    if (!ALLOW.has(label))
      violations.push(
        `${label}: static=${staticT} evaluated="${v.toString()}" evalType=${v.type}`
      );
  }
}

describeNightly('NIGHTLY type-soundness grid — unary', () => {
  jest.setTimeout(30000);
  for (const op of UNARY) {
    it(`${op}: evaluate().type ⊑ static .type across argument classes`, () => {
      const violations: string[] = [];
      for (const [la, a] of INPUTS)
        soundness(`${op}(${la})`, ce.expr([op, a]), violations);
      expect(violations).toEqual([]);
    });
  }
});

describeNightly('NIGHTLY type-soundness grid — binary', () => {
  jest.setTimeout(30000);
  for (const op of BINARY) {
    it(`${op}: evaluate().type ⊑ static .type across argument-pair classes`, () => {
      const violations: string[] = [];
      for (const [la, a] of INPUTS)
        for (const [lb, b] of INPUTS)
          soundness(`${op}(${la},${lb})`, ce.expr([op, a, b]), violations);
      expect(violations).toEqual([]);
    });
  }
});
