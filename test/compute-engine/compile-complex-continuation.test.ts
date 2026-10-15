import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * A special function whose interpreter kernel continues into the complex
 * plane takes the complex lane of the JavaScript target in `auto` and
 * `complex` mode where its value may be complex, as `Sqrt` and `Ln` do; in
 * `strict` mode it stays real and answers `NaN`. The shader targets have no
 * complex lane and decline a value that is provably complex.
 */

const ce = new ComputeEngine();
for (const name of ['x', 's', 'a', 'b', 'c', 'z', 'm'])
  ce.declare(name, 'real');

type Value = { re: number; im: number };

function reference(head: string, values: number[]): Value {
  const v = ce.box([head, ...values]).N() as any;
  return { re: v.re, im: v.im };
}

function run(
  head: string,
  names: string[],
  values: number[],
  mode: 'auto' | 'complex' | 'strict'
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

// [head, operand names, a point where the value is complex]
const cases: [string, string[], number[]][] = [
  ['HurwitzZeta', ['s', 'a'], [0.5, -0.5]],
  ['HurwitzZeta', ['s', 'a'], [2.5, -1.5]],
  ['LerchPhi', ['z', 's', 'a'], [3, 2, 1]],
  ['LerchPhi', ['z', 's', 'a'], [-2, 1.5, -0.5]],
  ['PolyLog', ['s', 'z'], [1.5, 2]],
  ['PolyLog', ['s', 'z'], [2, 3]],
  ['EllipticK', ['m'], [2]],
  ['EllipticE', ['m'], [2]],
  ['Hypergeometric2F1', ['a', 'b', 'c', 'z'], [1, 1, 2, 2]],
  ['LambertW', ['x'], [-1]],
];

describe('Special functions continued into the complex plane (JavaScript)', () => {
  for (const [head, names, values] of cases) {
    const ref = reference(head, values);
    const label = `${head}(${values.join(', ')})`;

    for (const mode of ['auto', 'complex'] as const)
      test(`${label} = ${fmt(ref)} (${mode}, as .N())`, () => {
        const out = run(head, names, values, mode) as Value;
        expect(out.re).toBeCloseTo(ref.re, 9);
        expect(out.im).toBeCloseTo(ref.im, 9);
      });

    test(`${label} = NaN (strict)`, () => {
      expect(run(head, names, values, 'strict')).toBeNaN();
    });
  }
});

// A point in the real region still answers a number, in every mode.
const realCases: [string, string[], number[], number][] = [
  ['HurwitzZeta', ['s', 'a'], [2, 1], Math.PI ** 2 / 6],
  ['LerchPhi', ['z', 's', 'a'], [0.5, 2, 1], 1.164481052930025],
  ['PolyLog', ['s', 'z'], [2, 0.5], 0.5822405264650125],
  ['EllipticK', ['m'], [0.5], 1.8540746773013719],
  ['EllipticE', ['m'], [0.5], 1.3506438810476755],
  ['Hypergeometric2F1', ['a', 'b', 'c', 'z'], [1, 1, 2, 0.5], 2 * Math.LN2],
  ['LambertW', ['x'], [1], 0.5671432904097838],
];

describe('Special functions continued into the complex plane: the real region', () => {
  for (const [head, names, values, expected] of realCases)
    for (const mode of ['auto', 'complex', 'strict'] as const)
      test(`${head}(${values.join(', ')}) = ${expected.toFixed(6)} (${mode})`, () => {
        expect(run(head, names, values, mode)).toBeCloseTo(expected, 9);
      });
});

describe('A complex operand takes the complex kernel in every mode', () => {
  const operand = ['Add', 'x', 'ImaginaryUnit'];
  for (const [head, extra] of [
    ['LambertW', []],
    ['EllipticK', []],
    ['HurwitzZeta', [3]],
  ] as [string, number[]][])
    for (const mode of ['auto', 'strict'] as const)
      test(`${head}(0.5 + i) as .N() (${mode})`, () => {
        const ref = ce.box([head, ['Complex', 0.5, 1], ...extra]).N() as any;
        const r = compile(ce.box([head, operand, ...extra] as any), {
          to: 'javascript',
          mode,
          fallback: false,
        } as any) as any;
        const out = r.run({ x: 0.5 }) as Value;
        expect(out.re).toBeCloseTo(ref.re, 9);
        expect(out.im).toBeCloseTo(ref.im, 9);
      });
});

describe('HurwitzZeta(1, z) is the unsigned pole for a non-real z', () => {
  test('compiled HurwitzZeta(1, 0.5 + i) is ~oo, as .N()', () => {
    expect(
      ce
        .box(['HurwitzZeta', 1, ['Complex', 0.5, 1]])
        .N()
        .isSame(ce.ComplexInfinity)
    ).toBe(true);
    const r = compile(
      ce.box(['HurwitzZeta', 1, ['Add', 'x', 'ImaginaryUnit']] as any),
      { to: 'javascript', mode: 'auto', fallback: false } as any
    ) as any;
    const out = r.run({ x: 0.5 }) as Value;
    // The compiled unsigned pole: an infinite part and a non-zero
    // imaginary part.
    expect(Math.abs(out.re) === Infinity || Math.abs(out.im) === Infinity).toBe(
      true
    );
    expect(out.im).not.toBe(0);
  });
});

describe('A user definition with a compile handler replaces the continuation', () => {
  test('Negate(LambertW(x)) uses the real scalar of the user handler', () => {
    // The user `LambertW` compiles to its operand, a real scalar. The
    // parent `Negate` must not read it as a complex value.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('LambertW', {
      signature: '(real) -> real',
      evaluate: ([v]) => v,
      compile: (args, compile) => compile(args[0]),
    });
    const r = compile(ce.box(['Negate', ['LambertW', 'x']]), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.run({ x: 2 })).toBe(-2);
  });
});

describe('Arcsec and Arccsc follow their type, as the inverse hyperbolics do', () => {
  for (const head of ['Arcsec', 'Arccsc'])
    for (const mode of ['auto', 'complex', 'strict'] as const) {
      const ref = reference(head, [0.5]);
      test(`${head}(0.5) = ${fmt(ref)} (${mode})`, () => {
        const out = run(head, ['x'], [0.5], mode) as Value;
        expect(out.re).toBeCloseTo(ref.re, 9);
        expect(out.im).toBeCloseTo(ref.im, 9);
      });
    }

  test('Arcsec(x) over a real x of unknown magnitude is not claimed real', () => {
    expect(ce.box(['Arcsec', 'x']).type.matches('real')).toBe(false);
    expect(ce.box(['Arccsc', 'x']).type.matches('real')).toBe(false);
  });
});

describe('The shader targets decline a provably complex value', () => {
  const gpu = new ComputeEngine();
  gpu.declare('p', 'real');
  gpu.assume(gpu.parse('p > 1'));

  const declined: [string, any][] = [
    ['LerchPhi(3, 2.5, 1)', ['LerchPhi', 3, 2.5, 1]],
    ['LerchPhi(p, 2.5, 1) with p > 1', ['LerchPhi', 'p', 2.5, 1]],
    ['PolyLog(2.5, 3)', ['PolyLog', 2.5, 3]],
    // A positive integer order is on the cut too
    ['PolyLog(2, 3)', ['PolyLog', 2, 3]],
    ['LerchPhi(3, 2, 1)', ['LerchPhi', 3, 2, 1]],
    ['HurwitzZeta(2.5, -1.5)', ['HurwitzZeta', 2.5, -1.5]],
  ];
  for (const [label, expr] of declined)
    for (const to of ['glsl', 'wgsl'] as const)
      test(`${to}: ${label} declines`, () => {
        expect(() =>
          compile(gpu.box(expr), { to, fallback: false } as any)
        ).toThrow(/no complex lane/);
      });

  // Where the value is not provably complex the shader keeps the real
  // helper, which answers NaN off the real domain.
  const kept: [string, any][] = [
    ['LerchPhi(z, s, a)', ['LerchPhi', 'z', 's', 'a']],
    ['PolyLog(s, z)', ['PolyLog', 's', 'z']],
    ['HurwitzZeta(s, a)', ['HurwitzZeta', 's', 'a']],
    ['LerchPhi(0.5, 2, 1)', ['LerchPhi', 0.5, 2, 1]],
  ];
  for (const [label, expr] of kept)
    for (const to of ['glsl', 'wgsl'] as const)
      test(`${to}: ${label} compiles`, () => {
        const r = compile(ce.box(expr), { to, fallback: false } as any) as any;
        expect(r.success).toBe(true);
      });
});
