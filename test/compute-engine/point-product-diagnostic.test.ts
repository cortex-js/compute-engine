import { ComputeEngine } from '../../src/compute-engine';

/**
 * A product between two POINTS is correctly rejected — there is no implicit
 * product between tuples, the ruling the `Dot` definition
 * (`library/linear-algebra.ts`) records — but for a long time the report was a
 * bare `incompatible-type "number" "tuple"`, which says only that something
 * wanted a number and got a tuple, and which surfaces wherever the product was
 * CONSUMED rather than where it was written. Since juxtaposition, `\cdot` and
 * `\times` all parse to the same `Multiply`, a user who meant a cross product
 * got no pointer at all. A consumer traced a five-mechanism blank-render hunt
 * to exactly this shape.
 *
 * The diagnostic now names the situation and the alternatives, and the same
 * treatment covers a point used as a DIVISOR.
 */

/** The error code of an `Error` expression, or `undefined`. */
function errorCode(expr: ReturnType<ComputeEngine['box']>): string | undefined {
  const json = JSON.parse(JSON.stringify(expr.json));
  if (!Array.isArray(json) || json[0] !== 'Error') return undefined;
  const code = json[1];
  if (typeof code === 'string') return code.replace(/^'|'$/g, '');
  if (Array.isArray(code) && code[0] === 'ErrorCode')
    return String(code[1]).replace(/^'|'$/g, '');
  return undefined;
}

describe('a product between two points names its alternatives', () => {
  function pointEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('a', 'tuple<number,number>');
    ce.declare('b', 'tuple<number,number>');
    ce.declare('p', 'tuple<number,number,number>');
    ce.declare('q', 'tuple<number,number,number>');
    return ce;
  }

  test('the error code is no longer the generic type report', () => {
    const ce = pointEngine();
    const product = ce.box(['Multiply', 'a', 'b']);
    expect(errorCode(product)).toEqual('no-product-between-points');
    expect(product.toString()).not.toMatch(/incompatible-type/);
  });

  test('every spelling of the product reports it', () => {
    // `\times`, `\cdot` and juxtaposition all parse to the same `Multiply`,
    // which is why the spelling cannot select a cross product.
    const ce = pointEngine();
    for (const latex of ['a \\times b', 'a \\cdot b', 'ab']) {
      expect(errorCode(ce.parse(latex))).toEqual('no-product-between-points');
    }
  });

  test('literal points report it too, not just declared ones', () => {
    const ce = new ComputeEngine();
    const product = ce.box(['Multiply', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    expect(errorCode(product)).toEqual('no-product-between-points');
  });

  test('`Cross` is named only when both points have three components', () => {
    // `Cross` is declared for 3-vectors and answers `incompatible-dimensions`
    // for anything else, so naming it for a pair of plane points would move
    // the user to a second error rather than to a fix.
    const ce = pointEngine();
    const plane = ce.box(['Multiply', 'a', 'b']).toString();
    expect(plane).toMatch(/Dot\(a, b\)/);
    expect(plane).not.toMatch(/Cross/);

    const space = ce.box(['Multiply', 'p', 'q']).toString();
    expect(space).toMatch(/Dot\(a, b\)/);
    expect(space).toMatch(/Cross\(a, b\)/);
  });

  test('a point reached only through its VALUE still gates Cross', () => {
    // `isTuple` accepts a symbol two ways: by the symbol's own type, or —
    // when that type is wider — through the tuple-typed VALUE bound to it.
    // Reading the arity off the symbol's own type alone reports "unknown" for
    // the second kind, which does NOT suppress `Cross` — so a pair of PLANE
    // points declared `value` would have been told to use a cross product.
    const plane = new ComputeEngine();
    plane.declare('w', 'value');
    plane.assign('w', plane.box(['Tuple', 1, 2]));
    plane.declare('z', 'value');
    plane.assign('z', plane.box(['Tuple', 3, 4]));
    const flat = plane.box(['Multiply', 'w', 'z']).toString();
    expect(flat).toMatch(/Dot\(a, b\)/);
    expect(flat).not.toMatch(/Cross/);

    // The 3-component case through the same route still names `Cross`.
    const space = new ComputeEngine();
    space.declare('m', 'value');
    space.assign('m', space.box(['Tuple', 1, 2, 3]));
    space.declare('o', 'value');
    space.assign('o', space.box(['Tuple', 4, 5, 6]));
    expect(space.box(['Multiply', 'm', 'o']).toString()).toMatch(/Cross/);
  });

  test('the Cross decision is a discrete payload marker, not prose', () => {
    // The LaTeX tooltip branches on this marker. Recovering the decision by
    // matching the remedy wording would break on any rewording.
    const ce = pointEngine();
    expect(ce.box(['Multiply', 'a', 'b']).toString()).toContain('no-cross');
    expect(ce.box(['Multiply', 'p', 'q']).toString()).toContain(
      'cross-applies'
    );
  });

  test('points of DIFFERENT known dimension are told so, not sent to Dot', () => {
    // `Dot` rejects a pair whose component counts differ
    // (`incompatible-dimensions`), so recommending it here would move the user
    // to a second error — the same trap the `Cross` gate exists to avoid.
    const ce = pointEngine();
    const mixed = ce.box(['Multiply', 'a', 'p']).toString();
    expect(mixed).toContain('different dimensions (2 and 3)');
    expect(mixed).not.toMatch(/Dot/);
    expect(mixed).not.toMatch(/Cross/);
    expect(ce.parse('(1,2)\\cdot(3,4,5)').latex).toContain(
      'different dimensions'
    );
    // The alternative it declines to name would indeed have failed.
    expect(
      errorCode(ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 3, 4, 5]]).evaluate())
    ).toEqual('incompatible-dimensions');
  });

  test('the suggestion it makes actually works', () => {
    // A recommendation the engine cannot honor would be worse than none.
    const ce = new ComputeEngine();
    expect(
      ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 3, 4]]).evaluate().re
    ).toEqual(11);
    expect(
      ce
        .box(['Cross', ['Tuple', 1, 0, 0], ['Tuple', 0, 1, 0]])
        .evaluate()
        .toString()
    ).toEqual('[0,0,1]');
  });

  test('the products that ARE defined are untouched', () => {
    const ce = pointEngine();
    // Scaling by a scalar, and adding two points of equal arity.
    expect(ce.box(['Multiply', 2, 'a']).toString()).toEqual('2a');
    expect(ce.box(['Add', 'a', 'b']).toString()).toEqual('a + b');
    expect(
      ce
        .box(['Multiply', 2, ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toEqual('(2, 4)');
  });
});

describe('a point used as a divisor says so', () => {
  test('both `x / point` and `point / point` report it', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'tuple<number,number>');
    ce.declare('b', 'tuple<number,number>');
    expect(errorCode(ce.box(['Divide', 'a', 'b']))).toEqual(
      'no-division-by-point'
    );
    expect(errorCode(ce.box(['Divide', 2, 'a']))).toEqual(
      'no-division-by-point'
    );
  });

  test('dividing a point BY a scalar still scales component-wise', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Divide', ['Tuple', 4, 6], 2])
        .evaluate()
        .toString()
    ).toEqual('(2, 3)');
  });
});
