import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { containsResidueClass } from '../../src/compute-engine/boxed-expression/residue-class';

const ce = new ComputeEngine();

const RC = (k: unknown, n: unknown) => ['ResidueClass', k, n];
const Z = (n: unknown) => ['QuotientRing', 'Integers', n];
const big = (digits: string) => ({ num: digits });

const json = (input: unknown) => ce.box(input as Expression).json;
const evaluated = (input: unknown) =>
  ce.box(input as Expression).evaluate().json;

describe('ResidueClass: canonical form (#399)', () => {
  const cases: [string, unknown, unknown][] = [
    ['k above n reduces', RC(7, 5), RC(2, 5)],
    ['k = n reduces to 0', RC(5, 5), RC(0, 5)],
    ['negative k reduces into 0…n-1', RC(-1, 7), RC(6, 7)],
    ['k already reduced is kept', RC(3, 7), RC(3, 7)],
    ['n = 1 is the zero ring: every k is 0', RC(5, 1), RC(0, 1)],
    [
      'a rational with a unit denominator reads as u·v⁻¹',
      RC(['Rational', 1, 3], 7),
      RC(5, 7),
    ],
    [
      'a rational with a non-unit denominator stays inert',
      RC(['Rational', 1, 2], 4),
      RC(['Rational', 1, 2], 4),
    ],
    ['n = 0 stays inert', RC(3, 0), RC(3, 0)],
    ['negative n stays inert', RC(3, -5), RC(3, -5)],
    ['non-integer n stays inert', RC(3, 2.5), RC(3, 2.5)],
    ['symbolic n stays inert', RC(3, 'n'), RC(3, 'n')],
    ['symbolic k stays inert', RC('k', 5), RC('k', 5)],
    ['float k stays inert', RC(2.5, 5), RC(2.5, 5)],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name}: ${JSON.stringify(input)} is ${JSON.stringify(expected)}`, () => {
      expect(json(input)).toEqual(expected);
      expect(evaluated(input)).toEqual(expected);
    });
  }

  test('a modulus past 2^53 is exact', () => {
    const n = '1000000000000000000000000000057';
    expect(json(RC(big('1000000000000000000000000000060'), big(n)))).toEqual(
      RC(3, big(n))
    );
    expect(json(RC(big('1' + '0'.repeat(36)), big(n)))).toEqual(
      RC(big('999999999999999999999943000057'), big(n))
    );
  });

  test('a class has type value', () => {
    expect(ce.box(RC(7, 5) as Expression).type.toString()).toBe('value');
  });

  test('evaluate() re-reduces a class whose operands became literals', () => {
    ce.declare('kk', 'integer');
    ce.assign('kk', 12);
    expect(ce.box(RC('kk', 5) as Expression).evaluate().json).toEqual(RC(2, 5));
  });
});

describe('ResidueClass: equality (#399)', () => {
  test('ResidueClass(7, 5) is ResidueClass(2, 5)', () => {
    expect(
      ce.box(RC(7, 5) as Expression).isSame(ce.box(RC(2, 5) as Expression))
    ).toBe(true);
    expect(evaluated(['Equal', RC(7, 5), RC(2, 5)])).toBe('True');
  });

  const cases: [string, unknown, unknown][] = [
    [
      'different residues of one modulus are not equal',
      ['Equal', RC(2, 5), RC(3, 5)],
      'False',
    ],
    [
      'NotEqual of different residues',
      ['NotEqual', RC(2, 5), RC(3, 5)],
      'True',
    ],
    ['NotEqual of one class', ['NotEqual', RC(7, 5), RC(2, 5)], 'False'],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name}: ${expected}`, () => {
      expect(evaluated(input)).toEqual(expected);
    });
  }

  // No answer rather than a wrong one.
  const undecided: [string, unknown][] = [
    ['classes of different moduli', ['Equal', RC(2, 5), RC(2, 6)]],
    ['a class and an integer', ['Equal', RC(2, 5), 2]],
  ];
  for (const [name, input] of undecided) {
    test(`${name} are not compared`, () => {
      expect(ce.box(input as Expression).evaluate().operator).toBe('Equal');
    });
  }
});

describe('ResidueClass: arithmetic (#399)', () => {
  const cases: [string, unknown, unknown][] = [
    ['sum', ['Add', RC(5, 7), RC(4, 7)], RC(2, 7)],
    [
      'sum of three classes and an integer',
      ['Add', RC(1, 7), RC(2, 7), RC(3, 7), 10],
      RC(2, 7),
    ],
    ['difference', ['Subtract', RC(2, 7), RC(5, 7)], RC(4, 7)],
    ['product', ['Multiply', RC(3, 7), RC(5, 7)], RC(1, 7)],
    ['negation', ['Negate', RC(3, 7)], RC(4, 7)],
    ['negation of 0', ['Negate', RC(0, 7)], RC(0, 7)],
    ['power', ['Power', RC(3, 7), 6], RC(1, 7)],
    ['power 0', ['Power', RC(0, 7), 0], RC(1, 7)],
    ['power 1', ['Power', RC(3, 7), 1], RC(3, 7)],
    ['power -1 of a unit is the inverse', ['Power', RC(3, 7), -1], RC(5, 7)],
    ['power -2 of a unit', ['Power', RC(3, 7), -2], RC(4, 7)],
    ['1 / a unit', ['Divide', 1, RC(3, 7)], RC(5, 7)],
    ['class / unit', ['Divide', RC(1, 7), RC(3, 7)], RC(5, 7)],
    ['class / integer unit', ['Divide', RC(1, 7), 3], RC(5, 7)],
    ['in the zero ring', ['Divide', RC(0, 1), RC(0, 1)], RC(0, 1)],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name}: ${JSON.stringify(input)} is ${JSON.stringify(expected)}`, () => {
      expect(evaluated(input)).toEqual(expected);
      // A class is exact: `.N()` leaves it alone.
      expect(ce.box(input as Expression).N().json).toEqual(expected);
      expect(ce.box(input as Expression).simplify().json).toEqual(expected);
    });
  }

  test('a modulus past 2^53: the inverse and a large power are exact', () => {
    const p = big('1000000000000000000000000000057');
    expect(
      evaluated(['Add', RC(big('1000000000000000000000000000056'), p), 1])
    ).toEqual(RC(0, p));
    // Fermat: 3^(p-1) = 1 mod p, when p is prime
    expect(
      evaluated(['Power', RC(3, p), big('1000000000000000000000000000056')])
    ).toEqual(RC(1, p));
    const inverse = ce.box(['Divide', 1, RC(3, p)] as Expression).evaluate();
    expect(
      ce.box(['Multiply', RC(3, p), inverse.json] as Expression).evaluate().json
    ).toEqual(RC(1, p));
  });
});

describe('ResidueClass: inverse needs gcd(k, n) = 1 (#399)', () => {
  // No answer rather than a wrong one: the call stays unevaluated.
  const cases: [string, unknown, unknown][] = [
    ['1 / 2 mod 4', ['Divide', 1, RC(2, 4)], ['Divide', 1, RC(2, 4)]],
    ['2^-1 mod 4', ['Power', RC(2, 4), -1], ['Power', RC(2, 4), -1]],
    ['0^-1 mod 7', ['Power', RC(0, 7), -1], ['Power', RC(0, 7), -1]],
    [
      'class / non-unit',
      ['Divide', RC(1, 6), RC(2, 6)],
      ['Divide', RC(1, 6), RC(2, 6)],
    ],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name} stays unevaluated`, () => {
      expect(evaluated(input)).toEqual(expected);
      expect(ce.box(input as Expression).N().json).toEqual(expected);
    });
  }

  test('a class that is a unit, mod a composite', () => {
    expect(evaluated(['Divide', 1, RC(5, 6)])).toEqual(RC(5, 6));
  });
});

describe('ResidueClass: integers combine with a class (#399)', () => {
  const cases: [string, unknown, unknown][] = [
    ['class + integer', ['Add', RC(5, 7), 3], RC(1, 7)],
    ['integer + class', ['Add', 3, RC(5, 7)], RC(1, 7)],
    ['integer - class', ['Subtract', 3, RC(5, 7)], RC(5, 7)],
    ['integer * class', ['Multiply', 3, RC(5, 7)], RC(1, 7)],
    ['negative integer * class', ['Multiply', -1, RC(5, 7)], RC(2, 7)],
    [
      'class + rational with a unit denominator',
      ['Add', RC(1, 7), ['Rational', 1, 3]],
      RC(6, 7),
    ],
    ['class * 2^100', ['Multiply', RC(1, 7), ['Power', 2, 100]], RC(2, 7)],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name}: ${JSON.stringify(input)} is ${JSON.stringify(expected)}`, () => {
      expect(evaluated(input)).toEqual(expected);
      expect(ce.box(input as Expression).simplify().json).toEqual(expected);
    });
  }

  const stays: [string, unknown][] = [
    ['a symbol', ['Add', RC(2, 7), 'x']],
    ['a float', ['Add', RC(2, 7), 0.5]],
    [
      'a rational with a non-unit denominator',
      ['Add', RC(1, 4), ['Rational', 1, 2]],
    ],
  ];
  for (const [name, input] of stays) {
    test(`class + ${name} stays unevaluated`, () => {
      const r = ce.box(input as Expression).evaluate();
      expect(r.operator).toBe('Add');
      expect(r.isValid).toBe(true);
    });
  }

  test('Mod stays the remainder and does not take a class', () => {
    expect(evaluated(['Mod', 7, 5])).toBe(2);
    expect(ce.box(['Mod', RC(2, 7), 5] as Expression).evaluate().operator).toBe(
      'Mod'
    );
  });

  test('a class is not ordered', () => {
    for (const op of ['Less', 'LessEqual', 'Greater', 'GreaterEqual']) {
      const result = ce.box([op, RC(1, 5), RC(2, 5)] as Expression).evaluate();
      expect(['True', 'False']).not.toContain(result.json);
    }
  });
});

// Arithmetic on classes of different moduli stays unevaluated, with no
// error: there is no ring that holds both. Reading them in ℤ/gcd(m, n) would
// break `x + y - y = x`: `(2 mod 4 + 1 mod 6) - 1 mod 6` would be `0 mod 2`.
describe('ResidueClass: classes of different moduli stay unevaluated (#399)', () => {
  const cases: [string, unknown][] = [
    ['2 mod 4 + 1 mod 6', ['Add', RC(2, 4), RC(1, 6)]],
    ['3 mod 4 * 5 mod 6', ['Multiply', RC(3, 4), RC(5, 6)]],
    ['coprime moduli', ['Add', RC(2, 3), RC(1, 5)]],
    ['a quotient', ['Divide', RC(2, 6), RC(1, 4)]],
    ['a quotient by a non-unit', ['Divide', RC(1, 4), RC(2, 6)]],
    ['with an integer', ['Add', RC(2, 4), RC(1, 6), 3]],
    ['a difference', ['Subtract', RC(2, 4), RC(1, 6)]],
  ];
  for (const [name, input] of cases) {
    test(`${name}: evaluate, N and simplify keep it`, () => {
      // The operands are evaluated (the negation of a class is a class),
      // but the classes of the two rings are not combined.
      const boxed = ce.box(input as Expression);
      for (const result of [boxed.evaluate(), boxed.N(), boxed.simplify()]) {
        expect(result.operator).toBe(boxed.operator);
        expect(result.nops).toBe(boxed.nops);
        expect(result.isValid).toBe(true);
      }
    });
  }

  test('x + y - y is not folded into another ring', () => {
    const boxed = ce.box([
      'Subtract',
      ['Add', RC(2, 4), RC(1, 6)],
      RC(1, 6),
    ] as Expression);
    for (const r of [boxed.evaluate(), boxed.N(), boxed.simplify()]) {
      expect(r.operator).toBe('Add');
      expect(r.nops).toBe(3);
    }
  });

  test('NaN still propagates', () => {
    expect(evaluated(['Add', 'NaN', RC(2, 4), RC(1, 6)])).toBe('NaN');
  });
});

describe('ResidueClass: type (#399)', () => {
  const cases: [string, unknown, string][] = [
    ['a class', RC(2, 5), 'value'],
    ['a sum with a class', ['Add', RC(2, 5), 'x'], 'broadcastable<value>'],
    [
      'a product with a class',
      ['Multiply', RC(2, 5), 'x'],
      'broadcastable<value>',
    ],
    ['a power of a class', ['Power', RC(2, 5), 'x'], 'broadcastable<value>'],
    ['ℤ/5ℤ has classes of type value', Z(5), 'set<value>'],
    ['ℤ/nℤ, n symbolic', Z('n'), 'set<value>'],
    [
      'ℚ/5ℚ has no class type',
      ['QuotientRing', 'RationalNumbers', 5],
      'set<unknown>',
    ],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name} has type ${expected}`, () => {
      expect(ce.box(input as Expression).type.toString()).toBe(expected);
    });
  }

  test('the parsed ℤ/5ℤ has the element type value', () => {
    expect(ce.parse('\\mathbb{Z}/5\\mathbb{Z}').type.toString()).toBe(
      'set<value>'
    );
  });
});

describe('QuotientRing(Integers, n) through ResidueClass (#399)', () => {
  for (const n of [1, 2, 5, 12]) {
    test(`ℤ/${n}ℤ lists ResidueClass(0, ${n}) … ResidueClass(${n - 1}, ${n})`, () => {
      const classes = Array.from({ length: n }, (_, k) => RC(k, n));
      expect(evaluated(['ListFrom', Z(n)])).toEqual(['List', ...classes]);
      expect(ce.box(Z(n) as Expression).isEnumerableCollection).toBe(true);
    });
  }

  test('ℤ/5ℤ is still finite with count 5', () => {
    const z5 = ce.box(Z(5) as Expression);
    expect(z5.isCollection).toBe(true);
    expect(z5.isFiniteCollection).toBe(true);
    expect(z5.isEmptyCollection).toBe(false);
    expect(z5.count).toBe(5);
    expect(evaluated(['Count', Z(5)])).toBe(5);
  });

  test('a large modulus is counted without listing', () => {
    const z = ce.box(Z(1000000007) as Expression);
    expect(z.count).toBe(1000000007);
    expect(evaluated(['Count', Z(1000000007)])).toBe(1000000007);
  });

  const inert: [string, unknown][] = [
    ['a symbolic modulus', Z('n')],
    ['modulus 0', Z(0)],
    ['a non-Integers base', ['QuotientRing', 'RationalNumbers', 5]],
  ];
  for (const [name, input] of inert) {
    test(`${name} is not a collection`, () => {
      expect(ce.box(input as Expression).isCollection).toBe(false);
    });
  }

  const membership: [string, unknown, unknown][] = [
    [
      'Element(ResidueClass(7, 5), ℤ/5ℤ) is True',
      ['Element', RC(7, 5), Z(5)],
      'True',
    ],
    [
      'Element(ResidueClass(0, 5), ℤ/5ℤ) is True',
      ['Element', RC(0, 5), Z(5)],
      'True',
    ],
    [
      'a class of another modulus is not a member',
      ['Element', RC(2, 6), Z(5)],
      'False',
    ],
    [
      'NotElement(ResidueClass(2, 6), ℤ/5ℤ)',
      ['NotElement', RC(2, 6), Z(5)],
      'True',
    ],
  ];
  for (const [name, input, expected] of membership) {
    test(name, () => {
      expect(evaluated(input)).toEqual(expected);
    });
  }

  // 7 is a representative of a class, not the class: an integer is not an
  // element of ℤ/5ℤ. This agrees with the listed classes, which do not hold 7.
  test('Element(7, ℤ/5ℤ) is False', () => {
    expect(evaluated(['Element', 7, Z(5)])).toBe('False');
  });

  test('the parsed \\overline{7}_{5} \\in \\mathbb{Z}/5\\mathbb{Z} is True', () => {
    expect(
      ce.parse('\\overline{7}_{5}\\in\\mathbb{Z}/5\\mathbb{Z}').evaluate().json
    ).toBe('True');
  });

  test('set operators walk the listed classes', () => {
    expect(
      evaluated(['Intersection', Z(5), ['Set', RC(2, 5), RC(2, 6)]])
    ).toEqual(['Set', RC(2, 5)]);
    expect(evaluated(['SetMinus', Z(3), ['Set', RC(1, 3)]])).toEqual([
      'Set',
      RC(0, 3),
      RC(2, 3),
    ]);
    expect(evaluated(['Union', Z(2), ['Set', RC(1, 2)]])).toEqual([
      'Set',
      RC(0, 2),
      RC(1, 2),
    ]);
  });

  test('.N() leaves the classes exact', () => {
    expect(ce.box(['ListFrom', Z(3)] as Expression).N().json).toEqual([
      'List',
      RC(0, 3),
      RC(1, 3),
      RC(2, 3),
    ]);
  });
});

describe('ResidueClass: LaTeX \\overline{k}_{n} (#399)', () => {
  const parses: [string, unknown][] = [
    ['\\overline{7}_{5}', RC(2, 5)],
    ['\\overline{7}_5', RC(2, 5)],
    ['\\overline{0}_{1}', RC(0, 1)],
    ['\\overline{12}_{5}', RC(2, 5)],
    ['\\overline{7}_{5}+\\overline{4}_{5}', ['Add', RC(2, 5), RC(4, 5)]],
    ['\\overline{3}_{7}^{-1}', ['Power', RC(3, 7), -1]],
    [
      '\\overline{123456789012345678901234567890}_{1000000000000000000000000000057}',
      RC(
        big('123456789012345678901234567890'),
        big('1000000000000000000000000000057')
      ),
    ],
  ];
  for (const [latex, expected] of parses) {
    test(`${latex} reads as ${JSON.stringify(expected)}`, () => {
      expect(ce.parse(latex).json).toEqual(expected);
    });
  }

  // Not classes: only an integer literal over an integer literal is read so.
  const unchanged: [string, unknown][] = [
    ['\\overline{7}', ['Conjugate', 7]],
    ['\\overline{z}', ['Conjugate', 'z']],
    ['\\overline{z}_1', ['Subscript', ['Conjugate', 'z'], 1]],
    ['\\overline{z}_{12}', ['Subscript', ['Conjugate', 'z'], 12]],
    ['\\overline{7}_{n}', ['Subscript', ['Conjugate', 7], 'n']],
    ['\\overline{7}_{0}', ['Subscript', ['Conjugate', 7], 0]],
    ['\\overline{7}_{2.5}', ['Subscript', ['Conjugate', 7], 2.5]],
    ['\\overline{n}_{5}', ['Subscript', ['Conjugate', 'n'], 5]],
    ['\\overline{-3}_{5}', ['Subscript', ['Conjugate', -3], 5]],
    ['\\overline{x+1}_{5}', ['Subscript', ['Conjugate', ['Add', 'x', 1]], 5]],
  ];
  for (const [latex, expected] of unchanged) {
    test(`${latex} is unchanged`, () => {
      const parsed = ce.parse(latex);
      expect(parsed.json).toEqual(expected);
      expect(parsed.operator).not.toBe('ResidueClass');
    });
  }

  test('\\overline{7} evaluates as the conjugate, 7', () => {
    expect(ce.parse('\\overline{7}').evaluate().json).toBe(7);
  });

  test('a repeating decimal is not affected', () => {
    expect(ce.parse('0.\\overline{3}').json).toEqual(['Rational', 1, 3]);
    expect(ce.parse('0.1\\overline{6}').json).toEqual(['Rational', 1, 6]);
  });

  const serializes: [string, unknown, string][] = [
    ['a class', RC(2, 5), '\\overline{2}_{5}'],
    ['a class mod 1', RC(0, 1), '\\overline{0}_{1}'],
    [
      'a symbolic modulus is a call',
      RC(2, 'n'),
      '\\mathrm{ResidueClass}(2, n)',
    ],
    ['modulus 0 is a call', RC(2, 0), '\\mathrm{ResidueClass}(2, 0)'],
  ];
  for (const [name, input, expected] of serializes) {
    test(`${name} serializes as ${expected}`, () => {
      expect(ce.box(input as Expression).latex).toBe(expected);
    });
  }

  const roundTrips: unknown[] = [
    RC(2, 5),
    RC(0, 1),
    RC(2, 'n'),
    RC(2, 0),
    RC(['Rational', 1, 2], 4),
    ['Add', RC(2, 5), RC(4, 5)],
    ['Multiply', RC(3, 7), RC(5, 7)],
    ['Divide', 1, RC(3, 7)],
    ['Power', RC(3, 7), 6],
    RC(big('3'), big('1000000000000000000000000000057')),
  ];
  for (const input of roundTrips) {
    test(`${JSON.stringify(input)} round-trips through LaTeX`, () => {
      const boxed = ce.box(input as Expression);
      expect(ce.parse(boxed.latex).isSame(boxed)).toBe(true);
    });
  }
});

describe('ResidueClass: other routes (#399)', () => {
  test('Epsil spells a class as residueClass(k, n), and runs it', () => {
    const epsil = new ComputeEngine();
    expect(executeEpsil(epsil, 'residueClass(7, 5)').value.json).toEqual(
      RC(2, 5)
    );
    expect(
      executeEpsil(epsil, 'residueClass(3, 7) * residueClass(5, 7)').value.json
    ).toEqual(RC(1, 7));
    expect(serializeEpsil(RC(2, 5) as Expression)).toBe('residueClass(2, 5)');
  });

  test('the compiled lane is not lowered: the call falls back, it does not guess', () => {
    const result = compile(ce.box(['Add', RC(2, 7), RC(3, 7)] as Expression));
    expect(result.success).toBe(false);
  });
});

// The three routes that compute: evaluate(), N() and simplify().
const routes = (input: unknown): [string, Expression][] => {
  const boxed = ce.box(input as Expression);
  return [
    ['evaluate', boxed.evaluate()],
    ['N', boxed.N()],
    ['simplify', boxed.simplify()],
  ];
};

describe('ResidueClass: a class with no inverse is never cancelled (#399)', () => {
  // `c/c` and `c·c⁻¹` have no value when gcd(k, n) ≠ 1: every route keeps
  // the expression, and none answers the integer 1.
  const stays: [string, unknown][] = [
    ['2 mod 4 / 2 mod 4', ['Divide', RC(2, 4), RC(2, 4)]],
    ['0 mod 7 / 0 mod 7', ['Divide', RC(0, 7), RC(0, 7)]],
    ['2 mod 4 · (2 mod 4)^-1', ['Multiply', RC(2, 4), ['Power', RC(2, 4), -1]]],
    ['k mod 4 / k mod 4, k symbolic', ['Divide', RC('k', 4), RC('k', 4)]],
  ];
  for (const [name, input] of stays) {
    for (const [route, result] of routes(input)) {
      test(`${name} stays unevaluated under ${route}`, () => {
        expect(result.json).toEqual(ce.box(input as Expression).json);
      });
    }
  }

  test('the parsed \\frac{\\overline{2}_{4}}{\\overline{2}_{4}} stays unevaluated', () => {
    const parsed = ce.parse('\\frac{\\overline{2}_{4}}{\\overline{2}_{4}}');
    expect(parsed.json).toEqual(['Divide', RC(2, 4), RC(2, 4)]);
    expect(parsed.simplify().json).toEqual(['Divide', RC(2, 4), RC(2, 4)]);
    expect(parsed.evaluate().json).toEqual(['Divide', RC(2, 4), RC(2, 4)]);
  });

  // A unit divided by itself is the class 1 of its ring, not the integer 1.
  for (const [route, result] of routes(['Divide', RC(3, 7), RC(3, 7)])) {
    test(`3 mod 7 / 3 mod 7 is ResidueClass(1, 7) under ${route}`, () => {
      expect(result.json).toEqual(RC(1, 7));
    });
  }
  test('the parsed unit quotient is ResidueClass(1, 7)', () => {
    const parsed = ce.parse('\\frac{\\overline{3}_{7}}{\\overline{3}_{7}}');
    expect(parsed.simplify().json).toEqual(RC(1, 7));
    expect(parsed.evaluate().json).toEqual(RC(1, 7));
  });
});

describe('ResidueClass: the canonical form keeps the ring (#399)', () => {
  // `1/(1/c)` is not `c` when `1/c` has no value.
  const noInverse: [string, unknown][] = [
    ['1 / (1 / 2 mod 4)', ['Divide', 1, ['Divide', 1, RC(2, 4)]]],
    ['((2 mod 4)^-1)^-1', ['Power', ['Power', RC(2, 4), -1], -1]],
    [
      '(1 / 2 mod 4) / (1 / 2 mod 4)',
      ['Divide', ['Divide', 1, RC(2, 4)], ['Divide', 1, RC(2, 4)]],
    ],
    ['x / (y / 2 mod 4)', ['Divide', 'x', ['Divide', 'y', RC(2, 4)]]],
  ];
  for (const [name, input] of noInverse) {
    test(`${name} is not cancelled`, () => {
      const boxed = ce.box(input as Expression);
      expect(boxed.json).not.toEqual(RC(2, 4));
      expect(boxed.operator).not.toBe('ResidueClass');
      for (const [, result] of routes(input)) {
        expect(result.operator).not.toBe('ResidueClass');
        expect(isFinite(Number(result.json))).toBe(false);
      }
    });
  }

  test('the parsed \\frac{1}{\\frac{1}{\\overline{2}_{4}}} is not cancelled', () => {
    const parsed = ce.parse('\\frac{1}{\\frac{1}{\\overline{2}_{4}}}');
    expect(parsed.operator).toBe('Divide');
    expect(parsed.evaluate().operator).not.toBe('ResidueClass');
  });

  // A unit has an inverse: evaluation finds the class. The canonical form
  // keeps the expression as written, as for every expression with a class.
  test('1 / (1 / 3 mod 7) is ResidueClass(3, 7)', () => {
    for (const input of [
      ['Divide', 1, ['Divide', 1, RC(3, 7)]],
      ['Power', ['Power', RC(3, 7), -1], -1],
    ]) {
      expect(json(input)).toEqual(input);
      for (const [, result] of routes(input))
        expect(result.json).toEqual(RC(3, 7));
    }
  });

  // A zero factor gives the zero class of the ring, not the integer 0.
  const zero: [string, unknown, unknown][] = [
    ['0 · 2 · 3 mod 7', ['Multiply', 0, 2, RC(3, 7)], RC(0, 7)],
    ['0 · 3 mod 7', ['Multiply', 0, RC(3, 7)], RC(0, 7)],
    ['3 mod 7 - 3 mod 7', ['Subtract', RC(3, 7), RC(3, 7)], RC(0, 7)],
    ['0 + 3 mod 7', ['Add', 0, RC(3, 7)], RC(3, 7)],
    [
      '0 · x · 3 mod 7',
      ['Multiply', 0, 'x', RC(3, 7)],
      ['Multiply', 'x', RC(0, 7)],
    ],
  ];
  for (const [name, input, expected] of zero) {
    test(`${name}: the canonical form is not a number`, () => {
      expect(typeof ce.box(input as Expression).json).not.toBe('number');
    });
    for (const [route, result] of routes(input)) {
      test(`${name} is ${JSON.stringify(expected)} under ${route}`, () => {
        expect(result.json).toEqual(expected);
      });
    }
  }

  test('the parsed 0\\cdot 2\\cdot\\overline{3}_{7} is ResidueClass(0, 7)', () => {
    const parsed = ce.parse('0\\cdot 2\\cdot\\overline{3}_{7}');
    expect(typeof parsed.json).not.toBe('number');
    expect(parsed.evaluate().json).toEqual(RC(0, 7));
  });

  test('a product with a call that is not a class yet stays', () => {
    for (const [, result] of routes(['Multiply', 0, RC('k', 7)]))
      expect(result.json).toEqual(['Multiply', 0, RC('k', 7)]);
  });
});

describe('ResidueClass: a float is not read as an integer (#399)', () => {
  const f = (digits: string) => ({ num: digits });
  test('a float k or n stays inert', () => {
    // The double 1e30 is not 10^30: 10^30 is 1 mod 7, the double is 5.
    for (const input of [RC(f('7.0'), 5), RC(3, f('5.0')), RC(1e30, 7)]) {
      const boxed = ce.box(input as Expression);
      expect(boxed.operator).toBe('ResidueClass');
      expect(
        boxed.ops.some((x) => x.isNumberLiteral && (x as any).isExact === false)
      ).toBe(true);
      expect(boxed.evaluate().json).toEqual(boxed.json);
      expect(boxed.N().json).toEqual(boxed.json);
    }
  });

  const stays: [string, unknown][] = [
    ['class + 3.0', ['Add', RC(2, 5), f('3.0')]],
    ['class + 1e30', ['Add', RC(2, 7), 1e30]],
    ['class · 2.0', ['Multiply', RC(2, 5), f('2.0')]],
    ['class / 3.0', ['Divide', RC(1, 7), f('3.0')]],
    ['class ^ 2.0', ['Power', RC(2, 5), f('2.0')]],
  ];
  for (const [name, input] of stays) {
    for (const [route, result] of routes(input)) {
      test(`${name} is not a class under ${route}`, () => {
        expect(result.operator).not.toBe('ResidueClass');
        expect(result.isValid).toBe(true);
      });
    }
  }

  test('the parsed routes agree', () => {
    expect(
      ce.parse('\\operatorname{ResidueClass}(7.0, 5)').evaluate().op1.json
    ).not.toEqual(2);
    expect(ce.parse('\\overline{2}_{5}+3.0').evaluate().operator).toBe('Add');
    expect(ce.parse('\\overline{7.0}_{5}').operator).not.toBe('ResidueClass');
  });

  test('an exact integer of the same value is read', () => {
    expect(evaluated(['Add', RC(2, 5), 3])).toEqual(RC(0, 5));
    expect(evaluated(['Add', RC(2, 7), big('1' + '0'.repeat(30))])).toEqual(
      RC(3, 7)
    );
  });
});

describe('ResidueClass: N() evaluates each operand once, exactly (#399)', () => {
  for (const operator of ['Add', 'Multiply']) {
    test(`an impure operand of ${operator} runs once under N()`, () => {
      const engine = new ComputeEngine();
      let calls = 0;
      engine.declare('ResidueTick', {
        signature: '() -> integer',
        pure: false,
        evaluate: () => {
          calls += 1;
          return engine.number(1);
        },
      });
      engine.box([operator, RC(2, 5), ['ResidueTick']] as Expression).N();
      expect(calls).toBe(1);
    });
  }

  test('a class of a symbol with a rational value is a class under N()', () => {
    const engine = new ComputeEngine();
    engine.assign('q', engine.box(['Rational', 1, 3]));
    const boxed = engine.box(RC('q', 7) as Expression);
    expect(boxed.evaluate().json).toEqual(RC(5, 7));
    expect(boxed.N().json).toEqual(RC(5, 7));
  });

  test('a rational beside a class is read exactly under N()', () => {
    // 1/3 is 5 mod 7, and 5 + 5 = 3 mod 7.
    expect(
      ce.box(['Add', RC(5, 7), ['Rational', 1, 3]] as Expression).N().json
    ).toEqual(RC(3, 7));
  });
});

describe('ResidueClass: NaN and the other terms of a sum or product (#399)', () => {
  const cases: [string, unknown, unknown][] = [
    ['NaN + class', ['Add', 'NaN', RC(2, 5)], 'NaN'],
    ['NaN · class', ['Multiply', 'NaN', RC(2, 5)], 'NaN'],
    [
      'two classes and a symbol',
      ['Add', RC(1, 5), RC(2, 5), 'x'],
      ['Add', 'x', RC(3, 5)],
    ],
    [
      'two classes, an integer and a symbol',
      ['Add', RC(1, 5), RC(2, 5), 4, 'x'],
      ['Add', 'x', RC(2, 5)],
    ],
    [
      'a product of two classes and a symbol',
      ['Multiply', RC(1, 5), RC(2, 5), 'x'],
      ['Multiply', 'x', RC(2, 5)],
    ],
  ];
  for (const [name, input, expected] of cases) {
    for (const [route, result] of routes(input)) {
      test(`${name} is ${JSON.stringify(expected)} under ${route}`, () => {
        expect(result.json).toEqual(expected);
      });
    }
  }

  test('the parsed sum folds its classes', () => {
    expect(
      ce.parse('\\overline{1}_{5}+\\overline{2}_{5}+x').evaluate().json
    ).toEqual(['Add', 'x', RC(3, 5)]);
  });

  // A class is exact and stays; π is approximated beside it.
  test('(class · π).N() approximates π and keeps the class', () => {
    const boxed = ce.box(['Multiply', RC(2, 5), 'Pi'] as Expression);
    expect(boxed.evaluate().json).toEqual(['Multiply', 'Pi', RC(2, 5)]);
    const n = boxed.N();
    expect(n.operator).toBe('Multiply');
    expect(n.ops.some((x) => x.isSame(ce.box(RC(2, 5) as Expression)))).toBe(
      true
    );
    const factor = n.ops.find((x) => x.operator !== 'ResidueClass')!;
    expect(factor.re).toBeCloseTo(Math.PI, 10);
  });
});

describe('ResidueClass: arity (#399)', () => {
  test('ResidueClass(2, 5, 99) keeps its arity error', () => {
    const boxed = ce.box(RC(2, 5).concat(99) as Expression);
    expect(boxed.isValid).toBe(false);
    expect(boxed.nops).toBe(3);
    expect(boxed.evaluate().isValid).toBe(false);
    const parsed = ce.parse('\\operatorname{ResidueClass}(2, 5, 99)');
    expect(parsed.isValid).toBe(false);
    expect(parsed.json).toEqual(boxed.json);
  });

  test('ResidueClass(2) keeps its arity error', () => {
    expect(ce.box(['ResidueClass', 2] as Expression).isValid).toBe(false);
  });
});

describe('ResidueClass: .is() agrees with .isEqual() (#399)', () => {
  const sum = () => ce.box(['Add', RC(1, 5), 1] as Expression);
  test('1 mod 5 + 1 is 2 mod 5', () => {
    const two = ce.box(RC(2, 5) as Expression);
    expect(sum().isEqual(two)).toBe(true);
    expect(sum().is(two)).toBe(true);
    expect(two.is(sum())).toBe(true);
    expect(ce.parse('\\overline{1}_{5}+1').is(two)).toBe(true);
  });

  test('1 mod 5 + 1 is not 3 mod 5, nor 2 mod 6', () => {
    expect(sum().is(ce.box(RC(3, 5) as Expression))).toBe(false);
    expect(sum().is(ce.box(RC(2, 6) as Expression))).toBe(false);
  });

  test('.is() for numbers is unchanged', () => {
    expect(ce.box(['Add', 1, 1] as Expression).is(2)).toBe(true);
    expect(ce.box(['Add', 1, 1] as Expression).is(ce.box(2))).toBe(true);
    expect(sum().is(2)).toBe(false);
  });
});

describe('QuotientRing(Integers, n): an integer is not an element (#399)', () => {
  const cases: [string, unknown, unknown][] = [
    ['an integer', ['Element', 7, Z(5)], 'False'],
    ['an integer in 0…n-1', ['Element', 2, Z(5)], 'False'],
    ['a rational', ['Element', ['Rational', 1, 2], Z(5)], 'False'],
    ['a string', ['Element', { str: 'abc' }, Z(5)], 'False'],
    ['True', ['Element', 'True', Z(5)], 'False'],
    ['Pi', ['Element', 'Pi', Z(5)], 'False'],
    ['a list', ['Element', ['List', 1, 2], Z(5)], 'False'],
    ['NotElement of an integer', ['NotElement', 7, Z(5)], 'True'],
    ['a class of ℤ/5ℤ', ['Element', RC(7, 5), Z(5)], 'True'],
    ['a class of another modulus', ['Element', RC(2, 6), Z(5)], 'False'],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name}: ${expected}`, () => {
      expect(evaluated(input)).toEqual(expected);
    });
  }

  // A symbol with no value, or an unevaluated call, may hold a class.
  const undecided: [string, unknown][] = [
    ['a symbol with no value', ['Element', 'u', Z(5)]],
    ['an unevaluated call', ['Element', ['g', 'u'], Z(5)]],
    ['a class that is not a class yet', ['Element', RC('u', 5), Z(5)]],
  ];
  for (const [name, input] of undecided) {
    test(`${name} is not decided`, () => {
      expect(ce.box(input as Expression).evaluate().operator).toBe('Element');
    });
  }

  test('the parsed 7\\in\\mathbb{Z}/5\\mathbb{Z} is False', () => {
    expect(ce.parse('7\\in\\mathbb{Z}/5\\mathbb{Z}').evaluate().json).toBe(
      'False'
    );
  });

  test('set operators agree with the membership', () => {
    expect(evaluated(['Intersection', Z(5), ['Set', 1]])).toBe('EmptySet');
    expect(
      ce.box(['Union', Z(3), ['Set', 1]] as Expression).evaluate().count
    ).toBe(4);
  });
});

// An arithmetic expression with a class anywhere in it is folded by the
// residue rules only. Every other fold (like terms, reciprocals, a zero or an
// infinity that absorbs, merged exponents) does not know the ring, so the
// expression is kept as it is, in the canonical form and under evaluate(),
// N() and simplify().
describe('ResidueClass: no generic fold on an expression with a class (#399)', () => {
  const c = RC(2, 4);
  const d = RC(3, 7);
  // [name, MathJSON, LaTeX or undefined]
  const kept: [string, unknown, string | undefined][] = [
    [
      '(x/c)·(c/x), c = 2 mod 4',
      ['Multiply', ['Divide', 'x', c], ['Divide', c, 'x']],
      '\\frac{x}{\\overline{2}_{4}}\\cdot\\frac{\\overline{2}_{4}}{x}',
    ],
    [
      '1/c - 1/c, c = 2 mod 4',
      ['Subtract', ['Divide', 1, c], ['Divide', 1, c]],
      '\\frac{1}{\\overline{2}_{4}}-\\frac{1}{\\overline{2}_{4}}',
    ],
    [
      'd·x - d·x, d = 3 mod 7',
      ['Subtract', ['Multiply', d, 'x'], ['Multiply', d, 'x']],
      '\\overline{3}_{7}x-\\overline{3}_{7}x',
    ],
    ['0·2·(1/c)', ['Multiply', 0, 2, ['Divide', 1, c]], undefined],
    [
      '1/(1/(2·(1 mod 4)))',
      ['Divide', 1, ['Divide', 1, ['Multiply', 2, RC(1, 4)]]],
      undefined,
    ],
    [
      '(c^(2/3))^3, c = 2 mod 5',
      ['Power', ['Power', RC(2, 5), ['Rational', 2, 3]], 3],
      '\\left(\\overline{2}_{5}^{\\frac{2}{3}}\\right)^3',
    ],
    ['(1 mod 7) / 0', ['Divide', RC(1, 7), 0], '\\frac{\\overline{1}_{7}}{0}'],
    ['(1 mod 7) / 0.0', ['Divide', RC(1, 7), { num: '0.0' }], undefined],
    ['(1 mod 7) / ~∞', ['Divide', RC(1, 7), 'ComplexInfinity'], undefined],
    [
      '(2 mod 5) + ∞',
      ['Add', RC(2, 5), 'PositiveInfinity'],
      '\\overline{2}_{5}+\\infty',
    ],
    [
      '(2 mod 5) - ∞',
      ['Subtract', RC(2, 5), 'PositiveInfinity'],
      '\\overline{2}_{5}-\\infty',
    ],
    [
      '(2 mod 5) · 0.0',
      ['Multiply', RC(2, 5), { num: '0.0' }],
      '\\overline{2}_{5}\\cdot 0.0',
    ],
    ['(2 mod 5) / ∞', ['Divide', RC(2, 5), 'PositiveInfinity'], undefined],
  ];
  for (const [name, input, latex] of kept) {
    const boxed = ce.box(input as Expression);
    test(`${name}: the canonical form keeps the operation`, () => {
      expect(boxed.operator).toBe(
        (input as string[])[0] === 'Subtract' ? 'Add' : (input as string[])[0]
      );
      expect(boxed.isValid).toBe(true);
    });
    for (const [route, result] of routes(input)) {
      test(`${name} is not folded under ${route}`, () => {
        expect(result.operator).toBe(boxed.operator);
        expect(result.isValid).toBe(true);
      });
    }
    if (latex !== undefined)
      test(`${name}: the parsed ${latex} is the same`, () => {
        const parsed = ce.parse(latex);
        expect(parsed.json).toEqual(boxed.json);
        expect(parsed.evaluate().operator).toBe(boxed.operator);
        expect(parsed.simplify().operator).toBe(boxed.operator);
      });
  }

  // In the zero ring every element is a unit, 0 included.
  for (const [route, result] of routes(['Divide', RC(0, 1), 0])) {
    test(`(0 mod 1) / 0 is ResidueClass(0, 1) under ${route}`, () => {
      expect(result.json).toEqual(RC(0, 1));
    });
  }
});

describe('ResidueClass: N() reads an exponent exactly (#399)', () => {
  // 2 has order 4 mod 5, and 4 divides 10^20; 3^3 = 27 = 6 mod 7.
  const cases: [string, unknown, unknown][] = [
    ['(2 mod 5)^(10^20)', ['Power', RC(2, 5), ['Power', 10, 20]], RC(1, 5)],
    [
      '(3 mod 7)^Floor(7/2)',
      ['Power', RC(3, 7), ['Floor', ['Divide', 7, 2]]],
      RC(6, 7),
    ],
  ];
  for (const [name, input, expected] of cases) {
    for (const [route, result] of routes(input)) {
      test(`${name} is ${JSON.stringify(expected)} under ${route}`, () => {
        expect(result.json).toEqual(expected);
      });
    }
  }
  test('the parsed \\overline{2}_{5}^{10^{20}} is ResidueClass(1, 5)', () => {
    expect(ce.parse('\\overline{2}_{5}^{10^{20}}').N().json).toEqual(RC(1, 5));
  });
});

describe('ResidueClass: an engine with no class does not look for one (#399)', () => {
  test('containsResidueClass() is false until the engine makes a class', () => {
    const engine = new ComputeEngine();
    const sum = engine.box(['Add', 'x', 1]);
    expect(containsResidueClass(sum)).toBe(false);
    const withClass = engine.box(['Add', 'x', RC(1, 5)] as Expression);
    expect(containsResidueClass(withClass)).toBe(true);
    expect(containsResidueClass(sum)).toBe(false);
  });
});

// The shared arithmetic (`add()`, `mul()`, `div()`, `pow()`, `root()`), the
// arithmetic methods, `Expand`, `Factor`, `D` and `simplify()` all apply the
// residue rules only, when an operand holds a class.
describe('ResidueClass: one guard for every route (#399)', () => {
  const c = RC(2, 4);
  const same = (input: unknown, result: Expression) =>
    expect(result.json).toEqual(ce.box(input as Expression).json);

  describe('simplify() keeps a quotient by a class with no inverse', () => {
    const cases: [string, unknown, string | undefined][] = [
      [
        '((x + 1)·c)/c',
        ['Divide', ['Multiply', ['Add', 'x', 1], c], c],
        '\\frac{(x+1)\\overline{2}_{4}}{\\overline{2}_{4}}',
      ],
      [
        'x·(∞ + c)',
        ['Multiply', 'x', ['Add', 'PositiveInfinity', c]],
        undefined,
      ],
    ];
    for (const [name, input, latex] of cases) {
      test(name, () => {
        for (const [, result] of routes(input)) same(input, result);
        if (latex !== undefined)
          expect(ce.parse(latex).simplify().json).toEqual(
            ce.box(input as Expression).json
          );
      });
    }
  });

  describe('Expand, ExpandAll and Factor keep an expression with a class', () => {
    const cases: [string, unknown][] = [
      ['Expand', ['Divide', ['Multiply', c, ['Add', 'x', 1]], c]],
      ['Expand', ['Multiply', c, ['Add', ['Divide', 1, c], 'x']]],
      ['Expand', ['Divide', ['Power', ['Add', c, 'x'], 2], c]],
      [
        'ExpandAll',
        ['Divide', ['Multiply', ['Add', 'x', 1], ['Add', c, 'x']], c],
      ],
      ['Expand', ['Multiply', ['Add', c, 'PositiveInfinity'], ['Add', 'x', 1]]],
      ['Factor', ['Divide', ['Multiply', c, 'x'], ['Multiply', c, 'y']]],
    ];
    for (const [op, input] of cases) {
      test(`${op}(${JSON.stringify(input)})`, () => {
        same(input, ce.box([op, input] as Expression).evaluate());
      });
    }
    test('the parsed \\operatorname{Expand}', () => {
      const parsed = ce.parse(
        '\\operatorname{Expand}(\\frac{\\overline{2}_{4}(x+1)}{\\overline{2}_{4}})'
      );
      expect(parsed.evaluate().operator).toBe('Divide');
    });
  });

  describe('the arithmetic methods', () => {
    const C = () => ce.box(c as Expression);
    const X = () => ce.box('x');
    const cases: [string, () => Expression, (r: Expression) => void][] = [
      [
        'c.div(c)',
        () => C().div(C()),
        (r) => expect(r.operator).toBe('Divide'),
      ],
      [
        'c.mul(c.inv())',
        () => C().mul(C().inv()),
        (r) => expect(r.operator).toBe('Multiply'),
      ],
      [
        'c.inv().inv()',
        () => C().inv().inv(),
        (r) => expect(r.operator).toBe('Divide'),
      ],
      [
        'c.add(∞)',
        () => C().add(ce.PositiveInfinity),
        (r) => expect(r.operator).toBe('Add'),
      ],
      ['c.mul(0)', () => C().mul(0), (r) => expect(r.json).toEqual(RC(0, 4))],
      [
        'c.mul(ce.Zero)',
        () => C().mul(ce.Zero),
        (r) => expect(r.json).toEqual(RC(0, 4)),
      ],
      ['c.div(0)', () => C().div(0), (r) => expect(r.operator).toBe('Divide')],
      // `-c` is read as a class, so the difference folds in the ring.
      ['c.sub(c)', () => C().sub(C()), (r) => expect(r.json).toEqual(RC(0, 4))],
      [
        '(x·c).sub(x·c)',
        () => X().mul(C()).sub(X().mul(C())),
        (r) => expect(r.operator).toBe('Add'),
      ],
      [
        'c.pow(-1)',
        () => C().pow(-1),
        (r) => expect(r.operator).not.toBe('ResidueClass'),
      ],
      [
        'c.sqrt()',
        () => C().sqrt(),
        (r) => expect(r.json).toEqual(['Sqrt', c]),
      ],
      [
        'unit: (3 mod 7).div(3 mod 7)',
        () =>
          ce.box(RC(3, 7) as Expression).div(ce.box(RC(3, 7) as Expression)),
        (r) => expect(r.json).toEqual(RC(1, 7)),
      ],
    ];
    for (const [name, make, check] of cases) test(name, () => check(make()));

    test('D of a product with a class has no division by 1', () => {
      const d = ce
        .box(['D', ['Multiply', RC(3, 5), 'x'], 'x'] as Expression)
        .evaluate();
      expect(JSON.stringify(d.json)).not.toContain('"Divide"');
      const sum = ce
        .box(RC(3, 5) as Expression)
        .add(ce.box(RC(3, 5) as Expression));
      expect(sum.json).toEqual(RC(1, 5));
      expect(json(['Divide', ['Multiply', 2, RC(3, 5)], 1])).toEqual([
        'Multiply',
        2,
        RC(3, 5),
      ]);
    });
  });

  describe('a symbol whose value is a class', () => {
    const engine = new ComputeEngine();
    engine.assign('q', engine.box(c as Expression));
    engine.assign('cc', engine.box(RC(3, 7) as Expression));
    const cases: [unknown, unknown][] = [
      [
        ['Divide', 'q', 'q'],
        ['Divide', c, c],
      ],
      [['Subtract', 'q', 'q'], RC(0, 4)],
      [
        ['Add', 'q', 'PositiveInfinity'],
        ['Add', 'PositiveInfinity', c],
      ],
      [['Multiply', 0, 'q'], RC(0, 4)],
      [
        ['Divide', ['Multiply', 'q', 'x'], 'q'],
        ['Divide', ['Multiply', 'x', c], c],
      ],
    ];
    for (const [input, value] of cases) {
      test(`${JSON.stringify(input)}: simplify keeps it, evaluate reads q`, () => {
        const boxed = engine.box(input as Expression);
        expect(boxed.simplify().json).toEqual(boxed.json);
        expect(boxed.evaluate().json).toEqual(value);
      });
    }
    test('0·2·cc is not the integer 0 when boxed', () => {
      const boxed = engine.box(['Multiply', 0, 2, 'cc']);
      expect(boxed.json).not.toBe(0);
      expect(boxed.evaluate().json).toEqual(RC(0, 7));
    });
    test('a symbol with value 0 still simplifies z/z to 1 (value-blind)', () => {
      engine.assign('z', 0);
      expect(engine.box(['Divide', 'z', 'z']).simplify().json).toBe(1);
    });
  });

  describe('simplify() sees a class through Sqrt, Root and Square', () => {
    const cases: [unknown, string][] = [
      [
        ['Sqrt', ['Power', ['Multiply', 'x', c], 2]],
        '\\sqrt{(x\\overline{2}_{4})^2}',
      ],
      [['Root', ['Power', RC('k', 7), 3], 3], ''],
    ];
    for (const [input, latex] of cases) {
      test(JSON.stringify(input), () => {
        const boxed = ce.box(input as Expression);
        expect(boxed.simplify().json).toEqual(boxed.json);
        if (latex) {
          const parsed = ce.parse(latex);
          expect(parsed.simplify().json).toEqual(parsed.json);
        }
      });
    }
  });

  describe('Indeterminate beside a class', () => {
    for (const op of ['Add', 'Multiply']) {
      test(`${op}(Indeterminate, 2 mod 5)`, () => {
        const boxed = ce.box([op, 'Indeterminate', RC(2, 5)] as Expression);
        expect(boxed.evaluate().json).toBe('Indeterminate');
        expect(boxed.simplify().json).toBe('Indeterminate');
        expect(boxed.N().json).toBe('NaN');
      });
    }
  });

  describe('a collection is broadcast, then each element folds', () => {
    const cases: [unknown, unknown][] = [
      [
        ['Add', RC(1, 5), ['List', 1, 2]],
        ['List', RC(2, 5), RC(3, 5)],
      ],
      [
        ['Multiply', RC(2, 5), ['List', 1, 2]],
        ['List', RC(2, 5), RC(4, 5)],
      ],
      [
        ['Multiply', c, ['Tuple', 1, 2]],
        ['Tuple', RC(2, 4), RC(0, 4)],
      ],
    ];
    for (const [input, expected] of cases) {
      for (const [route, result] of routes(input)) {
        test(`${JSON.stringify(input)} under ${route}`, () => {
          expect(result.json).toEqual(expected);
        });
      }
    }
    test('x + [1, 2] still broadcasts', () => {
      expect(evaluated(['Add', 'x', ['List', 1, 2]])).toEqual([
        'List',
        ['Add', 'x', 1],
        ['Add', 'x', 2],
      ]);
    });
  });

  describe('an expression that holds a class is not typed as a number', () => {
    const cases: unknown[] = [
      ['Power', ['Multiply', 'x', c], 2],
      ['Sqrt', c],
      ['Root', c, 3],
      ['Add', ['Power', ['Multiply', 'x', c], 2], 1],
    ];
    for (const input of cases) {
      test(JSON.stringify(input), () => {
        expect(ce.box(input as Expression).type.toString()).not.toMatch(
          /number|real|complex|integer/
        );
      });
    }
  });

  describe('a subscript of a conjugate round-trips', () => {
    test('Subscript(Conjugate(3), 5) is written {\\overline{3}}_{5}', () => {
      const boxed = ce.box(['Subscript', ['Conjugate', 3], 5]);
      expect(boxed.latex).toBe('{\\overline{3}}_{5}');
      expect(ce.parse(boxed.latex).json).toEqual(boxed.json);
    });
    test('ResidueClass(3, 5) is written \\overline{3}_{5}', () => {
      const boxed = ce.box(RC(3, 5) as Expression);
      expect(boxed.latex).toBe('\\overline{3}_{5}');
      expect(ce.parse(boxed.latex).json).toEqual(boxed.json);
    });
    test('a conjugate of a symbol keeps its spelling', () => {
      expect(ce.box(['Subscript', ['Conjugate', 'z'], 5]).latex).toBe(
        '\\overline{z}_{5}'
      );
    });
  });
});

describe('ResidueClass: fourth review round (#399)', () => {
  const c = RC(2, 5);
  const d = RC(2, 4);

  describe('Solve declines an equation with a class', () => {
    const cases: unknown[] = [
      ['Equal', 'x', c],
      ['Equal', ['Add', 'x', c], RC(4, 5)],
      ['Equal', ['Subtract', 'x', c], 0],
    ];
    for (const eq of cases) {
      test(`Solve(${JSON.stringify(eq)}, x) stays unevaluated`, () => {
        const r = ce.box(['Solve', eq, 'x'] as Expression).evaluate();
        expect(r.operator).toBe('Solve');
        expect(ce.box(eq as Expression).solve('x')).toBeNull();
      });
    }
    test('the parsed Solve stays unevaluated', () => {
      expect(
        ce.parse('\\operatorname{Solve}(x=\\overline{2}_{5}, x)').evaluate()
          .operator
      ).toBe('Solve');
    });
  });

  describe('symbol values are followed transitively', () => {
    const engine = new ComputeEngine();
    engine.assign('c', engine.box(d as Expression));
    engine.assign('q', engine.box('c'));
    engine.assign('r', engine.box(['Add', 'q', 'y']));
    test('q := c, c := ResidueClass(2, 4)', () => {
      expect(containsResidueClass(engine.box('q'))).toBe(true);
      expect(containsResidueClass(engine.box('r'))).toBe(true);
    });
    test('r/r with r := q + y is not simplified to 1', () => {
      const boxed = engine.box(['Divide', 'r', 'r']);
      expect(boxed.simplify().json).toEqual(boxed.json);
    });
    test('a cycle of values ends', () => {
      engine.assign('a1', engine.box('b1'));
      engine.assign('b1', engine.box('a1'));
      expect(containsResidueClass(engine.box('a1'))).toBe(false);
      expect(engine.box(['Divide', 'a1', 'a1']).simplify().json).toBe(1);
    });
  });

  describe('a class behind another operator is seen by simplify()', () => {
    const engine = new ComputeEngine();
    engine.assign(
      'S',
      engine.box(['Sum', RC('k', 4), 'k', 1, 3] as Expression)
    );
    const cases: unknown[] = [
      ['Divide', 'S', 'S'],
      ['Divide', ['At', ['List', d], 1], ['At', ['List', d], 1]],
      ['Divide', ['If', 'True', d, 0], ['If', 'True', d, 0]],
    ];
    for (const input of cases) {
      test(`${JSON.stringify(input)} is not simplified to 1`, () => {
        const r = engine.box(input as Expression).simplify();
        expect(r.json).not.toBe(1);
        expect(r.operator).toBe('Divide');
      });
    }
  });

  describe('N() does not evaluate an impure stored value twice', () => {
    for (const op of ['Add', 'Multiply', 'Divide', 'Power']) {
      test(op, () => {
        const engine = new ComputeEngine();
        let calls = 0;
        engine.declare('ResidueTock', {
          signature: '() -> integer',
          pure: false,
          evaluate: () => {
            calls += 1;
            return engine.number(1);
          },
        });
        engine.box(c as Expression);
        engine.declare('t', {
          type: 'integer',
          value: engine.box(['ResidueTock']),
        });
        engine.box([op, c, 't'] as Expression).N();
        expect(calls).toBe(1);
      });
    }
  });

  describe('D and Integrate decline a function with a class', () => {
    test('Integrate(c, (x, 0, 1/2))', () => {
      const boxed = ce.box([
        'Integrate',
        c,
        ['Limits', 'x', 0, ['Rational', 1, 2]],
      ] as Expression);
      expect(boxed.evaluate().operator).toBe('Integrate');
      expect(boxed.N().operator).toBe('Integrate');
    });
    test('D(c·x², x)', () => {
      const boxed = ce.box([
        'D',
        ['Multiply', c, ['Power', 'x', 2]],
        'x',
      ] as Expression);
      expect(boxed.evaluate().operator).toBe('D');
    });
  });

  describe('broadcasting', () => {
    test('c.mul([1, 2]) broadcasts', () => {
      expect(ce.box(c as Expression).mul(ce.box(['List', 1, 2])).json).toEqual([
        'List',
        RC(2, 5),
        RC(4, 5),
      ]);
    });
    test('(1 mod 7 + [1/3]).N() reads 1/3 exactly', () => {
      expect(
        ce
          .box(['Add', RC(1, 7), ['List', ['Rational', 1, 3]]] as Expression)
          .N().json
      ).toEqual(['List', RC(6, 7)]);
    });
    test('c / (1, 2) is a division by a point, as x / (1, 2)', () => {
      const a = ce.box(['Divide', c, ['Tuple', 1, 2]] as Expression);
      const b = ce.box(['Divide', 'x', ['Tuple', 1, 2]]);
      expect(a.json).toEqual(b.json);
    });
  });

  describe('Expand, Factor and Together fold a closed expression', () => {
    const cases: [string, unknown, unknown][] = [
      ['Expand', ['Add', c, c], RC(4, 5)],
      ['Expand', ['Multiply', c, c], RC(4, 5)],
      ['Expand', ['Power', ['Add', c, c], 2], RC(1, 5)],
      ['Factor', ['Add', c, c], RC(4, 5)],
      ['Together', ['Add', c, c], RC(4, 5)],
    ];
    for (const [op, input, expected] of cases) {
      test(`${op}(${JSON.stringify(input)})`, () => {
        expect(evaluated([op, input])).toEqual(expected);
      });
    }
  });

  test('-(x + c) folds the negated class', () => {
    for (const [, result] of routes(['Negate', ['Add', 'x', c]]))
      expect(result.json).toEqual(['Add', ['Negate', 'x'], RC(3, 5)]);
  });

  describe('types', () => {
    const engine = new ComputeEngine();
    engine.assign('q', engine.box(d as Expression));
    const cases: unknown[] = [
      ['Power', 2, c],
      ['Power', 'x', c],
      ['Exp', c],
      ['Root', 8, c],
      ['Multiply', 'q', 'x'],
    ];
    for (const input of cases) {
      test(`${JSON.stringify(input)} is not a number`, () => {
        expect(engine.box(input as Expression).type.toString()).not.toMatch(
          /number|real|complex|integer/
        );
      });
    }
  });

  describe('the terms with no class are simplified together', () => {
    test('sin²x + cos²x + c is ResidueClass(3, 5)', () => {
      expect(
        ce.parse('\\sin^2 x+\\cos^2 x+\\overline{2}_{5}').simplify().json
      ).toEqual(RC(3, 5));
    });
    test('x + x + c is 2x + c', () => {
      expect(
        ce.box(['Add', 'x', 'x', c] as Expression).simplify().json
      ).toEqual(['Add', ['Multiply', 2, 'x'], c]);
    });
  });

  test('spaces before _ and the modulus', () => {
    expect(ce.parse('\\overline{3} _ 5').json).toEqual(RC(3, 5));
    expect(ce.parse('\\overline{3} _{ 5 }').json).toEqual(RC(3, 5));
    expect(ce.parse('\\overline{z} _ 5').json).toEqual([
      'Subscript',
      ['Conjugate', 'z'],
      5,
    ]);
  });

  describe('a/a and a - a are element-wise for a list', () => {
    test('[x]/[x] is [1] and [x] - [x] is [0]', () => {
      expect(
        ce.box(['Divide', ['List', 'x'], ['List', 'x']]).simplify().json
      ).toEqual(['List', 1]);
      expect(
        ce.box(['Subtract', ['List', 'x'], ['List', 'x']]).simplify().json
      ).toEqual(['List', 0]);
    });
    test('[d]/[d] is not 1', () => {
      const r = ce
        .box(['Divide', ['List', d], ['List', d]] as Expression)
        .simplify();
      expect(r.operator).toBe('List');
      expect(r.json).toEqual(['List', ['Divide', d, d]]);
    });
  });
});

describe('ResidueClass: last review round (#399)', () => {
  test('a class behind any operator stops the canonical and evaluated a/a', () => {
    const engine = new ComputeEngine();
    engine.assign('c', engine.box(RC(2, 4) as Expression));
    const M = ['Max', 'c', 'x'];
    for (const input of [
      ['Divide', M, M],
      ['Subtract', M, M],
      ['Multiply', M, ['Power', M, -1]],
    ]) {
      const boxed = engine.box(input as Expression);
      expect(typeof boxed.json).not.toBe('number');
      for (const r of [boxed.evaluate(), boxed.simplify()])
        expect(typeof r.json).not.toBe('number');
    }
    // With no class, the canonical a/a still cancels.
    expect(
      new ComputeEngine().box(['Divide', ['Max', 'y', 'x'], ['Max', 'y', 'x']])
        .json
    ).toBe(1);
  });

  test('an assumed value that is a class is seen', () => {
    const engine = new ComputeEngine();
    engine.box(RC(1, 4) as Expression);
    engine.assume(engine.box(['Equal', 'qa', RC(2, 4)] as Expression));
    const boxed = engine.box(['Multiply', 0, 2, 'qa']);
    expect(boxed.json).not.toBe(0);
    expect(boxed.evaluate().json).toEqual(RC(0, 4));
    const q = engine.box(['Divide', 'qa', 'qa']);
    expect(q.simplify().json).toEqual(q.json);
  });

  test('NaN and Indeterminate in a power of a class', () => {
    const C = ce.box(RC(2, 5) as Expression);
    expect(C.pow(ce.Indeterminate).json).toBe('Indeterminate');
    expect(C.pow(ce.NaN).json).toBe('NaN');
    expect(C.div(ce.Indeterminate).json).toBe('Indeterminate');
    expect(C.div(ce.NaN).json).toBe('NaN');
    for (const e of ['NaN', 'Indeterminate']) {
      const boxed = ce.box(['Power', RC(2, 5), e] as Expression);
      expect(boxed.evaluate().json).toBe(e);
      expect(boxed.N().json).toBe('NaN');
    }
  });

  test('ResidueClass(2, 5, 99) keeps its third operand in LaTeX', () => {
    const boxed = ce.box(['ResidueClass', 2, 5, 99] as Expression);
    expect(boxed.latex).not.toBe('\\overline{2}_{5}');
    expect(boxed.latex).toMatch(/ResidueClass/);
    const back = ce.parse(boxed.latex);
    expect(back.operator).toBe('ResidueClass');
    expect(back.nops).toBe(3);
    expect(back.isValid).toBe(false);
    const parsed = ce.parse('\\operatorname{ResidueClass}(2, 5, 99)');
    expect(parsed.latex).toBe(boxed.latex);
  });
});
