/**
 * The effect classes of the slice IR, and the one set of eligibility
 * queries that the lowering, the passes and the printers ask.
 *
 * - `pure`: no effect and no failure; may be merged, removed, moved,
 *   folded, and evaluated in a region where it was not written.
 * - `may-fail`: can throw or not terminate (a loop over too many
 *   iterations); may be removed when its value is not read, but is not
 *   merged, folded, moved or evaluated where it was not written.
 * - `effectful`: changes or reads state; is evaluated exactly once per
 *   evaluation that the program asks for, in program order.
 *
 * The effect of an operation is its row's; of a region, the largest of its
 * row and its body; of a call, its callee's. The effects of the functions
 * are the least fixed point over the call graph from `pure` (each round
 * only raises an effect, so it ends, and a recursive function that does
 * nothing else is pure).
 */

import {
  regionsOf,
  type IRFunction,
  type Instr,
  type Program,
  type Region,
  type V,
} from './ir.js';
import {
  regionRow,
  rowOfOp,
  type Effect,
  type OperatorRow,
} from './operators.js';

export type { Effect };

const RANK: Record<Effect, number> = {
  'pure': 0,
  'may-fail': 1,
  'effectful': 2,
};

export function maxEffect(a: Effect, b: Effect): Effect {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The effect of `i`, given the effect of each function. */
export function instrEffect(
  rows: readonly OperatorRow[],
  i: Instr,
  fn: (name: string) => Effect
): Effect {
  const inner = regionsOf(i).reduce<Effect>(
    (e, r) => maxEffect(e, regionEffect(rows, r, fn)),
    'pure'
  );
  switch (i.k) {
    case 'op':
      return rowOfOp(rows, i.op)?.row.effect ?? 'effectful';
    case 'call':
      return fn(i.fn);
    case 'loop':
      // A loop of too many iterations fails (the trip count).
      return maxEffect('may-fail', inner);
    case 'region':
      return maxEffect(regionRow(i.op)?.effect ?? 'effectful', inner);
    default:
      return inner;
  }
}

function regionEffect(
  rows: readonly OperatorRow[],
  r: Region,
  fn: (name: string) => Effect
): Effect {
  return r.body.reduce<Effect>(
    (e, i) => maxEffect(e, instrEffect(rows, i, fn)),
    'pure'
  );
}

/** The effect of each function of `functions`: the least fixed point.
 *  A function that is not in the list (`known` absent) is effectful. */
export function functionEffects(
  rows: readonly OperatorRow[],
  functions: readonly IRFunction[],
  known: ReadonlyMap<string, Effect> = new Map()
): Map<string, Effect> {
  const effects = new Map<string, Effect>(known);
  for (const f of functions) effects.set(f.name, 'pure');
  const fn = (name: string) => effects.get(name) ?? 'effectful';
  for (let changed = true; changed;) {
    changed = false;
    for (const f of functions) {
      const e = regionEffect(rows, f.body, fn);
      if (e !== effects.get(f.name)) {
        effects.set(f.name, e);
        changed = true;
      }
    }
  }
  return effects;
}

export type Effects = {
  of(i: Instr): Effect;
  /** Two such instructions with the same operands give one value. */
  mergeable(i: Instr): boolean;
  /** The instruction can be removed when its values are not read. */
  removable(i: Instr): boolean;
  /** A pure value can be evaluated after `i` instead of before it. */
  crossable(i: Instr): boolean;
  /** The instruction can be evaluated where the program did not ask for
   *  it (out of an arm, before a condition). */
  speculatable(i: Instr): boolean;
};

export function effects(p: Program, rows: readonly OperatorRow[]): Effects {
  const fns = functionEffects(rows, p.functions);
  const of = (i: Instr) =>
    instrEffect(rows, i, (name) => fns.get(name) ?? 'effectful');
  return {
    of,
    mergeable: (i) => of(i) === 'pure',
    removable: (i) => of(i) !== 'effectful',
    crossable: (i) => of(i) !== 'effectful',
    speculatable: (i) => of(i) === 'pure',
  };
}

export type TraceEntry = { region: number; name: string; args: V[] };

/** The effectful instructions of `p` in order, each with its operands and
 *  the region that holds it (an id per region object, from `ids`). */
export function effectTrace(
  p: Program,
  rows: readonly OperatorRow[],
  ids: Map<Region, number>
): TraceEntry[] {
  const fx = effects(p, rows);
  const id = (r: Region) => {
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  };
  const out: TraceEntry[] = [];
  const walk = (r: Region) => {
    for (const i of r.body) {
      if (
        fx.of(i) === 'effectful' &&
        (i.k === 'op' || i.k === 'call' || i.k === 'region')
      ) {
        const name = i.k === 'call' ? `call ${i.fn}` : i.op;
        out.push({ region: id(r), name, args: i.args });
      }
      regionsOf(i).forEach(walk);
    }
  };
  p.functions.forEach((f) => walk(f.body));
  return out;
}

/** Whether the trace `after` is `before` with its operands renamed by
 *  `resolve`. */
export function sameTrace(
  before: readonly TraceEntry[],
  after: readonly TraceEntry[],
  resolve: (v: V) => V = (v) => v
): boolean {
  return (
    before.length === after.length &&
    before.every(
      (x, k) =>
        x.region === after[k].region &&
        x.name === after[k].name &&
        x.args.every((a, j) => resolve(a) === after[k].args[j])
    )
  );
}
