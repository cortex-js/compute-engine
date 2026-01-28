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
          InvisibleOperator,
          P,
          [
            Delimiter,
            x,
          ],
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
