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
  });

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
  });

  it('should parse XOR', () => {
    expect(ce.parse('p \\oplus q').json).toMatchInlineSnapshot(`
      [
        Sequence,
        p,
        [
          Error,
          [
            ErrorCode,
            'unexpected-command',
            '\\oplus',
          ],
          [
            LatexString,
            '\\oplus',
          ],
        ],
      ]
    `);
  });

  it('should parse NAND', () => {
    expect(ce.parse('p \\uparrow q').json).toMatchInlineSnapshot(`
      [
        Sequence,
        p,
        [
          Error,
          [
            ErrorCode,
            'unexpected-command',
            '\\uparrow',
          ],
          [
            LatexString,
            '\\uparrow',
          ],
        ],
      ]
    `);
  });

  it('should parse NOR', () => {
    expect(ce.parse('p \\downarrow q').json).toMatchInlineSnapshot(`
      [
        Sequence,
        p,
        [
          Error,
          [
            ErrorCode,
            'unexpected-command',
            '\\downarrow',
          ],
          [
            LatexString,
            '\\downarrow',
          ],
        ],
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
        ForAll,
        x,
      ]
    `);
  });

  it('should parse Exists', () => {
    expect(ce.parse('\\exists x').json).toMatchInlineSnapshot(`
      [
        Exists,
        x,
      ]
    `);
  });

  it('should parse ExistsUnique', () => {
    expect(ce.parse('\\exists! x').json).toMatchInlineSnapshot(`
      [
        ExistsUnique,
        x,
      ]
    `);
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
