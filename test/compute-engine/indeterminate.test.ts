/**
 * The exact indeterminate forms (`0/0`, `0·∞`, `∞ − ∞`, `0^0`, `Mod(5, 0)`
 * and the others) give `NaN` on every route, as `.N()` and compiled code do.
 * `Indeterminate` is only an input spelling of `NaN`: the MathJSON symbol,
 * `\\operatorname{Indeterminate}` in LaTeX, the Epsil word and the string
 * read by `NumberFrom` give `NaN`, and every serializer writes `NaN`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

const ce = new ComputeEngine();

/** Evaluate a MathJSON expression (the box route). */
function box(json: MathJsonExpression): Expression {
  return ce.box(json).evaluate();
}

/** `.N()` of a MathJSON expression. */
function boxN(json: MathJsonExpression): Expression {
  return ce.box(json).N();
}

/** Evaluate a LaTeX expression (the parse route). */
function parse(latex: string): Expression {
  return ce.parse(latex).evaluate();
}

/** Run an Epsil program on a fresh engine and return its value. */
function epsil(source: string): Expression {
  const { value, diagnostics } = executeEpsil(new ComputeEngine(), source);
  expect(diagnostics).toEqual([]);
  return value;
}

const I = '\\operatorname{Indeterminate}';

describe('INDETERMINATE — an input spelling of NaN', () => {
  test('every input spelling gives the NaN literal', () => {
    for (const x of [
      ce.box('Indeterminate'),
      ce.parse(I),
      ce.parse('\\mathrm{Indeterminate}'),
      epsil('Indeterminate'),
      box(['NumberFrom', { str: 'Indeterminate' }]),
    ]) {
      expect(x.isNaN).toBe(true);
      expect(x.isSame(ce.NaN)).toBe(true);
      expect(x.json).toBe('NaN');
      expect(x.toString()).toBe('NaN');
      expect(x.latex).toBe('\\operatorname{NaN}');
    }
  });

  test('the serializers write NaN', () => {
    expect(serializeEpsil('Indeterminate')).toBe('NaN');
    expect(typeToString(parseType('Indeterminate'))).toBe('NaN');
  });
});

describe('INDETERMINATE FORMS — the producers: the arithmetic forms', () => {
  const INDET = 'NaN';
  // [input, canonical form]: the forms that fold at canonicalization give the
  // value itself, the others keep their structure until `evaluate()`.
  test.each([
    [['Divide', 0, 0], INDET],
    [['Rational', 0, 0], INDET],
    [['Divide', 'PositiveInfinity', 'PositiveInfinity'], INDET],
    [['Divide', 'NegativeInfinity', 'PositiveInfinity'], INDET],
    [
      ['Multiply', 0, 'PositiveInfinity'],
      ['Multiply', 0, 'PositiveInfinity'],
    ],
    [
      ['Multiply', 0, 'ComplexInfinity'],
      ['Multiply', 0, 'ComplexInfinity'],
    ],
    [['Multiply', 2, 0, 'PositiveInfinity'], INDET],
    [
      ['Subtract', 'PositiveInfinity', 'PositiveInfinity'],
      ['Add', 'NegativeInfinity', 'PositiveInfinity'],
    ],
    [['Power', 0, 0], INDET],
    [['Power', 'PositiveInfinity', 0], INDET],
    [['Power', 'ComplexInfinity', 0], INDET],
    [['Power', 1, 'PositiveInfinity'], INDET],
    [['Power', 1, 'NegativeInfinity'], INDET],
    [['Power', -1, 'PositiveInfinity'], INDET],
    [['Power', -1, 'NegativeInfinity'], INDET],
    [['Power', 'ImaginaryUnit', 'PositiveInfinity'], INDET],
    [['Power', 'PositiveInfinity', 'ImaginaryUnit'], INDET],
    [['Power', 0, 'ImaginaryUnit'], INDET],
    [
      ['Root', 0, 'PositiveInfinity'],
      ['Root', 0, 'PositiveInfinity'],
    ],
    [
      ['Mod', 5, 0],
      ['Mod', 5, 0],
    ],
    [
      ['Mod', 'x', 0],
      ['Mod', 'x', 0],
    ],
    [
      ['Fract', 'PositiveInfinity'],
      ['Fract', 'PositiveInfinity'],
    ],
    [
      ['Fract', 'NegativeInfinity'],
      ['Fract', 'NegativeInfinity'],
    ],
    [
      ['Log', 1, 1],
      ['Log', 1, 1],
    ],
    [
      ['Log', 'PositiveInfinity', 'PositiveInfinity'],
      ['Log', 'PositiveInfinity', 'PositiveInfinity'],
    ],
  ] as [MathJsonExpression, MathJsonExpression][])(
    '%j is NaN, on evaluate() and N()',
    (json, canonical) => {
      const boxed = ce.box(json);
      expect(boxed.json).toEqual(canonical);
      const value = boxed.evaluate();
      expect(value.toString()).toBe('NaN');
      expect(value.isNaN).toBe(true);
      expect(value.isSame(ce.NaN)).toBe(true);
      expect(boxN(json).toString()).toBe('NaN');
      expect(
        ce.box(json).evaluate({ numericApproximation: true }).toString()
      ).toBe('NaN');
      // The raw form keeps the structure, and evaluates to the same value.
      const raw = ce.box(json, { form: 'raw' });
      expect(raw.json).toEqual(json);
      expect(raw.evaluate().toString()).toBe('NaN');
    }
  );

  test('the parse route', () => {
    for (const latex of [
      '\\frac{0}{0}',
      '0^0',
      '\\infty-\\infty',
      '0\\cdot\\infty',
      '1^\\infty',
      '\\frac{\\infty}{\\infty}',
      '(-1)^\\infty',
      '\\infty^0',
      '\\operatorname{mod}(5,0)',
    ]) {
      expect([latex, parse(latex).toString()]).toEqual([
        latex,
        'NaN',
      ]);
      expect([latex, ce.parse(latex).N().toString()]).toEqual([latex, 'NaN']);
    }
    expect(ce.parse('\\frac{0}{0}').latex).toBe('\\operatorname{NaN}');
  });

  test('the Epsil route', () => {
    for (const source of [
      '0/0',
      'oo - oo',
      '0 * oo',
      '0^0',
      '1^oo',
      '(-1)^oo',
      'oo^i',
      '0^i',
      'fract(oo)',
      'Mod(5, 0)',
      'x = 0; x/x',
    ])
      expect([source, epsil(source).toString()]).toEqual([
        source,
        'NaN',
      ]);
    expect(epsil('N(0/0)').toString()).toBe('NaN');
  });
});

describe('INDETERMINATE FORMS — the producers: a float operand gives NaN', () => {
  test.each([
    [['Divide', { num: '0.0' }, { num: '0.0' }]],
    [['Divide', 0, { num: '0.0' }]],
    [['Divide', { num: '0.0' }, 0]],
    [['Multiply', { num: '0.0' }, 'PositiveInfinity']],
    [['Multiply', { num: '2.5' }, 'PositiveInfinity', 0]],
    [['Add', 'PositiveInfinity', 'NegativeInfinity', { num: '1.5' }]],
    [['Power', { num: '0.0' }, 0]],
    [['Power', 0, { num: '0.0' }]],
    [['Power', 'PositiveInfinity', { num: '0.0' }]],
    [['Power', { num: '1.0' }, 'PositiveInfinity']],
    [['Power', { num: '1.0' }, 'NegativeInfinity']],
    [['Power', { num: '-1.0' }, 'PositiveInfinity']],
    [['Power', 0, ['Complex', 0, 2.5]]],
    [['Mod', { num: '5.0' }, 0]],
    [['Mod', 5, { num: '0.0' }]],
    [['Log', { num: '1.0' }, 1]],
  ] as MathJsonExpression[][])('%j is NaN', (json) => {
    const value = box(json);
    expect(value.toString()).toBe('NaN');
  });

  test('on the parse and Epsil routes', () => {
    expect(parse('\\frac{0.0}{0.0}').toString()).toBe('NaN');
    expect(parse('\\frac{0}{0.0}').toString()).toBe('NaN');
    expect(epsil('0.0/0.0').toString()).toBe('NaN');
    expect(epsil('0/0.0').toString()).toBe('NaN');
    expect(epsil('0.0 * oo').toString()).toBe('NaN');
  });
});

describe('INDETERMINATE FORMS — the producers: the poles and the other NaN are unchanged', () => {
  test('a pole is ~oo, not NaN', () => {
    for (const json of [
      ['Divide', 5, 0],
      ['Rational', 5, 0],
      ['Divide', 1, 0],
      ['Divide', -1, 0],
      ['Tan', ['Divide', 'Pi', 2]],
      ['Gamma', 0],
      ['Gamma', -1],
      ['Zeta', 1],
    ] as MathJsonExpression[])
      expect([json, box(json).toString()]).toEqual([json, '~oo']);
    expect(box(['Ln', 0]).toString()).toBe('-oo');
    expect(parse('\\frac{5}{0}').toString()).toBe('~oo');
    expect(epsil('5/0').toString()).toBe('~oo');
  });

  test('a rational pair with a zero denominator is a pole or the form', () => {
    // `ce.number([n, 0])` gives the answer of `Rational(n, 0)`: a pole for
    // `n ≠ 0`, and the indeterminate form for `0/0`.
    expect(ce.number([5, 0]).toString()).toBe('~oo');
    expect(ce.number([-3, 0]).toString()).toBe('~oo');
    expect(ce.number([BigInt(5), BigInt(0)]).toString()).toBe('~oo');
    expect(ce.number([0, 0]).toString()).toBe('NaN');
    expect(box(['Rational', 0, 0]).toString()).toBe('NaN');
    expect(ce.number([1, 2]).toString()).toBe('1/2');
    expect(box(['Ln', -2]).toString()).toBe('ln(-2)');
  });

  test('an absent operand gives Missing', () => {
    expect(box(['Add', 'Missing', 2]).toString()).toBe('"Missing"');
    expect(box(['Multiply', 'Missing', 0]).toString()).toBe('"Missing"');
    expect(box(['Divide', 'Missing', 0]).toString()).toBe('"Missing"');
    expect(box(['Length', 'Missing']).toString()).toBe('"Missing"');
    expect(box(['Multiply', 'NaN', 0]).toString()).toBe('NaN');
    expect(box(['Power', 'NaN', 0]).toString()).toBe('NaN');
  });

  test('0/∞ is 0, on the canonical route and through .div()', () => {
    expect(box(['Divide', 0, 'PositiveInfinity']).toString()).toBe('0');
    expect(ce.Zero.div(ce.PositiveInfinity).toString()).toBe('0');
    expect(ce.Zero.div(ce.ComplexInfinity).toString()).toBe('0');
    expect(ce.Zero.div(Infinity).toString()).toBe('0');
    expect(ce.Zero.div(0).toString()).toBe('NaN');
    expect(ce.Zero.div(ce.Zero).toString()).toBe('NaN');
  });
});

describe('INDETERMINATE FORMS — the producers: special functions at an infinite point', () => {
  test('no limit: NaN', () => {
    for (const json of [
      ['Gamma', 'NegativeInfinity'],
      ['Gamma', 'ComplexInfinity'],
      ['Factorial', 'NegativeInfinity'],
      ['Digamma', 'NegativeInfinity'],
      ['Zeta', 'NegativeInfinity'],
      ['Zeta', 'ComplexInfinity'],
      ['AiryAi', 'ComplexInfinity'],
      ['AiryAiPrime', 'NegativeInfinity'],
      ['BesselJ', 0, 'ComplexInfinity'],
      ['Beta', 'NegativeInfinity', ['Rational', 1, 2]],
      ['Gamma', 2, 'ComplexInfinity'],
      ['Gamma', 'PositiveInfinity', 'PositiveInfinity'],
      ['GammaRegularized', 'NegativeInfinity', 2],
      ['Binomial', 'NegativeInfinity', ['Rational', 1, 2]],
      ['Pochhammer', 2, 'ComplexInfinity'],
      ['ErfInv', 'PositiveInfinity'],
      ['SinIntegral', 'ComplexInfinity'],
      ['ExpIntegralEi', 'ComplexInfinity'],
      ['Real', 'ComplexInfinity'],
      ['Argument', 'ComplexInfinity'],
    ] as MathJsonExpression[]) {
      expect([json, box(json).toString()]).toEqual([json, 'NaN']);
      expect([json, boxN(json).toString()]).toEqual([json, 'NaN']);
    }
    expect(parse('\\Gamma(-\\infty)').toString()).toBe('NaN');
  });

  test('a divergence whose sign depends on the other operand answers the limit', () => {
    // Γ(n, z) = (n−1)!·e^(−z)·Σ_{k<n} z^k/k!, so Γ(2, −∞) = −∞
    // (mpmath: Γ(2, −100) = −2.7·10⁴⁵, Γ(2, −1000) = −2.0·10⁴³⁷).
    expect(box(['Gamma', 2, 'NegativeInfinity']).toString()).toBe('-oo');
    // B(a, b) ~ Γ(b)·a^(−b) as a → +∞ and Γ(−½) = −2√π, so B(+∞, −½) = −∞
    // (mpmath: B(10³, −½) = −112, B(10⁶, −½) = −3545).
    expect(
      box(['Beta', 'PositiveInfinity', ['Rational', -1, 2]]).toString()
    ).toBe('-oo');
    // Complex with a modulus that grows without bound (mpmath:
    // Q(½, −100) = −1.5·10⁴²·i, Q(½, −1000) = −3.5·10⁴³²·i).
    expect(
      box([
        'GammaRegularized',
        ['Rational', 1, 2],
        'NegativeInfinity',
      ]).toString()
    ).toBe('~oo');
  });

  test('`∞ + i` is the real infinity `+∞`, not an anonymous infinity', () => {
    // A complex literal with an infinite real part and a finite imaginary
    // part is boxed as `+∞` since 2026-10-18. Each head then gives its value
    // at `+∞` (until then, this "anonymous" infinity gave `NaN` on each).
    const anon: MathJsonExpression = ['Complex', 'PositiveInfinity', 1];
    for (const head of ['Gamma', 'Zeta', 'AiryAi', 'ErfInv'])
      expect([head, box([head, anon]).toString()]).toEqual([
        head,
        box([head, 'PositiveInfinity']).toString(),
      ]);
    expect(box(['Gamma', anon]).toString()).toBe('+oo');
    expect(box(['Zeta', anon]).toString()).toBe('1');
    expect(box(['AiryAi', anon]).toString()).toBe('0');
    expect(box(['ErfInv', anon]).toString()).toBe('NaN');
  });
});

describe('INDETERMINATE FORMS — the producers: library answers', () => {
  test('the sample variance of one datum', () => {
    expect(box(['Variance', ['List', 5]]).toString()).toBe('NaN');
    expect(box(['StandardDeviation', ['List', 5]]).toString()).toBe(
      'NaN'
    );
    expect(boxN(['Variance', ['List', 5]]).toString()).toBe('NaN');
    expect(box(['Variance', ['List', 5.5]]).toString()).toBe('NaN');
    expect(epsil('variance([5])').toString()).toBe('NaN');
  });

  test('a broadcast quotient and product, a matrix power', () => {
    expect(box(['Divide', ['List', 0, 1], 0]).toString()).toBe(
      '[NaN,~oo]'
    );
    expect(boxN(['Divide', ['List', 0, 1], 0]).toString()).toBe('[NaN,~oo]');
    expect(epsil('[0, 1]/0').toString()).toBe('[NaN,~oo]');
    expect(
      box(['Multiply', ['List', 0, 1], 'PositiveInfinity']).toString()
    ).toBe('[NaN,+oo]');
    // The final map of `.N()` reaches the cells a kernel computed.
    expect(
      boxN(['Multiply', ['List', 0, 1], 'PositiveInfinity']).toString()
    ).toBe('[NaN,+oo]');
    const power: MathJsonExpression = [
      'MatrixPower',
      ['List', ['List', 'PositiveInfinity', 0], ['List', 0, 1]],
      2,
    ];
    expect(box(power).toString()).toBe(
      '[[+oo,NaN],[NaN,1]]'
    );
    expect(boxN(power).toString()).toBe('[[+oo,NaN],[NaN,1]]');
  });
});

describe('INDETERMINATE FORMS — the producers: symbols, simplification, compilation', () => {
  test('a symbol holding 0 evaluates the form', () => {
    const ce2 = new ComputeEngine();
    // Unassigned, `x/x` folds to 1 at canonicalization (the generic-symbol
    // convention), and that form survives a later assignment.
    const cached = ce2.box(['Divide', 'x', 'x']);
    expect(cached.json).toBe(1);
    ce2.assign('x', 0);
    expect(cached.evaluate().toString()).toBe('1');
    // Boxed after the assignment, the quotient keeps its structure and
    // evaluates to the indeterminate form.
    const quotient = ce2.box(['Divide', 'x', 'x']);
    expect(quotient.json).toEqual(['Divide', 'x', 'x']);
    expect(quotient.evaluate().toString()).toBe('NaN');
    expect(quotient.N().toString()).toBe('NaN');
    expect(ce2.box(['Power', 'x', 'x']).evaluate().toString()).toBe(
      'NaN'
    );
    ce2.assign('x', 0.0);
    ce2.assign('y', { num: '0.0' });
    expect(ce2.box(['Divide', 'y', 'y']).evaluate().toString()).toBe('NaN');
  });

  test('simplification absorbs the value', () => {
    const ce2 = new ComputeEngine();
    expect(ce2.parse('x + \\frac{0}{0}').simplify().toString()).toBe(
      'NaN'
    );
    expect(ce2.parse('0 \\cdot \\infty + x').simplify().toString()).toBe(
      'NaN'
    );
    expect(
      ce2
        .box(['Simplify', ['Add', 'x', ['Divide', 0, 0]]])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });

  test('the compiled routes answer the IEEE NaN', () => {
    const quotient = compile(ce.box(['Divide', 0, 0]));
    expect(quotient.success).toBe(true);
    expect(quotient.run!({})).toBeNaN();
    const product = compile(ce.box(['Multiply', 0, 'PositiveInfinity']));
    expect(product.run!({})).toBeNaN();
    expect(
      compile(ce.box(['Divide', 'x', 'y'])).run!({ x: 0, y: 0 })
    ).toBeNaN();
  });
});

describe('INDETERMINATE FORMS — the producers: review round', () => {
  test('a float order of a Bessel or polygamma head gives NaN', () => {
    expect(box(['BesselI', { num: '2.0' }, 'ComplexInfinity']).toString()).toBe(
      'NaN'
    );
    expect(box(['BesselJ', { num: '0.0' }, 'ComplexInfinity']).toString()).toBe(
      'NaN'
    );
    expect(
      box(['PolyGamma', { num: '1.0' }, 'NegativeInfinity']).toString()
    ).toBe('NaN');
    // The exact orders are the indeterminate form.
    expect(box(['BesselJ', 0, 'ComplexInfinity']).toString()).toBe(
      'NaN'
    );
    expect(box(['PolyGamma', 1, 'NegativeInfinity']).toString()).toBe(
      'NaN'
    );
  });

  test('∞ + (−∞) through .add() and the kernels that use it', () => {
    expect(ce.PositiveInfinity.add(ce.NegativeInfinity).toString()).toBe(
      'NaN'
    );
    expect(ce.NegativeInfinity.add(ce.PositiveInfinity).toString()).toBe(
      'NaN'
    );
    expect(ce.PositiveInfinity.add(-Infinity).toString()).toBe('NaN');
    // `~oo` absorbs a sum, as in the `Add` fold.
    expect(ce.ComplexInfinity.add(ce.PositiveInfinity).toString()).toBe('~oo');
    expect(ce.PositiveInfinity.add(ce.PositiveInfinity).toString()).toBe('+oo');
    const cases: [MathJsonExpression, string][] = [
      [
        [
          'Add',
          ['List', 'PositiveInfinity', 1],
          ['List', 'NegativeInfinity', 2],
        ],
        '[NaN,3]',
      ],
      [
        [
          'Subtract',
          ['List', 'PositiveInfinity'],
          ['List', 'PositiveInfinity'],
        ],
        '[NaN]',
      ],
      [
        [
          'Add',
          ['List', ['List', 'PositiveInfinity']],
          ['List', ['List', 'NegativeInfinity']],
        ],
        '[[NaN]]',
      ],
      [
        ['Mean', ['List', 'PositiveInfinity', 'NegativeInfinity']],
        'NaN',
      ],
    ];
    for (const [json, expected] of cases) {
      expect([json, box(json).toString()]).toEqual([json, expected]);
      expect([json, boxN(json).toString()]).toEqual([
        json,
        expected.replace(/NaN/g, 'NaN'),
      ]);
    }
    // A float in the same cell, or in the data, makes it NaN.
    expect(
      box([
        'Add',
        ['List', 'PositiveInfinity', 1],
        ['List', 'NegativeInfinity', 2],
        ['List', { num: '1.5' }, 0],
      ]).toString()
    ).toBe('[NaN,3]');
    expect(
      box([
        'Mean',
        ['List', 'PositiveInfinity', 'NegativeInfinity', { num: '1.5' }],
      ]).toString()
    ).toBe('NaN');
  });

  test('Beta with two infinite operands', () => {
    // B(a, b) ≤ 1/a for b ≥ 1, so B(+∞, +∞) = 0.
    expect(
      box(['Beta', 'PositiveInfinity', 'PositiveInfinity']).toString()
    ).toBe('0');
    for (const [a, b] of [
      ['PositiveInfinity', 'NegativeInfinity'],
      ['PositiveInfinity', 'ComplexInfinity'],
      ['NegativeInfinity', 'PositiveInfinity'],
    ])
      expect([a, b, box(['Beta', a, b]).toString()]).toEqual([
        a,
        b,
        'NaN',
      ]);
    // One infinite operand with a finite real b of non-positive real part
    // that is not an integer: the infinity with the sign of Γ(b).
    expect(
      box(['Beta', 'PositiveInfinity', ['Rational', -1, 2]]).toString()
    ).toBe('-oo');
  });

  test('a float numerator over an infinity is the float 0', () => {
    expect(ce.box(['Divide', { num: '0.0' }, 'PositiveInfinity']).json).toEqual(
      { num: '0.0' }
    );
    expect(ce.box(['Divide', { num: '2.5' }, 'PositiveInfinity']).json).toEqual(
      { num: '0.0' }
    );
    expect(ce.box(['Divide', 2, 'PositiveInfinity']).json).toBe(0);
    expect(ce.box({ num: '0.0' }).div(ce.PositiveInfinity).json).toEqual({
      num: '0.0',
    });
  });

  test('Remainder by zero is the indeterminate form, as Mod', () => {
    expect(box(['Remainder', 5, 0]).toString()).toBe('NaN');
    expect(boxN(['Remainder', 5, 0]).toString()).toBe('NaN');
    expect(box(['Remainder', 'x', 0]).toString()).toBe('NaN');
    expect(box(['Remainder', { num: '5.0' }, 0]).toString()).toBe('NaN');
    expect(box(['Remainder', 5, { num: '0.0' }]).toString()).toBe('NaN');
    expect(box(['Remainder', 7, 3]).toString()).toBe('1');
  });

  test('a float absorbed by an infinity at canonicalization is not seen', () => {
    // A KNOWN LIMIT of the float rule, pinned as it is: the rule reads the
    // operands of the form as they are when the form is built, and `∞ + 0.5`
    // is the exact `∞` by then, so these answer `NaN` although a
    // float was written. (`docs/plans/2026-09-28-indeterminate-value.md`,
    // Phase 2 results.)
    expect(
      box(['Fract', ['Add', 'PositiveInfinity', { num: '0.5' }]]).toString()
    ).toBe('NaN');
    expect(
      box([
        'Multiply',
        0,
        ['Add', 'PositiveInfinity', { num: '0.5' }],
      ]).toString()
    ).toBe('NaN');
    // `2.5^∞` and `2.5·∞` are the exact `∞` when they are built: an
    // infinity is exact, and no float infinity exists.
    expect(
      box(['Fract', ['Power', { num: '2.5' }, 'PositiveInfinity']]).toString()
    ).toBe('NaN');
    expect(
      box([
        'Fract',
        ['Multiply', { num: '2.5' }, 'PositiveInfinity'],
      ]).toString()
    ).toBe('NaN');
  });
});

describe('INDETERMINATE FORMS — ROADMAP residues of the NaN rounds', () => {
  test('a NaN literal pattern matches itself only', () => {
    const match = (subject: MathJsonExpression, pattern: MathJsonExpression) =>
      box(['Match', subject, ['MatchCase', pattern, 1], ['MatchCase', '_', 2]])
        .re;
    // The number-literal spelling (the one the Epsil parser emits).
    expect(match({ num: 'NaN' }, { num: 'NaN' })).toBe(1);
    // The symbol spelling of MathJSON.
    expect(match('NaN', 'NaN')).toBe(1);
    expect(match('NaN', 'NaN')).toBe(1);
    expect(match(['Divide', 0, 0], 'NaN')).toBe(1);
    expect(match('Indeterminate', 'NaN')).toBe(1);
    expect(match('NaN', 1)).toBe(2);
    expect(match(1, 'NaN')).toBe(2);
    // The infinities, which compared by value before, still match.
    expect(match('PositiveInfinity', 'PositiveInfinity')).toBe(1);
    expect(match('ComplexInfinity', 'ComplexInfinity')).toBe(1);
    expect(match('NegativeInfinity', 'PositiveInfinity')).toBe(2);
    // Numbers still compare by value.
    expect(match({ num: '1.0' }, 1)).toBe(1);
    expect(match(1, { num: '1.0' })).toBe(1);
    // Inside a list pattern.
    expect(match(['List', 'NaN'], ['List', 'NaN'])).toBe(1);
    // The Epsil route.
    expect(epsil('match NaN {\n NaN => 1\n _ => 2\n}').re).toBe(1);
    expect(epsil('match 0/0 {\n NaN => 1\n _ => 2\n}').re).toBe(1);
    expect(epsil('match Infinity {\n Infinity => 1\n _ => 2\n}').re).toBe(1);
  });

  test('simplify() answers a function of NaN', () => {
    const simplify = (json: MathJsonExpression) =>
      ce.box(json).simplify().toString();
    expect(simplify(['Sin', 'NaN'])).toBe('NaN');
    expect(simplify(['Sin', 'NaN'])).toBe('NaN');
    expect(simplify(['Sqrt', 'NaN'])).toBe('NaN');
    expect(simplify(['Cos', ['Add', 'x', 'NaN']])).toBe('NaN');
    expect(simplify(['Arctan2', 'NaN', { num: '1.5' }])).toBe('NaN');
    expect(simplify(['Add', 'x', ['Divide', 0, 0]])).toBe('NaN');
    // An operator that reads NaN as a value is not affected.
    expect(simplify(['IsMissing', 'NaN'])).toBe('IsMissing(NaN)');
    // A broadcast applies the policy to each element, on evaluation.
    expect(simplify(['Sin', ['List', 1, 'NaN']])).toBe('sin([1,NaN])');
  });

  test('an exact 0 times a float is the exact 0 through .mul(), in both orders', () => {
    const f = ce.number(2.5);
    expect(ce.Zero.mul(f).json).toBe(0);
    expect(f.mul(ce.Zero).json).toBe(0);
    expect(ce.number({ num: '0.0' } as never).mul(ce.number(3)).json).toEqual({
      num: '0.0',
    });
    expect(f.mul(ce.NaN).toString()).toBe('NaN');
    expect(ce.PositiveInfinity.mul(ce.Zero).toString()).toBe('NaN');
    expect(box(['Multiply', 0, { num: '2.5' }, 'PositiveInfinity']).toString()).toBe(
      'NaN'
    );
  });

  test('Integrate of a NaN integrand', () => {
    for (const [json, exact] of [
      [['Integrate', ['Divide', 0, 0], 'x'], 'NaN'],
      [['Integrate', 'NaN', 'x'], 'NaN'],
      [['Integrate', 'NaN', ['Limits', 'x', 0, 1]], 'NaN'],
      [['Integrate', ['Divide', 0, 0], ['Limits', 'x', 0, 1]], 'NaN'],
      [['Integrate', ['Divide', 0, 0], ['Limits', 'x', 0, { num: '1.5' }]], 'NaN'],
      [
        [
          'Integrate',
          'NaN',
          ['Limits', 'x', 0, 1],
          ['Limits', 'y', 0, 1],
        ],
        'NaN',
      ],
    ] as [MathJsonExpression, string][]) {
      expect([json, box(json).toString()]).toEqual([json, exact]);
      expect([json, boxN(json).toString()]).toEqual([json, 'NaN']);
    }
    expect(parse('\\int_0^1 \\frac{0}{0}\\,dx').toString()).toBe('NaN');
    expect(box(['Sum', 'NaN', ['Limits', 'k', 1, 3]]).toString()).toBe('NaN');
  });

  test('Integrate of a NaN integrand with a list bound is a list', () => {
    // A list bound is one integral per element. The answer for a NaN
    // integrand was a single NaN, and bounds of different lengths gave no
    // error.
    for (const [json, exact, numeric] of [
      [
        ['Integrate', 'NaN', ['Limits', 'x', 0, ['List', 1, 2]]],
        '[NaN,NaN]',
        '[NaN,NaN]',
      ],
      [
        ['Integrate', ['Divide', 0, 0], ['Limits', 'x', 0, ['List', 1, 2]]],
        '[NaN,NaN]',
        '[NaN,NaN]',
      ],
      [
        [
          'Integrate',
          'NaN',
          ['Limits', 'x', ['List', 0, 1, 3], ['List', 1, 2]],
        ],
        'Error("incompatible-dimensions", "3 vs 2")',
        'Error("incompatible-dimensions", "3 vs 2")',
      ],
    ] as [MathJsonExpression, string, string][]) {
      expect([json, box(json).toString()]).toEqual([json, exact]);
      expect([json, boxN(json).toString()]).toEqual([json, numeric]);
    }
  });

  test('At with an infinite index answers NaN', () => {
    for (const index of [
      'PositiveInfinity',
      'NegativeInfinity',
      'ComplexInfinity',
    ] as MathJsonExpression[]) {
      const json: MathJsonExpression = ['At', ['List', 1, 2], index];
      expect([index, box(json).toString()]).toEqual([index, 'NaN']);
      expect([index, boxN(json).toString()]).toEqual([index, 'NaN']);
    }
    expect(box(['At', ['List', 1, 2], -1]).toString()).toBe('2');
  });

  test('a symbol times 0 through .mul() does not read the value it holds', () => {
    const ce = new ComputeEngine();
    ce.assign('w', ce.NaN);
    const product = ce.symbol('w').mul(0);
    expect(product.json).toEqual(['Multiply', 0, 'w']);
    expect(product.evaluate().toString()).toBe('NaN');
    ce.assign('w', ce.PositiveInfinity);
    expect(product.evaluate().toString()).toBe('NaN');
    ce.assign('w', 4);
    expect(product.evaluate().toString()).toBe('0');
    // A symbol with no value keeps the fold `x·0 = 0`.
    expect(ce.symbol('z').mul(0).toString()).toBe('0');
  });

  test('the type of Remainder includes nan when the divisor may be 0', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'integer');
    ce.declare('m', 'integer');
    const type = (json: MathJsonExpression) => ce.box(json).type.toString();
    expect(type(['Remainder', 5, 0])).toBe('nan');
    expect(type(['Remainder', 'k', 'm'])).toBe('integer | nan');
    expect(type(['Remainder', 'k', 3])).toBe('integer');
    expect(type(['Remainder', 5, 2])).toBe('integer');
    expect(type(['Remainder', { num: '5.5' }, 2])).toBe('real');
    expect(ce.box(['Remainder', 5, 0]).evaluate().toString()).toBe(
      'NaN'
    );
  });

  test('the statistics that subtract the mean, with an infinite datum', () => {
    for (const op of [
      'Variance',
      'StandardDeviation',
      'PopulationVariance',
      'PopulationStandardDeviation',
      'Kurtosis',
      'Skewness',
    ]) {
      const exact: MathJsonExpression = [op, ['List', 'PositiveInfinity', 1]];
      const float: MathJsonExpression = [
        op,
        ['List', 'PositiveInfinity', { num: '1.5' }],
      ];
      expect([op, box(exact).toString()]).toEqual([op, 'NaN']);
      expect([op, boxN(exact).toString()]).toEqual([op, 'NaN']);
      expect([op, box(float).toString()]).toEqual([op, 'NaN']);
    }
    expect(box(['Variance', ['List', 1, 2, 3]]).toString()).toBe('1');
  });
});
