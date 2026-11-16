/**
 * The pass `plain` of the interval mode (README, "The interval mode",
 * "Integers and loops"), run after the other passes: it changes the
 * representation of a value, not its value. A value whose bound reaches
 * 2^53 is not plain, so a plain integer is always an exact double.
 */

import {
  lengthValues,
  mapLengths,
  outsOf,
  regionsOf,
  scalarType,
  type Instr,
  type Literal,
  type Program,
  type Region,
  type V,
} from './ir.js';
import { deepFreeze, type OperatorRow, type Signature } from './operators.js';

const LIMIT = 2 ** 53;
const INDEX = 2 ** 32;

/** The operation on plain integers of each integer operation. */
const PLAIN: Record<string, string> = {
  'add.int': 'add.num',
  'sub.int': 'sub.num',
  'neg.int': 'neg.num',
  'mul.int': 'mul.num',
};

/** The comparisons: a comparison of two plain integers is computed on
 *  numbers and gives a verdict string (`'true'` or `'false'`). */
const COMPARE: Record<string, string> = {
  lt: '<',
  le: '<=',
  gt: '>',
  ge: '>=',
  eq: '===',
  ne: '!==',
};

const I = 'integer';
const plainRow = (
  arity: 1 | 2,
  signatures: Signature[],
  effect: OperatorRow['effect'] = 'pure'
): OperatorRow =>
  deepFreeze({ arity, signatures, threads: false, effect } as OperatorRow);

/** The rows of the operations that the pass makes. */
export const PLAIN_ROWS: readonly OperatorRow[] = Object.freeze([
  plainRow(2, [[[I, I], I, 'add.num']]),
  plainRow(2, [[[I, I], I, 'sub.num']]),
  plainRow(1, [[[I], I, 'neg.num']]),
  plainRow(2, [[[I, I], I, 'mul.num']]),
  ...Object.keys(COMPARE).map((op) =>
    plainRow(2, [[[I, I], 'boolean', `${op}.num`]])
  ),
  plainRow(1, [[[I], I, 'point']]),
  plainRow(1, [[[I], I, 'number']], 'may-fail'),
  plainRow(2, [
    [['real', I], 'real', 'pow.num'],
    [[I, I], I, 'pow.int.num'],
  ]),
]);

/** The spellings of the operations of `PLAIN_ROWS` in the interval mode. */
export const PLAIN_SPELLINGS: Readonly<Record<string, string>> = Object.freeze(
  {
    'add.num': '($0 + $1)',
    'sub.num': '($0 - $1)',
    'neg.num': '(-$0)',
    'mul.num': '($0 * $1)',
    ...Object.fromEntries(
      Object.entries(COMPARE).map(([op, js]) => [
        `${op}.num`,
        `($0 ${js} $1 ? 'true' : 'false')`,
      ])
    ),
    'point': '{ lo: $0, hi: $0 }',
    'number': '_IA.number($0)',
    'pow.num': '_IA.pow($0, $1)',
    'pow.int.num': '_IA.pow($0, $1)',
  }
);

/** The pass (README, "The interval mode", "Lists" for the lengths and
 *  indexes). Returns the refusal of a program where a length would not be
 *  one number (a `Range` of a real operand), or `undefined`. */
export function plain(p: Program): string | undefined {
  /** The bound of the magnitude of each plain value. */
  const bound = new Map<V, number>();
  const fns = new Map(p.functions.map((f) => [f.name, f]));
  for (const f of p.functions)
    f.lengthOf.forEach((l, k) => l && bound.set(f.body.params[k], INDEX));
  let refusal: string | undefined;
  /** The integer constants, by value. */
  const constants = new Map<V, number>();
  // The `point` of a plain value and the twin of a constant made in each
  // open region, innermost last.
  const scopes: Map<string, V>[] = [];
  const made = (key: string, out: Instr[], make: (v: V) => Instr): V => {
    for (const s of scopes) if (s.has(key)) return s.get(key)!;
    const v = p.types.push(scalarType(I)) - 1;
    out.push(make(v));
    scopes[scopes.length - 1].set(key, v);
    return v;
  };
  const magnitude = (v: V) =>
    bound.get(v) ?? (constants.has(v) ? Math.abs(constants.get(v)!) : LIMIT);
  /** The plain constant `value`. */
  const twin = (value: number, out: Instr[]): V =>
    made(`c ${value}`, out, (w) => {
      bound.set(w, Math.abs(value));
      const literal: Literal = { lane: I, value, plain: true };
      return { k: 'const', out: w, value: literal };
    });
  /** `v` as a number: a plain value, the twin of a constant, or `number`. */
  const asNumber = (v: V, out: Instr[]): V => {
    if (bound.has(v)) return v;
    if (constants.has(v)) return twin(constants.get(v)!, out);
    return made(`n ${v}`, out, (w) => {
      bound.set(w, INDEX);
      return { k: 'op', out: w, op: 'number', args: [v] };
    });
  };
  /** `v` as an interval. */
  const asInterval = (v: V, out: Instr[]): V =>
    bound.has(v)
      ? made(`p ${v}`, out, (w) => ({ k: 'op', out: w, op: 'point', args: [v] }))
      : v;
  const region = (r: Region): void => {
    scopes.push(new Map());
    const body: Instr[] = [];
    for (const i of r.body) {
      if (
        i.k === 'const' &&
        i.value.lane === I &&
        Number.isSafeInteger(i.value.value)
      )
        constants.set(i.out, i.value.value as number);
      if (i.k === 'op' && i.op in PLAIN) {
        const b = i.args.map(magnitude);
        const m = i.op === 'mul.int' ? b[0] * b[1] : b.reduce((s, x) => s + x);
        // Every operand is plain or a constant: a product by the constant 0
        // has the bound 0 whatever its other operand is.
        if (
          m < LIMIT &&
          i.args.every((a) => bound.has(a) || constants.has(a))
        ) {
          i.args = i.args.map((a) => asNumber(a, body));
          i.op = PLAIN[i.op];
          bound.set(i.out, m);
          body.push(i);
          continue;
        }
      }
      if (
        i.k === 'op' &&
        i.op in COMPARE &&
        i.args.every((a) => bound.has(a) || constants.has(a))
      ) {
        // Two plain integers, compared on numbers, give a verdict string:
        // the test of a total length against 0 in `Max`, for example.
        i.args = i.args.map((a) => asNumber(a, body));
        i.op = `${i.op}.num`;
        body.push(i);
        continue;
      }
      // A scalar power only: the rows of `pow.num` do not thread, and a list
      // power stays `pow`, `_IA.powReal` of each element.
      if (
        i.k === 'op' &&
        (i.op === 'pow' || i.op === 'pow.int') &&
        p.types[i.out].shape.length === 0 &&
        magnitude(i.args[1]) < LIMIT
      ) {
        i.args = [asInterval(i.args[0], body), asNumber(i.args[1], body)];
        i.op = i.op === 'pow' ? 'pow.num' : 'pow.int.num';
        body.push(i);
        continue;
      }
      if (i.k === 'op' && i.op === 'at' && constants.has(i.args[1])) {
        // `At(L, k)` of a constant `k` in range of a stated length.
        const [k, n] = [constants.get(i.args[1])!, p.types[i.args[0]].shape[0]];
        if (typeof n === 'number' && k !== 0 && Math.abs(k) <= n) {
          i.args = [i.args[0], twin(k > 0 ? k - 1 : n + k, body)];
          i.op = 'elem';
        }
      }
      if (i.k === 'op' && (i.op === 'rangecount' || i.op === 'rangestep')) {
        if (i.args.some((a) => p.types[a].lane !== I))
          refusal ??= 'a Range of a real operand';
        i.args = i.args.map((a) => asNumber(a, body));
        bound.set(i.out, i.op === 'rangestep' ? 1 : INDEX);
      } else if (i.k === 'op' && i.op === 'elem')
        i.args = [i.args[0], asNumber(i.args[1], body)];
      else if (i.k === 'call') {
        const f = fns.get(i.fn)!;
        i.args = i.args.map((a, k) =>
          f.lengthOf[k] ? asNumber(a, body) : asInterval(a, body)
        );
        // The list, then its length (`lower-functions.ts`).
        if (i.outs.length === 2) bound.set(i.outs[0], INDEX);
      } else if (i.k === 'region' && (i.op === 'build' || i.op === 'filter')) {
        i.args = i.args.map((a) => asNumber(a, body));
        bound.set(i.regions[0].params[0], INDEX);
        if (i.op === 'filter') bound.set(i.outs[0], INDEX);
      } else if (i.k === 'loop') {
        i.lo = asNumber(i.lo, body);
        i.hi = asNumber(i.hi, body);
        i.init = i.init.map((v) => asInterval(v, body));
        bound.set(
          i.body.params[0],
          Math.max(INDEX, magnitude(i.lo), magnitude(i.hi))
        );
      } else if (i.k !== 'const' && i.k !== 'if')
        i.args = i.args.map((a) => asInterval(a, body));
      // A length that is a constant is its plain twin.
      for (const v of [...outsOf(i), ...regionsOf(i).flatMap((r) => r.params)]) {
        p.types[v] = mapLengths(p.types[v], (n) =>
          constants.has(n) ? asNumber(n, body) : n
        );
        if (lengthValues(p.types[v]).some((n) => !bound.has(n)))
          refusal ??= 'a list whose length is not one number';
      }
      regionsOf(i).forEach(region);
      body.push(i);
    }
    r.body = body;
    r.yields = r.yields.map((y) => asInterval(y, r.body));
    scopes.pop();
  };
  p.functions.forEach((f) => region(f.body));
  return refusal;
}
