import type { MathJsonExpression } from '../../../src/math-json/types';
import { compile } from '../../../src/compute-engine/compilation/compile-expression';
import { engine as ce } from '../../utils';

// The restriction `e\{c\}` and the `where` clause. A restriction covers the
// whole of the smallest group that holds it (the statement, one comma item,
// the content of a delimiter or LaTeX argument, a big-operator body, one
// operand of a logical connective) and
// parses to `If(c, e)`; stacked restrictions in one group merge into
// `If(And(c_1, c_2, …), e)`. A `where` clause is one `Block` of
// `Declare(a, "unknown", v)` bindings, then the body, wrapped in `If(c, e)`
// by its conditions. The serializer writes `If(c, e)` and a binding `Block`
// as `e \text{ where } …`, and the text parses back to the same canonical
// expression. The rules are in `docs/plans/2026-11-02-restriction-binding.md`
// and `docs/plans/2026-11-02-where-binding.md`.
//
// Every LaTeX string is a stored row of Tycho's two Desmos corpora (the id is
// `corpus/document #cell`), as Tycho's importer writes it, from
// `~/dev/tycho/docs/scratch/2026-11-02-ce-31-rows.md`, or the `where` text
// that the importer writes for that row after this release, or the Desmos
// text of the row that the importer reads (said in the test).

function parseRaw(latex: string): MathJsonExpression {
  return ce.parse(latex, { canonical: false }).json as MathJsonExpression;
}

/** The serialized LaTeX of the non-canonical parse reads back as the same
 * canonical expression. */
function expectRoundTrip(latex: string): string {
  const text = ce.parse(latex, { canonical: false }).latex;
  expect(ce.parse(text).json).toEqual(ce.parse(latex).json);
  return text;
}

function op(expr: MathJsonExpression | undefined): string | undefined {
  return Array.isArray(expr) ? (expr[0] as string) : undefined;
}

describe('A RESTRICTION COVERS ITS GROUP', () => {
  const rows: [string, string, MathJsonExpression][] = [
    // neyret/6kalzeiedk #1752170633: y=x\{c\}
    ["neyret/6kalzeiedk #1752170633", "y=0\\left\\{x\\le0\\right\\}", ["If",["LessEqual","x",0],["Equal","y",0]]],
    // neyret/6kalzeiedk #1884363266: y=x\{c\}
    ["neyret/6kalzeiedk #1884363266", "r=1\\left\\{1=1\\right\\}", ["If",["Equal",1,1],["Equal","r",1]]],
    // neyret/nyhvir7uj2 #2130100824: x^2+y^2<9\{c\}
    ["neyret/nyhvir7uj2 #2130100824", "y\\le2\\left\\{y\\lt0.1\\right\\}", ["If",["Less","y",0.1],["LessEqual","y",2]]],
    // neyret/3mhkarzpoz #98034373: x^2+y^2<9\{c\}
    ["neyret/3mhkarzpoz #98034373", "0\\lt1\\left\\{x=x\\right\\}", ["If",["Equal","x","x"],["Less",0,1]]],
    // neyret/dzwvofwbnu #1012432278: a\le y\le b\{c\}
    ["neyret/dzwvofwbnu #1012432278", "0\\le x\\le1\\left\\{0\\le y\\le1\\right\\}", ["If",["LessEqual",0,"y",1],["LessEqual",0,"x",1]]],
    // neyret/fqgba393vi #1489758299: f(x)=x^2\{c\}+1
    ["neyret/fqgba393vi #1489758299", "P_1(y)=y-2\\left\\{-1\\le y\\le1\\right\\}", ["If",["LessEqual",["Negate",1],"y",1],["Equal",["InvisibleOperator","P_1",["Delimiter","y"]],["Subtract","y",2]]]],
    // neyret/5e1vuw9908 #721856020: f(x)=x^2\{c\}+1
    ["neyret/5e1vuw9908 #721856020", "H(x)=3x^2-2x^3\\left\\{0\\le x\\le1\\right\\}", ["If",["LessEqual",0,"x",1],["Equal",["H","x"],["Subtract",["InvisibleOperator",3,["Power","x",2]],["InvisibleOperator",2,["Power","x",3]]]]]],
    // neyret/bygw3kdipo #1694217309: F(x)\sim h\{c\}
    ["neyret/bygw3kdipo #1694217309", "F(99, x_{s})\\sim h\\left\\{x_{s}\\gt0\\right\\}", ["If",["Greater","x_s",0],["Tilde",["F",99,"x_s"],"h"]]],
    // neyret/s4h8jurofe #415761927: -a\{c\}
    ["neyret/s4h8jurofe #415761927", "y=-1\\left\\{2\\le x\\le4\\right\\}", ["If",["LessEqual",2,"x",4],["Equal","y",["Negate",1]]]],
    // neyret/t2unl2faxb #1844805248: a^{2\{c\}}
    ["neyret/t2unl2faxb #1844805248", "x^{3.1\\left\\{0\\le x\\le1\\right\\}}", ["Power","x",["If",["LessEqual",0,"x",1],3.1]]],
    // neyret/ts1xnav3zr #514387143: y=(z-0.03)b\{z>0.01\}
    ["neyret/ts1xnav3zr #514387143", "f_2(x)=2\\sin(x+\\sin(x))\\left\\{x\\lt\\pi\\right\\}", ["If",["Less","x","Pi"],["Equal",["InvisibleOperator","f_2",["Delimiter","x"]],["InvisibleOperator",2,["Sin",["Add","x",["Sin","x"]]]]]]],
    // neyret/srpgd2cnth #729996056: (1,2)\{c\}
    ["neyret/srpgd2cnth #729996056", "(f(x))\\left\\{x\\ge0\\right\\}", ["If",["GreaterEqual","x",0],["Delimiter",["f","x"]]]],
    // neyret/g91gh9zpcr #1917679740: (a\{c\}, b)
    ["neyret/g91gh9zpcr #1917679740", "\\operatorname{PointList}(t, (i(t,4))\\left\\{N\\ge1\\right\\})", ["PointList","t",["If",["GreaterEqual","N",1],["Delimiter",["InvisibleOperator","i",["Delimiter",["Sequence","t",4],"'(,)'"]]]]]],
    // neyret/9jlo0hocyt #2119608620: a\{c_1\}\{c_2\}
    ["neyret/9jlo0hocyt #2119608620", "xx\\left\\{0\\le x\\right\\}\\left\\{x\\lt1\\right\\}", ["If",["And",["LessEqual",0,"x"],["Less","x",1]],["InvisibleOperator","x","x"]]],
    // neyret/9jlo0hocyt #721856020: a\{c_1\}\{c_2\}
    ["neyret/9jlo0hocyt #721856020", "x^{2.2}\\left\\{0\\le x\\right\\}\\left\\{x\\lt1\\right\\}", ["If",["And",["LessEqual",0,"x"],["Less","x",1]],["Power","x",2.2]]],
    // neyret/akconkhexx #721856020: a restriction in each operand of `\lor`
    // in a condition. Each operand of a connective is a group of its own, so
    // each restriction covers its own relation.
    ["neyret/akconkhexx #721856020", "\\vert y+3\\vert\\le0.2\\left\\{x\\gt0\\left\\{x\\lt1\\right\\}\\lor x\\gt2\\left\\{x\\lt3\\right\\}\\right\\}", ["If",["Or",["If",["Less","x",1],["Greater","x",0]],["If",["Less","x",3],["Greater","x",2]]],["LessEqual",["Abs",["Add","y",3]],0.2]]],
    // neyret/91lvyfqcdd #1941579277: Or condition
    ["neyret/91lvyfqcdd #1941579277", "\\sin(x)-1\\left\\{\\sin(lx)\\gt0\\lor\\sin(4lx)\\gt0.9\\right\\}", ["If",["Or",["Greater",["Sin",["InvisibleOperator","l","x"]],0],["Greater",["Sin",["InvisibleOperator",4,"l","x"]],0.9]],["Subtract",["Sin","x"],1]]],
  ];

  test.each(rows)('%s', (_id, latex, expected) => {
    expect(parseRaw(latex)).toEqual(expected);
    expectRoundTrip(latex);
  });

  // neyret/akconkhexx #721856020: the condition holds for 0 < x < 1 and for
  // 2 < x < 3. Where it holds, the value is the relation.
  test('a restriction in each operand of a connective covers that operand', () => {
    const expr = ce.parse(
      '\\vert y+3\\vert\\le0.2\\left\\{x\\gt0\\left\\{x\\lt1\\right\\}\\lor x\\gt2\\left\\{x\\lt3\\right\\}\\right\\}'
    );
    const at = (x: number, y: number) =>
      expr.subs({ x, y }).evaluate().symbol;
    expect(at(0.5, -3)).toBe('True');
    expect(at(2.5, -3)).toBe('True');
    expect(at(2.5, 0)).toBe('False');
  });

  // `x>0\{x<1\}\lor x>2\{x<3\}`: a restriction binds tighter than a
  // connective and looser than a relation.
  test('each operand of a connective is a group', () => {
    expect(parseRaw('x>0\\{x<1\\}\\lor x>2\\{x<3\\}')).toEqual([
      'Or',
      ['If', ['Less', 'x', 1], ['Greater', 'x', 0]],
      ['If', ['Less', 'x', 3], ['Greater', 'x', 2]],
    ]);
    expect(parseRaw('x>0\\{x<1\\}\\land y>0')).toEqual([
      'And',
      ['If', ['Less', 'x', 1], ['Greater', 'x', 0]],
      ['Greater', 'y', 0],
    ]);
  });

  // An assignment is not a group boundary: the restriction is in the value.
  test('a restriction in the value of an assignment', () => {
    expect(parseRaw('a\\coloneq1\\{c>0\\}')).toEqual([
      'Assign',
      'a',
      ['If', ['Greater', 'c', 0], 1],
    ]);
  });

  // neyret/p0kazir1l9 #390608818: `[a\{c\}, b]`, each list element is a group
  test('a restriction in a list element covers that element', () => {
    const latex =
      '\\bigl\\lbrack(V_1(x))\\left\\{x\\le x_1\\right\\}, (V_2(x))\\left\\{x\\le x_2\\right\\}, (V_3(x))\\left\\{x\\le x_3\\right\\}, (V_4(x))\\left\\{x\\le x_4\\right\\}\\bigr\\rbrack';
    const expr = parseRaw(latex) as MathJsonExpression[];
    expect(op(expr)).toBe('List');
    expect(expr.slice(1).map((x) => op(x))).toEqual(['If', 'If', 'If', 'If']);
    expect((expr[1] as MathJsonExpression[])[1]).toEqual([
      'LessEqual',
      'x',
      'x_1',
    ]);
    expectRoundTrip(latex);
  });

  // desmos/2ki2hjsouf #1987475963: `(1,2)\{c\}`, a point restricted whole
  test('a restriction after a point covers the point', () => {
    const latex =
      '\\operatorname{PointList}(Fu, Fv, -4)\\left\\{\\vert\\sin(36\\,000u+36\\,666v+54\\,321v)\\vert\\lt0.1\\right\\}';
    const expr = parseRaw(latex) as MathJsonExpression[];
    expect(op(expr)).toBe('If');
    expect(op(expr[1])).toBe('Less');
    expect(op(expr[2])).toBe('PointList');
    expect(expectRoundTrip(latex)).toMatch(/\\text\{ where \}/);
  });

  // neyret/rqodxkrv9h #1275762319 and neyret/pvzphgx1eo #849288893: a
  // big-operator body is a group, so the definition is not restricted.
  test.each([
    [
      'neyret/rqodxkrv9h #1275762319',
      'y(f)=\\sum_{n=1}^{N}\\sin(2\\pi fa\\frac{n}{N}+b)\\left\\{-\\frac{N}{2}\\le f\\le\\frac{N}{2}\\right\\}',
      'Sum',
    ],
    [
      'neyret/pvzphgx1eo #849288893',
      'v(T)=\\prod_{i=0}^{n-1}(T_{s}(T,i,x_{o},\\min(x_0, x_1),\\frac{x_1-x_0}{n}))\\left\\{0\\lt T\\lt1\\right\\}',
      'Product',
    ],
  ])('%s: the restriction covers the body', (_id, latex, bigop) => {
    const expr = parseRaw(latex) as MathJsonExpression[];
    expect(op(expr)).toBe('Equal');
    const big = expr[2] as MathJsonExpression[];
    expect(op(big)).toBe(bigop);
    expect(op(big[1])).toBe('If');
    // In the parentheses of the clause, the serializer writes the fraction
    // `\frac{n}{N}` of the `Sum` row inline (`2\pi fan/N`), which reads back
    // as `(2\pi fan)/N`: the same value, another tree. The `Product` row
    // reads back as the same canonical expression.
    if (bigop === 'Product') expectRoundTrip(latex);
    else
      expect(ce.parse(latex, { canonical: false }).latex).toMatch(
        /\\left\(\\sin.*\\text\{ where \}/
      );
  });

  // neyret/dzwvofwbnu #1208070338: `\{c_1: a, b\}\{c_2\}`, a piecewise with
  // two branches restricted whole
  test('a restriction after a piecewise covers it', () => {
    const latex =
      '\\begin{cases}-0.3-2(x+0.475)&x+0.475\\lt0\\\\-0.3+2(x+0.475)&x+0.475\\gt0\\end{cases}\\left\\{\\vert x+0.475\\vert\\lt0.05\\right\\}';
    const expr = parseRaw(latex) as MathJsonExpression[];
    expect(op(expr)).toBe('If');
    expect(op(expr[1])).toBe('Less');
    expect(op(expr[2])).toBe('Which');
    expectRoundTrip(latex);
  });

  // The right side of a `Colon` is a group: a restriction in a piecewise
  // branch stays in that branch, and the brace still parses as a piecewise.
  // No corpus row writes a restriction inside a brace branch; the LaTeX is
  // the plausible form of the spec.
  test.each<[string, MathJsonExpression]>([
    [
      '\\left\\{x>0:\\sqrt{x}\\left\\{x<4\\right\\},0\\right\\}',
      [
        'Which',
        ['Greater', 'x', 0],
        ['If', ['Less', 'x', 4], ['Sqrt', 'x']],
        'True',
        0,
      ],
    ],
    [
      '\\left\\{x>0:\\sqrt{x}\\left\\{x<4\\right\\}\\right\\}',
      ['Which', ['Greater', 'x', 0], ['If', ['Less', 'x', 4], ['Sqrt', 'x']]],
    ],
    [
      '\\left\\{x>0:\\sqrt{x}\\right\\}\\left\\{x<4\\right\\}',
      ['If', ['And', ['Greater', 'x', 0], ['Less', 'x', 4]], ['Sqrt', 'x']],
    ],
    [
      '\\left\\{x>0:\\sqrt{x},0\\right\\}\\left\\{x<4\\right\\}',
      [
        'If',
        ['Less', 'x', 4],
        ['Which', ['Greater', 'x', 0], ['Sqrt', 'x'], 'True', 0],
      ],
    ],
  ])('a restriction in or after a piecewise brace: %s', (latex, expected) => {
    expect(parseRaw(latex)).toEqual(expected);
    expectRoundTrip(latex);
  });

  // desmos/cy55etqze6 #442562838: four stacked restrictions merge in
  // written order
  test('four stacked restrictions merge in written order', () => {
    const latex =
      '\\vert x+1\\vert\\le1\\left\\{2.5\\vert y\\vert\\le1\\right\\}\\left\\{\\vert z\\vert\\le1\\right\\}\\left\\{z\\lt6(x+1.7)+\\frac{zz}{2}\\right\\}\\left\\{a=1\\right\\}';
    const expr = parseRaw(latex) as MathJsonExpression[];
    expect(op(expr)).toBe('If');
    const conditions = expr[1] as MathJsonExpression[];
    expect(op(conditions)).toBe('And');
    expect(conditions.slice(1).map((x) => op(x))).toEqual([
      'LessEqual',
      'LessEqual',
      'Less',
      'Equal',
    ]);
    expect(conditions[4]).toEqual(['Equal', 'a', 1]);
    expect(op(expr[2])).toBe('LessEqual');
    expectRoundTrip(latex);
  });

  // desmos/hejpzl6eku #1489758299: four stacked restrictions inside the
  // argument of `\sin`, whose group is that argument
  test('stacked restrictions in a function argument cover the argument', () => {
    const latex =
      'z=\\sin(yz^{-1.7}\\left\\{z\\lt\\vert y\\vert+0.05\\right\\}\\left\\{z\\lt0.15\\right\\}\\left\\{z\\lt-0.7^{\\vert y\\vert}+1.023\\,4\\right\\}\\left\\{(y+0.38)^2+(z-0.2)^2\\gt0.06^2\\right\\})';
    const expr = parseRaw(latex) as MathJsonExpression[];
    expect(op(expr)).toBe('Equal');
    const sin = expr[2] as MathJsonExpression[];
    expect(op(sin)).toBe('Sin');
    const restricted = sin[1] as MathJsonExpression[];
    expect(op(restricted)).toBe('If');
    expect(op(restricted[1])).toBe('And');
    expect((restricted[1] as MathJsonExpression[]).length).toBe(5);
    expectRoundTrip(latex);
  });

  // neyret/siutvrzegl #1116885475: a list condition keeps its meaning
  test('a list condition covers the statement', () => {
    const latex =
      '1\\gt0\\left\\{x^2+y^2\\le(0.1..0.3..1)^2\\right\\}';
    const expr = parseRaw(latex) as MathJsonExpression[];
    expect(op(expr)).toBe('If');
    expect(op(expr[1])).toBe('LessEqual');
    expect(expr[2]).toEqual(['Greater', 1, 0]);
    expectRoundTrip(latex);
  });

  // desmos/6l8vae4zkn #2130100824: a restriction inside a condition covers
  // the whole relation of that condition
  test('a restriction inside a condition covers that condition', () => {
    const latex =
      '\\sqrt{(x+y)^2+(y+z)^2+(x-z)^2}\\le0.54\\left\\{x\\lt y-z+2.2\\left\\{x^2+y^2+z^2\\gt1\\left\\{x\\gt0\\left\\{T\\le\\frac{R-(R^2-4g)^{1/2}}{2g}\\right\\}\\right\\}\\right\\}\\right\\}';
    const expr = parseRaw(latex) as MathJsonExpression[];
    expect(op(expr)).toBe('If');
    const inner = expr[1] as MathJsonExpression[];
    expect(op(inner)).toBe('If');
    expect(op(inner[2])).toBe('Less');
    expectRoundTrip(latex);
  });
});

describe('THE WHERE CLAUSE', () => {
  // desmos/hyvhlz4chj #457454687: a Desmos `with` row. The importer stores
  // it as a `;` block today and writes the `where` text after this release.
  // Both give the same `Block`, written back as `where`.
  test('a binding of a value row', () => {
    const stored =
      'a\\coloneq R_{ec}(x+y,z); c_{lavinga}=\\operatorname{hsv}(12+10a, 0.87+\\frac{a}{5}, 0.8-0.4a)';
    const where =
      'c_{lavinga}=\\operatorname{hsv}(12+10a, 0.87+\\frac{a}{5}, 0.8-0.4a) \\text{ where } a\\coloneq R_{ec}(x+y,z)';
    const expr = parseRaw(where) as MathJsonExpression[];
    expect(op(expr)).toBe('Block');
    expect(expr.length).toBe(3);
    expect((expr[1] as MathJsonExpression[]).slice(0, 3)).toEqual([
      'Declare',
      'a',
      "'unknown'",
    ]);
    expect(op(expr[2])).toBe('Equal');
    expect(parseRaw(stored)).toEqual(expr);
    expect(expectRoundTrip(stored)).toMatchInlineSnapshot(
      `c_{lavinga}=\\operatorname{hsv}(12+10a, 0.87+\\frac{a}{5}, 0.8-0.4a)\\text{ where }a\\coloneq R_{ec}(x+y,z)`
    );
  });

  // desmos/hyvhlz4chj #1055895557: two bindings, in written order
  test('two bindings in written order', () => {
    const where =
      'R_{ec}(x,y)=f_{Bm}(x+\\frac{o_1\\vert o_1\\vert}{s_{c1}},y+\\frac{o_2\\vert o_2\\vert}{s_{c1}}) \\text{ where } o_1\\coloneq f_{Bm}(\\frac{x}{s_{c2}},\\frac{y}{s_{c2}}), o_2\\coloneq f_{Bm}(\\frac{y}{s_{c2}},\\frac{x}{s_{c2}})';
    const expr = parseRaw(where) as MathJsonExpression[];
    expect(op(expr)).toBe('Block');
    expect(expr.slice(1, 3).map((s) => (s as MathJsonExpression[])[1])).toEqual(
      ['o_1', 'o_2']
    );
    expectRoundTrip(where);
  });

  // desmos/wccrhnzn2q #124302086: a clause inside a delimiter covers the
  // content of the delimiter only
  test('a clause inside a delimiter', () => {
    const stored = '(z\\coloneq z+Z; d)\\lt1';
    const where = '(d \\text{ where } z\\coloneq z+Z)\\lt1';
    const expected: MathJsonExpression = [
      'Less',
      ['Delimiter', ['Block', ['Declare', 'z', "'unknown'", ['Add', 'z', 'Z']], 'd']],
      1,
    ];
    expect(parseRaw(where)).toEqual(expected);
    expect(parseRaw(stored)).toEqual(expected);
    expect(expectRoundTrip(stored)).toMatchInlineSnapshot(
      `(d\\text{ where }z\\coloneq z+Z)\\lt1`
    );
  });

  // desmos/hyvhlz4chj #1842462318: several bindings inside a sum body
  test('several bindings inside a sum body', () => {
    const stored =
      'f_{Bm}(x,y)=\\sum_{n=0}^{N}(a\\coloneq2^{n}; i\\coloneq x\\cos(2\\pi p_{rand}(\\operatorname{PointList}(n+s_{eed}, n, n)))-y\\sin(2\\pi p_{rand}(\\operatorname{PointList}(n+s_{eed}, n, n))); j\\coloneq x\\sin(2\\pi p_{rand}(\\operatorname{PointList}(n+s_{eed}, n, n)))+y\\cos(2\\pi p_{rand}(\\operatorname{PointList}(n+s_{eed}, n, n))); \\frac{c_2(ai,aj)}{a})';
    const expr = parseRaw(stored) as MathJsonExpression[];
    const sum = expr[2] as MathJsonExpression[];
    expect(op(sum)).toBe('Sum');
    const block = (sum[1] as MathJsonExpression[])[1] as MathJsonExpression[];
    expect(op(block)).toBe('Block');
    expect(block.slice(1, 4).map((s) => (s as MathJsonExpression[])[1])).toEqual(
      ['a', 'i', 'j']
    );
    expect(expectRoundTrip(stored)).toMatch(/\\text\{ where \}a\\coloneq/);
  });

  // desmos/khpocp8io0 #223711: a clause in the body of a comprehension; the
  // binding reads the index `n` of the `for`
  test('a clause in the body of a comprehension', () => {
    const stored =
      'W_{eight4H}=\\left[\\left(d\\coloneq\\left[\\begin{cases}\\sum P_{iecepos}[(n+m-(C_{heckvalidH}(n,4))[1])..(n+m-(C_{heckvalidH}(n,4))[1]+4)]&P_{iecepos}[n]=0\\end{cases} \\operatorname{for} m = 0..(\\sum C_{heckvalidH}(n,4))\\right]; R_{atioP}^7\\begin{cases}R_{atioP}\\mathrm{Length}(d[d=4])+\\mathrm{Length}(d[d=-4])&A_{Iturn}=1\\\\R_{atioP}\\mathrm{Length}(d[d=-4])+\\mathrm{Length}(d[d=4])&\\top\\end{cases}\\right) \\operatorname{for} n = 1..225\\right]';
    const expr = parseRaw(stored) as MathJsonExpression[];
    const comprehension = expr[2] as MathJsonExpression[];
    expect(op(comprehension)).toBe('Comprehension');
    const block = (comprehension[1] as MathJsonExpression[])[1];
    expect(op(block)).toBe('Block');
    expect(op((block as MathJsonExpression[])[1])).toBe('Declare');
    expectRoundTrip(stored);
  });

  // Graph Paper's help page (`src/graph-paper/locales/tips-and-tricks.en.md`
  // in Tycho) writes a bound as a `where` condition.
  test.each([
    [
      '(\\sin(t), \\cos(t)) \\text{ where } 0 \\le t \\le \\pi',
      [
        'If',
        ['LessEqual', 0, 't', 'Pi'],
        ['Delimiter', ['Sequence', ['Sin', 't'], ['Cos', 't']], "'(,)'"],
      ],
    ],
    [
      '\\tan(x) \\text{ where } -1 \\le x \\le 1',
      ['If', ['LessEqual', ['Negate', 1], 'x', 1], ['Tan', 'x']],
    ],
  ] as [string, MathJsonExpression][])('a condition: %s', (latex, expected) => {
    expect(parseRaw(latex)).toEqual(expected);
    expectRoundTrip(latex);
  });

  // A `where` item is a group: a restriction in a binding value stays in the
  // value, with `=` as with `\coloneq`, and does not move outside the Block.
  test.each(['=', '\\coloneq'])(
    'a restriction in a binding value written with %s',
    (relation) => {
      expect(
        parseRaw(`e \\text{ where } a ${relation} v\\left\\{x>0\\right\\}`)
      ).toEqual([
        'Block',
        ['Declare', 'a', "'unknown'", ['If', ['Greater', 'x', 0], 'v']],
        'e',
      ]);
    }
  );

  // The binding form of desmos/hyvhlz4chj #1842462318 (`a \coloneq 2^n`):
  // the interpreter and compiled code give the same value.
  test('a binding evaluates and compiles', () => {
    const expr = ce.parse('a+1 \\text{ where } a\\coloneq 2^{n}');
    expect(expr.json).toEqual([
      'Block',
      ['Declare', 'a', "'unknown'", ['Power', 2, 'n']],
      ['Add', 'a', 1],
    ]);
    expect(expr.subs({ n: 3 }).evaluate().re).toBe(9);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run!({ n: 3 })).toBe(9);
  });
});

// The term `\mathrm{Length}(d[d=4])` of desmos/khpocp8io0 #223711 with a
// constant list as the binding of `d`. The type of a `where` binding comes
// from its value, so `d` is a list, `d[d=4]` selects from it, and compiled
// code gives the interpreter's value.
test('a where binding has the type of its value when compiled', () => {
  const expr = ce.parse(
    '\\operatorname{Length}(d[d=4]) \\text{ where } d\\coloneq[1,4,4]'
  );
  expect(expr.evaluate().re).toBe(2);
  const compiled = compile(expr);
  expect(compiled.success).toBe(true);
  expect(compiled.run!({})).toBe(2);
});

describe('STORED ROWS READ BACK', () => {
  // Each stored row parses, serializes and parses back to the same canonical
  // expression.
  const rows: [string, string][] = [
    // neyret/akconkhexx #721856020: a `where` condition that is a
    // disjunction of two restricted relations.
    ["neyret/akconkhexx #721856020", "\\vert y+3\\vert\\le0.2\\keyword{where}\\left(x\\gt0\\keyword{where}x\\lt1\\right)\\lor\\left(x\\gt2\\keyword{where}x\\lt3\\right)"],
    // neyret/xhlkk7k9aq #532413756: a restricted value in a piecewise arm.
    ["neyret/xhlkk7k9aq #532413756", "1=c_2\\begin{cases}\\left(1\\keyword{where}\\sin(50\\arctan(y-\\mathrm{PointY}(C), x-\\mathrm{PointX}(C)))\\gt0\\right)&c_1\\lt1\\\\1&\\top\\end{cases}"],
    // neyret/5qn5kcrszu #415761927: a restriction by `M_{ode}=0` on the
    // second component of a point. The condition `a = v` with a symbol on
    // the left would read as a binding after `where`, so the serializer
    // writes the function form `\mathrm{If}(…)`.
    ["neyret/5qn5kcrszu #415761927", "\\operatorname{PointList}(X(P, t)+0.5-(t\\bmod1)V_{x}(P,t), \\mathrm{If}(M_{ode}=0, Y(P, t)+0.5-(t\\bmod1)V_{y}(P,t)))"],
  ];

  test.each(rows)('%s', (_id, latex) => {
    expectRoundTrip(latex);
  });

  // neyret/xhlkk7k9aq #1752170633: a restricted condition in a piecewise
  // arm. `90\frac{x}{\sin(k)}` is written back `(90x)/\sin(k)`, which
  // parses to another canonical form of the same value (also before the
  // restriction change), so the test compares the second round trip: its
  // text is the same as the first, and the conditions keep their `If`.
  test('neyret/xhlkk7k9aq #1752170633', () => {
    const latex =
      "0.7=c_3\\begin{cases}\\left(1\\keyword{where}\\sin(90\\frac{x}{\\sin(k)})\\gt0\\right)&\\left(0\\lt\\left(1\\keyword{where}c_1\\lt1\\right)\\keyword{where}c_2\\lt1\\right)\\\\\\left(1\\keyword{where}\\sin(40\\frac{x}{\\sin(k)})\\gt0\\right)&0\\lt\\begin{cases}1&c_1\\lt1\\\\1&c_2\\lt1\\\\\\operatorname{NaN}&\\top\\end{cases}\\\\1&\\top\\end{cases}";
    const text = ce.parse(latex).latex;
    const again = ce.parse(text);
    expect(again.latex).toBe(text);
    expect(ce.parse(again.latex).json).toEqual(again.json);
    const product = (again.json as MathJsonExpression[])[2] as MathJsonExpression[];
    expect(op(product)).toBe('Multiply');
    const arms = product[2] as MathJsonExpression[];
    expect(op(arms)).toBe('Which');
    expect(arms[1]).toEqual([
      'If',
      ['Less', 'c_2', 1],
      ['Less', 0, ['If', ['Less', 'c_1', 1], 1]],
    ]);
  });

  // The Desmos text of neyret/akconkhexx #721856020, which the importer
  // reads. Each item of the comma group in the braces is a relation under
  // its own restriction, and the group is their union.
  test('a comma group of restricted conditions is a union', () => {
    expect(
      parseRaw(
        '\\left|y+3\\right|\\le.2\\ \\ \\left\\{x>0\\left\\{\\ x<1\\right\\},x>2\\left\\{\\ x<3\\right\\}\\right\\}'
      )
    ).toEqual([
      'If',
      [
        'Or',
        ['If', ['Less', 'x', 1], ['Greater', 'x', 0]],
        ['If', ['Less', 'x', 3], ['Greater', 'x', 2]],
      ],
      ['LessEqual', ['Abs', ['Add', 'y', 3]], 0.2],
    ]);
  });

  // The Desmos text of neyret/xhlkk7k9aq #1752170633, which the importer
  // reads. The restriction `\{c_2<1\}` in the condition of the first arm
  // covers that condition, and the braces are still a piecewise.
  test('a restriction in the condition of a piecewise arm covers the condition', () => {
    const expr = parseRaw(
      '.7=c_{3}\\ \\left\\{0<\\left\\{c_{1}<1\\right\\}\\left\\{c_{2}<1\\right\\}:\\left\\{\\sin\\left(90\\frac{x}{\\sin\\left(k\\right)}\\right)>0\\right\\}\\ ,0<\\left\\{c_{1}<1,c_{2}<1\\right\\}:\\left\\{\\sin\\left(40\\frac{x}{\\sin\\left(k\\right)}\\right)>0\\right\\},1\\right\\}'
    ) as MathJsonExpression[];
    expect(op(expr)).toBe('Equal');
    const product = expr[2] as MathJsonExpression[];
    expect(op(product)).toBe('Multiply');
    const which = product[2] as MathJsonExpression[];
    expect(op(which)).toBe('Which');
    expect(which[1]).toEqual([
      'If',
      ['Less', 'c_2', 1],
      ['Less', 0, ['If', ['Less', 'c_1', 1], 1]],
    ]);
    expect(parseRaw('\\left\\{x>0\\left\\{c<1\\right\\}:5,1\\right\\}')).toEqual([
      'Which',
      ['If', ['Less', 'c', 1], ['Greater', 'x', 0]],
      5,
      'True',
      1,
    ]);
  });
});
