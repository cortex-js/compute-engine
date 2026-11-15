/**
 * The pass `plain` of the interval mode (README, "The interval mode"), run
 * after the other passes: it changes the representation of a value, not
 * its value.
 *
 * A plain integer is an integer constant, the index of a loop, or the
 * `add.int`, `sub.int`, `neg.int` or `mul.int` of plain integers, with a
 * static bound of its magnitude: the constant, 2^32 or the larger bound of
 * its loop for an index, the sum or the product of the bounds. A value
 * whose bound reaches 2^53 is not plain, so a plain integer is always an
 * exact double. A plain integer is a number of the target, and its
 * operations are the JavaScript ones (`add.num`); a plain constant is a
 * twin literal marked `plain`. Every other value is an interval. Where an
 * interval operation (an `if` or a function result included) reads a plain
 * integer, the pass adds `point` (`{ lo: n, hi: n }`); where a loop reads an
 * interval as a bound, it adds `number` (`_IA.number(x)`, which throws for
 * a value that is not one integer). A `pow` whose exponent is plain is
 * `pow.num`, the kernel `_IA.pow` of a number exponent. After the pass every
 * loop has number bounds and a number index, and no code tests a
 * representation.
 */

import {
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
    'point': '{ lo: $0, hi: $0 }',
    'number': '_IA.number($0)',
    'pow.num': '_IA.pow($0, $1)',
    'pow.int.num': '_IA.pow($0, $1)',
  }
);

export function plain(p: Program): void {
  /** The bound of the magnitude of each plain value. */
  const bound = new Map<V, number>();
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
  /** `v` as a number: a plain value, the twin of a constant, or `number`. */
  const asNumber = (v: V, out: Instr[]): V => {
    if (bound.has(v)) return v;
    if (constants.has(v)) {
      const value = constants.get(v)!;
      return made(`c ${value}`, out, (w) => {
        bound.set(w, Math.abs(value));
        const literal: Literal = { lane: I, value, plain: true };
        return { k: 'const', out: w, value: literal };
      });
    }
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
        (i.op === 'pow' || i.op === 'pow.int') &&
        magnitude(i.args[1]) < LIMIT
      ) {
        i.args = [asInterval(i.args[0], body), asNumber(i.args[1], body)];
        i.op = i.op === 'pow' ? 'pow.num' : 'pow.int.num';
        body.push(i);
        continue;
      }
      if (i.k === 'loop') {
        i.lo = asNumber(i.lo, body);
        i.hi = asNumber(i.hi, body);
        i.init = i.init.map((v) => asInterval(v, body));
        bound.set(
          i.body.params[0],
          Math.max(INDEX, magnitude(i.lo), magnitude(i.hi))
        );
      } else if (i.k !== 'const' && i.k !== 'if')
        i.args = i.args.map((a) => asInterval(a, body));
      regionsOf(i).forEach(region);
      body.push(i);
    }
    r.body = body;
    r.yields = r.yields.map((y) => asInterval(y, r.body));
    scopes.pop();
  };
  p.functions.forEach((f) => region(f.body));
}
