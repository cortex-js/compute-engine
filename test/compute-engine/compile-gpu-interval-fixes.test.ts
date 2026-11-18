import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

/**
 * Complex values on the targets that have no complex form for a head, or a
 * limited one.
 *
 * - GLSL lowers a complex value to a `vec2` of (re, im) and a real
 *   value to a `float`. A selection (`If`, `Which`) with one complex value
 *   lifts every real value to `vec2(v, 0.0)`: a ternary with a
 *   `vec2` arm and a `float` arm is not valid shader source. `Norm` of a list
 *   with complex entries is the length of the vector of the entries' moduli.
 * - `interval-js` computes with real intervals only, so a complex symbol
 *   fails closed.
 *
 * Every test builds its OWN engine: a use of an undeclared symbol can narrow
 * its type for the lifetime of the engine.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('w', 'real | signed_infinity | nan');
  ce.declare('z', 'complex');
  ce.declare('t', 'real');
  ce.declare('x', 'real');
  ce.declare('M', 'integer');
  ce.declare('h', { signature: '(real) -> complex' });
  ce.assign('h', ce.parse('u \\mapsto u + i'));
  return ce;
}

function run(ce: ComputeEngine, to: string, expr: any): any {
  return compile(ce.box(expr), { to, fallback: false } as any) as any;
}

const T_POS = ['Greater', 't', 0];

describe('GPU: a selection with one complex value lifts its real values', () => {

  test('a boolean value beside a complex one fails closed', () => {
    // `vec2(true, 0.0)` is not a complex value in GLSL.
    const ce = engine();
    for (const to of ['glsl'])
      expect(() => run(ce, to, ['If', T_POS, 'z', 'True'])).toThrow(
        /Could not compile/
      );
  });

  test('a real value that is not a scalar beside a complex one fails closed', () => {
    // A point beside a number: the branches have different types, and the
    // GLSL fragment refuses an `If` whose branches differ in type.
    const ce = engine();
    expect(() => run(ce, 'glsl', ['If', T_POS, 'z', ['Tuple', 1, 2]])).toThrow(
      /Could not compile/
    );
  });
});

describe('GPU: Norm of a list with complex entries', () => {
  test('the length of the vector of the moduli', () => {
    const ce = engine();
    // The GLSL fragment has no list with a complex entry, so these decline.
    expect(() => run(ce, 'glsl', ['Norm', ['List', 'z', 'z']])).toThrow(
      /Could not compile/
    );
    expect(() => run(ce, 'glsl', ['Norm', ['List', 'z', 1, 't']])).toThrow(
      /Could not compile/
    );
    expect(() => run(ce, 'glsl', ['Norm', ['List', 'z']])).toThrow(
      /Could not compile/
    );
  });

  test('the value agrees with the interpreter', () => {
    const ce = engine();
    // |1 + 2i|² + 3² = 14.
    expect(ce.box(['Norm', ['List', ['Complex', 1, 2], 3]]).N().re).toBeCloseTo(
      Math.sqrt(14),
      12
    );
  });
});

describe('GPU: the real-only shader lowerings', () => {
  test('a complex operand of a real-only lowering fails closed', () => {
    const ce = engine();
    const cases: any[] = [
      ['Variance', ['List', 'z', 't', 'x']],
      ['Hypot', 'z', 't'],
      ['Arctan2', 'z', 't'],
      ['Haversine', 'z'],
      ['GammaLn', 'z'],
      ['Beta', 'z', 't'],
      ['Erf', 'z'],
      ['Erfc', 'z'],
      ['ErfInv', 'z'],
      ['Heaviside', 'z'],
      ['Sinc', 'z'],
      ['FresnelC', 'z'],
      ['FresnelS', 'z'],
      ['BesselJ', 1, 'z'],
      ['Arccot', 'z'],
      ['Arcsch', 'z'],
      ['InverseHaversine', 'z'],
      ['Gamma', 'z'],
      ['Factorial', 'z'],
    ];
    for (const to of ['glsl'])
      for (const expr of cases)
        expect(() => run(ce, to, expr)).toThrow(/Could not compile/);
  });

  test('Mean has no shader lowering', () => {
    const ce = engine();
    expect(() => run(ce, 'glsl', ['Mean', ['List', 't', 1]])).toThrow(
      /Could not compile/
    );
  });
});

describe('interval-js: a complex symbol fails closed', () => {
  // The interval target throws its decline: a complex input has no lane on
  // interval-js.
  function declineCode(ce: ComputeEngine, expr: any): string {
    try {
      run(ce, 'interval-js', expr);
    } catch (e) {
      return compileDiagnosticOf(e).code;
    }
    return 'no decline';
  }

  test('a declared complex symbol in real arithmetic', () => {
    const ce = engine();
    expect(declineCode(ce, ['Subtract', 1, ['Add', 't', 'z']])).toBe(
      'outside-profile'
    );
    expect(declineCode(ce, ['Abs', 'z'])).toBe('outside-profile');
  });

  test('Re of a complex symbol fails closed', () => {
    const ce = engine();
    expect(declineCode(ce, ['Re', 'z'])).toBe('outside-profile');
  });

  test('a real symbol still compiles', () => {
    const ce = engine();
    // 1 − (t + x) is −2 at t = 1, x = 2.
    expect(
      run(ce, 'interval-js', ['Subtract', 1, ['Add', 't', 'x']]).run!({
        t: { lo: 1, hi: 1 },
        x: { lo: 2, hi: 2 },
      })
    ).toEqual({ kind: 'interval', value: { lo: -2, hi: -2 } });
  });
});
