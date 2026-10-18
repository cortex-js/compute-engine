import { ComputeEngine } from '../../src/compute-engine';

// `Floor`, `Ceil`, `Round` and `Truncate` of `~oo` (a pole: `5/0`,
// `Tan(π/2)`) are `~oo`, as the rounding of `±∞` is `±∞`. `Fract` and
// `Sign` have no value at `~oo`: `Indeterminate` on the exact route, `NaN`
// under `.N()`. Before 2026-10-17, each of these was an
// `incompatible-type` error, because `~oo` was outside the carrier.
//
// Under `.N()`, the float of an operand whose exact value is finite can be
// `~oo` when its terms cancel: the float of `1/(√(10⁴⁰ + 1) − 10²⁰)` is
// `~oo` at 21 digits, but the exact value is `√(10⁴⁰ + 1) + 10²⁰`, which is
// `2·10²⁰ + 5·10⁻²¹` to 40 digits. A function whose result jumps uses the
// exact value of an exact operand under `.N()`, so these are finite.

const ce = new ComputeEngine();

const ROUNDING = ['Floor', 'Ceil', 'Round', 'Truncate'];

const POLES: [string, unknown][] = [
  ['~oo', 'ComplexInfinity'],
  ['5/0', ['Divide', 5, 0]],
  ['Tan(π/2)', ['Tan', ['Divide', 'Pi', 2]]],
];

// `1/(√(10⁴⁰ + 1) − 10²⁰)`
const CANCELLATION = [
  'Divide',
  1,
  ['Subtract', ['Sqrt', ['Add', ['Power', 10, 40], 1]], ['Power', 10, 20]],
];

const box = (json: unknown) => ce.box(json as never);

describe('the rounding of ~oo is ~oo', () => {
  for (const op of ROUNDING)
    for (const [name, pole] of POLES)
      test(`${op}(${name})`, () => {
        const e = box([op, pole]);
        expect(e.isValid).toBe(true);
        expect(e.evaluate().isSame(ce.ComplexInfinity)).toBe(true);
        expect(e.N().isSame(ce.ComplexInfinity)).toBe(true);
      });

  test('the sign is not a direction', () => {
    expect(box(['Round', 'ComplexInfinity']).sgn).toBe('unsigned');
    for (const op of ROUNDING)
      expect(['positive', 'negative']).not.toContain(
        box([op, 'ComplexInfinity']).sgn
      );
  });

  test('the step form', () => {
    const e = box(['Floor', 'ComplexInfinity', 2]);
    expect(e.evaluate().isSame(ce.ComplexInfinity)).toBe(true);
    expect(e.N().isSame(ce.ComplexInfinity)).toBe(true);
  });

  test('the parse route', () => {
    expect(ce.parse('\\lfloor \\frac{5}{0} \\rfloor').evaluate().toString()).toBe(
      '~oo'
    );
  });

  test('a symbol that holds ~oo', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('h', ce2.ComplexInfinity);
    expect(
      ce2.box(['Floor', 'h']).evaluate().isSame(ce2.ComplexInfinity)
    ).toBe(true);
  });

  test('a complex operand is still a boxing error', () => {
    expect(box(['Floor', ['Complex', 1, 2]]).isValid).toBe(false);
  });

  test('the type', () => {
    // A `~oo` value claim is widened to `infinity` by the result type of a
    // type handler.
    expect(box(['Floor', 'ComplexInfinity']).type.toString()).toBe(
      'infinity'
    );
    const ce2 = new ComputeEngine();
    ce2.declare('r', 'real');
    ce2.declare('w', 'number');
    expect(ce2.box(['Floor', 'r']).type.toString()).toBe('integer');
    expect(ce2.box(['Floor', 'w']).type.toString()).toBe(
      'infinity | integer | nan'
    );
  });
});

describe('Fract and Sign have no value at ~oo', () => {
  for (const op of ['Fract', 'Sign'])
    for (const [name, pole] of POLES)
      test(`${op}(${name})`, () => {
        const e = box([op, pole]);
        expect(e.isValid).toBe(true);
        expect(e.evaluate().toString()).toBe('Indeterminate');
        expect(e.N().toString()).toBe('NaN');
      });

  test('the type', () => {
    expect(box(['Sign', 'ComplexInfinity']).type.toString()).toBe('nan');
    const ce2 = new ComputeEngine();
    ce2.declare('r', 'real');
    ce2.declare('q', 'real | ~oo');
    expect(ce2.box(['Sign', 'r']).type.toString()).toBe('integer<-1..1>');
    expect(ce2.box(['Sign', 'q']).type.toString()).toBe('integer<-1..1> | nan');
    expect(ce2.box(['Fract', 'r']).type.toString()).toBe('real<0..1>');
  });
});

// The type `infinity` is `signed_infinity | ~oo`. An operand typed
// `real | infinity` has the same types of `Floor` and `Sign` as an operand
// typed `real | signed_infinity | ~oo`. Before, the `infinity` member was
// not split, and the operand was not read as extended-real away from `~oo`.
describe('an operand whose type has the member infinity', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('z', 'real | infinity');
  ce2.declare('y', 'real | signed_infinity | ~oo');
  ce2.declare('q', 'infinity');

  test('real | infinity', () => {
    expect(ce2.box(['Floor', 'z']).type.toString()).toBe('infinity | integer');
    expect(ce2.box(['Floor', 'y']).type.toString()).toBe('infinity | integer');
    expect(ce2.box(['Sign', 'z']).type.toString()).toBe(
      'integer<-1..1> | nan'
    );
    expect(ce2.box(['Sign', 'y']).type.toString()).toBe(
      'integer<-1..1> | nan'
    );
  });

  test('infinity', () => {
    // The rounding of `±∞` is `±∞`, and the rounding of `~oo` is `~oo`.
    expect(ce2.box(['Floor', 'q']).type.toString()).toBe('infinity');
  });
});

describe('under .N(), an operand whose float is ~oo but whose exact value is finite', () => {
  test('its float is ~oo', () => {
    expect(box(CANCELLATION).N().toString()).toBe('~oo');
  });

  const expected: [string, string][] = [
    ['Floor', '200000000000000000000'],
    ['Ceil', '200000000000000000001'],
    ['Round', '200000000000000000000'],
    ['Truncate', '200000000000000000000'],
    ['Sign', '1'],
  ];
  for (const [op, value] of expected)
    test(`${op} uses the exact value`, () => {
      const n = box([op, CANCELLATION]).N();
      expect(n.toString()).toBe(value);
      // The same value as `evaluate()`.
      expect(n.isSame(box([op, CANCELLATION]).evaluate().N())).toBe(true);
    });

  test('Fract uses the exact value', () => {
    // `√(10⁴⁰ + 1) − 10²⁰ = 1/(√(10⁴⁰ + 1) + 10²⁰) ≈ 5·10⁻²¹ − 1.25·10⁻⁶¹`
    const v = box(['Fract', CANCELLATION]).N();
    expect(Math.abs(v.re / 5e-21 - 1)).toBeLessThan(1e-12);
  });

  test('the parse route', () => {
    const e = ce.parse(
      '\\lfloor \\frac{1}{\\sqrt{10^{40}+1}-10^{20}} \\rfloor'
    );
    expect(e.N().toString()).toBe('200000000000000000000');
  });
});
