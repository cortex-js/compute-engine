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
      'list<number> | number'
    );
    expect(ce.box(['PointY', 'P']).type.toString()).toBe(
      'list<number> | number'
    );
  });

  test('a single point and a point list keep their precise coordinate types', () => {
    const ce = new ComputeEngine();
    ce.declare('single', 'tuple<number, number>');
    ce.declare('many', 'list<tuple<number, number>>');
    expect(ce.box(['PointX', 'single']).type.toString()).toBe('number');
    expect(ce.box(['PointX', 'many']).type.toString()).toBe('list<number>');
  });

  test('a non-numeric point-list coordinate keeps its honest type, not list<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<tuple<string, number>> | tuple<number, number>');
    // The x-coordinate of the list arm is a string; it must not be reported as
    // `list<number>`, or a numeric consumer would compile against strings.
    expect(ce.box(['PointX', 'P']).type.toString()).toBe(
      'list<string> | number'
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
      'list<number> | number'
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
    // A coordinate that exists is typed by its component, with no absence
    // marker.
    expect(ce.box(['PointX', point]).type.toString()).toBe('integer');
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
    // A `broadcastable<number>` is a number (no coordinate: `Missing`, a
    // marker the result type leaves implicit), a vector (its first cell, a
    // number) or a tensor of higher rank (its first row, a tensor).
    ce.declare('N', 'broadcastable<number>');
    expect(ce.box(['PointX', 'N']).type.toString()).toBe('number | tensor');
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
    // review). The read is proved to find nothing, so it is typed by its
    // marker alone, as an `At` read proved out of range is (`At((5), 2)` is
    // typed `nan`): `nan` for an `integer` slot, `missing` for a `string`
    // slot.
    const ce = new ComputeEngine();
    ce.declare('A', 'tuple<integer>');
    ce.declare('S', 'tuple<integer> | tuple<string>');
    expect(ce.box(['PointY', 'A']).type.toString()).toBe('nan');
    expect(ce.box(['PointY', 'S']).type.toString()).toBe('missing | nan');
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

  test('a function of a point maps over a broadcastable point list, or takes one point', () => {
    // The call maps to the points at every depth when the value is a
    // collection of points, and takes one point whole, so its type is
    // `broadcastable<R>` (user decision 2026-10-25, ROADMAP CE-448). It was
    // `R | list<R>` (ROADMAP CE-407), which a matrix of points does not fit.
    const ce = new ComputeEngine();
    ce.declare('P', POINT);
    ce.declare('g', '(tuple<real, real>) -> real');
    expect(ce.box(['g', 'P']).type.toString()).toBe('broadcastable<real>');
  });

  test('PointList refuses a broadcastable point component, as a list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', POINT);
    expect(ce.box(['PointList', 'Q', 1]).isValid).toBe(false);
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
});

describe('point accessors over higher-rank data, non-numeric coordinates and empty rows', () => {

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
      /Could not compile/
    );
    let interval: { code?: string } | undefined;
    try {
      compile(e, { to: 'interval-js', fallback: false });
    } catch (err) {
      interval = (err as { diagnostic?: { code?: string } }).diagnostic;
    }
    expect(interval?.code).toBe('outside-profile');

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
      /Could not compile/
    );
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

  // An absent point does not decide the reading of a list, and in a lazy
  // collection neither. When every point is absent, the element type
  // decides, as for an empty list. A declared type cannot name `missing`
  // (`docs/ERROR-MODEL.md`, "`Missing` is a result only"), so the lists are
  // written, not declared inputs.
  test('absent points', () => {
    const ce = new ComputeEngine();
    const cases: [unknown, string][] = [
      [
        ['List', 'Missing', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        '[NaN,1,3]',
      ],
      [['List', 'Missing', 'Missing'], '[NaN,NaN]'],
    ];
    for (const [value, interpreted] of cases) {
      const e = ce.box(['PointX', value] as any);
      const v = e.evaluate();
      expect(v.toString()).toBe(interpreted);
      expect(v.type.matches(e.type)).toBe(true);
    }

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
    expect(lv.toString()).toBe('[NaN,2,3]');
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
