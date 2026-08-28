import { ComputeEngine } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';

/**
 * Tycho items 212 and 213 — two ways a list of points lost its point-ness on
 * the way to `PointX`/`PointY`, both found under one dark refraction diagram
 * whose rays are built from slider-dependent point lists (tracker D-229).
 *
 * Item 212 — the TYPE of a zip of two unknown-length point views. With `n`
 * unbound, `A = (Range(0,n)/n)·(1,0)` is a lazy view typed
 * `indexed_collection<tuple<…>>`, but `Subtract(A, B)` evaluated to
 * `Map((_1, _2) ↦ _1 + _2, A, B)` typed `indexed_collection<number>` — the
 * mapping literal's parameters are bare, so its body was typed with both
 * `unknown`. The pulled VALUES were correct tuples; `PointY` over the view
 * folded to a scalar absence marker from the type alone. `Map` now derives a
 * bare-parameter mapping's element type from the sources' element types
 * (`bareMappingElementType`).
 *
 * Item 213 — the VALUE of a coordinate accessor over SYMBOLIC points. With
 * `P` declared `tuple<number, number>` and unbound, `PointY([P])` evaluated
 * to `[NaN]` while `PointY(P)` stayed symbolic: the broadcast arm read a
 * symbolic element's `at()` answering `undefined` as an absent coordinate.
 * A symbolic element now keeps the accessor applied to it
 * (`pointComponentOf`).
 */
describe('Tycho item 212: zip of two unknown-length point views keeps element tuple-ness in the TYPE', () => {
  const L = ['Divide', ['Range', 0, 'n'], 'n'];
  const A = ['Multiply', L, ['Tuple', 1, 0]];
  const B = ['Multiply', L, ['Tuple', 0, 1]];

  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    return ce;
  }

  test('a point view over an unbound-length range types its element as a tuple of numbers (not integers)', () => {
    const ce = engine();
    const a = ce.box(A).evaluate();
    // `(k/n)·(1, 0)` has rational components: the literal's integer
    // components are scaled by a `number`, so the tuple type must say so.
    expect(a.type.toString()).toBe(
      'indexed_collection<tuple<number, number>>'
    );
  });

  test.each([
    ['Subtract', ['Subtract', A, B]],
    ['Add', ['Add', A, B]],
    ['Divide by a scalar view', ['Divide', A, L]],
    ['Multiply by a scalar view', ['Multiply', L, A]],
  ])('%s of point views is a view of points', (_label, expr) => {
    const ce = engine();
    const v = ce.box(expr).evaluate();
    expect(v.operator).toBe('Map');
    expect(v.type.toString()).toBe(
      'indexed_collection<tuple<number, number>>'
    );
  });

  test('the pulled values are the tuples the type promises', () => {
    const ce = engine();
    ce.assign('n', 3);
    expect(ce.box(['ListFrom', ['Subtract', A, B]]).evaluate().toString()).toBe(
      '[(0, 0),(1/3, -1/3),(2/3, -2/3),(1, -1)]'
    );
  });

  test('PointY over the zip view with the length bound is the coordinate list, not a scalar marker', () => {
    const ce = engine();
    ce.assign('n', 3);
    expect(
      ce.box(['ListFrom', ['PointY', ['Subtract', A, B]]]).evaluate().toString()
    ).toBe('[0,-1/3,-2/3,-1]');
  });

  test('PointY over the zip view with the length UNBOUND is the lazy projection, not an absence marker', () => {
    const ce = engine();
    const v = ce.box(['PointY', ['Subtract', A, B]]).evaluate();
    expect(v.operator).toBe('Map');
    expect(v.isCollection).toBe(true);
    expect(v.type.toString()).toBe('indexed_collection<number>');
  });

  test('a bare-parameter user zip derives its element type the same way', () => {
    const ce = engine();
    // `Map` is lazy, so its sources stay the unevaluated `Multiply` forms
    // and the derivation reads their STATIC element type — the collection ×
    // tuple branch of `Multiply`'s type handler, which must scale the
    // components by the collection's element type just as the evaluated
    // view's single-tuple branch does.
    const v = ce
      .box(['Map', ['Function', ['Add', '_1', '_2'], '_1', '_2'], A, B])
      .evaluate();
    // At least a collection of 2-tuples: the tuple-ness is the guard; the
    // component tier may refine.
    expectTypeBetween(v, { atMost: 'indexed_collection<tuple<number, number>>' });
  });

  test('an annotated parameter is the contract and is NOT overridden by the derivation', () => {
    const ce = engine();
    const v = ce
      .box([
        'Map',
        [
          'Function',
          ['Add', '_1', '_2'],
          ['Typed', '_1', 'tuple<number, number>'],
          ['Typed', '_2', 'tuple<number, number>'],
        ],
        A,
        B,
      ])
      .evaluate();
    expect(v.type.toString()).toBe(
      'indexed_collection<tuple<number, number>>'
    );
  });

  test('the derivation leaves no stand-in declaration behind', () => {
    const ce = engine();
    ce.box(['Subtract', A, B]).evaluate().type.toString();
    expect(ce.lookupDefinition('_1')).toBeUndefined();
    expect(ce.lookupDefinition('_2')).toBeUndefined();
  });

  test('a scalar scaled tuple widens its components by the declared scalar tier', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('k', 'integer');
    expect(
      ce.box(['Multiply', 'x', ['Tuple', 1, 0]]).type.toString()
    ).toBe('tuple<number, number>');
    // An integer scalar leaves integer components alone.
    expect(
      ce.box(['Multiply', 'k', ['Tuple', 1, 0]]).type.toString()
    ).toBe('tuple<integer, integer>');
  });
});

describe('the `.N()` route keeps a point view a view of points (found under item 212)', () => {
  // `N((k/n)·(1, 0))` came back as a TUPLE of coordinate lists —
  // `(Map(…), Map(…))` with `n` unbound, `([0, 1/3, …], [0, 0, …])` with it
  // bound — because `mulN`/`addN` ran their tuple branch on the RAW operand
  // `Divide(Range(0, n), n)`, which is collection-TYPED but not yet a
  // collection, before the `.N()` step could reveal the view. The same shape
  // with a literal list crashed outright: `mulTensors` buckets the tuple as a
  // scalar and `mulN` had no single-operand short-circuit.
  const L = ['Divide', ['Range', 0, 'n'], 'n'];
  const A = ['Multiply', L, ['Tuple', 1, 0]];
  const B = ['Multiply', L, ['Tuple', 0, 1]];

  test('a literal list scaled by a point floats to a list of points (was a crash)', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box(['Multiply', ['List', 0, ['Rational', 1, 3]], ['Tuple', 1, 0]])
      .N();
    expect(v.toString()).toBe('[(0, 0),(0.3333333333333333, 0)]');
  });

  test('with the length unbound, N() of the view is a lazy view of points', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    for (const expr of [A, ['Subtract', A, B], ['Multiply', 2, A]]) {
      const v = ce.box(expr).N();
      expect(v.operator).toBe('Map');
      expect(v.type.toString()).toBe(
        'indexed_collection<tuple<number, number>>'
      );
    }
  });

  test('with the length bound, N() of the zip is the list of float points the exact route promises', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    ce.assign('n', 3);
    expect(ce.box(A).N().toString()).toBe(
      '[(0, 0),(0.3333333333333333, 0),(0.6666666666666666, 0),(1, 0)]'
    );
    expect(
      ce.box(['PointY', ['N', ['Subtract', A, B]]]).evaluate().toString()
    ).toBe('[0,-0.3333333333333333,-0.6666666666666666,-1]');
  });
});

describe('Tycho item 213: coordinate accessors over a list of SYMBOLIC points stay symbolic', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    return ce;
  }

  test.each([
    [['PointY', 'P'], 'PointY(P)'],
    [['PointY', ['List', 'P']], '[PointY(P)]'],
    [['PointY', ['List', ['Tuple', 1, 2], 'P']], '[2,PointY(P)]'],
    [['PointY', ['List', 'P', ['Multiply', 2, 'P']]], '[PointY(P),PointY(2P)]'],
    [['PointX', ['List', 'P', ['Tuple', 3, 4]]], '[PointX(P),3]'],
  ])('%j', (expr, expected) => {
    expect(engine().box(expr).evaluate().toString()).toBe(expected);
  });

  test('control: a list of literal points still broadcasts eagerly', () => {
    expect(
      engine()
        .box(['PointY', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[2,4]');
  });

  test('a coordinate a literal point provably lacks still takes the absence marker', () => {
    // `PointZ` over a 2-D point errors at canonicalization (dimension
    // mismatch), so the marker path is witnessed through a 3-D list whose
    // FIRST element settles the broadcast and a later literal 2-tuple lacks
    // the coordinate.
    const ce = new ComputeEngine();
    ce.declare('Q', 'tuple<number, number, number>');
    const v = ce.box(['PointZ', ['List', 'Q', ['Tuple', 1, 2]]]).evaluate();
    expect(v.toString()).toBe('[PointZ(Q),NaN]');
  });

  test('a later NON-point element keeps the absence marker rather than a bogus accessor', () => {
    const ce = engine();
    const v = ce.box(['PointY', ['List', 'P', 5]]).evaluate();
    // A scalar has no coordinate to be absent from a numeric slot of: its
    // marker is `Missing`, exactly as before the symbolic-element fix.
    expect(v.toString()).toBe('[PointY(P),"Missing"]');
  });

  test('a parameter named like an interned constant still derives from its source', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    const v = ce
      .box([
        'Map',
        // `All` is an interned constant: `ce.symbol('All')` answers it
        // before consulting any scope, so a stand-in named after the
        // parameter would have probed against the constant.
        ['Function', ['Add', 'All', 'p'], 'All', 'p'],
        ['Multiply', ['Divide', ['Range', 0, 'n'], 'n'], ['Tuple', 1, 0]],
        ['Multiply', ['Divide', ['Range', 0, 'n'], 'n'], ['Tuple', 0, 1]],
      ])
      .evaluate();
    // At least a collection of 2-tuples: the tuple-ness is the guard; the
    // component tier may refine.
    expectTypeBetween(v, { atMost: 'indexed_collection<tuple<number, number>>' });
  });

  test('a referenced parameter without a source element type declines the derivation', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    ce.declare('u', 'indexed_collection');
    const v = ce
      .box(['Map', ['Function', ['Multiply', '_1', '_2'], '_1', '_2'], ['Range', 1, 'n'], 'u'])
      .evaluate();
    // Not `number`: the unknown-element source may be supplying tuples.
    expect(v.type.toString()).toBe('indexed_collection<number>');
  });

  test('the symbolic coordinate list substitutes to the numeric one', () => {
    const ce = engine();
    const v = ce.box(['PointY', ['List', 'P', ['Multiply', 2, 'P']]]).evaluate();
    ce.assign('P', ['Tuple', 1, 5]);
    expect(v.evaluate().toString()).toBe('[5,10]');
  });
});
