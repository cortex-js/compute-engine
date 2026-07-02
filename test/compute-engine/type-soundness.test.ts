import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

/**
 * Type-soundness grid (deterministic reduced core of the ~1,600-check operator
 * × argument harness from the SYMBOLIC review, SYM P0-11…P0-16).
 *
 * Contract: the type of the *exact* `evaluate()` result must be a subtype of
 * the statically-inferred `.type`. We check the `evaluate()` path (which stays
 * exact/symbolic) rather than `.N()`: `.N()` numericizes an exact rational to a
 * float (typed `finite_real`, never `finite_rational`) and can overflow a large
 * finite value to ±∞, both of which are float-*representation* artifacts, not
 * type-handler unsoundness (documented as P2-24).
 *
 * The full grid additionally covers Factorial/Gamma/Floor/Ceil/Round of complex
 * and non-integer arguments (SYM P1-14 / not-enumerated), which are out of the
 * scope of this fix and intentionally excluded here.
 */

const ce = new ComputeEngine();

const N = (s: string, v: any): [string, any] => [s, v];
const INPUTS: [string, any][] = [
  N('-2', -2),
  N('-1', -1),
  N('0', 0),
  N('1', 1),
  N('2', 2),
  N('1/2', ['Rational', 1, 2]),
  N('-1/2', ['Rational', -1, 2]),
  N('0.5', 0.5),
  N('-0.5', -0.5),
  N('3.7', 3.7),
  N('i', 'ImaginaryUnit'),
  N('pi', 'Pi'),
  N('+oo', 'PositiveInfinity'),
  N('-oo', 'NegativeInfinity'),
];

const UNARY = [
  'Sqrt',
  'Ln',
  'Log',
  'Sin',
  'Cos',
  'Tan',
  'Sec',
  'Csc',
  'Cot',
  'Sinh',
  'Cosh',
  'Arcsin',
  'Arccos',
  'Arcsec',
  'Arccsc',
  'Arctan',
  'Arccot',
];

const BINARY = ['Add', 'Subtract', 'Multiply', 'Divide', 'Power', 'Root', 'Mod'];

function soundness(expr: any): string | null {
  if (!expr.isValid) return null;
  const staticT = expr.type;
  let v: any;
  try {
    v = expr.evaluate();
  } catch (e) {
    return `THROW-EVAL ${String(e)}`;
  }
  if (!v.isValid) return null;
  if (!isSubtype(v.type.type, staticT.type))
    return `static=${staticT} evaluated="${v.toString()}" evalType=${v.type}`;
  return null;
}

describe('TYPE SOUNDNESS GRID — evaluate().type ⊑ static .type', () => {
  it('unary elementary/trig/log functions are type-sound', () => {
    const violations: string[] = [];
    for (const op of UNARY)
      for (const [label, input] of INPUTS) {
        const msg = soundness(ce.expr([op, input]));
        if (msg) violations.push(`${op}(${label}): ${msg}`);
      }
    expect(violations).toEqual([]);
  });

  it('binary arithmetic functions are type-sound', () => {
    const small: [string, any][] = INPUTS.filter(([l]) =>
      ['-2', '0', '2', '1/2', '0.5', '-0.5', 'i', '+oo', '3.7'].includes(l)
    );
    const violations: string[] = [];
    for (const op of BINARY)
      for (const [la, a] of small)
        for (const [lb, b] of small) {
          const msg = soundness(ce.expr([op, a, b]));
          if (msg) violations.push(`${op}(${la},${lb}): ${msg}`);
        }
    expect(violations).toEqual([]);
  });
});
