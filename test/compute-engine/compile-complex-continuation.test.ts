import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * `Arcsec` and `Arccsc` continue into the complex plane: the JavaScript
 * target gives the complex value in `complex` mode, and `NaN` in `strict`
 * mode.
 */

const ce = new ComputeEngine();
ce.declare('x', 'real');

type Value = { re: number; im: number };

function reference(head: string, values: number[]): Value {
  const v = ce.box([head, ...values]).N() as any;
  return { re: v.re, im: v.im };
}

function run(
  head: string,
  names: string[],
  values: number[],
  mode: 'complex' | 'strict'
): Value | number {
  const r = compile(ce.box([head, ...names]), {
    to: 'javascript',
    mode,
    fallback: false,
  } as any) as any;
  return r.run(Object.fromEntries(names.map((n, i) => [n, values[i]])));
}

const fmt = (v: Value) =>
  `${v.re.toFixed(4)}${v.im < 0 ? '-' : '+'}${Math.abs(v.im).toFixed(4)}i`;

describe('Arcsec and Arccsc follow their type, as the inverse hyperbolics do', () => {
  for (const head of ['Arcsec', 'Arccsc']) {
    const ref = reference(head, [0.5]);
    test(`${head}(0.5) = ${fmt(ref)} (complex)`, () => {
      const out = run(head, ['x'], [0.5], 'complex') as Value;
      expect(out.re).toBeCloseTo(ref.re, 9);
      expect(out.im).toBeCloseTo(ref.im, 9);
    });
    // A complex value on the real lane is NaN.
    test(`${head}(0.5) = NaN (strict)`, () => {
      expect(run(head, ['x'], [0.5], 'strict')).toBeNaN();
    });
  }

  test('Arcsec(x) over a real x of unknown magnitude is not claimed real', () => {
    expect(ce.box(['Arcsec', 'x']).type.matches('real')).toBe(false);
    expect(ce.box(['Arccsc', 'x']).type.matches('real')).toBe(false);
  });
});
