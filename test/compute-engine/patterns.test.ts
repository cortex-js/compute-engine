import {
  BoxedExpression,
  PatternMatchOptions,
  ExpressionInput,
  Substitution,
} from '../../src/compute-engine';
import { _BoxedExpression } from '../../src/compute-engine/boxed-expression/abstract-boxed-expression';
import { validatePattern } from '../../src/compute-engine/boxed-expression/boxed-patterns';
import { MathJsonExpression as Expression } from '../../src/math-json/types';
import { engine, latex } from '../utils';

const ce = engine;

function match(
  pattern: ExpressionInput,
  expr: BoxedExpression | Expression,
  options?: PatternMatchOptions
): Substitution | null {
  // Avoid re-boxing both expr & pattern so as to preserve canonical-status
  expr =
    expr instanceof _BoxedExpression ? (expr as BoxedExpression) : ce.box(expr);
  pattern =
    pattern instanceof _BoxedExpression
      ? (pattern as BoxedExpression)
      : ce.box(pattern);

  const result = expr.match(pattern, {
    useVariations: true,
    ...options,
  });
  if (result === null) return null;
  const r = {};
  for (const key of Object.keys(result)) r[key] = result[key];
  return r;
}

describe('Examples from Patterns and Rules guide', () => {
  const pattern: Expression = ['Add', '_', 'x'];

  // console.log("x+42", ce.box(["Add", "x", 42]).match(pattern));
  // ➔ { } : the expression matches the pattern by commutativity

  // console.log("5*x", ce.box(["Multiply", 5, "x"]).match(pattern));
  test('1+x', () =>
    expect(match(pattern, ['Add', 1, 'x'])).toMatchInlineSnapshot(`{}`));
  test('x+42', () =>
    expect(match(pattern, ['Add', 'x', 42])).toMatchInlineSnapshot(`{}`));
  test('5*x', () =>
    expect(match(pattern, ['Multiply', 5, 'x'])).toMatchInlineSnapshot(`null`));
  test('non-recursive: 2(1+x)', () =>
    expect(
      match(pattern, ['Multiply', 2, ['Add', 1, 'x']])
    ).toMatchInlineSnapshot(`null`));
  test('recursive: 2(1+x)', () =>
    expect(
      match(pattern, ['Multiply', 2, ['Add', 1, 'x']], { recursive: true })
    ).toMatchInlineSnapshot(`{}`));

  test('implicit addition (variants)', () =>
    expect(match(['Add', 'x', '_a'], 'x')).toMatchInlineSnapshot(`
      {
        _a: 0,
      }
    `));

  test('prevent implicit addition (variants)', () =>
    expect(
      match(['Add', 'x', '_a'], 'x', {
        useVariations: false,
      })
    ).toMatchInlineSnapshot(`null`));

  test('Repeated named wildcards (fail)', () =>
    expect(match(['Add', '_a', '_a'], ['Add', 1, 'x'])).toMatchInlineSnapshot(
      `null`
    ));
  test('Repeated named wildcards (success)', () =>
    expect(match(['Add', '_a', '_a'], ['Add', 'x', 'x']))
      .toMatchInlineSnapshot(`
      {
        _a: x,
      }
    `));

  test('Capture function name', () =>
    expect(match(['_f', '__args'], ['Add', 'x', 1])).toMatchInlineSnapshot(`
      {
        __args: ["Add", "x", 1],
        _f: Add,
      }
    `));
});

// Should match *single expr.* only
describe('PATTERNS  MATCH - Universal wildcard', () => {
  let pattern: Expression;

  describe('Named', () => {
    pattern = ['Add', 1, '_q'];

    test('Simple match (literals)', () => {
      expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`null`);
      expect(match(pattern, ['Add', 1, 'GoldenRatio'])).toMatchInlineSnapshot(`
        {
          _q: GoldenRatio,
        }
      `);
    });

    test('Matches functions, tensors...', () => {
      // Associative
      expect(match(pattern, ['Add', 1, ['Delimiter', ['List', 2, 3]]]))
        .toMatchInlineSnapshot(`
        {
          _q: ["List", 2, 3],
        }
      `);

      expect(match(pattern, ['Add', 1, ['Multiply', 2, 'j']]))
        .toMatchInlineSnapshot(`
        {
          _q: ["Multiply", 2, "j"],
        }
      `);

      expect(match(pattern, ['Add', 1, ['List', 5, 6]])).toMatchInlineSnapshot(`
        {
          _q: ["List", 5, 6],
        }
      `);
    });

    test('Commutative (should match operand permutations', () => {
      expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`null`);
      expect(match(pattern, ['Add', 'x', 1])).toMatchInlineSnapshot(`
        {
          _q: x,
        }
      `);
    });

    test('Multiple wildcards', () => {
      /*
       * Commutative FN.
       *
       */
      pattern = ['Add', '_a', 'n', '_c'];
      expect(match(pattern, ['Add', 'n', 3, 3])).toMatchInlineSnapshot(`null`);

      expect(match(pattern, ['Add', ['Multiply', 6, 'm'], 'n', ['Sqrt', 6]]))
        .toMatchInlineSnapshot(`
        {
          _a: ["Multiply", 6, "m"],
          _c: ["Sqrt", 6],
        }
      `);

      // Control
      // ---------
      // Absence of 'n' operand
      expect(match(pattern, ['Add', 'm', 3, 3])).toMatchInlineSnapshot(`null`);

      // Non-matching repeat-match
      pattern = ['Add', '_a', 'n', '_a'];
      expect(match(pattern, ['Add', 7, 9, 'n'])).toMatchInlineSnapshot(`null`);

      /*
       * Function-name + Operand simultaneously
       *
       */
      pattern = ['_n', '_a', 'x'];
      expect(match(pattern, ['Power', '1', 'x'])).toMatchInlineSnapshot(`
        {
          _a: 1,
          _n: Power,
        }
      `);

      expect(match(pattern, ['Power', ['Divide', '1', 'y'], 'x']))
        .toMatchInlineSnapshot(`
        {
          _a: ["Divide", 1, "y"],
          _n: Power,
        }
      `);

      expect(match(pattern, ['Divide', 'q', 'x'])).toMatchInlineSnapshot(`
        {
          _a: q,
          _n: Divide,
        }
      `);

      // Control
      // ---------
      // Not enough operands
      expect(match(pattern, ['Negate', 'x'])).toMatchInlineSnapshot(`null`);

      // No 'x'
      expect(
        match(pattern, ['Add', 'w', ['Negate', 'x']])
      ).toMatchInlineSnapshot(`null`);
    });

    // @todo?: Repeated-match cases, too?
    // (^some examples already in 'Examples from Patterns and Rules guide')
  });

  // Should return not null (i.e. `{}`) when there is a match
  test('Non-named', () => {
    /*
     * Selection of tests from 'Named' (replaced with unnamed cards)
     *
     */
    pattern = ['Add', 1, '_'];
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`null`);
    expect(match(pattern, ['Add', 1, 'GoldenRatio'])).toMatchInlineSnapshot(
      `{}`
    );

    // Associative
    expect(
      match(pattern, ['Add', 1, ['Delimiter', ['List', 2, 3]]])
    ).toMatchInlineSnapshot(`{}`);
    expect(
      match(pattern, ['Add', 1, ['Multiply', 2, 'j']])
    ).toMatchInlineSnapshot(`{}`);
    expect(match(pattern, ['Add', 1, ['List', 5, 6]])).toMatchInlineSnapshot(
      `{}`
    );
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`null`);

    // Multiple wildcards
    pattern = ['_', '_', 'x'];
    expect(match(pattern, ['Power', '1', 'x'])).toMatchInlineSnapshot(`{}`);

    pattern = ['Add', '_', 'n', '_'];
    expect(
      match(pattern, ['Add', ['Multiply', 6, 'm'], 'n', ['Sqrt', 6]])
    ).toMatchInlineSnapshot(`{}`);

    /*
     * Some extras...
     */
    pattern = ['Factorial', '_'];
    // (note: err. in terms of type/signature)
    expect(match(pattern, ['Factorial', 'a'])).toMatchInlineSnapshot(`{}`);
    // Nested
    pattern = ['Power', Infinity, ['Power', 'Pi', '_']];
    expect(
      match(pattern, ['Power', Infinity, ['Power', 'Pi', 'e']])
    ).toMatchInlineSnapshot(`{}`);
    // Function-name
    pattern = ['_', 'g'];
    expect(match(pattern, ['Negate', 'g'])).toMatchInlineSnapshot(`{}`);
  });
});

describe('PATTERNS  MATCH - Sequence wildcards', () => {
  let pattern: Expression;

  describe('Regular/non-optional sequence', () => {
    describe('Named wildcard', () => {
      test('Matches commutative-function operands', () => {
        pattern = ['Add', 1, '__a'];
        /*
         * 1 Operand
         *
         */
        expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`null`);

        /*
         * >1 Operand
         *
         */
        // Anchor-based matching: anchor `1` matches, __a captures all remaining elements
        expect(match(pattern, ['Add', 1, 2, 3, 'x', 5])).toMatchInlineSnapshot(
          `null`
        );

        /*
         * Function-expression operand/s
         *
         */
        expect(match(pattern, ['Add', 1, ['Multiply', 2, 'x']]))
          .toMatchInlineSnapshot(`
          {
            __a: ["Multiply", 2, "x"],
          }
        `);

        /*
         * Operand permutations
         */
        // Anchor-based matching: anchor `1` matches, __a captures remaining [x, 3, y]
        expect(match(pattern, ['Add', 'x', 1, 3, 'y'])).toMatchInlineSnapshot(
          `null`
        );

        expect(match(pattern, ['Add', ['Square', 'x'], 1]))
          .toMatchInlineSnapshot(`
          {
            __a: ["Square", "x"],
          }
        `);
      });

      test('Matches associative-function operands', () => {
        pattern = ['Multiply', '__m', ['Sqrt', 'x']];

        expect(match(pattern, ['Multiply', 7, ['Sqrt', 'x']]))
          .toMatchInlineSnapshot(`
          {
            __m: 7,
          }
        `);

        // Anchor-based matching: anchor ['Sqrt', 'x'] matches one occurrence,
        // __m captures remaining [2, ['Sqrt', 'x']]
        expect(match(pattern, ['Multiply', 2, ['Sqrt', 'x'], ['Sqrt', 'x']]))
          .toMatchInlineSnapshot(`
          {
            __m: ["Multiply", 2, ["Sqrt", "x"]],
          }
        `);

        // Match by commutative-permutation
        expect(match(pattern, ['Multiply', ['Sqrt', 'x'], ['Add', 2, 3]]))
          .toMatchInlineSnapshot(`
          {
            __m: 5,
          }
        `);

        // Control
        // (√y, instead of √x)
        expect(
          match(pattern, ['Multiply', 3, ['Sqrt', 'y']])
        ).toMatchInlineSnapshot(`null`);
      });

      test('Matches other function/categories', () => {
        /*
         * Non associative/commutative cases
         */
        //(@note: matching for this expr. ('Subtract') to be be done for *non-canonical* variants:
        //so as to not have Subtract canonicalized as Add)
        pattern = ['Subtract', '__a', 'y', '_b'];

        //(?Prettified MathJSON results in ["Square", "z"] here... ?)
        expect(
          match(
            ce.box(pattern, { form: 'raw' }),
            ce.box(['Subtract', 'x', 'y', ['Power', 'z', 2]], {
              form: 'raw',
            })
          )
        ).toMatchInlineSnapshot(`
          {
            __a: x,
            _b: ["Square", "z"],
          }
        `);

        // Control/should be no-match
        // -------------------------
        // Too many operands RHS (right of 'y')
        expect(
          match(
            ce.box(ce.box(pattern, { form: 'raw' }), { form: 'raw' }),
            ce.box(['Subtract', 'x', 'y', ['Power', 'z', 2], 'w'], {
              form: 'raw',
            })
          )
        ).toMatchInlineSnapshot(`null`);

        // Missing capture of '__a'
        expect(
          match(ce.box(pattern, { form: 'raw' }), [
            'Subtract',
            'y',
            ['Power', 'z', 2],
          ])
        ).toMatchInlineSnapshot(`null`);

        pattern = ['Max', '__a', 10];
        expect(match(pattern, ['Max', 1, 10])).toMatchInlineSnapshot(`
          {
            __a: 1,
          }
        `);
        expect(match(pattern, ['Max', 1, ['Range', 3, 7, 2], 9, 10]))
          .toMatchInlineSnapshot(`
          {
            __a: ["Sequence", 1, ["Range", 3, 7, 2], 9],
          }
        `);

        // Should not match
        expect(
          match(pattern, ['Max', 10, 9, 8]) //Non-commutative
        ).toMatchInlineSnapshot(`null`);
      });
    });

    describe('Non-named wildcard', () => {
      test(`Matches, but without capturing (substitutions)`, () => {
        /*
         * (Selection of cases from 'Named wildcard': but unnamed sequence cards)
         */

        pattern = ['Add', 1, '__'];

        expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`null`);

        // Anchor-based matching with unnamed wildcard
        expect(match(pattern, ['Add', 1, 2, 3, 'x', 5])).toMatchInlineSnapshot(
          `null`
        );

        expect(match(pattern, ['Add', 'x', 1, 3, 'y'])).toMatchInlineSnapshot(
          `null`
        );

        pattern = ['Multiply', '__', ['Sqrt', 'x']];

        // Anchor-based matching: ['Sqrt', 'x'] is anchor, __ captures the rest
        expect(
          match(pattern, ['Multiply', 2, ['Sqrt', 'x'], ['Sqrt', 'x']])
        ).toMatchInlineSnapshot(`{}`);

        pattern = ['Subtract', '__', 'y', '_'];

        expect(
          match(
            ce.box(pattern, { form: 'raw' }),
            ce.box(['Subtract', 'x', 'y', ['Power', 'z', 2]], {
              form: 'raw',
            })
          )
        ).toMatchInlineSnapshot(`{}`);
      });
    });

    test(`Matches operands which match further wildcards`, () => {
      /*
       * Case 1
       *
       */
      pattern = ['Add', ['Power', 'x', '_'], '__w'];

      expect(
        match(pattern, ['Add', ['Power', 'x', 'ExponentialE'], 'ImaginaryUnit'])
      ).toMatchInlineSnapshot(`
        {
          __w: ImaginaryUnit,
        }
      `);
      expect(match(pattern, ['Add', ['Square', 'y'], ['Power', 'x', 2], 3]))
        .toMatchInlineSnapshot(`
        {
          __w: ["Add", ["Square", "y"], 3],
        }
      `);

      // No match (non-matching Power)
      expect(
        match(pattern, ['Add', ['Power', 'y', 3], 'z'])
      ).toMatchInlineSnapshot(`null`);

      // No match (well; additive identity)
      expect(match(pattern, ['Add', ['Power', 'x', 2]])).toMatchInlineSnapshot(`
        {
          __w: 0,
        }
      `);

      /*
       * Case 2
       *
       */
      pattern = ['Multiply', ['Log', '__'], '_z', 10];

      expect(match(pattern, ['Multiply', ['Log', 64, 8], 'y', 10]))
        .toMatchInlineSnapshot(`
        {
          _z: y,
        }
      `);
      expect(
        match(pattern, ['Multiply', 3, 10, ['Log', 100]])
      ).toMatchInlineSnapshot(`null`);

      // No match (Missing '_z' operand)
      expect(
        match(pattern, ['Multiply', ['Log', '__'], 10])
      ).toMatchInlineSnapshot(`null`);
    });

    test(`Varying wildcard (operand) positions`, () => {
      /*
       *
       * Non-commutative FN's.
       *
       */
      // At end
      expect(match(['Max', 1, '__a'], ['Max', 1, 2, 3, 4]))
        .toMatchInlineSnapshot(`
        {
          __a: ["Sequence", 2, 3, 4],
        }
      `);

      // Placed in middle
      // ('Sequence wildcard in the middle, full of sound and fury, signifying nothing' 😆)
      expect(
        match(
          ['GCD', '_', '__a', 18],
          ['GCD', ['Factorial', 6], ['Power', 6, 3], ['Subtract', 74, 2], 18]
        )
      ).toMatchInlineSnapshot(`
        {
          __a: ["Sequence", 216, 72],
        }
      `);

      // Placed at beginning
      expect(
        match(
          //@note: non-canonical for both, because do not want Subtract to become 'Add'
          ce.box(['Subtract', '__s', 5], { form: 'raw' }),
          ce.box(['Subtract', 8, 7, 6, 5], { form: 'raw' })
        )
      ).toMatchInlineSnapshot(`
        {
          __s: ["Sequence", 8, 7, 6],
        }
      `);

      // Controls
      // ---------
      expect(match(['Max', 1, '__a'], ['Max', 2, 3, 4])).toMatchInlineSnapshot(
        `null`
      );

      expect(
        match(['LCM', '_', '__a', 18], ['LCM', ['Factorial', 6], 18])
      ).toMatchInlineSnapshot(`null`);

      expect(match(['Random', '__R'], ['Random'])).toMatchInlineSnapshot(
        `null`
      );
    });

    test(`Multiple sequence wildcards (for one set of operands)`, () => {
      /*
       * Non-commutative.
       *
       */
      pattern = ['Tuple', '__t', ['_', '__'], '__q'];

      expect(
        match(pattern, ['Tuple', ['Sqrt', 'x'], ['Add', 2, 3], 'y'])
      ).toMatchInlineSnapshot(`null`);

      // 3+ seq.
      pattern = ['List', 1, '__a', 4, '__b', 7, '__c'];
      expect(match(pattern, ['List', 1, 2, 3, 4, 5, 6, 7, 8]))
        .toMatchInlineSnapshot(`
        {
          __a: ["Sequence", 2, 3],
          __b: ["Sequence", 5, 6],
          __c: 8,
        }
      `); // 👍

      // With universal wildcards, too.
      pattern = [
        'Set',
        "'some text'",
        '_',
        '__a',
        ['Less', '_', '_'],
        '__b',
        9,
      ];
      expect(
        match(pattern, [
          'Set',
          "'some text'",
          'x',
          'y',
          ['Less', 'x', 'y'],
          ['About', 'RandomExpression'],
          9,
        ])
      ).toMatchInlineSnapshot(`
        {
          __a: y,
          __b: ["About", "RandomExpression"],
        }
      `); // 👍

      // Controls
      // ----------
      //No match for '__q'
      pattern = ['Tuple', '__t', ['_', '__'], '__q'];
      expect(
        match(pattern, ['Tuple', ['Sqrt', 'x'], ['Add', 2, 3]])
      ).toMatchInlineSnapshot(`null`);

      //Missing middle sequence ('_b_')
      pattern = ['List', 1, '__a', 4, '__b', 7, '__c'];
      expect(
        match(pattern, ['List', 1, 2, 3, 5, 6, 7, 8])
      ).toMatchInlineSnapshot(`null`);

      /*
       * Commutative.
       *
       */
      //!@feat?: this use-case (multiplt seq.-cards) illustrates the utility of a 'matchPermutations'
      //!(Replace) option

      //@todo
    });
  });

  describe(`Optional sequence`, () => {
    test('Matches nothing', () => {
      /*
       * Named optional-sequence
       */
      expect(match(['List', 1, 2, '___a', 3], ['List', 1, 2, 3]))
        .toMatchInlineSnapshot(`
        {
          ___a: Nothing,
        }
      `);

      /*
       * Un-named optional-sequence
       */
      expect(match(['Log', '_l', '___'], ['Log', ['Power', 10, 10]]))
        .toMatchInlineSnapshot(`
        {
          _l: 10000000000,
        }
      `);

      // Matches nothing, twice (because subsequent to regular/non-optional sequence, which should
      // 'greedily' match)
      expect(
        match(
          ['Tuple', 1, '__u', '___v', 4, '__w', '___x', 7],
          ['Tuple', 1, 2, 3, 4, 5, 6, 7]
        )
      ).toMatchInlineSnapshot(`
        {
          ___v: Nothing,
          ___x: Nothing,
          __u: ["Sequence", 2, 3],
          __w: ["Sequence", 5, 6],
        }
      `); // 👍
    });

    test('Matches >1 operands', () => {
      //i.e. behaves like an ordinary sequence wildcard
      expect(
        match(['Add', '___', 3, '___'], ['Add', 'x', 3, 'Pi'])
      ).toMatchInlineSnapshot(`{}`);

      expect(
        match(
          ['Matrix', ['List', '___m', ['List', 7.1]]],
          [
            'Matrix',
            [
              'List',
              ['List', 9.3],
              ['List', ['Complex', 6, 3.1]],
              ['List', 7.1],
            ],
          ]
        )
      ).toMatchInlineSnapshot(`
        {
          ___m: ["Sequence", ["List", 9.3], ["List", ["Complex", 6, 3.1]]],
        }
      `);
    });

    test("Special case: matches '0' (as additive identity)", () => {
      expect(match(['Add', 1, 2, '___a', 3], ['Add', 1, 2, 3]))
        .toMatchInlineSnapshot(`
        {
          ___a: 0,
        }
      `);

      // Control (Unnamed wildcard: so empty subst.)
      expect(
        match(['Add', 1, 2, '___', 3], ['Add', 1, 2, 3])
      ).toMatchInlineSnapshot(`{}`);
    });

    test("Special case: matches '1' (as multiplicative identity)", () => {
      // (Two optional seqs., too...)
      expect(
        match(
          ['Multiply', '___u', 'q', 'r', 's', '___v'],
          ['Multiply', 'q', 'r', 's']
        )
      ).toMatchInlineSnapshot(`
        {
          ___u: 1,
          ___v: 1,
        }
      `);
    });
  });
});

const TOLERANCE = 2.22044604925031e-16;

const sameExprs: [ExpressionInput, ExpressionInput][] = [
  [1, 1],
  [3.14159265, 3.14159265],
  [3.14159265, { num: '3.14159265' }],
  [{ num: '3.14159265' }, { num: '3.14159265' }],
  [3.14159265, { num: '+3.14159265' }],
  [3.14159265, 3.14159265 + TOLERANCE],
  [7, 7],

  ['Pi', 'Pi'],
  ['Pi', { sym: 'Pi' }],
  [{ sym: 'Pi' }, { sym: 'Pi', wikidata: 'Q167' }],

  [
    ['Add', 1, 'x'],
    ['Add', 'x', 1],
  ],
  [{ fn: ['Add', 'x', 1] }, ['Add', 'x', 1]],
];

const notSameExprs: [Expression, Expression][] = [
  [1, 0],
  [2, 5],

  [1, 'Pi'],
  ['Pi', 1],

  [1, 'x'],
  ['x', 1],
  ['x', 'y'],
  ['x', ['Foo']],
  [['Foo'], 'x'],

  // [
  //   { sym: 'Pi', wikidata: 'Q168' }, // Greek letter π
  //   { sym: 'Pi', wikidata: 'Q167' }, // 3.14159265...
  // ],

  [
    ['Add', 1],
    ['Add', 1, 2],
  ],
  [
    ['Add', 1, 2, 3],
    ['Add', 1, 2],
  ],
  [
    ['Add', 1, 2, 3],
    ['Add', 1, 2, 4],
  ],
];

describe('MATCH', () => {
  for (const expr of sameExprs) {
    const lhs = ce.box(expr[0]).canonical;
    const rhs = ce.box(expr[1]).canonical;
    test(`match(${lhs.latex}, ${rhs.latex})`, () => {
      expect(match(lhs, rhs) !== null).toBeTruthy();
    });
  }
});

describe('NOT SAME', () => {
  for (const expr of notSameExprs) {
    test(`match(${latex(expr[0])}, ${latex(expr[1])})`, () =>
      expect(
        engine.box(expr[0]).canonical.isSame(engine.box(expr[1]).canonical)
      ).toBeFalsy());
  }
});

describe('WILDCARDS', () => {
  it('number should match a wildcard', () => {
    const result = match('_x', ce.box(1));
    expect(result).toMatchInlineSnapshot(`
      {
        _x: 1,
      }
    `);
  });

  it('symbol should match a wildcard', () => {
    const result = match('_x', ce.box('a'));
    expect(result).toMatchInlineSnapshot(`
      {
        _x: a,
      }
    `);
  });

  it('function should match a wildcard', () => {
    const result = match('_x', ce.box(['Add', 1, 'a']));
    expect(result).toMatchInlineSnapshot(`
      {
        _x: ["Add", "a", 1],
      }
    `);
  });

  it('wildcard matched as an argument of a commutative function', () => {
    const result = match(['Add', '_x', 1], ce.box(['Add', 1, 'a']));
    expect(result).toMatchInlineSnapshot(`
      {
        _x: a,
      }
    `);
  });

  it('should **NOT** match a wildcard of a commutative function with more arguments', () => {
    const result = match(['Add', '_x', 1], ce.box(['Add', 'x', 1, 'a']));
    expect(result).toMatchInlineSnapshot(`null`);
  });

  it('should match a sequence wildcard of a commutative function with more argument', () => {
    const result = match(['Add', '__x', 1], ce.box(['Add', 'x', 1, 'a']));
    expect(result).toMatchInlineSnapshot(`
      {
        __x: ["Add", "a", "x"],
      }
    `);
  });

  // it('should match a wildcard with a condition', () => {
  //   const pattern = ce.pattern('_x', { condition: '_x > 0' });
  //   const result = pattern.match(1);
  //   expect(result).toMatchInlineSnapshot(`
  //     Object {
  //       "x": 1,
  //     }
  //   `);
  // });
  // it('should not match a wildcard with a condition', () => {
  //   const pattern = ce.pattern('_x', { condition: '_x > 0' });
  //   const result = pattern.match(-1);
  //   expect(result).toBeNull();
  // });
});

// Some operations (add, multiply) can accept variations on patterns.
// For example, "ax+b" can match "ax" or "x+b".
describe('NON EXACT WILDCARDS', () => {
  const match2 = (pattern, x) =>
    match(pattern, x, { substitution: { _x: ce.box('_x') } });

  it('should match x for a + x', () => {
    const result = match2(['Add', '_a', '_x'], '_x');
    expect(result).toMatchInlineSnapshot(`
      {
        _a: 0,
        _x: _x,
      }
    `);
  });

  it('should match x - a for a + x', () => {
    const result = match2(['Add', '_a', '_x'], ['Subtract', '_x', 5]);
    expect(result).toMatchInlineSnapshot(`
      {
        _a: -5,
        _x: _x,
      }
    `);
  });

  it('should match x for x - a', () => {
    const result = match2(['Subtract', '_x', '_a'], '_x');
    expect(result).toMatchInlineSnapshot(`
      {
        _a: 0,
        _x: _x,
      }
    `);
  });

  it('should match -x for a - x', () => {
    const result = match2(['Subtract', '_a', '_x'], ['Negate', '_x']);
    expect(result).toMatchInlineSnapshot(`
      {
        _a: 0,
        _x: _x,
      }
    `);
  });

  it('should match x for ax', () => {
    const result = match2(['Multiply', '_a', '_x'], '_x');
    expect(result).toMatchInlineSnapshot(`
      {
        _a: 1,
        _x: _x,
      }
    `);
  });

  it('should match x/a for ax', () => {
    const result = match2(['Multiply', '_a', '_x'], ['Divide', '_x', '2']);
    expect(result).toMatchInlineSnapshot(`
      {
        _a: ["Rational", 1, 2],
        _x: _x,
      }
    `);
  });

  it('should match -x for ax', () => {
    const result = match2(['Multiply', '_a', '_x'], ['Negate', '_x']);
    expect(result).toMatchInlineSnapshot(`
      {
        _a: -1,
        _x: _x,
      }
    `);
  });

  it('should match x/a for x', () => {
    const result = match2(['Divide', '_x', '_a'], '_x');
    expect(result).toMatchInlineSnapshot(`
      {
        _a: 1,
        _x: _x,
      }
    `);
  });

  it('should match a sequence with multiple potential zeros', () => {
    const result = match(['Add', '_a', ['Multiply', '_a', '_b']], ce.One);
    expect(result).toMatchInlineSnapshot(`
      {
        _a: 1,
        _b: 0,
      }
    `);
  });

  it('should match a sequence with multiple potential zeros', () => {
    const result = match(['Add', '___b', ['Multiply', '_a', '_b']], ce.One);
    expect(result).toMatchInlineSnapshot(`
      {
        ___b: 1,
        _a: 1,
        _b: 0,
      }
    `);
  });
});

// GitHub Issue #258: BoxedExpression.match() with a Rational pattern
describe('RATIONAL PATTERN MATCHING', () => {
  it('should match Rational(3, 2) with Rational pattern', () => {
    // Rational with two integers becomes a BoxedNumber
    const result = match(['Rational', '_num', '_den'], ['Rational', 3, 2]);
    expect(result).toMatchInlineSnapshot(`
      {
        _den: 2,
        _num: 3,
      }
    `);
  });

  it('should match Rational(x, 2) with Rational pattern', () => {
    // Rational with symbolic numerator is canonicalized as Multiply(x, Rational(1, 2))
    const result = match(['Rational', '_num', '_den'], ['Rational', 'x', 2]);
    expect(result).toMatchInlineSnapshot(`
      {
        _den: 2,
        _num: x,
      }
    `);
  });

  it('should match Rational(x, 9) with Rational pattern', () => {
    // Rational(x, Power(3, 2)) is canonicalized as Multiply(x, Rational(1, 9))
    const result = match(
      ['Rational', '_num', '_den'],
      ['Rational', 'x', ['Power', 3, 2]]
    );
    expect(result).toMatchInlineSnapshot(`
      {
        _den: 9,
        _num: x,
      }
    `);
  });

  it('should match Rational(3, y) with Rational pattern', () => {
    // Rational with symbolic denominator becomes Divide(3, y)
    const result = match(['Rational', '_num', '_den'], ['Rational', 3, 'y']);
    expect(result).toMatchInlineSnapshot(`
      {
        _den: y,
        _num: 3,
      }
    `);
  });

  it('should match Rational(x, y) with Rational pattern', () => {
    // Rational with two symbols becomes Divide(x, y)
    const result = match(['Rational', '_num', '_den'], ['Rational', 'x', 'y']);
    expect(result).toMatchInlineSnapshot(`
      {
        _den: y,
        _num: x,
      }
    `);
  });

  it('should match Divide pattern against Multiply with reciprocal', () => {
    // x/2 is canonicalized as Multiply(Rational(1, 2), x)
    const result = match(['Divide', '_num', '_den'], ['Rational', 'x', 2]);
    expect(result).toMatchInlineSnapshot(`
      {
        _den: 2,
        _num: x,
      }
    `);
  });
});

// Power pattern matching with canonicalized forms
describe('POWER PATTERN MATCHING', () => {
  it('should match Power(x, -1) which becomes Divide(1, x)', () => {
    // Power(x, -1) is canonicalized to Divide(1, x)
    const result = match(['Power', '_base', '_exp'], ['Power', 'x', -1]);
    expect(result).toMatchInlineSnapshot(`
      {
        _base: x,
        _exp: -1,
      }
    `);
  });

  it('should match Root(x, 3) against Power pattern', () => {
    // Power(x, 1/3) is canonicalized to Root(x, 3)
    // Root(x, 3) should match Power pattern as Power(x, 1/3)
    const result = match(['Power', '_base', '_exp'], ['Root', 'x', 3]);
    expect(result).toMatchInlineSnapshot(`
      {
        _base: x,
        _exp: ["Divide", 1, 3],
      }
    `);
  });

  it('should match Power(x, -2) directly', () => {
    // Power(x, -2) stays as Power(x, -2)
    const result = match(['Power', '_base', '_exp'], ['Power', 'x', -2]);
    expect(result).toMatchInlineSnapshot(`
      {
        _base: x,
        _exp: -2,
      }
    `);
  });

  it('should match Sqrt(x) against Sqrt pattern', () => {
    // Sqrt stays as Sqrt
    const result = match(['Sqrt', '_x'], ['Sqrt', 'x']);
    expect(result).toMatchInlineSnapshot(`
      {
        _x: x,
      }
    `);
  });

  it('should match Power(x, 1/2) which becomes Sqrt(x)', () => {
    // Power(x, 1/2) is canonicalized to Sqrt(x)
    const result = match(['Sqrt', '_x'], ['Power', 'x', ['Rational', 1, 2]]);
    expect(result).toMatchInlineSnapshot(`
      {
        _x: x,
      }
    `);
  });
});

describe('PATTERN VALIDATION', () => {
  // Test validatePattern directly with non-canonical patterns
  // (canonical forms may reorder operands for commutative operators)
  const validate = (pattern: Expression) => {
    const boxedPattern = ce.box(pattern, { form: 'raw' });
    validatePattern(boxedPattern);
  };

  // INVALID: Consecutive multi-element wildcards (no delimiter to separate them)
  test('rejects consecutive sequence wildcards', () => {
    expect(() => validate(['Add', '__a', '__b'])).toThrow(
      /sequence wildcard.*cannot be followed by.*sequence wildcard/
    );
  });

  test('rejects optional sequence followed by sequence wildcard', () => {
    expect(() => validate(['Add', '___a', '__b'])).toThrow(
      /optional sequence wildcard.*cannot be followed by.*sequence wildcard/
    );
  });

  test('rejects sequence wildcard followed by optional sequence wildcard', () => {
    expect(() => validate(['Add', '__a', '___b'])).toThrow(
      /sequence wildcard.*cannot be followed by.*optional sequence wildcard/
    );
  });

  test('rejects consecutive optional sequence wildcards', () => {
    expect(() => validate(['Add', '___a', '___b'])).toThrow(
      /optional sequence wildcard.*cannot be followed by.*optional sequence wildcard/
    );
  });

  // VALID: Universal wildcard (_) provides an anchor point
  test('allows sequence wildcard followed by universal wildcard', () => {
    expect(() => validate(['Add', '__a', '_b'])).not.toThrow();
  });

  test('allows optional sequence followed by universal wildcard', () => {
    expect(() => validate(['Add', '___a', '_b'])).not.toThrow();
  });

  test('allows sequence wildcard followed by literal', () => {
    expect(() => validate(['Add', '__a', 1])).not.toThrow();
  });

  // VALID: Multi-element wildcards separated by non-wildcard elements
  test('allows optional sequences with delimiters between them', () => {
    expect(() =>
      validate(['Multiply', '___u', 'q', 'r', 's', '___v'])
    ).not.toThrow();
  });

  test('validates nested patterns', () => {
    expect(() => validate(['Add', 1, ['Multiply', '__a', '__b']])).toThrow(
      /sequence wildcard.*cannot be followed by.*sequence wildcard/
    );
  });

  test('allows valid patterns with multiple universal wildcards', () => {
    expect(() => validate(['Add', '_a', '_b'])).not.toThrow();
  });
});

describe('matchPermutations option', () => {
  // Helper to match with non-canonical expressions to test permutation behavior
  const matchNonCanonical = (
    pattern: Expression,
    expr: Expression,
    options?: PatternMatchOptions
  ) => {
    const boxedPattern = ce.box(pattern, { form: 'raw' });
    const boxedExpr = ce.box(expr, { form: 'raw' });
    return boxedExpr.match(boxedPattern, { useVariations: true, ...options });
  };

  test('default behavior tries permutations for commutative operators', () => {
    // Add is commutative, so pattern [Add, 1, _a] should match [Add, x, 1]
    // via permutation to find _a = x
    const result = matchNonCanonical(['Add', 1, '_a'], ['Add', 'x', 1]);
    expect(result).toMatchInlineSnapshot(`
      {
        _a: x,
      }
    `);
  });

  test('matchPermutations: true explicitly allows permutation matching', () => {
    const result = matchNonCanonical(['Add', 1, '_a'], ['Add', 'x', 1], {
      matchPermutations: true,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        _a: x,
      }
    `);
  });

  test('matchPermutations: false disables permutation matching', () => {
    // Without permutations, pattern [Add, 1, _a] won't match [Add, x, 1]
    // because position 0 is 1 in pattern but x in expression
    const result = matchNonCanonical(['Add', 1, '_a'], ['Add', 'x', 1], {
      matchPermutations: false,
    });
    expect(result).toBeNull();
  });

  test('matchPermutations: false still matches exact order', () => {
    // Even without permutations, exact order should match
    const result = matchNonCanonical(['Add', 1, '_a'], ['Add', 1, 'x'], {
      matchPermutations: false,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        _a: x,
      }
    `);
  });

  test('matchPermutations does not affect non-commutative operators', () => {
    // Subtract is not commutative, so permutations should never be tried
    // regardless of the option value
    const withPerms = matchNonCanonical(
      ['Subtract', 1, '_a'],
      ['Subtract', 1, 'x'],
      {
        matchPermutations: true,
      }
    );
    const withoutPerms = matchNonCanonical(
      ['Subtract', 1, '_a'],
      ['Subtract', 1, 'x'],
      {
        matchPermutations: false,
      }
    );
    expect(withPerms).toEqual(withoutPerms);
    expect(withPerms).toMatchInlineSnapshot(`
      {
        _a: x,
      }
    `);
  });
});

// ============================================================================
// Permutation Matching Optimization Tests (PERMS-72)
// ============================================================================

describe('Permutation Matching Optimization', () => {
  // Note: Tests with useVariations: false to test the guards without
  // the variations system adding implicit elements (e.g., +0)
  // Note: We use anchors like 1, 2, 3 instead of 0 because 0 gets
  // canonicalized away (it's the identity for addition)

  describe('Phase 1.1: Arity Guard', () => {
    test('rejects when no sequence wildcards and length mismatch', () => {
      // Pattern: 4 operands, Expression: 3 operands
      // Use 1 as anchor (not 0, which gets canonicalized away)
      const result = match(
        ['Add', '_a', '_b', '_c', 1],
        ['Add', 'x', 'y', 'z'],
        {
          useVariations: false,
        }
      );
      expect(result).toBeNull();
    });

    test('accepts when lengths match exactly without sequence wildcards', () => {
      const result = match(['Add', '_a', '_b', 1], ['Add', 'x', 'y', 1], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('_a');
      expect(result).toHaveProperty('_b');
    });

    test('accepts when sequence wildcards can absorb extra operands', () => {
      const result = match(['Add', '__a', 1], ['Add', 'x', 'y', 'z', 1], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
    });

    test('rejects when pattern needs more operands than available', () => {
      // Pattern: 3 anchors + 2 universal wildcards = needs 5
      // Expression: only 4 operands
      const result = match(
        ['Add', 1, 2, 3, '_a', '_b'],
        ['Add', 1, 2, 3, 'x'],
        { useVariations: false }
      );
      expect(result).toBeNull();
    });
  });

  describe('Phase 1.2: Anchor Fingerprint', () => {
    test('rejects when required anchor is missing', () => {
      // Pattern has anchor 5, expression does not contain 5
      const result = match(['Add', '_a', '_b', 5], ['Add', 'x', 'y', 'z'], {
        useVariations: false,
      });
      expect(result).toBeNull();
    });

    test('handles anchor multiplicity correctly - rejects when insufficient', () => {
      // Pattern has two 1s, expression has only one
      const result = match(['Add', 1, 1, '_a'], ['Add', 1, 'x', 'y'], {
        useVariations: false,
      });
      expect(result).toBeNull();
    });

    test('matches when all anchors present with correct multiplicity', () => {
      const result = match(['Add', 1, 1, '_a'], ['Add', 1, 1, 'x'], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('_a');
    });

    test('handles complex anchors (function expressions)', () => {
      // Anchor is ['Sqrt', 'x'], not a simple literal
      const result = match(
        ['Add', ['Sqrt', 'x'], '_a'],
        ['Add', 'y', ['Sqrt', 'x']],
        { useVariations: false }
      );
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('_a');
    });

    test('rejects when complex anchor not found', () => {
      const result = match(
        ['Add', ['Sqrt', 'x'], '_a'],
        ['Add', 'y', ['Sqrt', 'z']],
        { useVariations: false }
      );
      expect(result).toBeNull();
    });
  });

  describe('Phase 2: Universal Anchoring', () => {
    test('uses anchor-based matching for universal wildcards + anchors', () => {
      // This pattern previously would enumerate all permutations
      // Now it should use anchor-based matching
      const result = match(['Add', 1, '_a', '_b'], ['Add', 'x', 1, 'y'], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('_a');
      expect(result).toHaveProperty('_b');
    });

    test('handles multiple anchors with universal wildcards', () => {
      const result = match(['Add', 1, 2, '_a', '_b'], ['Add', 'x', 1, 2, 'y'], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
    });

    test('preserves repeat-wildcard semantics - matches same value', () => {
      // _a appears twice, must match same value
      const result = match(['Add', '_a', '_a', 1], ['Add', 'x', 'x', 1], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('_a');
    });

    test('preserves repeat-wildcard semantics - rejects different values', () => {
      const result = match(['Add', '_a', '_a', 1], ['Add', 'x', 'y', 1], {
        useVariations: false,
      });
      expect(result).toBeNull();
    });
  });

  describe('Edge cases', () => {
    test('all-wildcard pattern still works (no anchors)', () => {
      const result = match(['Add', '_a', '_b', '_c'], ['Add', 'x', 'y', 'z'], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
    });

    test('pattern with only sequence wildcards works', () => {
      const result = match(['Add', '__a'], ['Add', 'x', 'y', 'z'], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
    });

    test('symbol anchors work correctly', () => {
      // 'x' is a symbol anchor (not a wildcard)
      const result = match(['Add', 'x', '_a'], ['Add', 'x', 'y'], {
        useVariations: false,
      });
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('_a');
    });

    test('rejects when symbol anchor missing', () => {
      const result = match(['Add', 'x', '_a'], ['Add', 'y', 'z'], {
        useVariations: false,
      });
      expect(result).toBeNull();
    });
  });

  describe('Phase 3: Hash Bucketing', () => {
    // Hash bucketing activates for patterns with 4+ anchors and expressions with 6+ operands

    test('matches with many anchors using hash bucketing', () => {
      // Pattern: 4 anchors + 2 wildcards = 6 operands
      // Expression: 6 operands (triggers hash bucketing)
      const result = match(
        ['Add', 1, 2, 3, 4, '_a', '_b'],
        ['Add', 'x', 1, 2, 3, 4, 'y'],
        { useVariations: false }
      );
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('_a');
      expect(result).toHaveProperty('_b');
    });

    test('rejects when anchor missing with hash bucketing', () => {
      // Pattern has anchor 5, expression does not contain 5
      const result = match(
        ['Add', 1, 2, 3, 5, '_a', '_b'],
        ['Add', 'x', 1, 2, 3, 4, 'y'],
        { useVariations: false }
      );
      expect(result).toBeNull();
    });

    test('handles anchor multiplicity with hash bucketing', () => {
      // Pattern has two 1s, expression has two 1s - should match
      const result = match(
        ['Add', 1, 1, 2, 3, '_a', '_b'],
        ['Add', 'x', 1, 1, 2, 3, 'y'],
        { useVariations: false }
      );
      expect(result).not.toBeNull();
    });

    test('rejects insufficient multiplicity with hash bucketing', () => {
      // Pattern has two 1s, expression has only one 1
      const result = match(
        ['Add', 1, 1, 2, 3, '_a', '_b'],
        ['Add', 'x', 1, 4, 2, 3, 'y'],
        { useVariations: false }
      );
      expect(result).toBeNull();
    });

    test('handles hash collisions correctly', () => {
      // Different values may have same hash - must use isSame() to verify
      // Using symbols which might have hash collisions
      const result = match(
        ['Add', 'a', 'b', 'c', 'd', '_x', '_y'],
        ['Add', 'a', 'b', 'c', 'd', 'e', 'f'],
        { useVariations: false }
      );
      expect(result).not.toBeNull();
    });
  });
});

// ============================================================================
// REPEATED WILDCARDS IN NESTED CONTEXTS (TODO #3)
// ============================================================================

describe('Repeated Wildcards in Nested Contexts', () => {
  // Non-canonical matching helper
  const matchNonCanonical = (pattern, expr) => {
    const boxedPattern = ce.box(pattern, { form: 'raw' });
    const boxedExpr = ce.box(expr, { form: 'raw' });
    return boxedExpr.match(boxedPattern);
  };

  describe('Simple repeated wildcards (flat structure)', () => {
    test('_a appears twice - same value should match', () => {
      const result = matchNonCanonical(['Add', '_a', '_a'], ['Add', 'x', 'x']);
      expect(result).not.toBeNull();
      expect(result?._a?.toString()).toBe('x');
    });

    test('_a appears twice - different values should not match', () => {
      const result = matchNonCanonical(['Add', '_a', '_a'], ['Add', 'x', 'y']);
      expect(result).toBeNull();
    });
  });

  describe('Repeated wildcards in nested function arguments', () => {
    test('_x in direct arg and inside Ln - same value', () => {
      const result = matchNonCanonical(
        ['Multiply', '_x', ['Ln', '_x']],
        ['Multiply', 'x', ['Ln', 'x']]
      );
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });

    test('_x in direct arg and inside Ln - different values should not match', () => {
      const result = matchNonCanonical(
        ['Multiply', '_x', ['Ln', '_x']],
        ['Multiply', 'x', ['Ln', 'y']]
      );
      expect(result).toBeNull();
    });

    test('_x appears at 3 different nesting levels', () => {
      const result = matchNonCanonical(
        ['Add', '_x', ['Multiply', '_x', ['Power', '_x', 2]]],
        ['Add', 'x', ['Multiply', 'x', ['Power', 'x', 2]]]
      );
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });

    test('exp(x)*sin(x) with repeated _x', () => {
      const result = matchNonCanonical(
        ['Multiply', ['Exp', '_x'], ['Sin', '_x']],
        ['Multiply', ['Exp', 'x'], ['Sin', 'x']]
      );
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });
  });

  describe('Repeated wildcards with Divide patterns', () => {
    test('1/(x*ln(x)) pattern - the TODO #3 example', () => {
      const result = matchNonCanonical(
        ['Divide', 1, ['Multiply', '_x', ['Ln', '_x']]],
        ['Divide', 1, ['Multiply', 'x', ['Ln', 'x']]]
      );
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });

    test('1/(x*ln(x)) with different variables should not match', () => {
      const result = matchNonCanonical(
        ['Divide', 1, ['Multiply', '_x', ['Ln', '_x']]],
        ['Divide', 1, ['Multiply', 'x', ['Ln', 'y']]]
      );
      expect(result).toBeNull();
    });
  });

  describe('Repeated wildcards matching complex expressions', () => {
    test('_x should match the same complex expression everywhere', () => {
      const result = matchNonCanonical(
        ['Add', '_x', ['Power', '_x', 2]],
        ['Add', ['Add', 'a', 1], ['Power', ['Add', 'a', 1], 2]]
      );
      expect(result).not.toBeNull();
      // _x should match ['Add', 'a', 1]
    });

    test('_x matching complex expr - mismatch should fail', () => {
      const result = matchNonCanonical(
        ['Add', '_x', ['Power', '_x', 2]],
        ['Add', ['Add', 'a', 1], ['Power', ['Add', 'a', 2], 2]]
      );
      expect(result).toBeNull();
    });
  });

  describe('Repeated wildcards with commutative reordering', () => {
    test('_x + ln(_x) with Add being commutative', () => {
      const result = matchNonCanonical(
        ['Add', '_x', ['Ln', '_x']],
        ['Add', ['Ln', 'x'], 'x']
      );
      // Add is commutative, so this should match with _x = x
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });

    test('_x * sin(_x) with Multiply being commutative', () => {
      const result = matchNonCanonical(
        ['Multiply', '_x', ['Sin', '_x']],
        ['Multiply', ['Sin', 'x'], 'x']
      );
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });
  });

  describe('Repeated wildcards with CANONICAL expressions', () => {
    test('1/(x*ln(x)) with canonical expression', () => {
      // Pattern is non-canonical (structural)
      const pattern = ce.box(['Divide', 1, ['Multiply', '_x', ['Ln', '_x']]], {
        form: 'raw',
      });
      // Expression is canonical (what you get from parsing)
      const expr = ce.parse('\\frac{1}{x \\ln x}');

      const result = expr.match(pattern);
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });

    test('exp(x)*sin(x) canonical expression', () => {
      // e^x becomes Power(ExponentialE, x), which doesn't match Exp(_x)
      // So this pattern needs to account for the canonical form
      const pattern = ce.box(
        ['Multiply', ['Power', 'ExponentialE', '_x'], ['Sin', '_x']],
        { form: 'raw' }
      );
      const expr = ce.parse('e^x \\sin x');

      const result = expr.match(pattern);
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });

    test('Repeated wildcard fails when canonical order differs', () => {
      // Multiply may reorder operands, so [x, ln(x)] might become [ln(x), x]
      // The pattern matching should still work due to commutativity handling
      const pattern = ce.box(['Multiply', '_x', ['Ln', '_x']], {
        form: 'raw',
      });
      const expr = ce.parse('x \\ln x');

      const result = expr.match(pattern);
      expect(result).not.toBeNull();
      expect(result?._x?.toString()).toBe('x');
    });
  });
});
