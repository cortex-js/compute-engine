/**
 * The passes of the slice compiler. Each pass is target-independent and
 * keeps the value of the program within the target's precision; none
 * changes the operation of a computation (`a/b` stays a division).
 *
 * - `scalarize`: an operation on static lists becomes one operation per
 *   element (for a target with no element-wise operations), and an `At` of
 *   a constant index in range of a static list an element (`elem`).
 * - `fold`: a pure operation whose operands are constants is the value of
 *   its row's `fold` (the constants that the passes expose: a sub-expression
 *   with no input is a literal already, `lower.ts`); an element of a list
 *   literal is that element; an element of an element-wise operation is the
 *   operation on elements; the `At` of `scalarize`; a conditional with no
 *   effect whose condition is a constant is the arm it takes.
 * - `hoist`: the operands of `And` and `Or` are lowered in an arm (only
 *   evaluated when needed); a pure operand is moved out of its arm, and the
 *   conditional becomes the `and` or `or` it is.
 * - `strength`: `pow` with a literal exponent 1 to 16 is a product: the
 *   definition of `pow` (`realPow()`).
 * - `cse`: an instruction that repeats an earlier mergeable one whose value
 *   is visible reads that value instead. No value is moved.
 * - `dce`: an instruction whose values are not read (by an instruction, a
 *   yield or a type) is removed, when it is removable.
 *
 * `fold`, `hoist`, `strength`, `cse` and `dce` run again while one of them
 * changes the program. After each pass the program is verified, and its
 * effectful instructions must be the same, in the same regions and order,
 * on the same operands (renamed by the pass).
 */

import {
  argsOf,
  elementType,
  lengthValues,
  literalKey,
  mapDirectArgs,
  mapLengths,
  outsOf,
  regionsOf,
  scalarType,
  type Cx,
  type IRType,
  type Instr,
  type Literal,
  type Program,
  type Region,
  type V,
} from './ir.js';
import { effects, effectTrace, sameTrace } from './effects.js';
import {
  foldOf,
  MAX_PRODUCT_EXPONENT,
  rowOfOp,
  type OperatorRow,
} from './operators.js';
import { SliceInternalError, verify } from './verify.js';

export type PassOptions = {
  scalarize?: boolean;
  fold?: boolean;
  hoist?: boolean;
  strength?: boolean;
  cse?: boolean;
  dce?: boolean;
};

export const ALL_PASSES: PassOptions = Object.freeze({
  fold: true,
  hoist: true,
  strength: true,
  cse: true,
  dce: true,
});

/** A pass: whether it changed the program, and how it renamed values. */
type Pass = (
  p: Program,
  rows: readonly OperatorRow[]
) => { changed: boolean; resolve: (v: V) => V };

export function runPasses(
  p: Program,
  options: PassOptions,
  rows: readonly OperatorRow[]
): Program {
  const ids = new Map<Region, number>();
  const run = (name: string, pass: Pass): boolean => {
    const before = effectTrace(p, rows, ids).map((x) => ({
      ...x,
      args: [...x.args],
      outs: [...x.outs],
    }));
    const { changed, resolve } = pass(p, rows);
    verify(p, rows);
    if (!sameTrace(before, effectTrace(p, rows, ids), resolve))
      throw new SliceInternalError(
        `slice pass ${name} changed the effectful instructions`
      );
    return changed;
  };
  if (options.scalarize) run('scalarize', scalarize);
  for (let round = 0; round < 8; round++) {
    let changed = false;
    if (options.fold) changed = run('fold', fold) || changed;
    if (options.hoist) changed = run('hoist', hoist) || changed;
    if (options.strength) changed = run('strength', strength) || changed;
    if (options.cse) changed = run('cse', cse) || changed;
    if (options.dce) changed = run('dce', dce) || changed;
    if (!changed) break;
  }
  return p;
}

/**
 * Rewrite each region of `p` once, in order. `f` returns `undefined` to
 * keep an instruction, or the instructions that replace it, which are
 * rewritten in turn; it records in `subst` each value that another value
 * replaces. The operands of an instruction (and the lengths of the types)
 * are substituted. `enter` brackets the rewrite of each region.
 */
function rewrite(
  p: Program,
  f: (i: Instr, subst: Map<V, V>) => Instr[] | undefined,
  enter: (inside: () => void) => void = (inside) => inside()
): { changed: boolean; resolve: (v: V) => V } {
  const subst = new Map<V, V>();
  let changed = false;
  const resolve = (v: V): V => {
    while (subst.has(v)) v = subst.get(v)!;
    return v;
  };
  const instrs = (list: Instr[], out: Instr[]) => {
    for (const i of list) {
      mapDirectArgs(i, resolve);
      const replacement = f(i, subst);
      if (replacement === undefined) {
        regionsOf(i).forEach(region);
        out.push(i);
      } else {
        changed = true;
        instrs(replacement, out);
      }
    }
  };
  const region = (r: Region) =>
    enter(() => {
      const body: Instr[] = [];
      instrs(r.body, body);
      r.body = body;
      r.yields = r.yields.map(resolve);
    });
  for (const fn of p.functions) region(fn.body);
  if (subst.size > 0) {
    p.types = p.types.map((t) => mapLengths(t, resolve));
    for (const fn of p.functions)
      fn.results.splice(
        0,
        Infinity,
        ...fn.results.map((t) => mapLengths(t, resolve))
      );
  }
  return { changed: changed || subst.size > 0, resolve };
}

/** A new value of type `t`. */
function fresh(p: Program, t: IRType): V {
  p.types.push(t);
  return p.types.length - 1;
}

/** A constant `value` of `lane`, appended to `out`. */
function constant(
  p: Program,
  value: number | boolean,
  lane: 'integer' | 'boolean',
  out: Instr[]
): V {
  const v = fresh(p, scalarType(lane));
  out.push({ k: 'const', out: v, value: { lane, value } as Literal });
  return v;
}

/** The element `k` of the list `a`: a constant index and an `elem`. */
function element(p: Program, a: V, k: number, out: Instr[]): V {
  const index = constant(p, k, 'integer', out);
  const e = fresh(p, elementType(p.types[a]));
  out.push({ k: 'op', out: e, op: 'elem', args: [a, index] });
  return e;
}

/** `At(l, i)` of a constant index `i` in range of a static list `l` as an
 *  `elem`, or `undefined`. */
function atToElem(
  p: Program,
  i: Instr,
  index: number | undefined
): Instr[] | undefined {
  if (i.k !== 'op' || i.op !== 'at' || index === undefined) return undefined;
  const n = p.types[i.args[0]].shape[0];
  if (
    typeof n !== 'number' ||
    !Number.isInteger(index) ||
    index === 0 ||
    Math.abs(index) > n
  )
    return undefined;
  const out: Instr[] = [];
  const k = constant(p, index > 0 ? index - 1 : n + index, 'integer', out);
  out.push({ k: 'op', out: i.out, op: 'elem', args: [i.args[0], k] });
  return out;
}

/** Whether the operation `op` applies to each element of a list result. */
const threads = (rows: readonly OperatorRow[], op: string) =>
  rowOfOp(rows, op)?.row.threads === true;

/** The instructions that compute the element-wise `op` `i` on scalars. */
function perElement(
  p: Program,
  rows: readonly OperatorRow[],
  i: Instr & { k: 'op' },
  out: Instr[]
): V {
  const t = p.types[i.out];
  if (t.shape.length === 0 || !threads(rows, i.op)) {
    out.push(i);
    return i.out;
  }
  const elements: V[] = [];
  for (let k = 0; k < (t.shape[0] as number); k++) {
    const args = i.args.map((a) =>
      p.types[a].shape.length === 0 ? a : element(p, a, k, out)
    );
    const o = fresh(p, elementType(t));
    elements.push(
      perElement(p, rows, { k: 'op', out: o, op: i.op, args }, out)
    );
  }
  out.push({ k: 'list', out: i.out, args: elements });
  return i.out;
}

const scalarize: Pass = (p, rows) => {
  const constants = new Map<V, number | boolean | Cx>();
  return rewrite(p, (i) => {
    if (i.k === 'const') constants.set(i.out, i.value.value);
    if (i.k !== 'op') return undefined;
    const at = atToElem(p, i, constants.get(i.args[1]) as number | undefined);
    if (at !== undefined) return at;
    const t = p.types[i.out];
    if (t.shape.length === 0 || !threads(rows, i.op)) return undefined;
    if (!t.shape.every((n) => typeof n === 'number')) return undefined;
    const out: Instr[] = [];
    perElement(p, rows, i, out);
    return out;
  });
};

const fold: Pass = (p, rows) => {
  const fx = effects(p, rows);
  const constants = new Map<V, Literal>();
  const defs = new Map<V, Instr>();
  return rewrite(p, (i, subst) => {
    for (const o of outsOf(i)) defs.set(o, i);
    if (i.k === 'const') constants.set(i.out, i.value);
    const at = atToElem(
      p,
      i,
      constants.get((i as { args?: V[] }).args?.[1] ?? -1)?.value as
        number | undefined
    );
    if (at !== undefined) return at;
    if (i.k === 'op' && i.op === 'elem' && constants.has(i.args[1])) {
      const [a, index] = i.args;
      const k = constants.get(index)!.value as number;
      const list = defs.get(a);
      if (list?.k === 'list') {
        subst.set(i.out, list.args[k]);
        return [];
      }
      if (list?.k === 'op' && fx.speculatable(list) && threads(rows, list.op)) {
        // The operation on the elements of its list operands; a new value
        // of the operation's element type (`i.out` can have a wider lane).
        const out: Instr[] = [];
        const args = list.args.map((x) =>
          p.types[x].shape.length === 0 ? x : element(p, x, k, out)
        );
        const o = fresh(p, elementType(p.types[list.out]));
        out.push({ k: 'op', out: o, op: list.op, args });
        subst.set(i.out, o);
        return out;
      }
    }
    if (
      i.k === 'op' &&
      fx.speculatable(i) &&
      i.args.every((a) => constants.has(a))
    ) {
      const args = i.args.map((a) => constants.get(a)!.value);
      const value = foldOf(rows, i.op)?.(...args);
      if (value !== undefined)
        return [
          {
            k: 'const',
            out: i.out,
            value: { lane: p.types[i.out].lane, value } as Literal,
          },
        ];
    }
    if (i.k === 'if' && constants.has(i.cond) && fx.of(i) !== 'effectful') {
      const taken = constants.get(i.cond)!.value ? i.then : i.else;
      taken.yields.forEach((y, j) => subst.set(i.outs[j], y));
      return taken.body;
    }
    return undefined;
  });
};

/** `if (c) { …y } else { false }` is `and(c, y)`, `if (c) { true } else
 *  { …y }` is `or(c, y)`, when the body of `y` is pure: it moves out. */
const hoist: Pass = (p, rows) => {
  const fx = effects(p, rows);
  const constants = new Map<V, boolean>();
  return rewrite(p, (i) => {
    if (i.k === 'const' && i.value.lane === 'boolean')
      constants.set(i.out, i.value.value);
    if (i.k !== 'if' || i.outs.length !== 1) return undefined;
    const decided = (r: Region) => {
      const c = r.body.find((x) => x.k === 'const' && x.out === r.yields[0]);
      return r.body.every((x) => x.k === 'const')
        ? ((c as { value?: Literal } | undefined)?.value?.value ??
            constants.get(r.yields[0]))
        : undefined;
    };
    const op =
      decided(i.else) === false
        ? 'and'
        : decided(i.then) === true
          ? 'or'
          : undefined;
    if (op === undefined) return undefined;
    const arm = op === 'and' ? i.then : i.else;
    if (!arm.body.every((x) => fx.speculatable(x))) return undefined;
    return [
      ...arm.body,
      { k: 'op', out: i.outs[0], op, args: [i.cond, arm.yields[0]] },
    ];
  });
};

const strength: Pass = (p) => {
  const constants = new Map<V, number | boolean | Cx>();
  return rewrite(p, (i, subst) => {
    if (i.k === 'const') constants.set(i.out, i.value.value);
    if (i.k !== 'op' || i.op !== 'pow') return undefined;
    const [base, exponent] = i.args;
    const n = constants.get(exponent);
    const t = p.types[i.out];
    if (n === 1) {
      subst.set(i.out, base);
      return [];
    }
    if (
      typeof n === 'number' &&
      Number.isInteger(n) &&
      n >= 2 &&
      n <= MAX_PRODUCT_EXPONENT
    ) {
      const out: Instr[] = [];
      let acc = base;
      for (let k = 1; k < n; k++) {
        const next = k === n - 1 ? i.out : fresh(p, t);
        out.push({ k: 'op', out: next, op: 'mul', args: [acc, base] });
        acc = next;
      }
      return out;
    }
    return undefined;
  });
};

const cse: Pass = (p, rows) => {
  const fx = effects(p, rows);
  // The keys of the visible instructions, one map per open region.
  const scopes: Map<string, V>[] = [];
  const key = (i: Instr): string | undefined => {
    if (!fx.mergeable(i)) return undefined;
    if (i.k === 'const') return literalKey(i.value.lane, i.value.value);
    if (i.k === 'op') return `o ${i.op} ${i.args.join(',')}`;
    if (i.k === 'list') return `l ${p.types[i.out].lane} ${i.args.join(',')}`;
    return undefined;
  };
  return rewrite(
    p,
    (i, subst) => {
      const k = key(i);
      if (k === undefined) return undefined;
      const found = scopes.map((s) => s.get(k)).find((v) => v !== undefined);
      if (found !== undefined) {
        subst.set(outsOf(i)[0], found);
        return [];
      }
      scopes[scopes.length - 1].set(k, outsOf(i)[0]);
      return undefined;
    },
    (inside) => {
      scopes.push(new Map());
      inside();
      scopes.pop();
    }
  );
};

/** One backward pass per region: an instruction is kept when one of its
 *  values is read later (or names the length of a value read later), or
 *  when it is not removable. */
const dce: Pass = (p, rows) => {
  const fx = effects(p, rows);
  const live = new Set<V>();
  let changed = false;
  const read = (v: V) => {
    live.add(v);
    lengthValues(p.types[v]).forEach((n) => live.add(n));
  };
  const region = (r: Region) => {
    r.yields.forEach(read);
    const kept: Instr[] = [];
    for (let j = r.body.length - 1; j >= 0; j--) {
      const i = r.body[j];
      if (!outsOf(i).some((v) => live.has(v)) && fx.removable(i)) {
        changed = true;
        continue;
      }
      outsOf(i).forEach(read);
      argsOf(i).forEach(read);
      regionsOf(i).forEach(region);
      kept.push(i);
    }
    r.body = kept.reverse();
  };
  for (const f of p.functions) {
    f.body.params.forEach(read);
    region(f.body);
  }
  return { changed, resolve: (v) => v };
};
