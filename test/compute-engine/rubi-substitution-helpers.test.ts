import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import {
  build,
  inverseFunctionOfLinear,
  substituteInverseFunction,
  type Ctx,
} from '../../src/compute-engine/rubi/rubi-utils';
import {
  logarithmicSubstitution,
  polynomialExponentialTrig,
} from '../../src/compute-engine/rubi/substitution-integrals';
import { differentiate } from '../../src/compute-engine/symbolic/derivative';
import type { Expr, Json } from '../../src/compute-engine/rubi/types';
import { compileRuleDocs } from '../../src/compute-engine/rubi/compile';
import { RubiDriver } from '../../src/compute-engine/rubi/driver';
import type { RubiRuleDoc } from '../../src/compute-engine/rubi/types';
import ruleData from '../../src/compute-engine/rubi/rubi-rules-data.json';

const ce = new ComputeEngine();
const ctx: Ctx = { ce, env: new Map(), x: 'x', hooks: { int: () => null } };
const box = (json: Json): Expr => ce.box(json as any);

function checkDerivative(
  f: Expr,
  F: Expr,
  variable = 'x',
  points = [0.3, 0.7, 1.2]
): void {
  expect(F.has('Integrate')).toBe(false);
  expect(F.isValid).toBe(true);
  const d = differentiate(F, variable);
  expect(d).toBeDefined();
  for (const point of points) {
    const expected = f.subs({ [variable]: point }).N();
    const actual = d!.subs({ [variable]: point }).N();
    expect(Number.isFinite(actual.re)).toBe(true);
    expect(actual.re).toBeCloseTo(expected.re!, 7);
    expect(actual.im).toBeCloseTo(expected.im ?? 0, 7);
    const h = 1e-5;
    const plus = F.subs({ [variable]: point + h }).N();
    const minus = F.subs({ [variable]: point - h }).N();
    expect((plus.re! - minus.re!) / (2 * h)).toBeCloseTo(expected.re!, 5);
    expect(((plus.im ?? 0) - (minus.im ?? 0)) / (2 * h)).toBeCloseTo(
      expected.im ?? 0,
      5
    );
  }
}

describe('inverse-function substitution utilities', () => {
  test.each([
    ['Ln', 'Exp'],
    ['Arctan', 'Tan'],
    ['Arccot', 'Cot'],
    ['Artanh', 'Tanh'],
    ['Arcoth', 'Coth'],
    ['Arcsin', 'Sin'],
    ['Arccos', 'Cos'],
    ['Arsinh', 'Sinh'],
    ['Arcosh', 'Cosh'],
  ])(
    '%s uses its forward function without inverse cancellation',
    (head, forward) => {
      const v = box([head, ['Add', 2, ['Multiply', 3, 'x']]]);
      const u = box(['Add', ['Power', v.json as Json, 2], 'x']);
      expect(inverseFunctionOfLinear(u, 'x')?.isSame(v)).toBe(true);
      const result = substituteInverseFunction(u, v, 'x')!;
      const expected = box([
        'Add',
        ['Power', 'x', 2],
        ['Divide', ['Subtract', [forward, 'x'], 2], 3],
      ]);
      for (const x of [0.2, 0.5]) {
        expect(result.subs({ x }).N().re).toBeCloseTo(
          expected.subs({ x }).N().re!,
          12
        );
      }
    }
  );

  test.each(
    (
      [
        ['Ln', ['Power', 'x', 2]],
        ['Ln', ['Multiply', 'b', 'x']],
        ['Ln', 'y'],
        ['Integrate', ['Ln', 'x'], 'x'],
        ['Function', ['Ln', 'x'], 'x'],
        ['Ln', ['Add', 1, ['Power', 'x', 1000]]],
      ] as Json[]
    ).map((json) => [json])
  )(
    'declines nonlinear, unproved, constant, bound, or oversized input %j',
    (u) => {
      expect(inverseFunctionOfLinear(box(u), 'x')).toBeNull();
    }
  );

  test('supports an integration variable other than x', () => {
    const v = box(['Ln', ['Add', 1, ['Multiply', -2, 't']]]);
    const result = substituteInverseFunction(
      box(['Multiply', 't', v.json as Json]),
      v,
      't'
    )!;
    expect(result.has('x')).toBe(false);
    expect(result.subs({ t: 0.4 }).N().re).toBeCloseTo(
      ((1 - Math.exp(0.4)) * 0.4) / 2,
      12
    );
  });

  test('does not rewrite bound variables during substitution', () => {
    expect(
      substituteInverseFunction(
        box(['Sum', ['Ln', 'x'], ['Tuple', 'x', 1, 5]]),
        box(['Ln', 'x']),
        'x'
      )
    ).toBeNull();
  });

  test('accepts inert Rubi trig heads but rejects effectful expressions', () => {
    const log = box(['Ln', 'x']);
    expect(
      inverseFunctionOfLinear(box(['cos', log.json as Json]), 'x')?.isSame(log)
    ).toBe(true);
    expect(
      inverseFunctionOfLinear(box(['Add', ['Random'], log.json as Json]), 'x')
    ).toBeNull();
  });

  test('substitution retains a different inverse function instead of treating it as the selected one', () => {
    const u = box(['Add', ['Arctan', 'x'], ['Arctan', ['Add', 1, 'x']]]);
    const result = substituteInverseFunction(u, box(['Arctan', 'x']), 'x')!;
    expect(result.has('Arctan')).toBe(true);
    for (const t of [0.2, 0.6])
      expect(result.subs({ x: t }).N().re).toBeCloseTo(
        t + Math.atan(1 + Math.tan(t)),
        12
      );
  });

  test.each(['Arctan', 'Arccot', 'Artanh', 'Arcoth'])(
    'Part reads the argument of %s for corpus guards',
    (head) => {
      expect(
        build(['Part', [head, ['Add', 1, 'x']], 1], ctx).isSame(
          box(['Add', 1, 'x'])
        )
      ).toBe(true);
    }
  );
});

describe('fractional affine substitution tuple', () => {
  test.each([
    [1, 2],
    [2, -3],
    [-2, 4],
  ])('combines square and cube roots of %s+%s*x using degree six', (a, b) => {
    const L: Json = ['Add', a, ['Multiply', b, 'x']];
    const u: Json = [
      'Multiply',
      ['Add', 1, 'x'],
      [
        'Ln',
        [
          'Add',
          1,
          ['Power', L, ['Rational', 1, 2]],
          ['Power', L, ['Rational', 1, 3]],
        ],
      ],
    ];
    const tuple = build(['SubstForFractionalPowerOfLinear', u, 'x'], ctx);
    expect(tuple.operator).toBe('List');
    expect(tuple.op2!.isSame(6)).toBe(true);
    for (const t of [0.8, 1.1]) {
      const oldX = (t ** 6 - a) / b;
      const actual =
        tuple.op1!.subs({ x: t }).N().re! * 6 * tuple.ops![3].N().re!;
      const expected = (box(u).subs({ x: oldX }).N().re! * 6 * t ** 5) / b;
      expect(actual).toBeCloseTo(expected, 8);
    }
  });

  test.each(
    (
      [
        ['Ln', ['Add', ['Sqrt', 'x'], ['Sqrt', ['Add', 1, 'x']]]],
        ['Ln', ['Power', 'x', ['Rational', 1, 17]]],
        ['Ln', ['Sqrt', ['Add', 1, ['Multiply', 'b', 'x']]]],
        ['Integrate', ['Sqrt', 'x'], 'x'],
        ['Ln', 'x'],
      ] as Json[]
    ).map((json) => [json])
  )('declines unsupported root substitutions %j', (u) => {
    expect(build(['SubstForFractionalPowerOfLinear', u, 'x'], ctx).symbol).toBe(
      'False'
    );
  });
});

describe('bundled inverse substitution rules', () => {
  test.each([
    ['Arctan', '5.3.7', 27, 1],
    ['Arccot', '5.3.7', 28, 1],
    ['Artanh', '7.3.7', 25, -1],
    ['Arcoth', '7.3.7', 26, -1],
  ] as const)(
    '%s substitution reaches the rule consumer',
    (head, section, index, sign) => {
      const docs = (ruleData as unknown as RubiRuleDoc[]).flatMap((doc) => {
        if (doc.file.startsWith('2 Exponentials')) return [doc];
        if (doc.file.includes(section))
          return [
            { ...doc, rules: doc.rules.filter((r) => r.index === index) },
          ];
        return [];
      });
      const driver = new RubiDriver(ce, compileRuleDocs(ce, docs).rules, {
        trace: true,
        timeLimitMs: 10000,
      });
      const f = box([
        'Divide',
        ['Exp', [head, 'x']],
        ['Add', 1, ['Multiply', sign, ['Power', 'x', 2]]],
      ]);
      const F = driver.int(f, 'x');
      expect({ answer: F?.json, trace: F ? [] : driver.stats.trace }).toEqual(
        expect.objectContaining({ answer: expect.anything() })
      );
      expect(
        Object.keys(driver.stats.ruleFirings).some(
          (id) => id.includes(section) && id.endsWith('#' + index)
        )
      ).toBe(true);
      checkDerivative(
        f,
        F!,
        'x',
        head === 'Arcoth' ? [1.4, 2, 3] : [0.2, 0.4, 0.7]
      );
    }
  );
});

test('the fractional-linear tuple drives the bundled logarithmic substitution', () => {
  const docs = (ruleData as unknown as RubiRuleDoc[]).flatMap((doc) => {
    if (
      doc.file.startsWith('1 Algebraic') ||
      doc.file.includes('3.1.') ||
      doc.file.includes('3.3 u')
    )
      return [doc];
    if (doc.file.includes('3.5 Miscellaneous'))
      return [{ ...doc, rules: doc.rules.filter((r) => r.index === 13) }];
    return [];
  });
  const driver = new RubiDriver(ce, compileRuleDocs(ce, docs).rules, {
    trace: true,
    timeLimitMs: 30000,
  });
  const f = box([
    'Multiply',
    'x',
    ['Ln', ['Add', 1, ['Sqrt', ['Add', 2, ['Multiply', 3, 'x']]]]],
  ]);
  const F = driver.int(f, 'x');
  expect({
    answer: F?.json,
    trace: F ? [] : driver.stats.trace.slice(-5),
  }).toEqual(expect.objectContaining({ answer: expect.anything() }));
  expect(
    Object.keys(driver.stats.ruleFirings).some(
      (id) => id.includes('3.5 Miscellaneous') && id.endsWith('#13')
    )
  ).toBe(true);
  checkDerivative(f, F!);
});

describe('finite polynomial exponential-trig recurrence', () => {
  test('rejects enormous nonlinear phases before coefficient allocation', () => {
    const f = box([
      'Multiply',
      ['Exp', ['Power', 'x', 1000000000]],
      ['Cos', 'x'],
    ]);
    expect(polynomialExponentialTrig(f, 'x')).toBeNull();
  });
  test.each([0, 1, 2, 4, 8])(
    'handles polynomial degree %s with both signs and trig functions',
    (degree) => {
      for (const head of ['Sin', 'Cos'])
        for (const a of [-2, 3]) {
          const f = box([
            'Multiply',
            ['Power', 'x', degree],
            ['Exp', ['Add', 1, ['Multiply', a, 'x']]],
            [head, ['Add', 2, ['Multiply', -3, 'x']]],
          ]);
          const F = polynomialExponentialTrig(f, 'x');
          expect(F).not.toBeNull();
          checkDerivative(f, F!, 'x', [0.2, 0.4, 0.7]);
        }
    }
  );

  test.each(
    (
      [
        ['Multiply', ['Power', 'x', 1000], ['Exp', 'x'], ['Cos', 'x']],
        ['Multiply', ['Exp', ['Multiply', 'a', 'x']], ['Cos', 'x']],
        ['Multiply', ['Exp', 'x'], ['Cos', ['Power', 'x', 2]]],
      ] as Json[]
    ).map((json) => [json])
  )('declines unsupported or unbounded recurrence %j', (f) => {
    expect(polynomialExponentialTrig(box(f), 'x')).toBeNull();
  });
});

describe('Rubi composition of substitution and integration', () => {
  beforeAll(() => {
    loadIntegrationRules(ce, { timeLimitMs: 30000 });
  });
  test.each(
    (
      [
        ['Cos', ['Ln', 'x']],
        ['Sin', ['Ln', 'x']],
        ['Cos', ['Add', 1, ['Multiply', 2, ['Ln', 'x']]]],
        ['Cos', ['Ln', ['Add', 2, ['Multiply', 3, 'x']]]],
        ['Multiply', ['Ln', 'x'], ['Cos', ['Ln', 'x']]],
        ['Multiply', ['Power', ['Ln', 'x'], 2], ['Sin', ['Ln', 'x']]],
        ['Multiply', ['Power', 'x', 2], ['Cos', ['Ln', 'x']]],
        ['Multiply', ['Power', 'x', -2], ['Sin', ['Ln', 'x']]],
        [
          'Multiply',
          ['Cos', ['Multiply', 3, 'x']],
          ['Cosh', ['Multiply', 2, 'x']],
        ],
        [
          'Multiply',
          'x',
          ['Sin', ['Multiply', 3, 'x']],
          ['Sinh', ['Multiply', 2, 'x']],
        ],
        ['Multiply', ['Exp', 'x'], ['Cos', 'x']],
      ] as Json[]
    ).map((json) => [json])
  )('closes the general composition %j', (json) => {
    const f = box(json);
    const F = ce.box(['Integrate', json as any, 'x']).evaluate();
    checkDerivative(f, F, 'x', [0.4, 0.8, 1.3]);
  });

  test('logarithmic substitution removes its chosen log and includes the Jacobian', () => {
    const f = box(['Cos', ['Ln', ['Add', 2, ['Multiply', -3, 'x']]]]);
    const sub = logarithmicSubstitution(f, 'x')!;
    expect(sub.integrand.has('Ln')).toBe(false);
    for (const t of [0.2, 0.6])
      expect(sub.integrand.subs({ x: t }).N().re).toBeCloseTo(
        (-Math.exp(t) * Math.cos(t)) / 3,
        12
      );
  });

  test('different logarithm arguments do not trigger a recursive substitution loop', () => {
    expect(
      logarithmicSubstitution(
        box(['Multiply', ['Ln', 'x'], ['Ln', ['Add', 1, 'x']]]),
        'x'
      )
    ).toBeNull();
  });

  test('parameter-dependent logarithms stay on the existing provider paths', () => {
    expect(
      logarithmicSubstitution(box(['Cos', ['Ln', ['Add', 'a', 'x']]]), 'x')
    ).toBeNull();
  });

  test('exact definite endpoints do not introduce a spurious zero-to-zero power', () => {
    const result = ce
      .box([
        'Integrate',
        ['Cos', ['Ln', 'x']],
        ['Tuple', 'x', 1, 'ExponentialE'],
      ])
      .evaluate();
    expect(result.has('Integrate')).toBe(false);
    expect(result.isNaN).not.toBe(true);
    expect(result.N().re).toBeCloseTo(
      (Math.E * (Math.sin(1) + Math.cos(1)) - 1) / 2,
      12
    );
  });

  test('the parsed integral and a renamed variable use the same composition', () => {
    const F = ce.parse('\\int \\cos(\\ln t)\\,dt').evaluate();
    checkDerivative(box(['Cos', ['Ln', 't']]), F, 't', [0.4, 1, 1.4]);
  });

  test('principal logarithms retain their complex values on the negative real axis', () => {
    const f = box(['Cos', ['Ln', 'x']]);
    const F = ce.box(['Integrate', f, 'x']).evaluate();
    checkDerivative(f, F, 'x', [-2, -0.8, -0.4]);
  });

  test('an improper endpoint is resolved as a limit, not by evaluating Ln(0)', () => {
    const F = ce
      .box(['Integrate', ['Cos', ['Ln', 'x']], ['Tuple', 'x', 0, 1]])
      .evaluate();
    // The endpoint-limit machinery may decline, but cannot report NaN or a
    // finite answer different from the convergent integral's value 1/2.
    if (!F.has('Integrate')) expect(F.N().re).toBeCloseTo(0.5, 12);
  });
});
