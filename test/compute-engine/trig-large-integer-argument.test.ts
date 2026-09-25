import { ComputeEngine } from '../../src/compute-engine';

// The numeric value of a trigonometric function of a large exact angle.
// The angle must not be rounded to the working precision before the kernel
// reduces it modulo 2π: rounding the 23-digit integer below to 21 digits
// changed its sine from −0.4206… to 0.9918…, and rounding `10³⁰·π` gave a
// sine of 0.8838… instead of 0.
//
// The reference values were computed independently with `decimal.js` at 120
// digits (for example `new Decimal('12345678901234567890123').sin()`).

const ce = new ComputeEngine();

function N(latex: string, engine = ce): string {
  return engine.parse(latex).N().toString();
}

describe('TRIG OF A LARGE EXACT ANGLE, AT THE WORKING PRECISION', () => {
  test('an exact integer with more digits than the working precision', () => {
    // decimal.js: −0.4205828591065724702776943
    expect(N('\\sin(12345678901234567890123)')).toBe(
      '-0.420582859106572470278'
    );
    // decimal.js: 0.9072541312255023347243489
    expect(N('\\cos(12345678901234567890123)')).toBe('0.907254131225502334724');
    // decimal.js: −0.4635777833697564037892221
    expect(N('\\tan(12345678901234567890123)')).toBe(
      '-0.463577783369756403789'
    );
    expect(N('\\sin(-12345678901234567890123)')).toBe(
      '0.420582859106572470278'
    );
  });

  test('a large exact rational', () => {
    // decimal.js: −0.7689641720505087261184865
    expect(N('\\sin(\\frac{123456789012345678901}{7})')).toBe(
      '-0.768964172050508726119'
    );
  });

  test('a large integer multiple of π', () => {
    // sin(10³⁰·π) = 0 and cos(10²⁰·π) = 1
    expect(N('\\sin(10^{30}\\pi)')).toBe('0');
    expect(N('\\cos(10^{20}\\pi)')).toBe('1');
    // 10³⁰·π + 1 ≡ 1 (mod 2π); decimal.js: 0.8414709848078965066525023
    expect(N('\\sin(10^{30}\\pi+1)')).toBe('0.841470984807896506653');
  });

  test('a large rational multiple of π', () => {
    // 10³⁰ ≡ 4 (mod 6), so 10³⁰·π/3 ≡ 4π/3; sin(4π/3) = −√3/2
    expect(N('\\sin(\\frac{10^{30}\\pi}{3})')).toBe('-0.866025403784438646765');
    // decimal.js: 0.6234898018587335305250049
    expect(N('\\cos(\\frac{3\\cdot 10^{25}\\pi}{7})')).toBe(
      '0.623489801858733530525'
    );
  });

  test('a pole at a large multiple of π', () => {
    expect(N('\\cot(10^{30}\\pi)')).toBe('~oo');
    expect(N('\\csc(10^{30}\\pi)')).toBe('~oo');
    expect(N('\\tan(\\frac{(2\\cdot 10^{30}+1)\\pi}{2})')).toBe('~oo');
  });

  test('an angle in degrees', () => {
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    // 10³⁰ ≡ 280 (mod 360); decimal.js: −0.984807753012208059366743
    expect(N('\\sin(10^{30})', deg)).toBe('-0.984807753012208059366');
  });

  test('smaller angles are unchanged', () => {
    expect(N('\\sin(10^{22})')).toBe('-0.852200849767188801773');
    expect(N('\\sin(3)')).toBe('0.141120008059867222101');
  });

  test('evaluate() stays exact', () => {
    expect(ce.parse('\\sin(10^{30}\\pi)').evaluate().toString()).toBe('0');
    expect(
      ce.parse('\\sin(12345678901234567890123)').evaluate().toString()
    ).toBe('sin(12345678901234567890123)');
  });

  test('the exact order uses the correct value', () => {
    expect(
      ce.parse('\\sin(12345678901234567890123) < 0').evaluate().toString()
    ).toBe('"True"');
  });
});

describe('TRIG OF A SYMBOL THAT HOLDS A LARGE EXACT ANGLE', () => {
  test('the value of the symbol is read without rounding', () => {
    const e = new ComputeEngine();
    e.assign('x', e.parse('12345678901234567890123'));
    e.assign('y', e.parse('10^{30}\\pi'));
    e.assign('w', e.parse('\\frac{10^{30}\\pi}{3}'));
    e.assign('z', e.parse('1.5'));
    // decimal.js: −0.4205828591065724702776943
    expect(N('\\sin(x)', e)).toBe('-0.420582859106572470278');
    // decimal.js: 0.9072541312255023347243489
    expect(N('\\cos(x)', e)).toBe('0.907254131225502334724');
    expect(N('\\sin(y)', e)).toBe('0');
    expect(N('\\cos(y)', e)).toBe('1');
    expect(N('\\sin(w)', e)).toBe('-0.866025403784438646765');
    // An inexact value is not read through: the usual route
    expect(N('\\sin(z)', e)).toBe('0.997494986604054430942');
  });
});

describe('TRIG OF A LARGE EXACT ANGLE, AT MACHINE PRECISION', () => {
  test('the angle is reduced before it becomes a double', () => {
    // Constructed here, not in the `describe` body: constructing an engine
    // sets the precision of the big decimals for every engine of the file.
    const m = new ComputeEngine({ precision: 'machine' });
    expect(
      Math.abs(
        m.parse('\\sin(12345678901234567890123)').N().re + 0.42058285910657247
      )
    ).toBeLessThan(1e-15);
    expect(m.parse('\\sin(10^{30}\\pi)').N().re).toBe(0);
    expect(m.parse('\\cos(10^{20}\\pi)').N().re).toBe(1);
    expect(
      Math.abs(
        m.parse('\\sin(\\frac{10^{30}\\pi}{3})').N().re + Math.sqrt(3) / 2
      )
    ).toBeLessThan(1e-15);
  });
});

describe('TRIG OF A LARGE EXACT ANGLE, AT HIGH PRECISION', () => {
  test('60 digits', () => {
    const h = new ComputeEngine({ precision: 60 });
    // decimal.js: −0.42058285910657247027769433682464153584826085542670100086817…
    expect(N('\\sin(12345678901234567890123)', h).slice(0, 55)).toBe(
      '-0.4205828591065724702776943368246415358482608554267010'
    );
  });
});

describe('CSC AND COT OF A TINY DOUBLE, AT MACHINE PRECISION', () => {
  // `1/sin(5·10⁻³²⁴)` overflows a double, but the angle is not a pole: the
  // value is about `2·10³²³`, with the sign of the angle. The pole at 0
  // itself stays the unsigned `~oo`.
  test('the value is the signed infinity', () => {
    const m = new ComputeEngine({ precision: 'machine' });
    const N = (json: any) => m.box(json).N().toString();
    expect(N(['Csc', 5e-324])).toBe('+oo');
    // An exact angle that underflows to the double 0 keeps its sign too.
    expect(N(['Csc', ['Power', 10, -400]])).toBe('+oo');
    expect(N(['Csc', ['Negate', ['Power', 10, -400]]])).toBe('-oo');
    expect(N(['Cot', ['Power', 10, -400]])).toBe('+oo');
    expect(N(['Cot', ['Negate', ['Power', 10, -400]]])).toBe('-oo');
    expect(N(['Csc', -5e-324])).toBe('-oo');
    expect(N(['Cot', 5e-324])).toBe('+oo');
    expect(N(['Cot', -5e-324])).toBe('-oo');
    expect(N(['Csc', 1e-310])).toBe('+oo');
    expect(N(['Csc', 0])).toBe('~oo');
    expect(N(['Cot', 0])).toBe('~oo');
    expect(N(['Csc', Math.PI])).toBe('~oo');
    expect(N(['Cot', Math.PI])).toBe('~oo');
    expect(N(['Tan', Math.PI / 2])).toBe('~oo');
  });

  test('the big-decimal route keeps its finite value', () => {
    const e = new ComputeEngine();
    expect(e.box(['Csc', 5e-324]).N().toString()).toBe('2e+323');
    expect(e.box(['Csc', -5e-324]).N().toString()).toBe('-2e+323');
    expect(
      e
        .box(['Csc', ['Power', 10, -400]])
        .N()
        .toString()
    ).toBe('1e+400');
  });
});
