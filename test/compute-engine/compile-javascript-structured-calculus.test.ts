import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { setAntiderivativeAttemptBudgetForTesting } from '../../src/compute-engine/compilation/compile-integrals';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Slice 1 of docs/plans/2026-11-11-structured-numeric-calculus.md on the
// structured route of the JavaScript compiler (the `numeric-kernel`
// profile): an `Integrate`, `D`, `ND` or `Derivative` node, and an `Apply`
// of a `Derivative`, is admitted as the closed form that the existing
// compiler writes in its place (`closedFormIntegral()`,
// `derivativeClosedForm()`); with no closed form the program declines.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`) at each input, and agree with the interpreter within 1e-12
// relative.

type Json = MathJsonExpression;
type Vars = Record<string, number>;

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const name of ['x', 'y', 'a', 'b']) ce.declare(name, 'real');
  ce.declare('n', 'integer');
  ce.assign('k', 3);
  ce.parse('g(t) := t^3 + \\sin(t)').evaluate();
  ce.parse('q(y) := \\int_0^y t^2 dt').evaluate();
  ce.parse('r(t) := |t|').evaluate();
  return ce;
}

function run(result: CompilationResult<'javascript'>, vars: Vars): unknown {
  return (result.run as unknown as (v: Vars) => unknown)(vars);
}

/** Within 1e-12 relative of `expected`. */
function close(value: unknown, expected: number): boolean {
  return (
    typeof value === 'number' &&
    (value === expected ||
      Math.abs(value - expected) <=
        1e-12 * Math.max(1, Math.abs(value), Math.abs(expected)))
  );
}

const POINTS: Vars[] = [
  { x: 0.7, y: -1.25, a: 0.5, b: 2 },
  { x: -1.3, y: 0.4, a: -2.25, b: 0.1 },
  { x: 2, y: 3, a: 1.75, b: -0.6 },
];

const Pow = (base: Json, exponent: Json): Json => ['Power', base, exponent];
const Int = (body: Json, lower: Json, upper: Json, v = 't'): Json => [
  'Integrate',
  body,
  ['Limits', v, lower, upper],
];

type Program = {
  readonly name: string;
  readonly json: Json;
  /** The code of both is the same text, but for parentheses. */
  readonly sameText?: boolean;
};

const PROGRAMS: Program[] = [
  // `Integrate`: constant bounds, input bounds, a bound that is an
  // expression, an integrand that reads an input or a constant with a
  // value, a nested integral.
  {
    name: 'an integral with constant bounds, as an operand',
    json: ['Multiply', 'x', Int(Pow('t', 2), 0, 1)],
    sameText: true,
  },
  {
    name: 'a quotient by an integral with constant bounds',
    json: ['Divide', 'x', Int(Pow('t', 2), 0, 1)],
    sameText: true,
  },
  {
    name: 'an integral with an input bound',
    json: Int(['Exp', ['Negate', Pow('t', 2)]], 0, 'a'),
  },
  {
    name: 'an integral with a bound that is an expression',
    json: Int(Pow('t', 2), 'a', ['Add', 'b', 1]),
  },
  {
    name: 'an integrand that reads an input',
    json: Int(['Sin', ['Multiply', 'y', 't']], 0, 'x'),
  },
  {
    name: 'an integrand that reads a constant with a value',
    json: Int(['Multiply', 'k', 't'], 0, 'a'),
  },
  {
    name: 'an integrand that calls a user function',
    json: Int(['g', 't'], 0, 'a'),
  },
  {
    name: 'a nested integral',
    json: Int(Int(['Multiply', 's', 't'], 0, 't', 's'), 0, 'a'),
  },
  {
    name: 'an integral in a Sum',
    json: ['Sum', Int(Pow('t', 'n'), 0, 1), ['Limits', 'n', 1, 3]],
  },
  {
    name: 'an integral in an If',
    json: ['If', ['Less', 'x', 0], Int('t', 0, 'x'), 0],
  },
  {
    name: 'an integral minus an input',
    json: ['Subtract', Int(Pow('t', 2), 0, 'a'), 'x'],
  },
  {
    name: 'an integral in the body of a helper',
    json: ['Add', ['q', 'x'], ['q', 'a']],
  },
  {
    name: 'an integrand whose variable the engine types complex (Abs)',
    json: Int(['Abs', 's'], 'a', 'b', 's'),
  },
  // `D`, `ND`, `Derivative`.
  { name: 'D of one variable', json: ['D', ['Sin', Pow('x', 3)], 'x'] },
  // The existing compiler writes the closed form of `D` in parentheses
  // (CE-1216): each operand form gives the code of the expression.
  ...(
    [
      ['a quotient by D', (d: Json): Json => ['Divide', 1, d]],
      ['the negation of D', (d: Json): Json => ['Negate', d]],
      ['a product with D', (d: Json): Json => ['Multiply', 'y', d]],
      ['a difference with D', (d: Json): Json => ['Subtract', 'y', d]],
      ['a power of D', (d: Json): Json => ['Power', d, 2]],
    ] as const
  ).map(([name, form]) => ({
    name: `${name} as an operand`,
    json: form(['D', ['Add', Pow('x', 3), 'x'], 'x']),
  })),
  { name: 'D twice', json: ['D', Pow('x', 4), 'x', 'x'] },
  {
    name: 'D of two variables',
    json: ['D', ['Multiply', Pow('x', 2), 'y'], 'x', 'y'],
  },
  { name: 'D of a user function', json: ['D', ['g', 'x'], 'x'] },
  {
    name: 'ND at a number: a non-negative literal, as an operand',
    json: ['Add', 'x', ['ND', ['Function', Pow('t', 3), 't'], 1.5]],
  },
  {
    name: 'the derivative of a library function, applied',
    json: ['Apply', ['Derivative', 'Sin', 1], 'x'],
  },
  {
    name: 'the derivative of a user function, applied, as an operand',
    json: ['Divide', 1, ['Apply', ['Derivative', 'g', 1], 'x']],
  },
  {
    name: 'the derivative of a user function of the type complex | nan (Sign), applied',
    json: ['Add', 'x', ['Apply', ['Derivative', 'r', 1], 'x']],
  },
  {
    name: 'the second derivative of a user function, applied',
    json: ['Apply', ['Derivative', 'g', 2], 'x'],
  },
  {
    name: 'the derivative of a function literal, applied',
    json: [
      'Apply',
      ['Derivative', ['Function', ['Add', Pow('t', 3), 't'], 't'], 1],
      'x',
    ],
  },
  {
    name: 'the third derivative of a function literal, applied',
    json: [
      'Apply',
      ['Derivative', ['Function', ['Sin', Pow('t', 3)], 't'], 3],
      'x',
    ],
  },
  {
    name: 'a partial derivative of a function of two variables, applied',
    json: [
      'Apply',
      [
        'Derivative',
        ['Function', ['Multiply', 's', Pow('t', 2)], 's', 't'],
        0,
        1,
      ],
      'x',
      'y',
    ],
  },
];

describe('STRUCTURED CALCULUS: the closed form of the existing compiler', () => {
  const ce = engine();
  for (const { name, json, sameText } of PROGRAMS)
    test(name, () => {
      const expr = ce.box(json);
      const existing = compile(expr, EXISTING);
      const profile = compile(expr, PROFILE);
      expect(profile.success).toBe(true);
      expect(profile.profile).toBe('numeric-kernel');
      if (sameText)
        expect(profile.code.replace(/[()\s]/g, '')).toBe(
          existing.code.replace(/[()\s]/g, '')
        );
      for (const vars of POINTS) {
        const a = run(existing, vars);
        const b = run(profile, vars);
        expect([name, vars, b]).toEqual([name, vars, a]);
        expect(Object.is(a, b)).toBe(true);
        // `evaluate()` gives the closed form, `N()` its value (`N()` alone
        // integrates numerically).
        const value = expr.subs(vars).evaluate().N();
        expect(isNumber(value) && close(b, value.re)).toBe(true);
      }
      expect(canCompile(expr, PROFILE)).toMatchObject({ ok: true });
    });
});

describe('STRUCTURED CALCULUS: declines', () => {
  const ce = engine();
  const cases: [string, Json, string][] = [
    [
      'an integral with no closed form',
      Int(['Sqrt', ['Add', 1, Pow('t', 4)]], 0, 'a'),
      'has no closed form that the engine finds at compile time',
    ],
    [
      'an indefinite integral with no closed form',
      ['Integrate', ['Sqrt', ['Add', 1, Pow('t', 4)]], 't'],
      'indefinite integral',
    ],
    [
      'an integrand that draws',
      Int(['Add', 't', ['Random']], 0, 1),
      'is not pure',
    ],
    [
      'ND at an input: the numerical derivative',
      ['ND', ['Function', Pow('t', 3), 't'], 'x'],
      'has no closed form',
    ],
    [
      'a derivative that is a function',
      ['Derivative', 'Sin'],
      'which the profile does not have as a value',
    ],
    [
      'a derivative of high order of a large literal: Taylor jets',
      [
        'Apply',
        [
          'Derivative',
          [
            'Function',
            ['Sin', ['Add', ['Cos', Pow('t', 3)], ['Exp', ['Sin', 't']]]],
            't',
          ],
          4,
        ],
        'x',
      ],
      'Taylor jets',
    ],
  ];
  for (const [name, json, message] of cases)
    test(name, () => {
      const expr = ce.box(json);
      expect(() => compile(expr, PROFILE)).toThrow(message);
      expect(canCompile(expr, PROFILE)).toMatchObject({
        ok: false,
        diagnostic: { code: 'outside-profile' },
      });
    });

  test('a variable that can hold a list, a variable of D that holds a value', () => {
    const c = new ComputeEngine();
    c.declare('g', 'list<real>');
    // The existing compiler declines it; the closed form read as a number
    // would give `NaN` for a list.
    expect(() =>
      compile(c.box(['Integrate', Pow('g', 2), 'g']), PROFILE)
    ).toThrow('the variable g of the integral');
    c.assign('w', 4);
    // The existing compiler reads `w` as an input in the closed form
    // (`3 * (_.w * _.w)`); the interpreter reads its value (48).
    expect(() => compile(c.box(['D', Pow('w', 3), 'w']), PROFILE)).toThrow(
      'holds a value'
    );
  });

  test('a complex number in the node, a closed form 0 as an operand', () => {
    // The existing compiler reads the node on the complex lane, around the
    // real closed form: `{re: NaN, im: NaN}`.
    expect(() =>
      compile(ce.box(['Power', Int('t', 'ImaginaryUnit', 0), 2]), PROFILE)
    ).toThrow('reads the complex value');
    // The existing compiler keeps the term `(0)` of a complex sum.
    expect(() =>
      compile(ce.box(['Add', 'x', Int(1, 0, 0)]), PROFILE)
    ).toThrow('its closed form is 0');
  });

  test('the complex mode', () => {
    expect(() =>
      compile(ce.box(Int(Pow('t', 2), 0, 'a')), {
        ...PROFILE,
        mode: 'complex',
      })
    ).toThrow('Integrate in the complex mode is not in the profile');
  });

  test('the bigint mode: the lane analysis declines on both', () => {
    const expr = ce.box(['D', Pow('n', 3), 'n']);
    expect(() => compile(expr, { ...EXISTING, mode: 'bigint' })).toThrow(
      'not on the integer lane'
    );
    expect(() => compile(expr, { ...PROFILE, mode: 'bigint' })).toThrow(
      'not on the integer lane'
    );
  });
});

describe('STRUCTURED CALCULUS: the shared step pool of the closed-form searches', () => {
  afterEach(() => setAntiderivativeAttemptBudgetForTesting());

  test('the route starts with the full pool, as the existing compiler does', () => {
    const ce = engine();
    BaseCompiler.antiderivativeStepsLeft = 0;
    const result = compile(ce.box(Int(Pow('t', 2), 0, 'a')), PROFILE);
    expect(result.success).toBe(true);
    expect(result.code).not.toContain('_SYS.integrate');
  });

  test('a search that runs out of steps: quadrature on one, a decline on the other', () => {
    // `t eᵗ cos t` spends 9 steps of a search; with 5, no closed form.
    const latex = '\\int_0^a t e^{t} \\cos t dt';
    setAntiderivativeAttemptBudgetForTesting(5);
    expect(compile(engine().parse(latex), EXISTING).code).toContain(
      '_SYS.integrate'
    );
    expect(() => compile(engine().parse(latex), PROFILE)).toThrow(
      'has no closed form'
    );
    setAntiderivativeAttemptBudgetForTesting();
    const ce = engine();
    const existing = compile(ce.parse(latex), EXISTING);
    const profile = compile(ce.parse(latex), PROFILE);
    expect(existing.code).not.toContain('_SYS.integrate');
    for (const vars of POINTS)
      expect(Object.is(run(profile, vars), run(existing, vars))).toBe(true);
  });
});

describe('STRUCTURED CALCULUS: the result', () => {
  test('the dependencies: the names whose definitions a closed form holds', () => {
    const ce = engine();
    ce.assign('b2', 2);
    ce.assign('a2', ce.box(['Add', 'b2', 1]));
    const deps = (json: Json): string[] => {
      const symbolDeps = new Set<string>();
      compile(ce.box(json), { ...PROFILE, symbolDeps });
      return [...symbolDeps].sort();
    };
    // `a2` holds `b2 + 1`: the closed form holds the value 3.
    expect(deps(['D', ['Multiply', 'a2', 'x'], 'x'])).toEqual(['a2', 'b2']);
    // An input and the variable of the integral are not dependencies.
    expect(deps(Int(Pow('s', 2), 0, 'x', 's'))).toEqual([]);
    // A function given as a symbol, and a user function of the body.
    expect(deps(['Apply', ['Derivative', 'g', 1], 'x'])).toEqual(['g']);
    expect(deps(['D', ['Multiply', 'k', ['g', 'x']], 'x'])).toEqual([
      'g',
      'k',
    ]);
  });

  test('a local function whose body holds an integral captures no variable of the integral', () => {
    for (const declared of [false, true]) {
      const ce = engine();
      if (declared) ce.declare('s', 'real');
      const expr = ce.box([
        'Block',
        [
          'Assign',
          'f',
          ['Function', Int(Pow('s', 2), 0, 'u', 's'), 'u'],
        ],
        ['Divide', 1, ['f', 'x']],
      ]);
      const existing = compile(expr, EXISTING);
      const profile = compile(expr, PROFILE);
      expect(profile.code).not.toContain('_.s');
      expect(profile.defaultedSymbols ?? []).toEqual([]);
      for (const vars of POINTS)
        expect(Object.is(run(profile, vars), run(existing, vars))).toBe(true);
    }
  });

  test('pure, shippable, and the dependencies of a closed form', () => {
    const ce = engine();
    const symbolDeps = new Set<string>();
    const result = compile(
      ce.box([
        'Add',
        Int(['Multiply', 'k', 't'], 0, 'a'),
        ['Apply', ['Derivative', 'g', 1], 'x'],
      ]),
      { ...PROFILE, symbolDeps }
    );
    expect(result.pure).toBe(true);
    expect(result.shippable).toBe(true);
    // The closed form holds the value of `k` and the body of `g`.
    expect(symbolDeps.has('k')).toBe(true);
    expect(symbolDeps.has('g')).toBe(true);
  });

  test('a degree angular unit', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('x', 'real');
    for (const json of [
      ['D', ['Sin', Pow('x', 2)], 'x'],
      ['Apply', ['Derivative', ['Function', ['Cos', Pow('t', 2)], 't'], 1], 'x'],
      Int(['Cos', 't'], 0, 'x'),
    ] as Json[]) {
      const expr = ce.box(json);
      const existing = compile(expr, EXISTING);
      const profile = compile(expr, PROFILE);
      for (const x of [3, -40, 120])
        expect(Object.is(run(profile, { x }), run(existing, { x }))).toBe(true);
    }
  });

  // The memo of `nameHasAngularDefinition()` is keyed by a name: the route
  // empties it at the start and the end of each compilation, so an answer
  // made with the definition of `k` in one engine is not read for the
  // definition of `k` in another one. With `k := Sin(30)` the search for a
  // closed form refuses the definition, which reads the angular unit, and
  // the route declines; the existing compiler integrates numerically.
  for (const order of [
    ['3', 'Sin(30)'],
    ['Sin(30)', '3'],
  ])
    test(`a name defined in two engines: k := ${order.join(', then ')}`, () => {
      const programs = order.map((value) => {
        const ce = new ComputeEngine();
        ce.angularUnit = 'deg';
        ce.declare('x', 'real');
        ce.assign('k', value === '3' ? 3 : ce.box(['Sin', 30]));
        return { value, expr: ce.box(Int('k', 0, 'x')) };
      });
      // Both programs compile with the profile before any compilation of
      // the existing compiler, which empties the memos when it ends.
      const profiles = programs.map(({ value, expr }) => {
        if (value === '3') return compile(expr, PROFILE);
        expect(() => compile(expr, PROFILE)).toThrow('has no closed form');
        return undefined;
      });
      programs.forEach(({ value, expr }, i) => {
        const existing = compile(expr, EXISTING);
        const profile = profiles[i];
        for (const x of [2, -0.5]) {
          const expected = (value === '3' ? 3 : 0.5) * x;
          const interpreted = expr.subs({ x }).evaluate().N();
          expect(isNumber(interpreted) && close(interpreted.re, expected)).toBe(
            true
          );
          expect(close(run(existing, { x }), expected)).toBe(true);
          if (profile === undefined) continue;
          expect(Object.is(run(profile, { x }), run(existing, { x }))).toBe(
            true
          );
        }
      });
    });
});

describe('First of a list whose elements have the type never', () => {
  test('declines: the existing emitter reads undefined for []', () => {
    const ce = engine();
    expect(compile(ce.box(['First', ['List']]), EXISTING).run!({})).toBe(
      undefined
    );
    expect(() => compile(ce.box(['First', ['List']]), PROFILE)).toThrow(
      'whose elements have the type never'
    );
    // `Last` and `At` read `NaN` on both.
    for (const json of [['Last', ['List']], ['At', ['List'], 1]] as Json[])
      expect(
        Object.is(
          run(compile(ce.box(json), PROFILE), {}),
          run(compile(ce.box(json), EXISTING), {})
        )
      ).toBe(true);
  });
});
