/**
 * Five small fixes reported in cortex-js/compute-engine#397:
 *
 * 1. Wikidata ids that named an unrelated item (`PlanckConstant` was
 *    `Q524`, Mount Vesuvius).
 * 2. `Solve` answered `[]` ("no solution") for an identity and for an
 *    equation it could not solve. An identity now answers one free
 *    parameter, an equation with no candidate root stays unevaluated.
 * 3. `simplify()` combined `ln(a) + ln(b)` into `ln(ab)` for any
 *    unconstrained arguments, which is wrong when they are negative. The
 *    combination now uses only the arguments that are provably non-negative
 *    (or an absolute value).
 * 4. `Range` with an exact non-integer step enumerated floats.
 * 5. `LerchPhi` stayed unevaluated at an exact zero, `Φ(−1, −1, 1/2) = 0`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import OPERATORS from '../../src/math-json/OPERATORS.json';

const ce = new ComputeEngine();

function solve(eq: unknown, x = 'x'): unknown {
  return ce.box(['Solve', eq as any, x]).evaluate().json;
}

describe('Wikidata ids name the concept of the head', () => {
  // Each id was checked against its English label on wikidata.org.
  test.each([
    ['PlanckConstant', 'Q122894'],
    ['AvogadroConstant', 'Q6203'],
    ['BoltzmannConstant', 'Q5962'],
    ['GasConstant', 'Q182333'],
    ['GravitationalConstant', 'Q18373'],
    ['StefanBoltzmannConstant', 'Q51374'],
    ['VacuumPermittivity', 'Q6158'],
  ])('constant %s is %s', (name, id) => {
    expect(ce.box(name).wikidata).toBe(id);
  });

  test.each([
    ['AiryAi', 'Q109729241'],
    ['AiryBi', 'Q109729257'],
    ['AiryAiPrime', 'Q409415'],
    ['BesselJ', 'Q219637'],
    ['BesselI', 'Q2607225'],
    ['BesselK', 'Q109559130'],
    ['BesselY', 'Q109545924'],
    ['Beta', 'Q468881'],
    ['Combinations', 'Q202805'],
    ['EllipticK', 'Q109752514'],
    ['LambertW', 'Q429331'],
    ['Nand', 'Q3874243'],
    ['Nor', 'Q574946'],
    ['PlusMinus', 'Q260387'],
  ])('operator %s is %s', (name, id) => {
    expect(ce.lookupDefinition(name)?.operator?.wikidata).toBe(id);
  });

  // `OPERATORS.json` repeats the ids of the library: they must agree.
  test('OPERATORS.json agrees with the library', () => {
    const mismatches: string[] = [];
    for (const entry of [...OPERATORS.operators, ...OPERATORS.constants]) {
      const id = (entry as { wikidata?: string }).wikidata;
      if (id === undefined) continue;
      const def = ce.lookupDefinition(entry.name);
      const libraryId = def?.operator?.wikidata ?? def?.value?.wikidata;
      if (libraryId !== id)
        mismatches.push(`${entry.name}: ${id} vs ${libraryId}`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('Solve of an identity, a contradiction, an unsolved equation', () => {
  test('an identity has one solution with a free parameter', () => {
    expect(solve(['Equal', 'x', 'x'])).toEqual(['List', 't']);
    expect(solve(['Equal', 0, 0])).toEqual(['List', 't']);
    expect(
      solve([
        'Equal',
        ['Multiply', 2, ['Add', 'x', 1]],
        ['Add', ['Multiply', 2, 'x'], 2],
      ])
    ).toEqual(['List', 't']);
  });

  test('the free parameter does not reuse a symbol of the equation', () => {
    expect(solve(['Equal', 't', 't'], 't')).toEqual(['List', 't_1']);
  });

  test('a contradiction has no solution', () => {
    expect(solve(['Equal', 1, 0])).toEqual(['List']);
    expect(solve(['Equal', ['Add', 'x', 1], ['Add', 'x', 2]])).toEqual([
      'List',
    ]);
  });

  test('an equation whose answer depends on another unknown stays unevaluated', () => {
    expect((solve(['Equal', 'a', 0]) as unknown[])[0]).toBe('Solve');
  });

  test('an equation with no candidate root stays unevaluated', () => {
    // a·x⁵ + x + 1 = 0 has roots; the solver finds none.
    const quintic = [
      'Equal',
      ['Add', ['Multiply', 'a', ['Power', 'x', 5]], 'x', 1],
      0,
    ];
    expect((solve(quintic) as unknown[])[0]).toBe('Solve');
    // sin x = x³ + eˣ has a real root between −2 and −1.
    const transcendental = [
      'Equal',
      ['Sin', 'x'],
      ['Add', ['Power', 'x', 3], ['Exp', 'x']],
    ];
    expect((solve(transcendental) as unknown[])[0]).toBe('Solve');
  });

  test('an identity with a removed point stays unevaluated', () => {
    // (x² − 1)/(x − 1) = x + 1 is false at x = 1, where it is not defined.
    const eq = ce.parse('\\operatorname{Solve}(\\frac{x^2-1}{x-1}=x+1, x)');
    expect(eq.evaluate().operator).toBe('Solve');
  });

  test('candidate roots that are all rejected give no solution', () => {
    expect(solve(['Equal', ['Sqrt', 'x'], -1])).toEqual(['List']);
    expect(solve(['Equal', ['Sin', 'x'], 2])).toEqual(['List']);
    expect(solve(['Equal', ['Cos', 'x'], 2])).toEqual(['List']);
    expect(solve(['Equal', ['Exp', 'x'], 0])).toEqual(['List']);
    expect(solve(['Equal', ['Exp', 'x'], -1])).toEqual(['List']);
    expect(solve(['Equal', ['Cosh', 'x'], ['Rational', 1, 2]])).toEqual([
      'List',
    ]);
  });

  test('an exponential equation keeps an exact root', () => {
    // The constant `ExponentialE` used to be replaced by its float value
    // before solving: `ln(3)` came out as 1.0986…, and `e^(2x) = 5` was
    // not recognized at all.
    expect(solve(['Equal', ['Exp', 'x'], 3])).toEqual(['List', ['Ln', 3]]);
    expect(solve(['Equal', ['Exp', ['Multiply', 2, 'x']], 5])).toEqual([
      'List',
      ['Multiply', ['Rational', 1, 2], ['Ln', 5]],
    ]);
  });
});

describe('Solve: the cases where an empty or identity answer is not proved', () => {
  test('a root dropped by an undecided check is not a decision', () => {
    // √(x + a) = -x has the root x = -1 at a = 2, but the check of the
    // candidate root cannot be decided for a free `a`.
    const eq = ce.parse('\\operatorname{Solve}(\\sqrt{x+a}=-x, x)');
    expect(eq.evaluate().operator).toBe('Solve');
  });

  test('an identity of non-polynomial sides stays unevaluated', () => {
    // 1/x = 1/x is not defined at x = 0, √x = √x not for x < 0.
    for (const side of [
      ['Divide', 1, 'x'],
      ['Sqrt', 'x'],
      ['Ln', 'x'],
    ])
      expect((solve(['Equal', side, side]) as unknown[])[0]).toBe('Solve');
  });

  test('an identity in a restricted unknown stays unevaluated', () => {
    const engine = new ComputeEngine();
    engine.declare('k', 'integer');
    engine.assume(engine.parse('y > 0'));
    for (const u of ['k', 'y'])
      expect(
        engine.box(['Solve', ['Equal', u, u], u]).evaluate().operator
      ).toBe('Solve');
  });

  test('a list of conditions with a domain filters the roots', () => {
    // The `List` spelling was read as a system and answered `[]`; the `And`
    // and `Set` spellings answered `[2]`.
    expect(
      ce
        .box([
          'Solve',
          ['List', ['Equal', ['Power', 'n', 2], 4], ['Greater', 'n', 0]],
          ['Element', 'n', ['Range', -20, 20]],
        ])
        .evaluate().json
    ).toEqual(['List', 2]);
  });

  test('a sum of logarithms is solved although simplify() keeps it', () => {
    // simplify() no longer combines ln(x + 1) + ln(x - 1); the solver does,
    // and rejects the root -√2, where ln(x + 1) is not real.
    expect(
      solve([
        'Equal',
        ['Add', ['Ln', ['Add', 'x', 1]], ['Ln', ['Subtract', 'x', 1]]],
        0,
      ])
    ).toEqual(['List', ['Sqrt', 2]]);
    expect(
      solve(['Equal', ['Add', ['Ln', 'x'], ['Ln', ['Add', 'x', 2]]], ['Ln', 3]])
    ).toEqual(['List', 1]);
  });

  test('a list of one equation is that equation', () => {
    expect(solve(['List', ['Equal', ['Power', 'x', 2], 4]])).toEqual([
      'List',
      2,
      -2,
    ]);
    expect(
      solve(['List', ['Equal', ['Power', 'x', 2], 4], ['Greater', 'x', 0]])
    ).toEqual(['List', 2]);
  });
});

describe('simplify() combines logarithms of non-negative arguments only', () => {
  test('unconstrained arguments are not combined', () => {
    // At a = b = -1, ln(a) + ln(b) is 2πi but ln(ab) is 0.
    expect(ce.box(['Add', ['Ln', 'a'], ['Ln', 'b']]).simplify().json).toEqual([
      'Add',
      ['Ln', 'a'],
      ['Ln', 'b'],
    ]);
    // At x = 3 the combined form had the wrong sign of its imaginary part.
    const f = ce.box([
      'Add',
      ['Negate', ['Ln', ['Subtract', 2, 'x']]],
      ['Ln', ['Add', 2, 'x']],
    ]);
    const atThree = f.simplify().subs({ x: 3 }).N();
    expect(atThree.re).toBeCloseTo(Math.log(5), 12);
    expect(atThree.im).toBeCloseTo(-Math.PI, 12);
  });

  test('positive arguments are combined', () => {
    expect(ce.parse('\\ln 2 + \\ln 3').simplify().toString()).toBe('ln(6)');
    const engine = new ComputeEngine();
    engine.assume(engine.parse('p > 0'));
    engine.assume(engine.parse('q > 0'));
    expect(engine.parse('\\ln p + \\ln q').simplify().toString()).toBe(
      'ln(p * q)'
    );
    expect(engine.parse('\\ln p - \\ln q').simplify().toString()).toBe(
      'ln(p / q)'
    );
  });
});

describe('logarithm rules that hold for every argument', () => {
  test.each([
    // e^(ln u) = u for every u, so the exponent needs no combination.
    ['e^{\\ln x+\\ln y}', 'x * y'],
    ['e^{\\ln x+\\ln y+z}', 'x * y * exp(z)'],
    ['2^{\\log_2 x+\\log_2 y}', 'x * y'],
    // Only the non-negative arguments are combined.
    ['\\ln 2 + \\ln 3 + \\ln x', 'ln(x) + ln(6)'],
    // ln(c·u) = ln(c) + ln(u) for a positive constant c and any u.
    ['\\ln(2x) - \\ln(x)', 'ln(2)'],
    ['\\log_2(x)-\\log_2(2x)', '-1'],
    ['\\ln(2x)+\\ln(y)', 'ln(2x) + ln(y)'],
  ])('%s → %s', (src, expected) => {
    expect(ce.parse(src).simplify().toString()).toBe(expected);
  });
});

describe('Solve: logarithm and linear equations', () => {
  test.each([
    ['\\log_2(x)+\\log_2(x+2)=3', [2]],
    ['\\log(x)+\\log(x-21)=2', [25]],
    ['\\log_2(x^2+2x)=3', [2, -4]],
  ])('%s', (src, expected) => {
    const engine = new ComputeEngine();
    const roots = engine.parse(src).solve('x') as Expression[];
    expect(roots.map((r) => r.json)).toEqual(expected);
  });

  test('a logarithm of a quotient', () => {
    // ln(x) - ln(x - 1) = 1 has the root e/(e - 1).
    const engine = new ComputeEngine();
    const roots = engine
      .parse('\\ln(x) - \\ln(x-1) = 1')
      .solve('x') as Expression[];
    expect(roots).toHaveLength(1);
    expect(roots[0].N().re).toBeCloseTo(Math.E / (Math.E - 1), 12);
  });

  test('a linear equation whose coefficient is a sum', () => {
    for (const [src, value] of [
      ['\\pi x + x = 1', 1 / (Math.PI + 1)],
      ['x - ex + e = 0', Math.E / (Math.E - 1)],
    ] as const) {
      const engine = new ComputeEngine();
      const roots = engine.parse(src).solve('x') as Expression[];
      expect(roots).toHaveLength(1);
      expect(roots[0].N().re).toBeCloseTo(value, 12);
    }
  });
});

describe('Range with an exact step', () => {
  test('a rational step gives exact elements', () => {
    const r = ce.box(['Range', 0, 1, ['Rational', 1, 3]]);
    expect(r.at(2)!.toString()).toBe('1/3');
    expect(r.at(2)!.isExact).toBe(true);
    expect(r.evaluate().toString()).toBe('[0,1/3,2/3,1]');
    expect(ce.box(['Sum', r]).evaluate().json).toBe(2);
  });

  test('a rational lower bound gives exact elements', () => {
    expect(
      ce
        .box(['Range', ['Rational', 1, 2], 3])
        .evaluate()
        .toString()
    ).toBe('[1/2,3/2,5/2]');
  });

  test('a step that is a multiple of π gives number literals', () => {
    // The consumers of a range read each element as a number literal (`.re`),
    // so an exact constant step (`π/2`) still gives floats.
    const r = ce.box(['Range', 0, 'Pi', ['Divide', 'Pi', 2]]);
    expect(r.at(2)!.re).toBeCloseTo(Math.PI / 2, 15);
  });

  test('a float step and integer ranges are unchanged', () => {
    expect(ce.box(['Range', 1, 2, 0.25]).evaluate().toString()).toBe(
      '[1,1.25,1.5,1.75,2]'
    );
    expect(ce.box(['Range', 1, 10, 3]).evaluate().toString()).toBe(
      '[1,4,7,10]'
    );
  });

  test('N() still gives floats', () => {
    expect(
      ce
        .box(['Range', 0, 1, ['Rational', 1, 3]])
        .N()
        .toString()
    ).toBe('[0,0.3333333333333333,0.6666666666666666,1]');
  });
});

describe('LerchPhi at a negative integer order', () => {
  // Φ(z, −n, a) = Σₖ (k + a)ⁿ zᵏ is a rational function of z. Each value
  // below was checked against the numeric kernel (float operands) and, for
  // |z| < 1, against a direct partial sum.
  test.each([
    [-1, -1, ['Rational', 1, 2], 0],
    [-1, -2, ['Rational', 1, 2], ['Rational', -1, 8]],
    [['Rational', 1, 2], -2, 3, 36],
    [-1, -3, 0, ['Rational', 1, 8]],
    [2, -1, 1, 1],
    [3, -4, ['Rational', -5, 2], ['Rational', -5725, 32]],
    [5, -2, -3, ['Rational', -147, 32]],
  ])('LerchPhi(%j, %j, %j) = %j', (z, s, a, expected) => {
    const phi = ce.box(['LerchPhi', z as any, s as any, a as any]);
    expect(phi.evaluate().json).toEqual(expected);
  });

  test('the exact zero is found under N() too', () => {
    const phi = ce.box(['LerchPhi', -1, -1, ['Rational', 1, 2]]);
    const value = phi.N();
    expect(value.re).toBe(0);
    expect(value.isExact).toBe(false);
  });

  test('a float order gives a float', () => {
    const value = ce
      .function('LerchPhi', [ce.number([1, 2]), ce.parse('-3.0'), ce.One])
      .evaluate();
    expect(value.isExact).toBe(false);
    expect(value.re).toBe(52);
  });

  test('an exact radical z stays symbolic', () => {
    expect(ce.box(['LerchPhi', ['Sqrt', 2], -2, 1]).evaluate().operator).toBe(
      'LerchPhi'
    );
  });

  test('a symbolic z stays symbolic', () => {
    expect(ce.box(['LerchPhi', 'z', -1, 1]).evaluate().operator).toBe(
      'LerchPhi'
    );
  });
});
