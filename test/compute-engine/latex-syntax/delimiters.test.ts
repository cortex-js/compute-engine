import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce } from '../../utils';

describe('DELIMITERS', () => {
  test('Parentheses', () => {
    expect(ce.parse('(2+3)').json).toMatchInlineSnapshot(`5`);
    expect(ce.parse('(2+3, 4+5)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        5,
        9,
      ]
    `);
    expect(ce.parse('(2+3; 4+5)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        5,
        9,
      ]
    `);
    expect(ce.parse('1+(2+3)').json).toMatchInlineSnapshot(`6`);
    expect(ce.parse('1+((2+3))').json).toMatchInlineSnapshot(`6`);
    expect(ce.parse('4(2+3)').json).toMatchInlineSnapshot(`20`);
    expect(ce.parse('4((2+(3)))').json).toMatchInlineSnapshot(`20`);
  });

  test('Function application', () => {
    expect(ce.parse('f(x)').json).toMatchInlineSnapshot(`
      [
        f,
        x,
      ]
    `);
    expect(ce.parse('f(2)').json).toMatchInlineSnapshot(`
      [
        f,
        2,
      ]
    `);
    expect(ce.parse('f(2, 3)').json).toMatchInlineSnapshot(`
      [
        f,
        2,
        3,
      ]
    `);
  });

  test('Indexed access', () => {
    // NOTE (SYM P2-20): the union type string in the incompatible-type error is
    // now emitted in canonical (lexicographic) member order — `dictionary |
    // indexed_collection` rather than the former construction-order
    // `indexed_collection | dictionary`.
    expect(ce.parse('[2]').json).toMatchInlineSnapshot(`
      [
        List,
        2,
      ]
    `);
    expect(ce.parse('[2, 3]').json).toMatchInlineSnapshot(`
      [
        List,
        2,
        3,
      ]
    `);
    expect(ce.parse('[2; 3]').json).toMatchInlineSnapshot(`
      [
        List,
        [
          List,
          2,
        ],
        [
          List,
          3,
        ],
      ]
    `);
    expect(ce.parse('f[3]').json).toMatchInlineSnapshot(`
      [
        At,
        [
          Error,
          [
            ErrorCode,
            'incompatible-type',
            'dictionary | indexed_collection',
            'function',
          ],
        ],
        3,
      ]
    `);
    expect(ce.parse('f[3, 4]').json).toMatchInlineSnapshot(`
      [
        At,
        [
          Error,
          [
            ErrorCode,
            'incompatible-type',
            'dictionary | indexed_collection',
            'function',
          ],
        ],
        3,
        4,
      ]
    `);
    expect(ce.parse('v[3]').json).toMatchInlineSnapshot(`
      [
        At,
        v,
        3,
      ]
    `);
    expect(ce.parse('v[3, 4]').json).toMatchInlineSnapshot(`
      [
        At,
        v,
        3,
        4,
      ]
    `);
  });

  // A symbol followed by a `\left[...\right]` (or `\left\lbrack...\rbrack`)
  // fenced group must index identically to the plain-bracket `symbol[...]`
  // form. Previously the fenced group was silently dropped (e.g.
  // `A\left[1\right]` parsed to just `["A"]`), losing the index — which broke
  // every Desmos list-indexing row, since Desmos always emits `\left[...\right]`.
  test('Indexed access with \\left[...\\right] fences (parity with plain brackets)', () => {
    const raw = (s: string) => JSON.stringify(ce.parse(s, { canonical: false }).json);

    // Single index
    expect(raw('A\\left[1\\right]')).toEqual(raw('A[1]'));
    expect(raw('A\\left[1\\right]')).toEqual('["At","A",1]');
    expect(raw('A\\left\\lbrack1\\right\\rbrack')).toEqual(raw('A[1]'));

    // List-typed symbol, symbolic index (Desmos `L\left[k\right]`)
    expect(raw('L\\left[k\\right]')).toEqual(raw('L[k]'));
    expect(raw('L\\left[k\\right]')).toEqual('["At","L","k"]');

    // Multi-index
    expect(raw('L\\left[1,2\\right]')).toEqual(raw('L[1,2]'));
    expect(raw('L\\left[1,2\\right]')).toEqual('["At","L",1,2]');

    // Range index
    expect(raw('L\\left[1...5\\right]')).toEqual(raw('L[1...5]'));
    expect(raw('L\\left[1...5\\right]')).toEqual('["At","L",["Range",1,5]]');

    // `D` must index (not crash on the derivative operator path)
    expect(raw('D\\left[1\\right]')).toEqual('["At","D",1]');

    // A standalone `\left[...\right]` NOT preceded by a symbol stays a List
    expect(raw('\\left[1,2\\right]')).toEqual('["List",1,2]');
  });

  // A parenthesized group followed by a bracket indexes the group, matching
  // symbol/list-literal LHS behavior. The group reaches the postfix `[`
  // parser as a `Delimiter` (with `(` fences); only parentheses can present
  // a compound LHS to the bracket, so a bare `x+1[2]` is unaffected.
  // Corpus motivation: Desmos emits `\left(...tuple...\right)\left[range\right]`.
  test('Indexed access with a parenthesized-group LHS', () => {
    const raw = (s: string) =>
      JSON.stringify(ce.parse(s, { canonical: false }).json);

    // Tuple LHS, single/multi/symbolic/range index — plain and \left..\right,
    // plus the mixed fence forms Desmos and hand-authored LaTeX produce.
    expect(raw('(3,4)[1]')).toEqual(
      '["At",["Delimiter",["Sequence",3,4],"\'(,)\'"],1]'
    );
    expect(raw('\\left(1,2,3\\right)\\left[2\\right]')).toEqual(
      '["At",["Delimiter",["Sequence",1,2,3],"\'(,)\'"],2]'
    );
    expect(raw('\\left(a,b\\right)\\left[k\\right]')).toEqual(
      '["At",["Delimiter",["Sequence","a","b"],"\'(,)\'"],"k"]'
    );
    expect(raw('(a,b,c)[2]')).toEqual(
      '["At",["Delimiter",["Sequence","a","b","c"],"\'(,)\'"],2]'
    );
    // Mixed fences: plain `(...)` + `\left[...\right]`, and `\left(...\right)` + `[...]`
    expect(raw('(1,2,3)\\left[2\\right]')).toEqual(
      '["At",["Delimiter",["Sequence",1,2,3],"\'(,)\'"],2]'
    );
    expect(raw('\\left(1,2\\right)[2]')).toEqual(
      '["At",["Delimiter",["Sequence",1,2],"\'(,)\'"],2]'
    );
    // Corpus range index `\left(...\right)\left[r_{ange}\right]`
    expect(raw('\\left(1,2,3\\right)\\left[r_{ange}\\right]')).toEqual(
      '["At",["Delimiter",["Sequence",1,2,3],"\'(,)\'"],"r_ange"]'
    );

    // A non-tuple (scalar-valued) parenthesized group still parses to an
    // indexing `At`; the type layer decides whether the target is indexable.
    expect(raw('(x+1)[2]')).toEqual(
      '["At",["Delimiter",["Add","x",1]],2]'
    );
    expect(raw('(x+1)[1,2]')).toEqual(
      '["At",["Delimiter",["Add","x",1]],1,2]'
    );
    expect(raw('(x+1)[1...5]')).toEqual(
      '["At",["Delimiter",["Add","x",1]],["Range",1,5]]'
    );

    // A tuple LHS canonicalizes to `At(Tuple(...), index)`.
    expect(JSON.stringify(ce.parse('(3,4)[1]').json)).toEqual(
      '["At",["Tuple",3,4],1]'
    );
  });

  // Guard-rails: the parenthesized-group relaxation must NOT change how a
  // bracket binds to a non-`)`-closed LHS. A scalar or bare compound followed
  // by `[` remains an unexpected-operator error (never flips to indexing or
  // multiplication), and a declared function application is untouched.
  test('Bracket after non-group LHS is unchanged (no scalar[list] flip)', () => {
    const raw = (s: string) =>
      JSON.stringify(ce.parse(s, { canonical: false }).json);

    // Scalar LHS: still an unexpected `[`, not At and not Multiply.
    expect(raw('2[1,2]')).toEqual(
      '["Sequence",2,["Error","\'unexpected-operator\'",["LatexString","\'[\'"]]]'
    );
    // Bare (unparenthesized) compound: `[` binds to the last operand `1`,
    // which is a number → rejected → leftover unexpected `[`.
    expect(raw('x+1[2]')).toEqual(
      '["Sequence",["Add","x",1],["Error","\'unexpected-operator\'",["LatexString","\'[\'"]]]'
    );
    // Symbol LHS multi-index path is preserved.
    expect(raw('x[1,2]')).toEqual('["At","x",1,2]');
  });

  // A postfix bracket after a function-call LHS indexes the call result,
  // extending the symbol/paren-group indexing to `f(x)[i]`. All four fence
  // combinations, multi-index, and range forms mirror the symbol path.
  // Corpus motivation: Desmos emits `C_{ube}\left(u,v\right)\left[y\right]`
  // and `\operatorname{sphere}\left(...\right)\left[range\right]`.
  test('Indexed access with a function-application LHS', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('f', '(number) -> number');
    ce2.declare('F', '(number) -> number');
    const raw = (s: string) =>
      JSON.stringify(ce2.parse(s, { canonical: false }).json);

    // A declared function call, all four fence combinations.
    expect(raw('f(x)[1]')).toEqual('["At",["f","x"],1]');
    expect(raw('f\\left(x\\right)\\left[1\\right]')).toEqual(
      '["At",["f","x"],1]'
    );
    expect(raw('f(x)\\left[1\\right]')).toEqual('["At",["f","x"],1]');
    expect(raw('f\\left(x\\right)[1]')).toEqual('["At",["f","x"],1]');

    // Multi-index and range index, plain and \left..\right forms.
    expect(raw('F(x)[1,2]')).toEqual('["At",["F","x"],1,2]');
    expect(raw('F(x)\\left[1,2\\right]')).toEqual('["At",["F","x"],1,2]');
    expect(raw('F(x)[1...5]')).toEqual('["At",["F","x"],["Range",1,5]]');
    expect(raw('F(x)\\left[1...5\\right]')).toEqual(
      '["At",["F","x"],["Range",1,5]]'
    );

    // A built-in `\operatorname{...}` call (parses to a function head) indexes
    // identically, plain and fenced.
    expect(raw('\\operatorname{sphere}\\left(a,b\\right)\\left[1\\right]')).toEqual(
      '["At",["Sphere","a","b"],1]'
    );
    expect(raw('\\operatorname{sphere}(a,b)[1]')).toEqual(
      '["At",["Sphere","a","b"],1]'
    );

    // A trig-function application is likewise indexable (was an error before).
    expect(raw('\\sin(x)[1]')).toEqual('["At",["Sin","x"],1]');

    // Chained indexing stays unsupported, matching the symbol path `x[1][2]`:
    // the second bracket falls on an `At` LHS and is left unexpected.
    expect(raw('f(x)[1][2]')).toEqual(
      '["Sequence",["At",["f","x"],1],["Error","\'unexpected-operator\'",["LatexString","\'[\'"]]]'
    );

    // Guard-rail: an UNDECLARED juxtaposition (`g(x)`) is NOT a function
    // application — it parses to `InvisibleOperator` and the bracket binds to
    // the inner parenthesized group, unchanged by this relaxation.
    expect(raw('g(x)[1]')).toEqual(
      '["InvisibleOperator","g",["At",["Delimiter","x"],1]]'
    );
    expect(raw('g\\left(x\\right)\\left[1\\right]')).toEqual(
      '["InvisibleOperator","g",["At",["Delimiter","x"],1]]'
    );
  });
});

describe('Delimiter scale styles (REVIEW.md C1)', () => {
  // wrapString appended a stray `}` for the 'scaled' style and a stray `)`
  // for 'big', producing invalid LaTeX.
  test("'scaled' wraps with \\left…\\right and no trailing brace", () =>
    expect(
      ce.expr(['f', 'x', 'y']).toLatex({ applyFunctionStyle: () => 'scaled' })
    ).toEqual('f\\left(x, y\\right)'));

  test("'big' wraps with \\Bigl…\\Bigr and no trailing paren", () =>
    expect(
      ce.expr(['f', 'x', 'y']).toLatex({ applyFunctionStyle: () => 'big' })
    ).toEqual('f\\Bigl(x, y\\Bigr)'));
});
