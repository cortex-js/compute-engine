import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

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
    ['2^-1 mod 4', ['Power', RC(2, 4), -1], ['Divide', 1, RC(2, 4)]],
    ['0^-1 mod 7', ['Power', RC(0, 7), -1], ['Divide', 1, RC(0, 7)]],
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

// Classes of two moduli meet in ℤ/gcd(m, n), the largest ring that both
// reduce onto, and an integer is read in that ring.
describe('ResidueClass: classes of different moduli (#399)', () => {
  const cases: [string, unknown, unknown][] = [
    ['2 mod 4 + 1 mod 6 is in ℤ/2', ['Add', RC(2, 4), RC(1, 6)], RC(1, 2)],
    ['3 mod 4 * 5 mod 6 is in ℤ/2', ['Multiply', RC(3, 4), RC(5, 6)], RC(1, 2)],
    [
      'coprime moduli meet in the zero ring',
      ['Add', RC(2, 3), RC(1, 5)],
      RC(0, 1),
    ],
    [
      'the quotient is taken in the common ring',
      ['Divide', RC(2, 6), RC(1, 4)],
      RC(0, 2),
    ],
    [
      'an integer is read in the common ring',
      ['Add', RC(2, 4), RC(1, 6), 3],
      RC(0, 2),
    ],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name}`, () => {
      expect(evaluated(input)).toEqual(expected);
    });
  }

  test('a non-unit divisor in the common ring stays unevaluated', () => {
    expect(
      ce.box(['Divide', RC(1, 4), RC(2, 6)] as Expression).evaluate().operator
    ).toBe('Divide');
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

  // 7 is a representative of a class, not the class: membership of a bare
  // integer is not decided, as before ResidueClass.
  test('Element(7, ℤ/5ℤ) is not decided', () => {
    expect(ce.box(['Element', 7, Z(5)] as Expression).evaluate().operator).toBe(
      'Element'
    );
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
    ['\\overline{3}_{7}^{-1}', ['Divide', 1, RC(3, 7)]],
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
