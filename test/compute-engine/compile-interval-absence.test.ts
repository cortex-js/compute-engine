/**
 * Absence on the interval target, across its whole value model.
 *
 * The target has no object domain: every value it produces is an enclosure,
 * an array of them (a collection at a consuming position) or a tri-state
 * verdict, and absence has a spelling in each — the whole-NaN marker or the
 * `empty` result for a value, the marker for an absent list (every collection
 * consumer propagates a non-array operand), the verdict `'false'` for an
 * absent condition. So the object-domain absence gate does not apply here
 * (`absence.numeric.coversValueModel`): a position typed
 * `list<number> | missing | number` compiles, and a type the target cannot
 * value is refused by its own lowering.
 *
 * The discharge primitives answer in the target's own domains: `IsMissing`
 * is a verdict (it used to be a JavaScript `false` for every kinded result,
 * the `empty` of a failed restriction included), `Coalesce` hands the
 * fallback back for an absent value and the hull for a partial one.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const iv = (lo: number, hi: number) => ({ lo, hi });

describe('the discharge primitives across the value model (review findings)', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');

  test('a list of verdicts stays outside the value model', () => {
    // A verdict element would read as `entire` in the collection consumers;
    // the position keeps failing closed at the absence gate.
    ce.declare('B', 'list<boolean>');
    const fn = compile(ce.parse('B\\{x>0\\}'), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    // The absent arm and the list arm have two shapes.
    expect(fn.diagnostic?.code).toBe('unsettled-shape');
  });
});

describe('a restriction over a relation', () => {
  // `y ≤ K(x) {K(x) > 0}` as ONE row: the restriction applies to the whole
  // relation. Where it fails the relation holds nowhere; where it is
  // undecided the relation holds at most where it held. The JavaScript
  // target reads the same way (its absent condition is falsy).
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  const expr = ce.box(['If', ['Greater', ['Sin', 'x'], 0], ['LessEqual', 'y', ['Sin', 'x']]]);
  const fn = compile(expr, { to: 'interval-js' });

  test('the position typed `boolean | missing` compiles to a conjunction at run time', () => {
    expect(expr.type.toString()).toBe('boolean');
    expect(fn.success).toBe(true);
    // x in [1, 1.5]: sin x in [0.84, 1] > 0, y = 0.5 ≤ sin x → 'true'.
    expect(fn.run!({ x: iv(1, 1.5), y: iv(0.5, 0.5) })).toBe('true');
    // x in [4, 4.5]: sin x < 0, the restriction fails → 'false', not absent.
    expect(fn.run!({ x: iv(4, 4.5), y: iv(-2, -2) })).toBe('false');
    // x in [-0.5, 0.5]: the restriction is undecided → at most 'maybe'.
    expect(fn.run!({ x: iv(-0.5, 0.5), y: iv(-2, -2) })).toBe('maybe');
  });
});
