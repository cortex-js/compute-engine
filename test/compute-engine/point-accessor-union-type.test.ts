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
    expect(r.run!({ P: [[0.5, 9], [0.25, 4]] })).toEqual([180.5, 90.5]);
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
    ce.declare('P', 'dictionary<tuple<number, number>> | tuple<number, number>');
    // A dictionary is keyed, not an ordered point list; its synthesized
    // `tuple<string, V>` element must not read as a point. The union does not
    // distribute — it falls back to the safe `unknown` rather than fabricating
    // a confident `number | list<number>` that would admit a numeric consumer.
    expect(ce.box(['PointX', 'P']).type.toString()).toBe('unknown');
  });

  test('PointZ over an all-3D-point union distributes; over a 2D/3D mix it declines', () => {
    const ce = new ComputeEngine();
    ce.declare('P3', 'list<tuple<number, number, number>> | tuple<number, number, number>');
    expect(ce.box(['PointZ', 'P3']).type.toString()).toBe(
      'list<number> | missing | number'
    );
    // A 2-point arm has no z-coordinate, so the union cannot distribute a z:
    // it falls back to the collapsed collection type and fails closed.
    ce.declare('Pmix', 'list<tuple<number, number, number>> | tuple<number, number>');
    expect(ce.box(['PointZ', 'Pmix']).type.toString()).toBe('collection<number>');
  });

  // The conservative boundary: an arm whose element type is `number | tuple`
  // (a collection that could be a point spelled flat OR a list of points — the
  // imprecise parameter union Tycho declares) states nothing definite about
  // the coordinate, so the union does NOT distribute and stays
  // `collection<number>`, which still fails closed. Narrowing that arm away
  // (to `list<tuple> | tuple`) is what makes it compile.
  test('a union carrying a `number | tuple` collection arm does not distribute', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'P',
      'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>'
    );
    expect(ce.box(['PointX', 'P']).type.toString()).toBe('collection<number>');
    const chan = ce.box(['Add', ['Multiply', 360, ['PointX', 'P']], 0.5]);
    expect(() => compile(chan, { fallback: false })).toThrow();
  });
});
