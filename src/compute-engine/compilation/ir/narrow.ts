/**
 * The pass `narrow` of the interval mode (README, "The interval mode",
 * "Conditionals"), run before the other passes. The constant of the
 * comparison is on either side, and an arm reads the clamp in its body, its
 * nested regions and its yields.
 *
 * It is sound: the interpreter takes the arm only at a point where its `v`
 * satisfies the comparison, so its `v` is in the narrowed interval there.
 * A strict comparison takes the closed bound: `v > c` gives `v ≥ c`, and the
 * interval of the points where `v > c` holds is not closed. A NaN `v` takes
 * the arm of a false comparison where no bound holds; a clamp keeps the
 * kind of `v` (`empty`, `partial`), so the arm keeps the kind of an operand
 * with no value. It stays sound when `hoist` moves a pure arm out
 * as `and(cond, y)` or `or(cond, y)`: the value of `y` reads the narrowed
 * value only where the condition does not decide the result alone.
 */

import {
  mapDirectArgs,
  outsOf,
  regionsOf,
  type Instr,
  type Program,
  type Region,
  type V,
} from './ir.js';

/** The comparisons whose true arm has `v ≥ c` when `v` is the left
 *  operand. */
const ABOVE: Record<string, boolean> = {
  lt: false,
  le: false,
  gt: true,
  ge: true,
};

export function narrow(p: Program): void {
  const def = new Map<V, Instr>();
  // The value that each value reads as in the arm being walked: one walk,
  // each narrowing set while its arm is walked.
  const subst = new Map<V, V>();
  const resolve = (x: V): V => {
    while (subst.has(x)) x = subst.get(x)!;
    return x;
  };
  const constant = (v: V): boolean => {
    const i = def.get(v);
    return (
      i?.k === 'const' &&
      (i.value.lane === 'real' || i.value.lane === 'integer') &&
      Number.isFinite(i.value.value)
    );
  };
  /** Walk the arm `r`, which reads `op(v, c)` in place of `v`. An arm that
   *  does not read `v` leaves the operation unread, for `dce`. */
  const arm = (r: Region, v: V, c: V, op: 'atleast' | 'atmost'): void => {
    const lane = p.types[v].lane;
    // The result of a clamp has the lane of `v`: a real `v`, or an integer
    // `v` and an integer `c`.
    if (lane !== 'real' && !(lane === 'integer' && p.types[c].lane === lane))
      return walk(r);
    const w = p.types.push(p.types[v]) - 1;
    r.body.unshift({
      k: 'op',
      out: w,
      op: lane === 'real' ? op : `${op}.int`,
      // The clamp of an `if` around this one, when it narrows `v` too.
      args: [resolve(v), c],
    });
    const outer = subst.get(v);
    subst.set(v, w);
    walk(r, 1);
    if (outer === undefined) subst.delete(v);
    else subst.set(v, outer);
  };
  const walk = (r: Region, from = 0): void => {
    r.body.forEach((i, k) => {
      if (k < from) return;
      mapDirectArgs(i, resolve);
      for (const o of outsOf(i)) def.set(o, i);
      const d = i.k === 'if' ? def.get(i.cond) : undefined;
      if (i.k === 'if' && d?.k === 'op' && d.op in ABOVE) {
        const [a, b] = d.args;
        if (constant(a) !== constant(b)) {
          const left = constant(b);
          const [v, c] = left ? [a, b] : [b, a];
          const above = ABOVE[d.op] === left;
          arm(i.then, v, c, above ? 'atleast' : 'atmost');
          arm(i.else, v, c, above ? 'atmost' : 'atleast');
          return;
        }
      }
      regionsOf(i).forEach((x) => walk(x));
    });
    r.yields = r.yields.map(resolve);
  };
  p.functions.forEach((f) => walk(f.body));
}
