/**
 * A destructuring `Declare` whose pattern has the same name at two positions
 * (`Declare((a, a), "unknown", (1, 2))`) declines on every target.
 *
 * The interpreter evaluates the whole value first, then binds the names in
 * depth-first pattern order, so the name gets the value at its last
 * position. The compiled lowering desugars the pattern into one declaration
 * per position, which would declare the name twice in one scope
 * (`let a = 1; let a = 2`, not valid JavaScript). The compilation declines
 * such a statement, and its message names the repeated symbol.
 *
 * The Epsil parser rejects such a pattern, so only a MathJSON input can
 * contain it.
 */

import type { MathJsonExpression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const T = "'unknown'";

const FLAT: MathJsonExpression = [
  'Block',
  ['Declare', ['Tuple', 'a', 'a'], T, ['Tuple', 1, 2]],
  'a',
];

const NESTED: MathJsonExpression = [
  'Block',
  [
    'Declare',
    ['Tuple', 'a', ['Tuple', 'b', 'a']],
    T,
    ['Tuple', 1, ['Tuple', 2, 3]],
  ],
  ['Add', 'a', 'b'],
];

const DECLINE = /pattern has the name 'a' at more than one position/;

/** The result of the compilation, or the message of its decline: with no
 * interpreter fallback, a decline throws on most targets. */
function compileTo(ce: ComputeEngine, json: MathJsonExpression, to: string) {
  try {
    return compile(ce.box(json), { to: to as any, fallback: false });
  } catch (e) {
    return { success: false, error: (e as Error).message } as ReturnType<
      typeof compile
    >;
  }
}

describe('A destructuring declaration with a repeated name declines', () => {
  test.each(['javascript', 'interval-js', 'python', 'glsl', 'wgsl'])(
    '%s',
    (to) => {
      const ce = new ComputeEngine();
      // The interpreter gives the name the value at its last position.
      expect(ce.box(FLAT).evaluate().re).toBe(2);
      expect(ce.box(NESTED).evaluate().re).toBe(5);
      for (const json of [FLAT, NESTED]) {
        const r = compileTo(ce, json, to);
        expect(r.success).toBe(false);
        expect(r.error).toMatch(DECLINE);
      }
    }
  );
});
