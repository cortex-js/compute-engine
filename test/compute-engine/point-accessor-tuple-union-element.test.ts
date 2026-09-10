import { ComputeEngine } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

/**
 * A point whose TYPE is a union of tuple spellings.
 *
 * A list literal of two points whose components have different tiers infers a
 * UNION element type: `[(a, 1), (2, b)]` with `a`/`b` declared `number` is a
 * `list<tuple<integer, number> | tuple<number, integer>>`. Every element of
 * such a list is a point, exactly as in a `list<tuple<number, number>>`, so
 * `PointX`/`PointY`/`PointZ` must read the two the same way.
 *
 * They did not. Every point-shape predicate tested for ONE tuple type
 * (`t === 'tuple' || t.kind === 'tuple'`), so the union was not point-shaped
 * for the TYPE handler while the VALUE route — which peeks at the actual
 * elements — read it as a list of points. The type said
 * `missing | tuple<integer, number> | tuple<number, integer>` where the value
 * was a list of numbers, and the JavaScript compiler, trusting that type,
 * emitted scalar code over a broadcast: `PointY(Q) + 1` returned the STRING
 * "1,71". The shared predicate `isPointElementType` (`common/type/utils.ts`)
 * now decides all of them.
 *
 * The same reading applies to a SINGLE point declared with such a union, and
 * to the `scalar + tuple` rejection in `canonicalAdd`: an operand that is a
 * numeric tuple in every non-absent case — `missing | tuple<number, number>`,
 * what a `When`-gated point has, or a union of numeric tuple spellings — is
 * the same mistake a plain `tuple<number, number>` operand is.
 */

const UNION_LIST_TYPE = 'list<tuple<integer, number> | tuple<number, integer>>';
const UNION_POINT_TYPE = 'tuple<integer, number> | tuple<number, integer>';

/** An engine holding `Q`, the INFERRED union-element point list `[(a,1),(2,b)]`
 *  with `a = 5` and `b = 7`. */
function engineWithInferredUnionList(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('a', 'number');
  ce.declare('b', 'number');
  ce.assign('Q', ce.box(['List', ['Tuple', 'a', 1], ['Tuple', 2, 'b']]));
  ce.assign('a', 5);
  ce.assign('b', 7);
  return ce;
}

describe('point accessor over a list whose element type is a union of tuples', () => {
  const js = new JavaScriptTarget();

  test('the element type is the union the defect is about', () => {
    const ce = engineWithInferredUnionList();
    expect(ce.box('Q').type.toString()).toBe(UNION_LIST_TYPE);
  });

  test('the accessor types as the coordinate LIST, not as one point', () => {
    const ce = engineWithInferredUnionList();
    expect(ce.box(['PointY', 'Q']).type.toString()).toBe('list<number>');
    // The type the compiler reads for the sum. Before the fix this was
    // `number | tuple<number, number>` and the emitted code was scalar.
    expect(ce.box(['Add', ['PointY', 'Q'], 1]).type.toString()).toBe(
      'list<number>'
    );
  });

  test('the interpreter broadcasts the coordinate', () => {
    const ce = engineWithInferredUnionList();
    expect(
      ce
        .box(['Add', ['PointY', 'Q'], 1])
        .evaluate()
        .toString()
    ).toBe('[2,8]');
  });

  test('the compiled route answers what the interpreter answers', () => {
    const ce = engineWithInferredUnionList();
    const sum = js.compile(ce.box(['Add', ['PointY', 'Q'], 1]));
    expect(sum.success).toBe(true);
    // The defect returned the string "1,71" here.
    expect((sum.run as (s: any) => unknown)({})).toEqual([2, 8]);

    const x = js.compile(ce.box(['PointX', 'Q']));
    expect(x.success).toBe(true);
    expect((x.run as (s: any) => unknown)({})).toEqual([5, 2]);
  });
});

describe('point accessor over an EMPTY list with a union element type', () => {
  const js = new JavaScriptTarget();

  /** An engine holding an empty list declared with element type `t`. */
  function emptyListEngine(name: string, t: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare(name, t);
    ce.assign(name, ce.box(['List']));
    return ce;
  }

  test('it broadcasts to the empty list, as a single tuple element type does', () => {
    // The rule for an empty collection is `elementTypeBroadcastsWhenEmpty`: a
    // point-shaped declared element type broadcasts over zero points. The
    // union spelling must answer what the single-tuple spelling answers.
    const ce = emptyListEngine('R', UNION_LIST_TYPE);
    expect(ce.box(['PointY', 'R']).evaluate().toString()).toBe('[]');

    const single = emptyListEngine('R', 'list<tuple<number, number>>');
    expect(ce.box(['PointY', 'R']).type.toString()).toBe(
      single.box(['PointY', 'R']).type.toString()
    );
    expect(ce.box(['PointY', 'R']).evaluate().toString()).toBe(
      single.box(['PointY', 'R']).evaluate().toString()
    );
  });

  test('the compiled route answers the empty list too', () => {
    const ce = emptyListEngine('R', UNION_LIST_TYPE);
    const r = js.compile(ce.box(['PointY', 'R']));
    expect(r.success).toBe(true);
    expect((r.run as (s: any) => unknown)({})).toEqual([]);
  });
});

describe('point accessor over a SINGLE point typed as a union of tuples', () => {
  const js = new JavaScriptTarget();

  function singlePointEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('w', UNION_POINT_TYPE);
    ce.assign('w', ce.box(['Tuple', 1, 2]));
    return ce;
  }

  test('the coordinate is a number, not an `unknown`', () => {
    const ce = singlePointEngine();
    expect(ce.box(['PointY', 'w']).evaluate().toString()).toBe('2');
    // Every arm of the union states a component at this position, so the
    // coordinate type is the widening of them. It was `unknown` before.
    expect(ce.box(['PointY', 'w']).type.toString()).toBe('number');
  });

  test('the compiled route answers the same coordinate', () => {
    const ce = singlePointEngine();
    const r = js.compile(ce.box(['PointY', 'w']));
    expect(r.success).toBe(true);
    expect((r.run as (s: any) => unknown)({})).toBe(2);
  });
});

describe('scalar + tuple rejection reads through absence and unions', () => {
  test('a `missing | tuple` operand is rejected like a plain tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'missing | tuple<number, number>');
    const sum = ce.box(['Add', 'q', 2]);
    expect(sum.isValid).toBe(false);
    expect(JSON.stringify(sum.json)).toContain('incompatible-type');
  });

  test('a union of numeric tuple spellings is rejected as well', () => {
    const ce = new ComputeEngine();
    ce.declare('w', UNION_POINT_TYPE);
    const sum = ce.box(['Add', 'w', 2]);
    expect(sum.isValid).toBe(false);
    expect(JSON.stringify(sum.json)).toContain('incompatible-type');
  });

  test('a `When`-gated point returned by a user function is rejected', () => {
    // `h(t) := (t, t+1) when t > 0` types `missing | tuple<number, number>`.
    // The compiled route used to emit the scalar `2 + _fn_h(1)`, which
    // returned the string "21,2" where the interpreter errored.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'h',
      [
        'Function',
        ['When', ['Tuple', 't', ['Add', 't', 1]], ['Greater', 't', 0]],
        't',
      ],
    ]).evaluate();
    const sum = ce.box(['Add', ['h', 1], 2]);
    expect(sum.isValid).toBe(false);
    expect(JSON.stringify(sum.json)).toContain('incompatible-type');
  });

  test('the controls are unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number>');
    expect(ce.box(['Add', 'p', 2]).isValid).toBe(false);
    // A scalar MULTIPLE of a point is defined (it scales the vector), so the
    // widened rejection must not reach `Multiply`.
    ce.declare('q', 'missing | tuple<number, number>');
    expect(ce.box(['Multiply', 'q', 2]).isValid).toBe(true);
  });

  test('a transparent ALIAS of `missing | tuple` is rejected too', () => {
    // The alias is unfolded before the absence arm is stripped: stripping
    // first leaves the reference node untouched, and the `missing` arm then
    // hides the tuple from the test.
    const ce = new ComputeEngine();
    ce.declareType('gp', 'missing | tuple<number, number>', { alias: true });
    ce.declare('q2', 'gp');
    const sum = ce.box(['Add', 'q2', 2]);
    expect(sum.isValid).toBe(false);
    expect(JSON.stringify(sum.json)).toContain('incompatible-type');
  });
});

describe('the point element predicate is shared and cycle-safe', () => {
  test('a self-referential alias in a union arm does not overflow the stack', () => {
    // `type alias cyc = cyc | tuple<number, number>` reaches itself through
    // a union arm; the point-element walk unfolds an alias once per path.
    const ce = new ComputeEngine();
    ce.declareType('cyc', 'cyc | tuple<number, number>', { alias: true });
    ce.declare('L', 'list<cyc>');
    expect(() => ce.box(['PointY', 'L']).type.toString()).not.toThrow();
  });

  test('`Abs` over a valueless union-element point list is the per-point norm', () => {
    // `isPointListValue` decides whether `Abs` over a list of points is the
    // list of point norms. It used the one-tuple test, so a PARAMETER typed
    // with the union compiled to a component-wise `Math.abs` broadcast.
    const ce = new ComputeEngine();
    ce.declare('S', UNION_LIST_TYPE);
    const js = new JavaScriptTarget();
    const norm = js.compile(ce.box(['Abs', 'S']));
    expect(norm.success).toBe(true);
    expect(
      (norm.run as (s: any) => unknown)({
        S: [
          [3, 4],
          [6, 8],
        ],
      })
    ).toEqual([5, 10]);
  });
});
