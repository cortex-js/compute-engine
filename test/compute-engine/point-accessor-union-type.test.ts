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
