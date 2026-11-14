import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

//
// Compositions of the circular and hyperbolic functions with their inverses,
// the reflection of the inverses that take values in [0, π], and the
// imaginary argument. Every rule is an identity on the principal branches, so
// each numeric check compares the folded value with the kernel's value at
// points on and off the branch cuts.
//

const ce = new ComputeEngine();

const num = (re: number, im = 0) =>
  im === 0 ? ce.number(re) : ce.number(ce.complex(re, im));

const same = (a: Expression, b: Expression) => {
  const [x, y] = [a.N(), b.N()];
  if (x.isNaN && y.isNaN) return true;
  if (x.isInfinity && y.isInfinity) return true;
  return Math.abs(x.re - y.re) < 1e-9 && Math.abs(x.im - y.im) < 1e-9;
};

// Off the real axis, on both cuts of Arcsin/Arccos (|Re| > 1, Im = 0) and of
// Arctan (Re = 0, |Im| > 1), and at the points between.
const POINTS: [number, number][] = [];
for (const re of [-3, -1, -0.5, 0, 0.5, 1, 2, 3.5])
  for (const im of [-2, -0.5, 0, 0.5, 2]) POINTS.push([re, im]);

describe('f(f⁻¹(x)) = x', () => {
  const pairs: [string, string][] = [
    ['Sin', 'Arcsin'],
    ['Cos', 'Arccos'],
    ['Tan', 'Arctan'],
    ['Cot', 'Arccot'],
    ['Sec', 'Arcsec'],
    ['Csc', 'Arccsc'],
    ['Sinh', 'Arsinh'],
    ['Cosh', 'Arcosh'],
    ['Tanh', 'Artanh'],
    ['Coth', 'Arcoth'],
    ['Sech', 'Arsech'],
    ['Csch', 'Arcsch'],
  ];

  for (const [f, g] of pairs) {
    for (const route of ['evaluate', 'simplify'] as const) {
      test(`${f}(${g}(x)) = x (${route})`, () => {
        const e = ce.function(f, [ce.function(g, [ce.symbol('x')])]);
        expect(e[route]().toString()).toBe('x');
      });
    }
    test(`${f}(${g}(5)) = 5 (evaluate, simplify and N, exact)`, () => {
      const e = ce.function(f, [ce.function(g, [ce.number(5)])]);
      expect(e.evaluate().toString()).toBe('5');
      expect(e.simplify().toString()).toBe('5');
      // The operand `Arcsin(5)` is complex: the kernel leaves `5 - 3e-16i`.
      const n = e.N();
      expect(n.re).toBe(5);
      expect(n.im).toBe(0);
    });
    test(`${f}(${g}(z)) agrees with the kernel on and off the cuts`, () => {
      for (const [re, im] of POINTS) {
        const z = num(re, im);
        const kernel = ce.function(f, [ce.function(g, [z]).N()]);
        const folded = ce.function(f, [ce.function(g, [z])]);
        // The identity needs a finite value of `g(z)`; at the poles of `f`
        // the kernel is not a number the fold could match.
        if (kernel.N().isNaN || kernel.N().isInfinity) continue;
        if (kernel.N().operator === 'Error') continue;
        expect([f, g, re, im, same(kernel, folded)]).toEqual([
          f,
          g,
          re,
          im,
          true,
        ]);
      }
    });
  }

  test('the parse route', () => {
    expect(ce.parse('\\sin(\\arcsin(x))').evaluate().toString()).toBe('x');
    expect(
      ce.parse('\\cosh(\\operatorname{arcosh}(a+1))').simplify().toString()
    ).toBe('a + 1');
  });

  test('a compound argument that reduces to the literal', () => {
    const e = ce.function('Sin', [
      ce.function('Arcsin', [ce.parse('x - x + 1/3')]),
    ]);
    expect(e.evaluate().toString()).toBe('1/3');
  });

  test('not folded where the inverse is a pole of f', () => {
    // arctan(±i) = ~oo, and tan(~oo) has no value
    expect(
      ce
        .box(['Tan', ['Arctan', 'ImaginaryUnit']])
        .evaluate()
        .toString()
    ).not.toBe('i');
    expect(
      ce
        .box(['Sec', ['Arcsec', 0]])
        .evaluate()
        .toString()
    ).not.toBe('0');
    expect(
      ce
        .box(['Csch', ['Arcsch', 0]])
        .evaluate()
        .toString()
    ).not.toBe('0');
  });

  test('not folded at an infinity: cosh(arcosh(-∞)) is +∞, not -∞', () => {
    const e = ce.box(['Cosh', ['Arcosh', 'NegativeInfinity']]);
    expect(e.evaluate().toString()).toBe('+oo');
  });

  test('the reverse composition stays: Arcsin(Sin(x)) is not x', () => {
    for (const route of ['evaluate', 'simplify'] as const)
      expect(
        ce
          .box(['Arcsin', ['Sin', 'x']])
          [route]()
          .toString()
      ).toBe('arcsin(sin(x))');
  });
});

describe('Arcsin(Sin(y)), Arccos(Cos(y)) and Arctan(Tan(y)) for an exact real y', () => {
  const cases: [string, string, string][] = [
    ['Arcsin', '1/2', '1/2'],
    ['Arcsin', '3', '-3 + pi'],
    ['Arcsin', '4', '-4 + pi'],
    ['Arcsin', '5', '5 - 2pi'],
    ['Arcsin', '-2', '2 - pi'],
    ['Arcsin', '7/2', '-7/2 + pi'],
    ['Arcsin', '\\sqrt{50}', '5sqrt(2) - 2pi'],
    ['Arccos', '5', '-5 + 2pi'],
    ['Arccos', '-7/2', '-7/2 + 2pi'],
    ['Arccos', '1', '1'],
    ['Arccos', '7', '7 - 2pi'],
    ['Arctan', '1', '1'],
    ['Arctan', '2', '2 - pi'],
    ['Arctan', '3', '3 - pi'],
  ];
  for (const [f, y, expected] of cases) {
    const forward = { Arcsin: 'Sin', Arccos: 'Cos', Arctan: 'Tan' }[f]!;
    for (const route of ['evaluate', 'simplify'] as const) {
      test(`${f}(${forward}(${y})) = ${expected} (${route})`, () => {
        const e = ce.function(f, [ce.function(forward, [ce.parse(y)])]);
        expect(e[route]().toString()).toBe(expected);
      });
    }
    test(`${f}(${forward}(${y})) agrees with N()`, () => {
      const e = ce.function(f, [ce.function(forward, [ce.parse(y)])]);
      expect(same(e.evaluate(), e)).toBe(true);
      expect(e.evaluate().N().re).toBeCloseTo(e.N().re, 12);
    });
  }

  test('a symbolic argument stays', () => {
    for (const f of ['Arcsin', 'Arccos', 'Arctan']) {
      const forward = { Arcsin: 'Sin', Arccos: 'Cos', Arctan: 'Tan' }[f]!;
      const e = ce.function(f, [ce.function(forward, [ce.symbol('x')])]);
      expect(e.evaluate().operator).toBe(f);
      expect(e.simplify().operator).toBe(f);
    }
  });

  test('declines for a very large argument and at a pole of the tangent', () => {
    expect(ce.box(['Arcsin', ['Sin', 1e10]]).evaluate().operator).toBe(
      'Arcsin'
    );
    expect(
      ce.box(['Arctan', ['Tan', ['Divide', 'Pi', 2]]]).evaluate().operator
    ).not.toBe('Subtract');
  });

  test('declines where the double y/π cannot tell the branch', () => {
    // π/2 cut after 25 decimals (smaller than π/2: the value is y itself),
    // π cut after 25 decimals (the value is y), and 2π cut after 25
    // decimals (the value is 2π - y). A double reads each as a branch point.
    const big = '10000000000000000000000000';
    for (const [f, g, p] of [
      ['Arcsin', 'Sin', '15707963267948966192313216'],
      ['Arccos', 'Cos', '31415926535897932384626433'],
      ['Arccos', 'Cos', '62831853071795864769252867'],
    ])
      expect(
        ce.box([f, [g, ['Rational', p, big]]]).evaluate().operator
      ).toBe(f);
  });

  test('the half-turn is that of the angular unit', () => {
    const own = new ComputeEngine();
    own.angularUnit = 'deg';
    // sin 100° = sin 80°, cos 400° = cos 40°, tan 200° = tan 20°
    expect(
      own
        .box(['Arcsin', ['Sin', 100]])
        .evaluate()
        .toString()
    ).toBe('80');
    expect(
      own
        .box(['Arccos', ['Cos', 400]])
        .evaluate()
        .toString()
    ).toBe('40');
    expect(
      own
        .box(['Arctan', ['Tan', 200]])
        .evaluate()
        .toString()
    ).toBe('20');
  });

  test('simplify() of an odd function of the value of sin(4), a negative constant, does not recurse', () => {
    expect(
      ce
        .box(['Arcsin', ['Sin', 4]])
        .simplify()
        .toString()
    ).toBe('-4 + pi');
    expect(ce.box(['Arctan', ['Sin', 4]]).simplify().operator).toBe('Arctan');
  });
});

describe('the Pythagorean compositions', () => {
  const cases: [string, string, string, string][] = [
    ['Cos', 'Arcsin', 'x', 'sqrt(1 - x^2)'],
    ['Sin', 'Arccos', 'x', 'sqrt(1 - x^2)'],
    ['Cos', 'Arctan', 'x', '1 / sqrt(x^2 + 1)'],
    ['Sin', 'Arctan', 'x', 'x / sqrt(x^2 + 1)'],
    ['Tan', 'Arcsin', 'x', 'x / sqrt(1 - x^2)'],
  ];
  for (const [f, g, x, expected] of cases)
    test(`${f}(${g}(${x})) = ${expected} (simplify)`, () => {
      const e = ce.function(f, [ce.function(g, [ce.parse(x)])]);
      expect(e.simplify().toString()).toBe(expected);
    });

  const exact: [string, string, string, string][] = [
    ['Cos', 'Arcsin', '1/3', '2/3sqrt(2)'],
    ['Sin', 'Arccos', '1/3', '2/3sqrt(2)'],
    ['Cos', 'Arctan', '3/4', '4/5'],
    ['Sin', 'Arctan', '3/4', '3/5'],
    ['Tan', 'Arcsin', '3/5', '3/4'],
  ];
  for (const [f, g, x, expected] of exact)
    test(`${f}(${g}(${x})) = ${expected} (simplify, exact)`, () => {
      const e = ce.function(f, [ce.function(g, [ce.parse(x)])]);
      expect(e.simplify().toString()).toBe(expected);
    });

  for (const [f, g] of cases.map(([f, g]) => [f, g]))
    test(`${f}(${g}(z)) agrees with the kernel on and off the cuts`, () => {
      for (const [re, im] of POINTS) {
        const z = num(re, im);
        const kernel = ce.function(f, [ce.function(g, [z]).N()]);
        const folded = ce.function(f, [ce.function(g, [z])]).simplify();
        if (kernel.N().operator === 'Error') continue;
        if (kernel.N().isNaN || kernel.N().isInfinity) continue;
        expect([f, g, re, im, same(kernel, folded)]).toEqual([
          f,
          g,
          re,
          im,
          true,
        ]);
      }
    });
});

describe('arccos and arcsec reflect, arcoth is odd', () => {
  for (const f of ['Arccos', 'Arcsec']) {
    test(`${f}(-x) = π - ${f}(x) (simplify)`, () => {
      const e = ce.function(f, [ce.function('Negate', [ce.symbol('x')])]);
      expect(e.simplify().toString()).toBe(`-${f.toLowerCase()}(x) + pi`);
    });
    test(`${f}(-z) = π - ${f}(z) on and off the cuts`, () => {
      for (const [re, im] of POINTS) {
        const z = num(re, im);
        if (z.isSame(0)) continue;
        const lhs = ce.function(f, [z.neg()]);
        const rhs = ce.Pi.sub(ce.function(f, [z]));
        if (lhs.N().operator === 'Error' || rhs.N().operator === 'Error')
          continue;
        expect([f, re, im, same(lhs, rhs)]).toEqual([f, re, im, true]);
      }
    });
  }

  test('the reflection is by the half-turn of the angular unit', () => {
    const own = new ComputeEngine();
    own.angularUnit = 'deg';
    expect(
      own
        .box(['Arccos', ['Negate', 'x']])
        .simplify()
        .toString()
    ).toBe('180 - arccos(x)');
  });

  test('Arcoth(-x) = -Arcoth(x)', () => {
    expect(
      ce
        .box(['Arcoth', ['Negate', 'x']])
        .simplify()
        .toString()
    ).toBe('-arcoth(x)');
    for (const [re, im] of POINTS) {
      const z = num(re, im);
      if (z.isSame(0)) continue;
      expect([
        re,
        im,
        same(
          ce.function('Arcoth', [z.neg()]),
          ce.function('Arcoth', [z]).neg()
        ),
      ]).toEqual([re, im, true]);
    }
  });
});

describe('the circular and hyperbolic functions of i·t', () => {
  const cases: [string, string][] = [
    ['Sin', 'i * sinh(t)'],
    ['Cos', 'cosh(t)'],
    ['Tan', 'i * tanh(t)'],
    ['Sinh', 'i * sin(t)'],
    ['Cosh', 'cos(t)'],
    ['Tanh', 'i * tan(t)'],
  ];
  for (const [f, expected] of cases) {
    test(`${f}(i·t) = ${expected} (simplify)`, () => {
      const e = ce.function(f, [ce.box(['Multiply', 'ImaginaryUnit', 't'])]);
      expect(e.simplify().toString()).toBe(expected);
    });
    test(`${f}(i·t) agrees with the kernel`, () => {
      for (const t of [num(0.7), num(2, 1), num(-1.5, 0.5), num(0, 3)]) {
        const arg = ce.box(['Multiply', 'ImaginaryUnit', t]);
        const folded = ce
          .function(f, [ce.box(['Multiply', 'ImaginaryUnit', 't'])])
          .subs({ t })
          .simplify();
        expect([
          f,
          t.toString(),
          same(ce.function(f, [arg.N()]), folded),
        ]).toEqual([f, t.toString(), true]);
      }
    });
  }

  test('a literal imaginary coefficient: Cos(2i·t) = Cosh(2t)', () => {
    const e = ce.function('Cos', [
      ce.box(['Multiply', ['Complex', 0, 2], 't']),
    ]);
    expect(e.simplify().toString()).toBe('cosh(2t)');
  });

  test('two imaginary factors are a real argument and stay', () => {
    const e = ce.function('Cos', [
      ce.box(['Multiply', 'ImaginaryUnit', 'ImaginaryUnit', 't']),
    ]);
    expect(e.simplify().toString()).not.toContain('cosh');
  });
});

describe('quotients of a function and its co-function, and cosh² - sinh²', () => {
  const cases: [string, string, string, string][] = [
    ['Sin', 'Cos', 'x', 'tan(x)'],
    ['Cos', 'Sin', 'x', 'cot(x)'],
    ['Sinh', 'Cosh', 'x', 'tanh(x)'],
    ['Cosh', 'Sinh', 'x', 'coth(x)'],
  ];
  for (const [f, g, x, expected] of cases) {
    test(`${f}(${x}) / ${g}(${x}) = ${expected}`, () => {
      const e = ce.box(['Divide', [f, x], [g, x]]);
      expect(e.simplify().toString()).toBe(expected);
    });
    test(`${f}(x + 1) / ${g}(x + 1) = ${expected.replace('(x)', '(x + 1)')}`, () => {
      const arg = ['Add', 'x', 1];
      const e = ce.box(['Divide', [f, arg], [g, arg]]);
      expect(e.simplify().toString()).toBe(expected.replace('(x)', '(x + 1)'));
    });
  }

  test('different arguments stay', () => {
    expect(
      ce
        .box(['Divide', ['Sin', 'x'], ['Cos', 'y']])
        .simplify()
        .toString()
    ).toBe('sin(x) / cos(y)');
  });

  test('cosh²(x) - sinh²(x) = 1, also inside a larger sum', () => {
    const c2 = ce.box(['Square', ['Cosh', 'x']]);
    const s2 = ce.box(['Square', ['Sinh', 'x']]);
    expect(ce.box(['Subtract', c2, s2]).simplify().toString()).toBe('1');
    expect(
      ce
        .box(['Add', c2, ['Negate', s2], 'y'])
        .simplify()
        .toString()
    ).toBe('y + 1');
    expect(
      ce
        .box(['Subtract', c2, ['Square', ['Sinh', 'y']]])
        .simplify()
        .toString()
    ).toBe('cosh(x)^2 - sinh(y)^2');
  });
});
