import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { sameSyntactic } from '../../src/compute-engine/boxed-expression/compare';

const TESTS: [string, string][] = [
  ['1234', '1234.0'],
  ['2+2', '4'],
  ['x^2', 'x\\times x'],
  ['\\frac{1}{2}', '0.5'],
  ['\\sqrt{4}', '2'],
  ['\\sin(\\frac{\\pi}{2})', '1'],
  ['\\log_{10}(100)', '2'],
  // ['\\int_{0}^{1} x^2 dx', '\\frac{1}{3}'],
  ['\\sum_{n=1}^{10} n', '55'],
  // ['\\lim_{x \\to \\infty} (1 + \\frac{1}{x})^x', 'e'],
  ['2x+1=0', '2x=-1'],
  ['2x+1=0', 'x=-\\frac12'],
  ['x^2+2x+1=0', '(x+1)^2=0'],
  ['x^2+1=0', 'x^2=-1'],
  ['20x+10=0', '2x+1=0'],
  ['3x + 1 = 0', '6x + 2 = 0'],
  ['2(13.1+x)<(10-5)', '26.2+2x<5'],
  ['x^2 + 2x + 1 = 0', 'x^2 + 2x = -1'],
  // Same unknowns, structurally equal after expand/simplify
  ['(x+1)^2', 'x^2+2x+1'],
];

// Tests for equation equivalence - equations that should NOT be equal
// (different solution sets)
const NOT_EQUAL_EQUATIONS: [string, string][] = [
  // Different solution sets: x^2-1=0 has solutions {-1, 1}, x-1=0 has solution {1}
  ['x^2 - 1 = 0', 'x - 1 = 0'],
  // x=1 vs x=2 are completely different equations
  ['x = 1', 'x = 2'],
  // x+1=0 and x+2=0 have different solutions
  ['x + 1 = 0', 'x + 2 = 0'],
  // 0=0 (identity, always true) vs x=0 (only true when x=0)
  ['0 = 0', 'x = 0'],
];

describe('a.isEqual(b)', () => {
  for (const test of TESTS) {
    const [a, b] = test;
    it(`("${a}").isEqual("${b}")`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(true));
  }
});

describe('Equation equivalence - non-equivalent equations', () => {
  for (const test of NOT_EQUAL_EQUATIONS) {
    const [a, b] = test;
    it(`("${a}").isEqual("${b}") should be false`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(false));
  }
});

// REVIEW.md B13: the sample-based equivalence check substituted the SAME value
// for every unknown, so multi-unknown equations collapsed — e.g. `x + y` and
// `2x` both became `2v` and compared equal. Each unknown now gets an
// independent value.
describe('Equation equivalence - multiple unknowns (REVIEW.md B13)', () => {
  const EQUIVALENT: [string, string][] = [
    ['x+y=0', '2x+2y=0'], // differ by a non-zero constant factor
    ['x+y=0', 'y+x=0'], // reordered
    ['x+2y=0', '3x+6y=0'],
  ];
  const NOT_EQUIVALENT: [string, string][] = [
    ['x+y=0', '2x=0'], // the original false positive
    ['x-y=0', 'x+y=0'],
    ['x+y=0', 'x+2y=0'],
  ];

  for (const [a, b] of EQUIVALENT)
    it(`("${a}").isEqual("${b}") is true`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(true));

  for (const [a, b] of NOT_EQUIVALENT)
    it(`("${a}").isEqual("${b}") is false`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(false));
});

// `isSame` is an unconditional equivalence relation (option B): two symbols
// are the same symbol only when they agree on being bound AND on the binding.
// A RAW (non-canonical) operand carries no binding, so it never equals a
// canonical symbol — comparing a TEMPLATE against a subject is the explicit
// `sameSyntactic` entry point, not an implicit consequence of unboundness.
// See the contract on `same()` in compare.ts.
describe('isSame: the canonical/raw boundary', () => {
  test('two canonical symbols of the same name in DIFFERENT scopes differ', () => {
    const engine = new ComputeEngine();
    const outer = engine.box('q');
    engine.pushScope();
    engine.declare('q', 'number');
    const inner = engine.box('q');
    engine.popScope();
    expect(outer.isSame(inner)).toBe(false);
    expect(inner.isSame(outer)).toBe(false); // symmetric
  });

  test('a raw symbol does NOT match a canonical one — templates use sameSyntactic', () => {
    const engine = new ComputeEngine();
    const raw = engine.box('q', { canonical: false });
    const canonical = engine.box('q');
    expect(raw.isSame(canonical)).toBe(false);
    expect(canonical.isSame(raw)).toBe(false); // symmetric
    // The template-vs-subject question is asked explicitly:
    expect(sameSyntactic(raw, canonical)).toBe(true);
  });

  test('a lazy operator holding a raw symbol is not a transitivity bridge', () => {
    // The case that falsified the lenient rule: `Hold` keeps its operand
    // un-canonicalized, so a CANONICAL `Hold(q)` contains a raw `q`. Under
    // the lenient rule it compared equal to canonical `Hold(q)`s from two
    // different scopes that were themselves unequal — non-transitivity inside
    // the domain every dedup key uses. Option B: the raw-holding expression
    // equals neither, and the relation stays transitive.
    const engine = new ComputeEngine();
    // A pre-boxed raw operand survives inside the canonical wrapper (the
    // box/parse routes bind `Hold`'s operand, so build it explicitly).
    const holdRaw = engine.function('Hold', [
      engine.box('q', { canonical: false }),
    ]);
    expect(holdRaw.isCanonical).toBe(true);
    const holdOuter = engine.function('Hold', [engine.box('q')]);
    engine.pushScope();
    engine.declare('q', 'number');
    const holdInner = engine.function('Hold', [engine.box('q')]);
    engine.popScope();
    expect(holdOuter.isSame(holdInner)).toBe(false);
    expect(holdRaw.isSame(holdOuter)).toBe(false);
    expect(holdRaw.isSame(holdInner)).toBe(false);
  });

  test('a rule pattern (raw, with a literal constant) still matches a canonical subject', () => {
    // The concrete case `sameSyntactic` exists for: `\pi` is a literal, not a
    // wildcard, and the pattern is raw while the subject is canonical.
    const engine = new ComputeEngine();
    expect(
      engine.parse('\\pi + 3').replace('\\pi + a -> 2a')?.toString()
    ).toEqual('6');
  });

  test('standard-library symbols compare by name across engine instances', () => {
    // A library symbol is not a binding: `Nothing`, `Sin`, `Pi` denote the
    // same object in every engine, even though each engine mints its own
    // root-scope definition.
    const a = new ComputeEngine();
    const b = new ComputeEngine();
    for (const n of ['Nothing', 'Missing', 'Sin', 'List', 'Pi'])
      expect(a.box(n).isSame(b.box(n))).toBe(true);
    // …but a user symbol SHADOWING a library name is its own binding:
    a.pushScope();
    a.declare('Sin', 'number');
    expect(a.box('Sin').isSame(b.box('Sin'))).toBe(false);
    a.popScope();
  });
});
