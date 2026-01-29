import { engine as ce } from '../../utils';

describe('Logic', () => {
  it('should parse True and False', () => {
    expect(ce.parse('\\top').json).toMatchInlineSnapshot(`True`);
    expect(ce.parse('\\bot').json).toMatchInlineSnapshot(`False`);
    expect(ce.parse('\\mathrm{True}').json).toMatchInlineSnapshot(`True`);
    expect(ce.parse('\\operatorname{False}').json).toMatchInlineSnapshot(
      `False`
    );
    expect(ce.parse('\\mathsf{T}').json).toMatchInlineSnapshot(`True`);
    expect(ce.parse('\\mathsf{F}').json).toMatchInlineSnapshot(`False`);
  });

  it('should parse Not', () => {
    expect(ce.parse('\\neg p').json).toMatchInlineSnapshot(`
      [
        Not,
        p,
      ]
    `);
    expect(ce.parse('\\lnot p').json).toMatchInlineSnapshot(`
      [
        Not,
        p,
      ]
    `);
    expect(ce.parse('\\operatorname{not} p').json).toMatchInlineSnapshot(`
      [
        Tuple,
        Not,
        p,
      ]
    `);
  });
  it('should parse And', () => {
    expect(ce.parse('p \\land q').json).toMatchInlineSnapshot(`
      [
        And,
        p,
        q,
      ]
    `);
    expect(ce.parse('p \\wedge q').json).toMatchInlineSnapshot(`
      [
        And,
        p,
        q,
      ]
    `);
    expect(ce.parse('p \\& q').json).toMatchInlineSnapshot(`
      [
        And,
        p,
        q,
      ]
    `);
    expect(ce.parse('p \\operatorname{and} q').json).toMatchInlineSnapshot(`
      [
        And,
        p,
        q,
      ]
    `);
  });

  it('should parse Or', () => {
    expect(ce.parse('p \\lor q').json).toMatchInlineSnapshot(`
      [
        Or,
        p,
        q,
      ]
    `);
  });

  // https://github.com/cortex-js/compute-engine/issues/156
  it('should parse logical operators with correct precedence (issue #156)', () => {
    // Logical operators should have lower precedence than relational operators
    // so expressions like `3=4\vee 7=8` parse as `(3=4) \vee (7=8)`
    expect(ce.parse('3=4\\vee 7=8').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Equal,
          3,
          4,
        ],
        [
          Equal,
          7,
          8,
        ],
      ]
    `);

    // Set relations with logical And
    expect(ce.parse('A\\subseteq B\\wedge\\emptyset\\subset B').json)
      .toMatchInlineSnapshot(`
      [
        And,
        [
          SubsetEqual,
          A,
          B,
        ],
        [
          Subset,
          EmptySet,
          B,
        ],
      ]
    `);
  });

  // https://github.com/cortex-js/compute-engine/issues/243
  it('should parse Or with comparisons correctly (issue #243)', () => {
    // Comparisons should bind tighter than logic operators
    expect(ce.parse('x = 1 \\vee x = 2').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Equal,
          x,
          1,
        ],
        [
          Equal,
          x,
          2,
        ],
      ]
    `);

    expect(ce.parse('x = 1 \\lor y = 2').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Equal,
          x,
          1,
        ],
        [
          Equal,
          y,
          2,
        ],
      ]
    `);

    expect(ce.parse('a < 1 \\land b > 2').json).toMatchInlineSnapshot(`
      [
        And,
        [
          Less,
          a,
          1,
        ],
        [
          Less,
          2,
          b,
        ],
      ]
    `);
  });

  it('should parse complex nested logic expressions', () => {
    // AND binds tighter than OR: a = b ∧ c = d ∨ g = f → ((a = b) ∧ (c = d)) ∨ (g = f)
    // Note: using 'g' instead of 'e' since 'e' is parsed as ExponentialE
    expect(ce.parse('a = b \\land c = d \\lor g = f').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          And,
          [
            Equal,
            a,
            b,
          ],
          [
            Equal,
            c,
            d,
          ],
        ],
        [
          Equal,
          g,
          f,
        ],
      ]
    `);

    // OR binds tighter than implies: a ∨ b → c parses as (a ∨ b) → c
    expect(ce.parse('a \\lor b \\implies c').json).toMatchInlineSnapshot(`
      [
        Implies,
        [
          Or,
          a,
          b,
        ],
        c,
      ]
    `);

    // Chained implications are right-associative: a → b → c parses as a → (b → c)
    expect(ce.parse('a \\implies b \\implies c').json).toMatchInlineSnapshot(`
      [
        Implies,
        a,
        [
          Implies,
          b,
          c,
        ],
      ]
    `);

    // Comparison with implication: x < 1 → y > 2
    expect(ce.parse('x < 1 \\implies y > 2').json).toMatchInlineSnapshot(`
      [
        Implies,
        [
          Less,
          x,
          1,
        ],
        [
          Less,
          2,
          y,
        ],
      ]
    `);
  });

  it('should parse Not with comparisons and logic operators', () => {
    // \lnot has high precedence (880), so it only applies to the next symbol
    // \lnot x = 1 \lor y = 2 parses as ((\lnot x) = 1) \lor (y = 2)
    expect(ce.parse('\\lnot x = 1 \\lor y = 2').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Equal,
          y,
          2,
        ],
        [
          Equal,
          [
            Not,
            x,
          ],
          1,
        ],
      ]
    `);

    // To negate a comparison, use parentheses: \lnot(x = 1)
    expect(ce.parse('\\lnot(x = 1) \\lor y = 2').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Not,
          [
            Equal,
            x,
            1,
          ],
        ],
        [
          Equal,
          y,
          2,
        ],
      ]
    `);

    // Double negation is simplified during canonicalization
    expect(ce.parse('\\lnot \\lnot p').json).toMatchInlineSnapshot(`p`);

    // Not with And (using parentheses)
    expect(ce.parse('\\lnot (a \\land b)').json).toMatchInlineSnapshot(`
      [
        Not,
        [
          And,
          a,
          b,
        ],
      ]
    `);
  });

  it('should parse equivalence with logic operators', () => {
    // Equivalence binds looser than Or
    expect(ce.parse('a \\lor b \\iff c \\lor d').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        [
          Or,
          a,
          b,
        ],
        [
          Or,
          c,
          d,
        ],
      ]
    `);

    // Equivalence with And
    expect(ce.parse('a \\land b \\iff c \\land d').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        [
          And,
          a,
          b,
        ],
        [
          And,
          c,
          d,
        ],
      ]
    `);
  });

  it('should parse mixed comparisons and logic', () => {
    // Multiple comparisons with multiple logic operators
    expect(ce.parse('x = 1 \\land y = 2 \\land z = 3').json).toMatchInlineSnapshot(`
      [
        And,
        [
          Equal,
          x,
          1,
        ],
        [
          Equal,
          y,
          2,
        ],
        [
          Equal,
          z,
          3,
        ],
      ]
    `);

    // Inequality chain with Or
    expect(ce.parse('x < 0 \\lor x > 10').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Less,
          x,
          0,
        ],
        [
          Less,
          10,
          x,
        ],
      ]
    `);

    // Complex: (a ≤ b) ∧ (b ≤ c) → (a ≤ c)
    expect(ce.parse('a \\leq b \\land b \\leq c \\implies a \\leq c').json).toMatchInlineSnapshot(`
      [
        Implies,
        [
          And,
          [
            LessEqual,
            a,
            b,
          ],
          [
            LessEqual,
            b,
            c,
          ],
        ],
        [
          LessEqual,
          a,
          c,
        ],
      ]
    `);
  });

  it('should parse Implies', () => {
    expect(ce.parse('p \\Rightarrow q').json).toMatchInlineSnapshot(`
      [
        Implies,
        p,
        q,
      ]
    `);
    expect(ce.parse('p \\implies q').json).toMatchInlineSnapshot(`
      [
        Implies,
        p,
        q,
      ]
    `);
    expect(ce.parse('p \\operatorname{implies} q').json).toMatchInlineSnapshot(`
      [
        Tuple,
        p,
        implies,
        q,
      ]
    `);
  }); // @fixme

  it('should parse Equivalent', () => {
    expect(ce.parse('p \\Leftrightarrow q').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        p,
        q,
      ]
    `);
    expect(ce.parse('p \\iff q').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        p,
        q,
      ]
    `);
    expect(ce.parse('p \\operatorname{iff} q').json).toMatchInlineSnapshot(`
      [
        Tuple,
        p,
        iff,
        q,
      ]
    `);
  }); // @fixme

  it('should parse XOR', () => {
    expect(ce.parse('p \\oplus q').json).toMatchInlineSnapshot(`
      [
        Tuple,
        p,
        [
          Error,
          'unexpected-command',
          [
            LatexString,
            '\\oplus',
          ],
        ],
        q,
      ]
    `);
  });

  it('should parse NAND', () => {
    expect(ce.parse('p \\uparrow q').json).toMatchInlineSnapshot(`
      [
        Tuple,
        p,
        [
          Error,
          'unexpected-command',
          [
            LatexString,
            '\\uparrow',
          ],
        ],
        q,
      ]
    `);
  });

  it('should parse NOR', () => {
    expect(ce.parse('p \\downarrow q').json).toMatchInlineSnapshot(`
      [
        Tuple,
        p,
        [
          Error,
          'unexpected-command',
          [
            LatexString,
            '\\downarrow',
          ],
        ],
        q,
      ]
    `);
  });

  it('should parse XNOR', () => {
    expect(ce.parse('p \\iff q').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        p,
        q,
      ]
    `);
  });

  it('should parse ForAll', () => {
    expect(ce.parse('\\forall x').json).toMatchInlineSnapshot(`
      [
        Tuple,
        [
          Error,
          'unexpected-command',
          [
            LatexString,
            '\\forall',
          ],
        ],
        x,
      ]
    `);
  });

  it('should parse Exists', () => {
    expect(ce.parse('\\exists x').json).toMatchInlineSnapshot(`
      [
        Tuple,
        [
          Error,
          'unexpected-command',
          [
            LatexString,
            '\\exists',
          ],
        ],
        x,
      ]
    `);
  });

  it('should parse ExistsUnique', () => {
    expect(ce.parse('\\exists! x').json).toMatchInlineSnapshot(`
      [
        Sequence,
        [
          Error,
          'unexpected-command',
          [
            LatexString,
            '\\exists',
          ],
        ],
        [
          Factorial,
          [
            Error,
            missing,
            [
              LatexString,
              '!',
            ],
          ],
        ],
      ]
    `);
  });

  // Complete quantified expressions with body
  it('should parse ForAll with comma separator', () => {
    expect(ce.parse('\\forall x, x>0').json).toMatchInlineSnapshot(`
      [
        ForAll,
        x,
        [
          Greater,
          x,
          0,
        ],
      ]
    `);
  });

  it('should parse ForAll with various separators', () => {
    // With \mid separator
    expect(ce.parse('\\forall x \\mid x>0').json).toMatchInlineSnapshot(`
      [
        ForAll,
        x,
        [
          Greater,
          x,
          0,
        ],
      ]
    `);
    // With dot separator
    expect(ce.parse('\\forall x. x>0').json).toMatchInlineSnapshot(`
      [
        ForAll,
        x,
        [
          Greater,
          x,
          0,
        ],
      ]
    `);
    // With colon separator
    expect(ce.parse('\\forall x: x>0').json).toMatchInlineSnapshot(`
      [
        ForAll,
        x,
        [
          Greater,
          x,
          0,
        ],
      ]
    `);
    // With parentheses
    expect(ce.parse('\\forall x (x>0)').json).toMatchInlineSnapshot(`
      [
        ForAll,
        x,
        [
          Delimiter,
          [
            Greater,
            x,
            0,
          ],
        ],
      ]
    `);
  });

  // Note: P(x) is automatically inferred as a predicate inside quantifier scopes
  // because P is a single uppercase letter followed by parentheses
  it('should parse ForAll with set membership', () => {
    expect(ce.parse('\\forall x \\in S, P(x)').json).toMatchInlineSnapshot(`
      [
        ForAll,
        [
          Element,
          x,
          S,
        ],
        [
          Predicate,
          P,
          x,
        ],
      ]
    `);
  });

  it('should parse Exists with body', () => {
    expect(ce.parse('\\exists x, x>0').json).toMatchInlineSnapshot(`
      [
        Exists,
        x,
        [
          Greater,
          x,
          0,
        ],
      ]
    `);
  });

  it('should parse ExistsUnique with body', () => {
    expect(ce.parse('\\exists! x, x=0').json).toMatchInlineSnapshot(`
      [
        ExistsUnique,
        x,
        [
          Equal,
          x,
          0,
        ],
      ]
    `);
  });

  it('should parse NotForAll with body', () => {
    expect(ce.parse('\\lnot\\forall x, x>0').json).toMatchInlineSnapshot(`
      [
        NotForAll,
        x,
        [
          Greater,
          x,
          0,
        ],
      ]
    `);
  });

  it('should parse NotExists with body', () => {
    expect(ce.parse('\\lnot\\exists x, x>0').json).toMatchInlineSnapshot(`
      [
        NotExists,
        x,
        [
          Greater,
          x,
          0,
        ],
      ]
    `);
  });

  // Serialization tests
  it('should serialize ForAll', () => {
    expect(ce.box(['ForAll', 'x', ['Greater', 'x', 0]]).latex).toBe(
      '\\forall x, x\\gt0'
    );
  });

  it('should serialize Exists', () => {
    expect(ce.box(['Exists', 'x', ['Greater', 'x', 0]]).latex).toBe(
      '\\exists x, x\\gt0'
    );
  });

  it('should serialize ExistsUnique', () => {
    expect(ce.box(['ExistsUnique', 'x', ['Equal', 'x', 0]]).latex).toBe(
      '\\exists! x, x=0'
    );
  });

  it('should serialize NotForAll', () => {
    expect(ce.box(['NotForAll', 'x', ['Greater', 'x', 0]]).latex).toBe(
      '\\lnot\\forall x, x\\gt0'
    );
  });

  it('should serialize NotExists', () => {
    expect(ce.box(['NotExists', 'x', ['Greater', 'x', 0]]).latex).toBe(
      '\\lnot\\exists x, x\\gt0'
    );
  });

  // Round-trip tests
  it('should round-trip ForAll expressions', () => {
    const expr1 = ce.parse('\\forall x, x>y');
    const expr2 = ce.parse(expr1.latex);
    expect(expr2.json).toEqual(expr1.json);
  });

  it('should round-trip Exists expressions', () => {
    const expr1 = ce.parse('\\exists x, x>0');
    const expr2 = ce.parse(expr1.latex);
    expect(expr2.json).toEqual(expr1.json);
  });

  it('should round-trip ExistsUnique expressions', () => {
    const expr1 = ce.parse('\\exists! n, n=0');
    const expr2 = ce.parse(expr1.latex);
    expect(expr2.json).toEqual(expr1.json);
  });

  // Round-trip tests for logic operators with comparisons
  it('should round-trip logic expressions with comparisons', () => {
    const tests = [
      'x=1\\lor x=2',
      'x=1\\land y=2',
      'a\\lt1\\lor b\\gt2',
      'p\\implies q',
      'p\\iff q',
      'a\\land b\\lor c',
    ];

    for (const latex of tests) {
      const expr1 = ce.parse(latex);
      const expr2 = ce.parse(expr1.latex);
      expect(expr2.json).toEqual(expr1.json);
    }
  });
});

describe('Kronecker Delta', () => {
  it('should parse with a single symbol', () => {
    expect(ce.parse('\\delta_{n}').json).toMatchInlineSnapshot(`
      [
        KroneckerDelta,
        n,
      ]
    `);
    expect(ce.parse('\\delta_n').json).toMatchInlineSnapshot(`
      [
        KroneckerDelta,
        n,
      ]
    `);
    expect(ce.parse('\\delta_\\alpha').json).toMatchInlineSnapshot(`
      [
        KroneckerDelta,
        alpha,
      ]
    `);
  });

  it('should parse with two symbols', () => {
    expect(ce.parse('\\delta_{nm}').json).toMatchInlineSnapshot(`
      [
        KroneckerDelta,
        n,
        m,
      ]
    `);
    expect(ce.parse('\\delta_{n, m}').json).toMatchInlineSnapshot(`
      [
        KroneckerDelta,
        n,
        m,
      ]
    `);
  });
});

describe('Iverson Bracket', () => {
  it('should parse with brackets', () => {
    expect(ce.parse('[a = b]').json).toMatchInlineSnapshot(`
      [
        Boole,
        [
          Equal,
          a,
          b,
        ],
      ]
    `);
    expect(ce.parse('\\left\\lbrack a < b \\right\\rbrack').json)
      .toMatchInlineSnapshot(`
      [
        Boole,
        [
          Less,
          a,
          b,
        ],
      ]
    `);
  });

  // Also \llbracket (U+27E6)...\rrbracket (U+27E7)
  it('should parse with double brackets', () => {
    expect(ce.parse('\\llbracket a=b\\rrbracket').json).toMatchInlineSnapshot(`
      [
        Boole,
        [
          Equal,
          a,
          b,
        ],
      ]
    `);
  });
});

describe('Predicate', () => {
  // Serialization tests
  it('should serialize Predicate with one argument', () => {
    expect(ce.box(['Predicate', 'P', 'x']).latex).toBe('P(x)');
  });

  it('should serialize Predicate with multiple arguments', () => {
    expect(ce.box(['Predicate', 'Q', 'a', 'b']).latex).toBe('Q(a, b)');
    expect(ce.box(['Predicate', 'R', 'x', 'y', 'z']).latex).toBe('R(x, y, z)');
  });

  // Round-trip tests: parse -> serialize -> parse should give same result
  it('should round-trip predicates inside ForAll', () => {
    const expr1 = ce.parse('\\forall x, P(x)');
    // Verify it contains Predicate
    expect(expr1.json).toMatchInlineSnapshot(`
      [
        ForAll,
        x,
        [
          Predicate,
          P,
          x,
        ],
      ]
    `);
    // Serialize and re-parse
    const latex = expr1.latex;
    const expr2 = ce.parse(latex);
    expect(expr2.json).toEqual(expr1.json);
  });

  it('should round-trip predicates inside Exists', () => {
    const expr1 = ce.parse('\\exists x, Q(x, y)');
    expect(expr1.json).toMatchInlineSnapshot(`
      [
        Exists,
        x,
        [
          Predicate,
          Q,
          x,
          y,
        ],
      ]
    `);
    const expr2 = ce.parse(expr1.latex);
    expect(expr2.json).toEqual(expr1.json);
  });

  it('should round-trip nested quantifiers with predicates', () => {
    const expr1 = ce.parse('\\forall x, \\exists y, R(x, y)');
    expect(expr1.json).toMatchInlineSnapshot(`
      [
        ForAll,
        x,
        [
          Exists,
          y,
          [
            Predicate,
            R,
            x,
            y,
          ],
        ],
      ]
    `);
    const expr2 = ce.parse(expr1.latex);
    expect(expr2.json).toEqual(expr1.json);
  });

  // Type inference tests
  it('should infer boolean type for Predicate', () => {
    const pred = ce.box(['Predicate', 'P', 'x']);
    expect(pred.type.toString()).toBe('boolean');
  });

  it('should allow Predicate in boolean contexts', () => {
    // Predicate should work as argument to And, Or, Not, etc.
    const expr1 = ce.box(['And', ['Predicate', 'P', 'x'], ['Predicate', 'Q', 'x']]);
    expect(expr1.type.toString()).toBe('boolean');

    const expr2 = ce.box(['Not', ['Predicate', 'P', 'x']]);
    expect(expr2.type.toString()).toBe('boolean');

    const expr3 = ce.box(['Implies', ['Predicate', 'P', 'x'], ['Predicate', 'Q', 'x']]);
    expect(expr3.type.toString()).toBe('boolean');
  });

  // D(f, x) should parse as Predicate, not derivative
  it('should parse D(f, x) as Predicate, not derivative', () => {
    // Outside quantifier scope - D is special-cased to always be Predicate
    expect(ce.parse('D(f, x)').json).toMatchInlineSnapshot(`
      [
        Predicate,
        D,
        f,
        x,
      ]
    `);

    // Inside quantifier scope
    expect(ce.parse('\\forall x, D(x)').json).toMatchInlineSnapshot(`
      [
        ForAll,
        x,
        [
          Predicate,
          D,
          x,
        ],
      ]
    `);
  });

  // Predicates outside quantifier scope should be regular function applications
  it('should parse predicates outside quantifier scope as function applications', () => {
    // P(x) outside quantifier scope is a regular function application
    expect(ce.parse('P(x)').json).toMatchInlineSnapshot(`
      [
        P,
        x,
      ]
    `);
    expect(ce.parse('Q(a, b)').json).toMatchInlineSnapshot(`
      [
        Q,
        a,
        b,
      ]
    `);
  });
});

describe('Single-letter library functions', () => {
  // N is a library function for numeric evaluation, but N(x) in LaTeX
  // is not standard math notation. Like D, N is excluded from automatic
  // function recognition so it can be used as a variable.
  it('should parse N(x) as Predicate, not as numeric function', () => {
    // N(x) should NOT be parsed as the numeric evaluation function
    // Instead, it's parsed as a Predicate (like D)
    const expr = ce.parse('N(\\pi)');
    expect(expr.json).toMatchInlineSnapshot(`
      [
        Predicate,
        N,
        Pi,
      ]
    `);
  });

  it('should allow N function via MathJSON', () => {
    // N function can be constructed directly in MathJSON
    const expr = ce.box(['N', 'Pi']);
    expect(expr.operator).toBe('N');
    expect(expr.op1?.symbol).toBe('Pi');

    // Direct .N() on Pi gives numeric value (preferred way to get numeric values)
    const piNumeric = ce.box('Pi').N();
    expect(piNumeric.numericValue).not.toBeNull();
  });

  // e and i are constants, not functions
  it('should parse e as Euler constant', () => {
    expect(ce.parse('e').json).toMatchInlineSnapshot(`ExponentialE`);
  });

  it('should parse i as imaginary unit', () => {
    // i is canonicalized to Complex representation
    expect(ce.parse('i').json).toMatchInlineSnapshot(`
      [
        Complex,
        0,
        1,
      ]
    `);
  });
});
