import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho item 253 — `Abs` over a parameter declared with the point-or-point-
 * list union (`list<tuple<number, number>> | tuple<number, number>`, or the
 * three-arm form a point-consuming document function declares), or with no
 * type at all, lowered to ELEMENT-WISE `Math.abs` (`_SYS.bcast(Math.abs, …)`
 * or a bare `Math.abs(array)`), where `evaluate()` of the same call answers
 * the NORM. Neither static rewrite (`Abs(point)` → `Norm`, `Abs(point list)`
 * → `Norm`) applied, because the operand is not provably either.
 *
 * The shape is now decided at run time (`_SYS.absShape`): a number is
 * `Math.abs`, an array of numbers a point (its norm), an array of arrays a
 * point list (one norm per point). A compiled array carries no
 * tuple-versus-list tag, so a flat numeric array is read as a point. That
 * reading is only sound when the operand cannot legitimately hold a flat
 * list of numbers: either its type has no such arm, or it is a point SUM,
 * for which the interpreter answers an `incompatible-type` error at every
 * element.
 */

const DECLARATIONS = [
  'tuple<number, number>',
  'list<tuple<number, number>> | tuple<number, number>',
  'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>',
  'unknown',
];

function declareG(ce: ComputeEngine, type: string): void {
  ce.declare('g', { signature: `(${type}) -> number` });
  ce.assign(
    'g',
    ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]], 'P'])
  );
}

describe('Tycho item 253: Abs over a union-typed point parameter', () => {
  for (const type of DECLARATIONS) {
    test(`g((x, y)) with P: ${type} compiles to the norm`, () => {
      const ce = new ComputeEngine();
      declareG(ce, type);
      expect(ce.parse('g\\left(\\left(5,1\\right)\\right)').N().re).toBeCloseTo(
        Math.SQRT2,
        12
      );
      const r = compile(ce.parse('g\\left(\\left(x,y\\right)\\right)'), {
        to: 'javascript',
      });
      expect(r.success).toBe(true);
      expect(r.run!({ x: 5, y: 1 })).toBeCloseTo(Math.SQRT2, 12);
    });
  }

  test('a point list through the union answers one norm per point', () => {
    const ce = new ComputeEngine();
    declareG(ce, 'list<tuple<number, number>> | tuple<number, number>');
    ce.declare('Q', 'list<tuple<number, number>>');
    const r = compile(ce.box(['g', 'Q']), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(
      r.run!({
        Q: [
          [5, 1],
          [4, 2],
        ],
      })
    ).toEqual([Math.SQRT2, 2]);
  });

  test('a chain of point subtractions is one n-ary Add and still lifts', () => {
    // Canonicalization flattens `P − (4, 0) − (1, 2)` into ONE `Add` with
    // THREE operands, two of them tuple-valued. The run-time point-list lift
    // must admit more than one provable point beside the run-time-shaped
    // operand, or the generic flat broadcast zips the point LIST against the
    // points' components.
    const ce = new ComputeEngine();
    ce.declare('g', {
      signature:
        '(list<tuple<number, number>> | tuple<number, number>) -> number',
    });
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Abs',
          ['Subtract', ['Subtract', 'P', ['Tuple', 4, 0]], ['Tuple', 1, 2]],
        ],
        'P',
      ])
    );
    ce.declare('Q', 'list<tuple<number, number>>');

    const overList = compile(ce.box(['g', 'Q']), { to: 'javascript' });
    expect(overList.success).toBe(true);
    const expected = ce
      .box(['g', ['List', ['Tuple', 5, 1], ['Tuple', 4, 2]]])
      .N()
      .ops!.map((op) => op.re);
    expect(expected).toEqual([1, 1]);
    expect(
      overList.run!({
        Q: [
          [5, 1],
          [4, 2],
        ],
      })
    ).toEqual(expected);

    const atPoint = compile(ce.parse('g\\left(\\left(x,y\\right)\\right)'), {
      to: 'javascript',
    });
    expect(atPoint.success).toBe(true);
    expect(atPoint.run!({ x: 5, y: 1 })).toBeCloseTo(
      ce.box(['g', ['Tuple', 5, 1]]).N().re,
      12
    );
  });

  test('an empty point list answers the empty list', () => {
    // A point of the declared arity is never an empty array at run time, so
    // an empty array is an empty list of points: both the run-time lift and
    // `_SYS.absShape` map over it and answer `[]`, as the provable
    // point-list lowering (`Q.map((p) => _SYS.norm(p))`) already does.
    const ce = new ComputeEngine();
    declareG(ce, 'list<tuple<number, number>> | tuple<number, number>');
    ce.declare('Q', 'list<tuple<number, number>>');
    const r = compile(ce.box(['g', 'Q']), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ Q: [] })).toEqual([]);
  });

  test('a union that admits a flat numeric list keeps the element-wise lowering', () => {
    // A compiled array carries no tuple-versus-list tag. For `P: list<number>
    // | tuple<number, number>` a flat array of numbers is a legitimate LIST,
    // which the interpreter reads element-wise, so a bare `|P|` must NOT
    // dispatch on the run-time shape — reading `[3, −4]` as a point would
    // answer the norm 5 where `evaluate()` answers `[3, 4]`.
    const ce = new ComputeEngine();
    ce.declare('h', {
      signature: '(list<number> | tuple<number, number>) -> number',
    });
    ce.assign('h', ce.box(['Function', ['Abs', 'P'], 'P']));
    ce.declare('Q', 'list<number>');
    const bare = compile(ce.box(['h', 'Q']), { to: 'javascript' });
    expect(bare.success).toBe(true);
    expect(String(bare.preamble ?? '') + String(bare.code)).not.toContain(
      'absShape'
    );
    expect(bare.run!({ Q: [3, -4] })).toEqual(
      ce
        .box(['Abs', ['List', 3, -4]])
        .evaluate()
        .ops!.map((op) => op.re)
    );

    // The same declaration, but the operand is a point SUM: adding a point to
    // a number is an `incompatible-type` error at every element, so a flat
    // array of numbers is not a value this operand can take and the run-time
    // shape dispatch is sound again.
    ce.declare('k', {
      signature: '(list<number> | tuple<number, number>) -> number',
    });
    ce.assign(
      'k',
      ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]], 'P'])
    );
    const sum = compile(ce.parse('k\\left(\\left(x,y\\right)\\right)'), {
      to: 'javascript',
    });
    expect(sum.success).toBe(true);
    expect(String(sum.preamble ?? '') + String(sum.code)).toContain('absShape');
    expect(sum.run!({ x: 5, y: 1 })).toBeCloseTo(Math.SQRT2, 12);
  });

  // A nested array reaching `_SYS.absShape` is read as a point LIST, never as
  // a matrix. There is no test through the union for a matrix argument
  // because the interpreter has no answer to compare against: the
  // point-list union refuses a matrix at the call gate
  // (`g([[1, 2], [3, 4]])` is `incompatible-type`, measured), and for the
  // `list<number> | tuple<number, number>` declaration, which does accept
  // one, the point subtraction inside the body is an `incompatible-type`
  // error at every element and `Abs` stays inert.

  test('a scalar-typed parameter keeps Math.abs', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> number');
    ce.assign('h', ce.box(['Function', ['Abs', ['Subtract', 'P', 4]], 'P']));
    const r = compile(ce.parse('h(x)'), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(String(r.preamble ?? '') + String(r.code)).toContain('Math.abs');
    expect(String(r.preamble ?? '') + String(r.code)).not.toContain('absShape');
    expect(r.run!({ x: 1 })).toBe(3);
  });

  test('the D-264 shape: min over seven discs is a disc union, not axis bands', () => {
    const ce = new ComputeEngine();
    // f(P) = min([ |P − (4, 0) − 2(H(i+.2), H(i+.4))| − .9 H(i+.6) for i = 1..7 ])
    // with H a smooth hash; the region f((x,y)) ≤ 0 is a union of discs. At a
    // point inside the first disc and off both axes through its centre, the
    // element-wise reading answered a positive value (no band contains it).
    ce.declare('H', '(number) -> number');
    ce.assign('H', ce.box(['Function', ['Sin', ['Multiply', 7, 'u']], 'u']));
    ce.declare(
      'f',
      '(list<tuple<number, number>> | tuple<number, number>) -> number'
    );
    ce.assign(
      'f',
      ce.parse(
        'P\\mapsto\\min\\left(\\left[\\left|P-\\left(4,0\\right)-2\\left(H\\left(i+.2\\right),H\\left(i+.4\\right)\\right)\\right|-.9H\\left(i+.6\\right)\\ \\text{for}\\ i=\\left[1...7\\right]\\right]\\right)'
      )
    );
    const row = ce.parse('f\\left(\\left(x,y\\right)\\right)');
    const r = compile(row, { to: 'javascript' });
    expect(r.success).toBe(true);
    for (const [x, y] of [
      [4.3, 0.4],
      [2.1, -1.2],
      [5.7, 1.1],
    ]) {
      const expected = ce.box(['f', ['Tuple', x, y]]).N().re;
      expect(r.run!({ x, y })).toBeCloseTo(expected, 9);
    }
  });
});
