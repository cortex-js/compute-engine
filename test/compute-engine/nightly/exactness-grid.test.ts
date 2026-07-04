import { ComputeEngine } from '../../../src/compute-engine';

/**
 * NIGHTLY — exactness-contract grid.
 *
 * Ported from the EXACTNESS review harness (`exactness/grid.ts`) plus the D2
 * float-argument sweep (`d2/sweep.mts`). Three contracts are asserted:
 *
 *   1. EXACT (real) → not FLOAT: a real exact argument must not numericize to a
 *      machine float under evaluate() (it stays exact or symbolic). Complex
 *      exact arguments are EXEMPT — CE stores complex values at machine
 *      precision by design (FINDINGS-TRACKER "complex im machine-precision by
 *      representation (deliberate non-goal)").
 *   2. N/evaluate consistency: when both evaluate().N() and .N() are finite,
 *      they agree numerically (pole/∞/NaN cells are excluded).
 *   3. D2 float-numericization: an operator that has a numeric implementation,
 *      given an inexact (float) argument, numericizes under evaluate()
 *      (isNumberLiteral) rather than staying symbolically unevaluated.
 *
 * The original grid additionally raised FLOAT-ARG-STAYED-SYMBOLIC /
 * N-STAYED-SYMBOLIC flags; those were a hand-triaged DIAGNOSTIC — the large
 * majority are legitimate capability gaps (e.g. Totient/Subfactorial/Zeta of a
 * non-integer or complex argument has no numeric value) rather than contract
 * violations, so they are not asserted here. The precise, fixed part of that
 * signal (D2) is asserted in contract 3.
 *
 * One `it` per operator so a hang or throw is isolated.
 */

const NIGHTLY = process.env.CE_NIGHTLY === '1';
const describeNightly = NIGHTLY ? describe : describe.skip;

const ce = new ComputeEngine();

type ArgClass = {
  name: string;
  mk: () => any;
  kind: 'exact' | 'inexact' | 'special';
  complex?: boolean;
};

const A: ArgClass[] = [
  { name: 'int2', mk: () => ce.number(2), kind: 'exact' },
  { name: 'int-2', mk: () => ce.number(-2), kind: 'exact' },
  { name: 'zero', mk: () => ce.number(0), kind: 'exact' },
  { name: 'one', mk: () => ce.number(1), kind: 'exact' },
  { name: '1/2', mk: () => ce.box(['Rational', 1, 2]), kind: 'exact' },
  { name: '-3/2', mk: () => ce.box(['Rational', -3, 2]), kind: 'exact' },
  { name: 'sqrt2', mk: () => ce.box(['Sqrt', 2]), kind: 'exact' },
  { name: 'pi', mk: () => ce.box('Pi'), kind: 'exact' },
  { name: 'pi/4', mk: () => ce.box(['Divide', 'Pi', 4]), kind: 'exact' },
  { name: 'e', mk: () => ce.box('ExponentialE'), kind: 'exact' },
  { name: 'ln2', mk: () => ce.box(['Ln', 2]), kind: 'exact' },
  { name: 'i', mk: () => ce.box(['Complex', 0, 1]), kind: 'exact', complex: true },
  { name: '1+i', mk: () => ce.box(['Complex', 1, 1]), kind: 'exact', complex: true },
  { name: 'f0.5', mk: () => ce.number(0.5), kind: 'inexact' },
  { name: 'f-0.5', mk: () => ce.number(-0.5), kind: 'inexact' },
  { name: 'f5.1', mk: () => ce.number(5.1), kind: 'inexact' },
  { name: 'cf', mk: () => ce.box(['Complex', 0.5, 0.5]), kind: 'inexact', complex: true },
  { name: '+inf', mk: () => ce.box('PositiveInfinity'), kind: 'special' },
  { name: '-inf', mk: () => ce.box('NegativeInfinity'), kind: 'special' },
  { name: 'nan', mk: () => ce.box('NaN'), kind: 'special' },
];

function classify(e: any): string {
  try {
    if (e === undefined || e === null) return 'undef';
    if (e.isNaN) return 'NaN';
    if (e.isInfinity) return 'inf';
    if (e.isNumberLiteral) {
      const nv = e.numericValue;
      if (typeof nv === 'number') return Number.isInteger(nv) ? 'exact' : 'FLOAT';
      return nv.isExact ? 'exact' : 'FLOAT';
    }
    if (e.operator === 'Error') return 'error';
    return 'symbolic';
  } catch (err) {
    return 'ERR:' + err;
  }
}

function num(e: any): [number, number] {
  try {
    const re = e.re;
    const im = e.im;
    return [typeof re === 'number' ? re : NaN, typeof im === 'number' ? im : NaN];
  } catch {
    return [NaN, NaN];
  }
}

function bothFinite(a: number, b: number, c: number, d: number): boolean {
  return [a, b, c, d].every((x) => Number.isFinite(x));
}
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));
}

// KNOWN-OPEN cells. Each keyed by `Op(argClass):ISSUE` and justified by a
// documented finding in docs/reviews/2026-07-archive/exactness-findings.md.
const ALLOW = new Set<string>([
  // EX-07e (documented open finding): Factorial of an exact non-integer real
  // numericizes to a machine float instead of staying symbolic (√π/2 etc.).
  'Factorial(1/2):EXACT->FLOAT',
  'Factorial(-3/2):EXACT->FLOAT',
  'Factorial(sqrt2):EXACT->FLOAT',
  // EX-07d (documented open finding): Mod/Remainder of exact rationals/radicals
  // numericizes instead of staying exact (WP-2.5 did the easy exact-rational Mod
  // and punted the radical / cross-rational cases).
  'Mod([["Sqrt",2],2]):EXACT->FLOAT',
  'Remainder([["Rational",1,2],["Rational",1,3]]):EXACT->FLOAT',
  'Remainder([["Sqrt",2],2]):EXACT->FLOAT',
  'Remainder([["Rational",1,2],2]):EXACT->FLOAT',
]);

// EX-15 crash class (integer-domain functions throwing RangeError on ±∞)
// FIXED: `toBigint` now returns null for non-finite values, so `evaluate()`
// never throws — the cells below assert that directly (no allowlist).

function checkCell(
  opName: string,
  argExprs: any[],
  argClasses: { kind: string; complex?: boolean }[],
  argDesc: string,
  kind: string,
  violations: string[]
) {
  let expr: any;
  try {
    expr = ce.function(opName, argExprs);
  } catch (err) {
    violations.push(`${opName}(${argDesc}) box-threw: ${err}`);
    return;
  }
  let ev: any, n: any, evn: any;
  try {
    ev = expr.evaluate();
  } catch (err) {
    violations.push(`${opName}(${argDesc}) evaluate-threw: ${err}`);
    return;
  }
  try {
    n = expr.N();
  } catch (err) {
    violations.push(`${opName}(${argDesc}) N-threw: ${err}`);
    return;
  }
  try {
    evn = ev.N();
  } catch (err) {
    violations.push(`${opName}(${argDesc}) evaluate().N()-threw: ${err}`);
    return;
  }
  const cEv = classify(ev);
  const anyComplexArg = argClasses.some((c) => c.complex);
  const issues: string[] = [];

  // Contract 1 — exact real arg must not numericize to a machine float.
  if (kind === 'exact' && !anyComplexArg && cEv === 'FLOAT')
    issues.push('EXACT->FLOAT');

  // Contract 2 — finite N/evaluate consistency.
  const [nr, ni] = num(n);
  const [er, ei] = num(evn);
  if (bothFinite(nr, ni, er, ei) && !(close(nr, er) && close(ni, ei)))
    issues.push('N-DISAGREE');

  for (const iss of issues) {
    const key = `${opName}(${argDesc}):${iss}`;
    if (!ALLOW.has(key)) violations.push(`${key} ev=${ev} n=${n}`);
  }
}

const UNARY: string[] = [
  'Abs', 'Ceil', 'Floor', 'Round', 'Truncate', 'Fract', 'Negate', 'Square',
  'Sqrt', 'Exp', 'Ln', 'Lb', 'Lg', 'Sign', 'Heaviside',
  'Factorial', 'Factorial2', 'Gamma', 'GammaLn', 'Digamma', 'Trigamma',
  'Zeta', 'LambertW', 'AiryAi', 'AiryBi',
  'Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc',
  'Sinh', 'Cosh', 'Tanh', 'Coth', 'Sech', 'Csch',
  'Arcsin', 'Arccos', 'Arctan', 'Arccot', 'Arcsec', 'Arccsc',
  'Arsinh', 'Arcosh', 'Artanh', 'Arcoth', 'Arsech', 'Arcsch',
  'Erf', 'Erfc', 'ErfInv', 'Erfi', 'Sinc',
  'FresnelS', 'FresnelC', 'SinIntegral', 'CosIntegral', 'ExpIntegralEi',
  'LogIntegral', 'EllipticK', 'EllipticE',
  'Real', 'Imaginary', 'Argument', 'Conjugate',
  'Fibonacci', 'Subfactorial', 'BellNumber', 'CatalanNumber', 'LucasL',
  'BernoulliB', 'PrimePi', 'Totient', 'MoebiusMu',
  'Haversine', 'InverseHaversine',
];

type Raw = [unknown, unknown, 'exact' | 'inexact' | 'special', boolean];
const PAIR_SPEC: Raw[] = [
  [2, 3, 'exact', false],
  [2, -2, 'exact', false],
  [['Rational', 1, 2], ['Rational', 1, 3], 'exact', false],
  [['Sqrt', 2], 2, 'exact', false],
  ['Pi', 2, 'exact', false],
  [2, 'Pi', 'exact', false],
  [['Rational', 1, 2], 2, 'exact', false],
  [2, ['Rational', 1, 2], 'exact', false],
  [['Complex', 0, 1], 2, 'exact', true],
  [0.5, 2, 'inexact', false],
  [2, 0.5, 'inexact', false],
  [5.1, 2.3, 'inexact', false],
  ['PositiveInfinity', 2, 'special', false],
  ['NaN', 2, 'special', false],
  [2, 0, 'exact', false],
  [0, 0, 'exact', false],
  [-2, 3, 'exact', false],
  [['Rational', -3, 2], ['Rational', 1, 2], 'exact', false],
];

const BINARY: string[] = [
  'Power', 'Root', 'Divide', 'Subtract', 'Mod', 'Remainder', 'Log',
  'GCD', 'LCM', 'Beta', 'BesselJ', 'BesselY', 'BesselI', 'BesselK',
  'Binomial', 'Choose', 'Hypot', 'Arctan2', 'Max', 'Min',
  'PolyGamma', 'JacobiSymbol', 'LegendreSymbol', 'Stirling', 'Eulerian',
  'Multinomial', 'DivisorSigma',
];

describeNightly('NIGHTLY exactness grid — unary operators', () => {
  jest.setTimeout(20000);
  for (const op of UNARY) {
    it(`${op}: exactness contract across argument classes`, () => {
      const violations: string[] = [];
      for (const a of A)
        checkCell(op, [a.mk()], [{ kind: a.kind, complex: a.complex }], a.name, a.kind, violations);
      expect(violations).toEqual([]);
    });
  }
});

describeNightly('NIGHTLY exactness grid — binary operators', () => {
  jest.setTimeout(20000);
  for (const op of BINARY) {
    it(`${op}: exactness contract across argument-pair classes`, () => {
      const violations: string[] = [];
      for (const [a, b, kind, cplx] of PAIR_SPEC)
        checkCell(
          op,
          [ce.box(a as any), ce.box(b as any)],
          [{ kind, complex: cplx }, { kind, complex: cplx }],
          JSON.stringify([a, b]),
          kind,
          violations
        );
      expect(violations).toEqual([]);
    });
  }
});

/**
 * D2 — an inexact (float) argument must numericize under evaluate(). Ported
 * from `d2/sweep.mts` (the harness for the Wave-4 "D2 float-arg numericization"
 * cluster). Each operator has a genuine numeric implementation for this
 * argument, so evaluate() must return a number literal, not a symbolic form.
 */
const D2_CASES: [string, any][] = [
  ['Exp', ['Exp', 5.1]],
  ['Gamma(1-arg)', ['Gamma', 5.1]],
  ['Gamma(2-arg upper)', ['Gamma', 2, 3.1]],
  ['GammaLn', ['GammaLn', 5.1]],
  ['Digamma', ['Digamma', 5.1]],
  ['Trigamma', ['Trigamma', 5.1]],
  ['PolyGamma', ['PolyGamma', 1, 5.1]],
  ['Zeta', ['Zeta', 5.1]],
  ['Beta', ['Beta', 2, 3.1]],
  ['LambertW', ['LambertW', 5.1]],
  ['BesselJ', ['BesselJ', 0, 2.5]],
  ['BesselY', ['BesselY', 0, 2.5]],
  ['BesselI', ['BesselI', 0, 2.5]],
  ['BesselK', ['BesselK', 0, 2.5]],
  ['AiryAi', ['AiryAi', 2.5]],
  ['AiryBi', ['AiryBi', 2.5]],
  ['Ln', ['Ln', 5.1]],
  ['Log(1-arg)', ['Log', 5.1]],
  ['Log(2-arg)', ['Log', 5.1, 2]],
  ['Lb', ['Lb', 5.1]],
  ['Lg', ['Lg', 5.1]],
  ['Power(float exp)', ['Power', 2, 5.1]],
  ['Power(float base)', ['Power', 2.5, 3]],
  ['Root', ['Root', 5.1, 3]],
  ['Sqrt(float)', ['Sqrt', 5.1]],
  ['Square(float)', ['Square', 5.1]],
  ['EllipticK', ['EllipticK', 0.5]],
  ['EllipticE', ['EllipticE', 0.5]],
  ['AGM', ['AGM', 1.5, 2.5]],
  ['Hypergeometric2F1', ['Hypergeometric2F1', 1, 1, 2, 0.5]],
  ['Hypergeometric1F1', ['Hypergeometric1F1', 1, 2, 0.5]],
  ['ExpIntegralEi', ['ExpIntegralEi', 2.5]],
  ['LogIntegral', ['LogIntegral', 2.5]],
  ['Erf', ['Erf', 1.5]],
  ['Erfc', ['Erfc', 1.5]],
  ['ErfInv', ['ErfInv', 0.5]],
  ['Erfi', ['Erfi', 1.5]],
  ['Hypot', ['Hypot', 3.5, 4]],
  ['Arctan(1-arg)', ['Arctan', 1.5]],
  ['Arctan2', ['Arctan2', 1.5, 2]],
  ['Haversine', ['Haversine', 1.5]],
  ['InverseHaversine', ['InverseHaversine', 0.3]],
  ['Sinc', ['Sinc', 1.5]],
  ['FresnelS', ['FresnelS', 1.5]],
  ['FresnelC', ['FresnelC', 1.5]],
  ['SinIntegral', ['SinIntegral', 1.5]],
  ['CosIntegral', ['CosIntegral', 1.5]],
  ['Sin', ['Sin', 5.1]],
  ['Cos', ['Cos', 5.1]],
  ['Choose', ['Choose', 5.5, 2]],
  ['Binomial', ['Binomial', 5.5, 2]],
  ['Add(float,Pi)', ['Add', 0.5, 'Pi']],
  ['Multiply(float,Pi)', ['Multiply', 0.5, 'Pi']],
];

describeNightly('NIGHTLY exactness grid — D2 float-arg numericization', () => {
  jest.setTimeout(20000);
  it('every float-argument operator numericizes under evaluate()', () => {
    const offenders: string[] = [];
    for (const [label, expr] of D2_CASES) {
      let ev: any;
      try {
        ev = ce.box(expr as any, { canonical: true }).evaluate();
      } catch (err) {
        offenders.push(`${label}: evaluate threw ${err}`);
        continue;
      }
      if (ev.isNumberLiteral !== true)
        offenders.push(`${label}: evaluate()="${ev.toString()}" not a number literal`);
    }
    expect(offenders).toEqual([]);
  });
});
