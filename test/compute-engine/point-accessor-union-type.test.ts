import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * The result type of a coordinate accessor (`PointX`/`PointY`/`PointZ`) over a
 * point-or-point-list UNION operand.
 *
 * A coordinate accessor yields a scalar from a single point and a list of
 * coordinates from a list of points. So over the union `list<tuple<…>> |
 * tuple<…>` — the "point or a list of points" type a document helper returns —
 * its result is the precise `number | list<number>`. It previously widened all
 * the way to `collection<number>` (the abstract collection top), because the
 * type handler mapped the union through `mapResultType`, which collapses a
 * union to a plain collection. That top is not provably array-shaped, so the
 * JavaScript compile target failed closed over any arithmetic on the
 * coordinate; the precise union compiles through `_SYS.bcast`.
 *
 * Audit witness: `neyret/wgxnrn87sx`, a hue built as `360·PointX(P) + 0.5`
 * with `P` a point list.
 */

describe('coordinate accessor over a point-or-point-list union', () => {
  const UNION = 'list<tuple<number, number>> | tuple<number, number>';

  test('PointX/PointY yield the precise number | list<number>, not collection<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('P', UNION);
    expect(ce.box(['PointX', 'P']).type.toString()).toBe(
      'list<number> | missing | number'
    );
    expect(ce.box(['PointY', 'P']).type.toString()).toBe(
      'list<number> | missing | number'
    );
  });

  test('a single point and a point list keep their precise coordinate types', () => {
    const ce = new ComputeEngine();
    ce.declare('single', 'tuple<number, number>');
    ce.declare('many', 'list<tuple<number, number>>');
    expect(ce.box(['PointX', 'single']).type.toString()).toBe('number');
    expect(ce.box(['PointX', 'many']).type.toString()).toBe('list<number>');
  });

  test('arithmetic on the coordinate compiles and matches the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('P', UNION);
    // A color-channel shape: 360·PointX(P) + 0.5.
    const chan = ce.box(['Add', ['Multiply', 360, ['PointX', 'P']], 0.5]);
    const r = compile(chan, { fallback: false });
    expect(r.success).toBe(true);
    // A single point → a scalar; a list of points → a list of coordinates.
    expect(r.run!({ P: [0.5, 9] })).toBe(180.5);
    expect(
      r.run!({
        P: [
          [0.5, 9],
          [0.25, 4],
        ],
      })
    ).toEqual([180.5, 90.5]);
  });

  test('a non-numeric point-list coordinate keeps its honest type, not list<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<tuple<string, number>> | tuple<number, number>');
    // The x-coordinate of the list arm is a string; it must not be reported as
    // `list<number>`, or a numeric consumer would compile against strings.
    expect(ce.box(['PointX', 'P']).type.toString()).toBe(
      'list<string> | missing | number'
    );
  });

  test('a keyed dictionary/record arm is not treated as a point list', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'P',
      'dictionary<tuple<number, number>> | tuple<number, number>'
    );
    // A dictionary is keyed, not an ordered point list; its synthesized
    // `tuple<string, V>` element must not read as a point. The union does not
    // distribute — it falls back to the safe `unknown` rather than fabricating
    // a confident `number | list<number>` that would admit a numeric consumer.
    expect(ce.box(['PointX', 'P']).type.toString()).toBe('unknown');
  });

  test('PointZ over an all-3D-point union distributes; over a 2D/3D mix it declines', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'P3',
      'list<tuple<number, number, number>> | tuple<number, number, number>'
    );
    expect(ce.box(['PointZ', 'P3']).type.toString()).toBe(
      'list<number> | missing | number'
    );
    // A 2-point arm has no z-coordinate, so the union cannot distribute a z:
    // it falls back to the collapsed collection type and fails closed.
    ce.declare(
      'Pmix',
      'list<tuple<number, number, number>> | tuple<number, number>'
    );
    expect(ce.box(['PointZ', 'Pmix']).type.toString()).toBe(
      'collection<number>'
    );
  });

  // An arm whose element type is `number | tuple` — a collection that is
  // either one point written flat or a list of points, the parameter union
  // Tycho declares for a helper read through `.x`/`.y` — distributes too.
  // The accessor decides by the first element (`pointComponentAt`): a list
  // of points broadcasts to the coordinate list, and a list of numbers is
  // one point written flat, whose coordinate is the element at this
  // position — a number. The run-time helper `_SYS.pointComponent` reads a
  // JavaScript array the same way, so both readings compile. (An earlier
  // version of this test pinned the collapsed `collection<number>` and a
  // compile decline for this union; the corpus witness `neyret/hpr2q4kles`
  // declined every `Power`, `Abs` and `Sqrt` over such a coordinate.)
  test('a union carrying a `number | tuple` collection arm distributes as well', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'P',
      'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>'
    );
    // The element-indexing reading answers the element at the position,
    // whatever its arm, so the point arm of the element type joins too.
    expect(ce.box(['PointX', 'P']).type.toString()).toBe(
      'list<number> | missing | number | tuple<number, number>'
    );
    const chan = ce.box(['Add', ['Multiply', 360, ['PointX', 'P']], 0.5]);
    const r = compile(chan, { fallback: false });
    expect(r.success).toBe(true);
    // One point written flat, and a list of points.
    expect(r.run!({ P: [0.5, 9] })).toBe(180.5);
    expect(
      r.run!({
        P: [
          [0.5, 9],
          [0.25, 4],
        ],
      })
    ).toEqual([180.5, 90.5]);
    // Power, Abs and Sqrt over the coordinate compile as well.
    for (const head of ['Abs', 'Sqrt'])
      expect(
        compile(ce.box([head, ['PointX', 'P']]), { fallback: false }).run!({
          P: [4, 9],
        })
      ).toBe(head === 'Abs' ? 4 : 2);
    expect(
      compile(ce.box(['Power', ['PointX', 'P'], 2]), { fallback: false }).run!({
        P: [
          [3, 1],
          [4, 1],
        ],
      })
    ).toEqual([9, 16]);
  });

  test('a mixed list under that union answers as the interpreter does', () => {
    // The first element decides: a point first broadcasts, and a later
    // number has no coordinate (the interpreter's absence marker, `NaN` on
    // this target); a number first element-indexes.
    const ce = new ComputeEngine();
    ce.declare(
      'P',
      'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>'
    );
    expect(
      ce.box(['PointX', ['List', ['Tuple', 1, 2], 5]]).evaluate().json
    ).toEqual(['List', 1, 'Missing']);
    expect(
      ce.box(['PointX', ['List', 5, ['Tuple', 1, 2]]]).evaluate().json
    ).toBe(5);
    const r = compile(ce.box(['PointX', 'P']), { fallback: false });
    expect(r.run!({ P: [[1, 2], 5] })).toEqual([1, NaN]);
    expect(r.run!({ P: [5, [1, 2]] })).toBe(5);
    // A number-first list element-indexes: `PointY` answers the element at
    // position 2 whole, a point here, and the type says so — including a
    // heterogeneous point arm, which a numeric consumer must not be told is
    // a number.
    expect(
      ce.box(['PointY', ['List', 5, ['Tuple', 1, 2]]]).evaluate().json
    ).toEqual(['Tuple', 1, 2]);
    ce.declare(
      'H',
      'indexed_collection<number | tuple<string, number>> | tuple<number, number>'
    );
    expect(ce.box(['PointY', 'H']).type.toString()).toBe(
      'list<number> | missing | number | tuple<string, number>'
    );
  });
});

describe('coordinate of a written-out point keeps the type of that component', () => {
  // The `elttype` handler of a tuple answers the widening of EVERY component;
  // a coordinate accessor over a tuple TYPE reads the component at its own
  // position instead. Over `(1, sqrt(1 - e^2))` the first coordinate is an
  // integer; the widening admitted a complex value because the second
  // coordinate may be one, and a division by the first coordinate then
  // lowered on the complex lane against a coordinate emitted as the plain
  // number `1` — `NaN` at run time (corpus witness `neyret/hpr2q4kles`).
  test('PointX/PointY over a literal tuple type as their own component', () => {
    const ce = new ComputeEngine();
    ce.declare('e', 'number');
    const point = ce.parse('(1, \\sqrt{1-e^2})');
    expect(point.type.toString()).toBe('tuple<integer, number>');
    // The accessor's result carries the absence marker of a numeric coordinate.
    expect(ce.box(['PointX', point]).type.toString()).toBe('integer | nan');
    expect(ce.box(['PointY', point]).type.toString()).toBe('number');
    // A symbol declared `tuple<number, number>` reads its declared
    // component type.
    ce.declare('T', 'tuple<number, number>');
    ce.assign('T', ce.box(['Tuple', 1, 2]));
    expect(ce.box(['PointX', 'T']).type.toString()).toBe('number');
  });

  test('a division by the real coordinate compiles on the real lane and matches the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('A', 'function');
    ce.assign(
      'A',
      ce.parse('e_0 \\mapsto \\left(1,\\sqrt{1-e_{0}^{2}}\\right)')
    );
    ce.declare('f', '(unknown) -> number');
    ce.assign(
      'f',
      ce.parse(
        'e \\mapsto \\frac{x}{\\mathrm{PointX}\\left(A\\left(e\\right)\\right)}'
      )
    );
    const r = compile(ce.box(['f', 0.206]), { fallback: false });
    expect(r.run!({ x: 1.2 })).toBe(1.2);
    expect(String(r.preamble)).not.toContain('.re');
  });
});

describe('juxtaposition with a union-typed operand', () => {
  // `2 · PointX(P)` over a point-or-point-list helper: the coordinate types
  // `number | list<number>`, a number or a list of numbers, and juxtaposition
  // is scaling in both cases — not a silent pair. A union with an arm that
  // is not value-like (`string | number`) still groups as a `Tuple`.
  test('a number beside a `number | list<number>` operand multiplies', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'number | list<number>');
    ce.declare('R', 'list<tuple<number, number>> | tuple<number, number>');
    ce.declare('S', 'string | number');
    expect(ce.parse('2M').json).toEqual(['Multiply', 2, 'M']);
    expect(ce.parse('2\\mathrm{PointX}(R)').json).toEqual([
      'Multiply',
      2,
      ['PointX', 'R'],
    ]);
    expect(ce.parse('x\\mathrm{PointX}(R)').json).toEqual([
      'Multiply',
      'x',
      ['PointX', 'R'],
    ]);
    expect(ce.parse('2S').json).toEqual(['Tuple', 2, 'S']);
  });
});

describe('coordinate accessor over a bare tuple, a broadcastable point, and two point arities', () => {
  test('a bare tuple is one point: its coordinate is a number, not a list', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tuple');
    expect(ce.box(['PointX', 'T']).type.toString()).toBe('number');
    expect(ce.box(['PointZ', 'T']).type.toString()).toBe('number');
    ce.assign('T', ce.box(['Tuple', 1, 2]));
    expect(ce.box(['PointX', 'T']).evaluate().toString()).toBe('1');
  });

  test('a broadcastable point gives a broadcastable coordinate', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'broadcastable<tuple<number, number>>');
    ce.declare('B', 'broadcastable<tuple>');
    ce.declare(
      'D',
      'broadcastable<tuple<number, number> | tuple<number, number, number>>'
    );
    // A point or a list of points: a number or a list of numbers. Read as a
    // collection, this typed `collection<number>`, which the number of a
    // single point is not.
    expect(ce.box(['PointX', 'P']).type.toString()).toBe(
      'broadcastable<number>'
    );
    expect(ce.box(['PointY', 'P']).type.toString()).toBe(
      'broadcastable<number>'
    );
    expect(ce.box(['PointX', 'B']).type.toString()).toBe(
      'broadcastable<number>'
    );
    expect(ce.box(['PointX', 'D']).type.toString()).toBe(
      'broadcastable<number>'
    );
    // No arm has a third coordinate: the dimension error a 2-D point gives.
    expect(ce.box(['PointZ', 'P']).type.toString()).toBe('error');
    // The 3-D arm has one; the 2-D arm's error contributes nothing.
    expect(ce.box(['PointZ', 'D']).type.toString()).toBe(
      'broadcastable<number>'
    );
    const x = ce.box(['PointX', 'P']);
    ce.assign('P', ce.box(['Tuple', 3, 4]));
    expect(x.evaluate().toString()).toBe('3');
    expect(x.evaluate().type.matches(x.type)).toBe(true);
    const ce2 = new ComputeEngine();
    ce2.declare('P', 'broadcastable<tuple<number, number>>');
    const xs = ce2.box(['PointX', 'P']);
    ce2.assign('P', ce2.box(['List', ['Tuple', 3, 4], ['Tuple', 5, 6]]));
    expect(xs.evaluate().toString()).toBe('[3,5]');
    expect(xs.evaluate().type.matches(xs.type)).toBe(true);
  });

  test('a number-or-point element states nothing definite', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'broadcastable<number | tuple<number, number>>');
    ce.declare('R', 'broadcastable<number | tuple>');
    // The coordinate is defined for the point and not for the number, and a
    // list of them reads element-wise or as a flat point by content. This
    // typed `missing | number | tuple<number, number>`: a point is never the
    // coordinate, and the list of coordinates was not admitted.
    expect(ce.box(['PointX', 'Q']).type.toString()).toBe('unknown');
    expect(ce.box(['PointX', 'R']).type.toString()).toBe('unknown');
    // A numeric element keeps the flat-point reading: `PointX([3, 4])` is 3.
    // A `broadcastable<number>` is a number (no coordinate: `missing`), a
    // vector (its first cell, a number) or a tensor of higher rank (its
    // first row, a tensor).
    ce.declare('N', 'broadcastable<number>');
    expect(ce.box(['PointX', 'N']).type.toString()).toBe(
      'missing | number | tensor'
    );
  });

  test('a 2-D-or-3-D point: the third coordinate is the 3-D arm’s', () => {
    const ce = new ComputeEngine();
    ce.declare('W', 'tuple<number, number> | tuple<number, number, number>');
    expect(ce.box(['PointX', 'W']).type.toString()).toBe('number');
    // Typed `collection<number>` before, which the number is not.
    expect(ce.box(['PointZ', 'W']).type.toString()).toBe('number');
    ce.assign('W', ce.box(['Tuple', 1, 2, 3]));
    expect(ce.box(['PointZ', 'W']).evaluate().toString()).toBe('3');
  });

  test('a short arm under PointX/PointY answers its absence marker, as a structural tuple does', () => {
    // `PointY` of a 1-tuple is the slot's absence marker, not a dimension
    // error (only the third coordinate errors): each arm answers as the
    // structural tuple of its arity does, and the answers are joined (dual
    // review).
    const ce = new ComputeEngine();
    ce.declare('A', 'tuple<integer>');
    ce.declare('S', 'tuple<integer> | tuple<string>');
    expect(ce.box(['PointY', 'A']).type.toString()).toBe('integer | nan');
    expect(ce.box(['PointY', 'S']).type.toString()).toBe(
      'integer | missing | nan | string'
    );
    expect(
      ce
        .box(['PointY', ['Tuple', 1]])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });
});

describe('a broadcastable point is read as a point or a list of points', () => {
  // The element type of `broadcastable<tuple<…>>` through
  // `collectionElementType` is `tuple<…> | tensor<tuple<…>>`, which is not a
  // point type. The tests that ask "is this a list of points" read the `T` of
  // the broadcastable instead (`pointCollectionElementType`). A value of the
  // type may still be ONE point, so a result type also admits the answer for
  // one point (`Dot(P, (1, 1))` is a number when `P` is a point).
  const POINT = 'broadcastable<tuple<real, real>>';

  test('Dot of a valueless broadcastable point stays symbolic', () => {
    const ce = new ComputeEngine();
    ce.declare('P', POINT);
    const e = ce.box(['Dot', 'P', ['Tuple', 1, 1]]);
    expect(e.type.toString()).toBe('list<real> | real');
    expect(e.evaluate().toString()).toBe('Dot(P, (1, 1))');
  });

  test('the coordinate of an empty broadcastable point list is the empty list', () => {
    const ce = new ComputeEngine();
    ce.declare('P', POINT);
    ce.assign('P', ce.box(['List']));
    expect(ce.box(['PointX', 'P']).evaluate().toString()).toBe('[]');
  });

  test('a function of a point maps over a broadcastable point list', () => {
    const ce = new ComputeEngine();
    ce.declare('P', POINT);
    ce.declare('g', '(tuple<real, real>) -> real');
    expect(ce.box(['g', 'P']).type.toString()).toBe('list<real>');
  });

  test('PointList refuses a broadcastable point component, as a list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', POINT);
    expect(ce.box(['PointList', 'Q', 1]).isValid).toBe(false);
  });

  test('compiled Norm, Abs, Dot and PointX read a list of points per point', () => {
    const ce = new ComputeEngine();
    const run = (body: unknown) =>
      compile(ce.box(['Function', body, ['Typed', 'w', `'${POINT}'`]] as any), {
        fallback: false,
      }).run as (w: unknown) => unknown;
    const W = [
      [3, 4],
      [6, 8],
    ];
    expect(run(['Norm', 'w'])(W)).toEqual([5, 10]);
    expect(run(['Abs', 'w'])(W)).toEqual([5, 10]);
    expect(run(['Dot', ['Tuple', 1, 2], 'w'])(W)).toEqual([11, 22]);
    expect(run(['PointX', 'w'])(W)).toEqual([3, 6]);
  });
});

/** The MathJSON of a point (an array of numbers) or of a nested list of
 * points (an array of arrays). */
function pointValue(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  if (v.length > 0 && !Array.isArray(v[0])) return ['Tuple', ...v];
  return ['List', ...v.map(pointValue)];
}

/** An evaluated value as JavaScript numbers and arrays. */
function asJS(e: any): unknown {
  if (e.isCollection === true) return Array.from(e.each(), asJS);
  return e.N().re;
}

/** The interpreter's value of `expr` with `P` and `Q` assigned `v`, and the
 * check that the value matches the static type of `expr` when `P` and `Q`
 * have no value. The check is skipped for `Abs`: its static type states
 * non-negative cells (`real<0..>`), and the type of a value such as
 * `[5, 10]` is `vector<integer^2>`, which does not state the sign, so the
 * check cannot succeed even when every cell is in the static type. */
function interpreted(decl: string, expr: unknown, v: unknown): unknown {
  const statics = new ComputeEngine();
  statics.declare('P', decl);
  statics.declare('Q', decl);
  const staticType = statics.box(expr as any).type.toString();
  const ce = new ComputeEngine();
  ce.declare('P', decl);
  ce.declare('Q', decl);
  ce.assign('P', ce.box(pointValue(v) as any));
  ce.assign('Q', ce.box(pointValue(v) as any));
  const value = ce.box(expr as any).evaluate();
  if ((expr as unknown[])[0] !== 'Abs')
    expect(value.type.matches(ce.type(staticType))).toBe(true);
  return asJS(value);
}

describe('compiled point readers over a broadcastable point', () => {
  // A value of `broadcastable<tuple<number, number>>` is one point or a
  // tensor of points of any rank. The compiled `Norm`, `PointX`, `PointY`,
  // `Abs` and `Dot` read the shape at run time. Before, they read the
  // operand as a list of points: `PointX` of the point `(3, 4)` was
  // `[NaN, NaN]` and `Norm` of it `[3, 4]`.
  const DECL = 'broadcastable<tuple<number, number>>';
  const ONE = [3, 4];
  const TWO = [
    [3, 4],
    [6, 8],
  ];
  const RANK2 = [
    [
      [3, 4],
      [6, 8],
    ],
    [
      [5, 12],
      [0, 1],
    ],
  ];
  const compiled = (expr: unknown, to?: string) => {
    const ce = new ComputeEngine();
    ce.declare('P', DECL);
    ce.declare('Q', DECL);
    const r = compile(ce.box(expr as any), {
      fallback: false,
      ...(to ? { to } : {}),
    } as any);
    expect(r.success).toBe(true);
    return (v: unknown) => r.run!({ P: v, Q: v } as any);
  };

  test.each([
    [['Norm', 'P']],
    [['PointX', 'P']],
    [['PointY', 'P']],
    [['Abs', 'P']],
    [['Dot', 'P', 'Q']],
    [['Dot', 'P', ['Tuple', 1, 1]]],
  ])('%j over one point and over a list of points', (expr) => {
    const run = compiled(expr);
    for (const v of [ONE, TWO]) {
      const expected = interpreted(DECL, expr, v);
      expect(run(v)).toEqual(expected);
    }
  });

  test('a tensor of points of rank 2', () => {
    // The accessors and `Abs` map over the points, as the interpreter does.
    for (const expr of [
      ['PointX', 'P'],
      ['PointY', 'P'],
      ['Abs', 'P'],
    ])
      expect(compiled(expr)(RANK2)).toEqual(interpreted(DECL, expr, RANK2));
    // The interpreter refuses `Norm` and `Dot` of such a value; the compiled
    // answer is `NaN`.
    expect(compiled(['Norm', 'P'])(RANK2)).toBeNaN();
    expect(compiled(['Dot', 'P', ['Tuple', 1, 1]])(RANK2)).toBeNaN();
  });

  test('the interval target reads one point and a list of points', () => {
    const lo = (r: any) => r.value.lo;
    const x = compiled(['PointX', 'P'], 'interval-js');
    expect(lo(x(ONE))).toBe(3);
    expect((x(TWO) as any[]).map(lo)).toEqual([3, 6]);
    expect((x(RANK2) as any[][]).map((row) => row.map(lo))).toEqual([
      [3, 6],
      [5, 0],
    ]);
  });
});

describe('a point accessor over a tensor of points maps over the points', () => {
  // The cells of a `tensor<tuple<…>>` are points, at any rank, so `PointX`
  // of it is the tensor of the x coordinates: `tensor<number>`. Before, the
  // accessor was typed `list<number>`, and a value of rank 2 evaluated to
  // its first row of points.
  test('the type and the value agree at rank 1 and at rank 2', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tensor<tuple<number, number>>');
    expect(ce.box(['PointX', 'T']).type.toString()).toBe('tensor');
    expect(
      interpreted('tensor<tuple<number, number>>', ['PointX', 'P'], [[3, 4], [6, 8]])
    ).toEqual([3, 6]);
    expect(
      interpreted('tensor<tuple<number, number>>', ['PointY', 'P'], [
        [
          [3, 4],
          [6, 8],
        ],
        [
          [5, 12],
          [0, 1],
        ],
      ])
    ).toEqual([
      [4, 8],
      [12, 1],
    ]);
    expect(
      interpreted('tensor<tuple<number, number>>', ['PointX', 'P'], [])
    ).toEqual([]);
  });

  test('a literal tensor of points and a list of lists of points', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'PointX',
      [
        'List',
        ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]],
        ['List', ['Tuple', 5, 12], ['Tuple', 0, 1]],
      ],
    ]);
    expect(literal.type.toString()).toBe('matrix<integer^(2x2)>');
    const value = literal.evaluate();
    expect(value.toString()).toBe('[[3,6],[5,0]]');
    expect(value.type.matches(literal.type)).toBe(true);

    ce.declare('L', 'list<list<tuple<number, number>>>');
    expect(ce.box(['PointX', 'L']).type.toString()).toBe('list<list<number>>');
    const ragged = ce.box([
      'PointX',
      ['List', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 3, 4], ['Tuple', 5, 6]]],
    ]);
    expect(ragged.evaluate().toString()).toBe('[[1],[3,5]]');
    expect(ragged.evaluate().type.matches(ragged.type)).toBe(true);
  });

  test('the third coordinate of a tensor of 2-D points is an error', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tensor<tuple<number, number>>');
    expect(ce.box(['PointZ', 'T']).type.toString()).toBe('error');
  });

  test('the norm of a tensor of points is one norm per point', () => {
    expect(
      interpreted('tensor<tuple<number, number>>', ['Norm', 'P'], [[3, 4], [6, 8]])
    ).toEqual([5, 10]);
  });

  test('compiled: PointX and Abs map over the points, Norm and Dot decline', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tensor<tuple<number, number>>');
    const run = (expr: unknown) => {
      const r = compile(ce.box(expr as any), { fallback: false });
      return (v: unknown) => r.run!({ T: v } as any);
    };
    const rank2 = [
      [
        [3, 4],
        [6, 8],
      ],
      [
        [5, 12],
        [0, 1],
      ],
    ];
    expect(run(['PointX', 'T'])([[3, 4], [6, 8]])).toEqual([3, 6]);
    expect(run(['PointX', 'T'])(rank2)).toEqual([
      [3, 6],
      [5, 0],
    ]);
    expect(run(['PointX', 'T'])([])).toEqual([]);
    expect(run(['Abs', 'T'])([[3, 4], [6, 8]])).toEqual([5, 10]);
    expect(run(['Abs', 'T'])(rank2)).toEqual([
      [5, 10],
      [13, 1],
    ]);
    expect(() => compile(ce.box(['Norm', 'T']), { fallback: false })).toThrow(
      /collection of points/
    );
    expect(() =>
      compile(ce.box(['Dot', 'T', ['Tuple', 1, 1]]), { fallback: false })
    ).toThrow(/collection of points/);
  });
});

/** The MathJSON of a nested array of numbers, as lists at every level. */
function numericList(v: unknown): unknown {
  return Array.isArray(v) ? ['List', ...v.map(numericList)] : v;
}

describe('point accessors over higher-rank data, non-numeric coordinates and empty rows', () => {
  // A numeric tensor of rank 3 holds no tuple point at any level. The type
  // handler reads it by element indexing (its element type), and so do the
  // interpreter and the compiled code. The interpreter used to read its
  // elements as collections of coordinate rows (`[[1, 3]]`), and the
  // compiled code as a list of rows (`[[1, 2]]`).
  test('a numeric tensor of rank 3 is element-indexed everywhere', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'PointX',
      numericList([
        [
          [1, 2],
          [3, 4],
        ],
      ]),
    ] as any);
    expect(literal.type.toString()).toBe('matrix<integer^(2x2)>');
    const value = literal.evaluate();
    expect(value.type.matches(literal.type)).toBe(true);
    expect(asJS(value)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(compile(literal, { fallback: false }).run!()).toEqual([
      [1, 2],
      [3, 4],
    ]);

    const data = [
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ],
    ];
    ce.declare('M', 'tensor<integer^(2x2x2)>');
    ce.assign('M', ce.box(numericList(data) as any));
    for (const [op, i] of [
      ['PointX', 0],
      ['PointY', 1],
    ] as const) {
      const e = ce.box([op, 'M']);
      const v = e.evaluate();
      expect(v.type.matches(e.type)).toBe(true);
      expect(asJS(v)).toEqual(data[i]);
      expect(compile(e, { fallback: false }).run!({ M: data })).toEqual(
        data[i]
      );
    }
  });

  // The run-time point dispatch of the compile targets reads an array as a
  // point only when every cell is a number. A point with a string
  // coordinate was read as a list of numbers, and the compiled `PointY` gave
  // the second POINT, `["b", 2]`. The compile is refused.
  test('a point with a coordinate that is not a number refuses the compile', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'broadcastable<tuple<string, number>>');
    ce.assign(
      'P',
      ce.box(['List', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]] as any)
    );
    const e = ce.box(['PointY', 'P']);
    const v = e.evaluate();
    expect(v.type.matches(e.type)).toBe(true);
    expect(v.toString()).toBe('[1,2]');
    expect(() => compile(e, { fallback: false })).toThrow(
      /not provably a number/
    );
    const interval = compile(e, { to: 'interval-js', fallback: false });
    expect(interval.success).toBe(false);
    expect(interval.error).toMatch(/not provably a number/);

    ce.declare('Q', 'list<list<tuple<string, number>>>');
    ce.assign(
      'Q',
      ce.box([
        'List',
        ['List', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]],
      ] as any)
    );
    const q = ce.box(['PointY', 'Q']);
    const qv = q.evaluate();
    expect(qv.type.matches(q.type)).toBe(true);
    expect(qv.toString()).toBe('[[1,2]]');
    expect(() => compile(q, { fallback: false })).toThrow(
      /not provably a number/
    );
  });

  // An empty row has the element type `never`, which is below `number`, so
  // it read as a point with no coordinates. When it was the first element,
  // the whole list was read as a list of points: `[Missing, (1, 2)]` in the
  // interpreter and `[null, [1, 2]]` in the compiled code, where the type is
  // `list<list<number>>`. The first row that is not empty decides now.
  test('an empty first row does not decide the reading', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<list<tuple<number, number>>>');
    ce.assign(
      'L',
      ce.box([
        'List',
        ['List'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ] as any)
    );
    const L = [
      [],
      [
        [1, 2],
        [3, 4],
      ],
    ];
    const e = ce.box(['PointX', 'L']);
    expect(e.type.toString()).toBe('list<list<number>>');
    const v = e.evaluate();
    expect(v.type.matches(e.type)).toBe(true);
    expect(asJS(v)).toEqual([[], [1, 3]]);
    expect(compile(e, { fallback: false }).run!({ L })).toEqual([[], [1, 3]]);
    const r = compile(e, { to: 'interval-js', fallback: false }).run!({
      L,
    }) as any;
    expect(r[0]).toEqual([]);
    expect(r[1].map((x: any) => x.value.lo)).toEqual([1, 3]);

    // Every row empty: the value does not decide, and the declared type
    // does. Each row gives the empty list of coordinates.
    ce.declare('E', 'list<list<tuple<number, number>>>');
    ce.assign('E', ce.box(['List', ['List'], ['List']] as any));
    const empty = ce.box(['PointX', 'E']);
    const ev = empty.evaluate();
    expect(ev.type.matches(empty.type)).toBe(true);
    expect(asJS(ev)).toEqual([[], []]);
    const emptyCompiled = compile(empty, { fallback: false });
    expect(emptyCompiled.run!({ E: [[], []] })).toEqual([[], []]);

    // The third coordinate is measured on the first point that exists.
    ce.declare('Z', 'list<list<tuple<number, number, number>>>');
    ce.assign(
      'Z',
      ce.box(['List', ['List'], ['List', ['Tuple', 1, 2, 3]]] as any)
    );
    const z = ce.box(['PointZ', 'Z']);
    const zv = z.evaluate();
    expect(zv.type.matches(z.type)).toBe(true);
    expect(asJS(zv)).toEqual([[], [3]]);
    expect(
      compile(z, { fallback: false }).run!({ Z: [[], [[1, 2, 3]]] })
    ).toEqual([[], [3]]);
  });

  // Past the eager threshold, an indexed source that is not a written-out
  // `List` takes the lazy map of the accessor over its elements, as a list
  // of points of rank 1 does, instead of a loop over every element.
  test('a large lazy collection of rows of points stays lazy', () => {
    const ce = new ComputeEngine();
    const rows = [
      'Map',
      ['Function', ['List', ['Tuple', 'k', 1], ['Tuple', 'k', 2]], 'k'],
      ['Range', 1, 150],
    ];
    const x = ce.box(['PointX', rows] as any);
    const v = x.evaluate();
    expect(v.operator).toBe('Map');
    expect(v.count).toBe(150);
    expect(v.type.matches(x.type)).toBe(true);
    expect(asJS(v.at(1))).toEqual([1, 1]);
    expect(asJS(v.at(150))).toEqual([150, 150]);
    const ye = ce.box(['PointY', rows] as any);
    const y = ye.evaluate();
    expect(y.operator).toBe('Map');
    expect(y.type.matches(ye.type)).toBe(true);
    expect(asJS(y.at(3))).toEqual([1, 2]);
    // A small source is still answered as a written-out list.
    const small = ce
      .box([
        'PointX',
        [
          'Map',
          ['Function', ['List', ['Tuple', 'k', 1], ['Tuple', 'k', 2]], 'k'],
          ['Range', 1, 3],
        ],
      ] as any)
      .evaluate();
    expect(small.operator).toBe('List');
    expect(small.toString()).toBe('[[1,1],[2,2],[3,3]]');
  });
});

describe('the coordinate type of a list of points, empty rows of a broadcastable point, undecided nesting and absent points', () => {
  // The coordinate of a list of points is typed by the component of the
  // point type. It was typed `number` whatever the component held, and the
  // value of `PointX` over points with a string coordinate is a list of
  // strings.
  test('a list of points with a coordinate that is not a number', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<string, number>>');
    ce.assign(
      'L',
      ce.box(['List', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]] as any)
    );
    const e = ce.box(['PointX', 'L']);
    expect(e.type.toString()).toBe('list<string>');
    const v = e.evaluate();
    expect(v.toString()).toBe('["a","b"]');
    expect(v.type.matches(e.type)).toBe(true);
    const c = compile(e, { fallback: false });
    expect(
      c.run!({
        L: [
          ['a', 1],
          ['b', 2],
        ],
      } as any)
    ).toEqual(['a', 'b']);

    const literal = ce.box([
      'PointX',
      ['List', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]],
    ] as any);
    expect(literal.type.toString()).toBe('list<string^2>');
    expect(literal.evaluate().type.matches(literal.type)).toBe(true);
  });

  // `[[], []]` is a tensor of points with two rows and no columns, so its
  // coordinate is `[[], []]`. Read as a list of two points, it answered
  // `[Missing, Missing]`, which `broadcastable<number>` does not hold.
  test('a broadcastable point holding only empty rows', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'broadcastable<tuple<number, number>>');
    ce.assign('P', ce.box(['List', ['List'], ['List']] as any));
    for (const op of ['PointX', 'PointY']) {
      const e = ce.box([op, 'P']);
      const v = e.evaluate();
      expect(v.toString()).toBe('[[],[]]');
      expect(v.type.matches(e.type)).toBe(true);
      expect(compile(e, { fallback: false }).run!({ P: [[], []] } as any))
        .toEqual([[], []]);
      expect(
        compile(e, { to: 'interval-js', fallback: false }).run!({
          P: [[], []],
        } as any)
      ).toEqual([[], []]);
    }
  });

  // An operand whose type does not decide the reading (`unknown`) is read at
  // run time, where a tuple and a list are the same array. A numeric array
  // of rank 3 (element-indexed by the interpreter) and a list of lists of
  // points (mapped down to the points) have the same shape there, so the
  // compiled code throws for that shape instead of answering. Before, it
  // answered `[[1, 3]]` where the interpreter answers `[[1, 2], [3, 4]]`.
  test('an undecided operand of rank 3 has no compiled answer', () => {
    const rank3 = [
      [
        [1, 2],
        [3, 4],
      ],
    ];
    const ce = new ComputeEngine();
    ce.assign('V', ce.box(numericList(rank3) as any));
    expect(asJS(ce.box(['PointX', 'V']).evaluate())).toEqual([
      [1, 2],
      [3, 4],
    ]);

    const fresh = new ComputeEngine();
    const e = fresh.box(['PointX', 'V']);
    const c = compile(e, { fallback: false });
    expect(c.success).toBe(true);
    expect(() => c.run!({ V: rank3 } as any)).toThrow(RangeError);
    // A list of points and one point have one reading, and are answered.
    expect(
      c.run!({
        V: [
          [1, 2],
          [3, 4],
        ],
      } as any)
    ).toEqual([1, 3]);
    expect(c.run!({ V: [3, 4] } as any)).toBe(3);
    // The interval target gives no band for that shape: `entire`.
    const iv = compile(e, { to: 'interval-js', fallback: false });
    expect(iv.success).toBe(true);
    expect(Array.isArray(iv.run!({ V: rank3 } as any))).toBe(false);
  });

  // A symbol with no value, declared with a type that does not decide the
  // reading: the first element decides at evaluation. A list of numbers is
  // one point spelled flat (`PointX` is its first element, a number), a list
  // of rows is a list of points (a list of coordinates), and a numeric array
  // of rank 3 is read by its elements (the first row). The static type is
  // the join of these readings, and holds each value. (Before 2026-10-22 it
  // was `list<number>`, which holds only the list of coordinates.)
  test('an undecided declared operand is typed by every reading', () => {
    const values: Array<[string, unknown]> = [
      ['rank 1', [1, 2, 3]],
      [
        'rank 2',
        [
          [1, 2],
          [3, 4],
        ],
      ],
      [
        'rank 3',
        [
          [
            [1, 2],
            [3, 4],
          ],
          [
            [5, 6],
            [7, 8],
          ],
        ],
      ],
    ];
    for (const [decl, expectedStatic] of [
      ['list', 'list<any> | number'],
      ['list<list<any>>', 'list<any> | missing'],
      ['tensor<number>', 'missing | number | tensor'],
    ] as const) {
      const ce = new ComputeEngine();
      ce.declare('v', decl);
      const staticType = ce.box(['PointX', 'v']).type;
      expect(staticType.toString()).toBe(expectedStatic);
      const c = compile(ce.box(['PointX', 'v']), { fallback: false });
      expect(c.success).toBe(true);
      for (const [name, value] of values) {
        const arm = new ComputeEngine();
        arm.declare('v', decl);
        // `list<list<any>>` does not admit a list of numbers.
        if (name === 'rank 1' && decl === 'list<list<any>>') continue;
        arm.assign('v', arm.box(numericList(value) as any));
        const evaluated = arm.box(['PointX', 'v']).evaluate();
        expect(evaluated.type.matches(staticType)).toBe(true);
        // The compiled code gives the same answer, or throws for the shape
        // that it cannot tell from a list of lists of points (rank 3).
        if (name === 'rank 3')
          expect(() => c.run!({ v: value } as any)).toThrow(RangeError);
        else expect(c.run!({ v: value } as any)).toEqual(asJS(evaluated));
      }
    }
  });

  // An absent point does not decide the reading of a list, on any route and
  // in a lazy collection too. When every point is absent, the declared
  // element type decides, as for an empty list.
  test('absent points', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'list<tuple<number, number> | missing>');
    const cases: [unknown, unknown[], string, unknown[]][] = [
      [
        ['List', 'Missing', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        [undefined, [1, 2], [3, 4]],
        '["Missing",1,3]',
        [NaN, 1, 3],
      ],
      [
        ['List', 'Missing', 'Missing'],
        [undefined, undefined],
        '["Missing","Missing"]',
        [NaN, NaN],
      ],
      [['List'], [], '[]', []],
    ];
    for (const [value, js, interpreted, compiled] of cases) {
      ce.assign('M', ce.box(value as any));
      for (const e of [
        ce.box(['PointX', 'M']),
        ce.box(['PointX', value] as any),
      ]) {
        const v = e.evaluate();
        expect(v.toString()).toBe(interpreted);
        expect(v.type.matches(e.type)).toBe(true);
      }
      const e = ce.box(['PointX', 'M']);
      expect(compile(e, { fallback: false }).run!({ M: js } as any)).toEqual(
        compiled
      );
      const iv = compile(e, { to: 'interval-js', fallback: false }).run!({
        M: js,
      }) as any[];
      expect(iv.length).toBe(compiled.length);
    }
    ce.assign(
      'M',
      ce.box(['List', 'Missing', ['Tuple', 1, 2], ['Tuple', 3, 4]] as any)
    );
    expect(
      compile(ce.box(['PointY', 'M']), { fallback: false }).run!({
        M: [undefined, [1, 2], [3, 4]],
      } as any)
    ).toEqual([NaN, 2, 4]);

    // A lazy collection whose first element is absent.
    const lazy = ce.box([
      'PointX',
      [
        'Map',
        [
          'Function',
          ['If', ['Equal', 'k', 1], 'Missing', ['Tuple', 'k', 'k']],
          'k',
        ],
        ['Range', 1, 3],
      ],
    ] as any);
    const lv = lazy.evaluate();
    expect(lv.toString()).toBe('["Missing",2,3]');
    expect(lv.type.matches(lazy.type)).toBe(true);
  });

  // The value of an empty `list<number>` holds no element that shows the
  // domain, so the absence marker is that of the type of the application,
  // `NaN`, as for `First`.
  test('the coordinate of an empty list of numbers is NaN', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'list<number>');
    ce.assign('N', ce.box(['List'] as any));
    const e = ce.box(['PointX', 'N']);
    const v = e.evaluate();
    expect(v.toString()).toBe('NaN');
    expect(v.type.matches(e.type)).toBe(true);
  });
});
