/**
 * The JavaScript printer of the slice compiler: a function of an inputs
 * object, `(_) => { … }`. Each operation is spelled with the double
 * arithmetic that the `fold` of its row computes. An element-wise operation
 * is an `Array.from()` over the elements. A list result that can be (or
 * hold) an input is a copy, so that the host cannot change the input
 * through it.
 *
 * A draw, a random frame, a power, a `Mod`, the length of a `Range` and the
 * functions of `REAL_FUNCTIONS` and `COMPLEX_FUNCTIONS` (a complex value
 * is a `{ re, im }` object) call the runtime `_rt`: the engine's own
 * `makeRandomHelpers()` (over the engine's frame slot, `ce._random()`),
 * `realPow()` (the interpreter's real root of a negative base),
 * `floorMod()` (which throws beyond the safe integer range) and
 * `rangeCount()`, so these are the interpreter's by construction. Each loop and build checks the engine's deadline every
 * 1024 iterations (`_rt.tick()`).
 *
 * The entry is `(_) => …` of an inputs object; for a root function literal
 * it is `(a0, a1, …, _ = {}) => …`: the parameters by position, then the
 * inputs object for the free names of the body.
 */

import type { IComputeEngine as ComputeEngine } from '../../global-types.js';
import { makeRandomHelpers } from '../javascript-runtime.js';
import type { RandomSeedFrame } from '../../numerics/random.js';
import { rangeCount } from '../../numerics/range-count.js';
import {
  checkDeadlineEvery,
  makeLoopPassCounter,
} from '../../../common/interruptible.js';
import { argumentIndex, entryOf, type Program } from './ir.js';
import {
  COMPLEX_FUNCTIONS,
  floorMod,
  realPow,
  REAL_FUNCTIONS,
  type OperatorRow,
} from './operators.js';
import { printProgram, type Printed, type Syntax } from './print.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The guard of a loop or a build of more than 2^32 iterations. */
const guard = (n: string, what: string) =>
  `if (!(${n} < 4294967296)) throw new RangeError('${what} of more than 2^32 iterations');`;

const tick = '  _rt.tick();';

const number = (x: number) =>
  Object.is(x, -0) ? '(-0)' : x < 0 ? `(${x})` : String(x);

export const JS: Syntax = Object.freeze({
  ops: {
    add: '($0 + $1)',
    sub: '($0 - $1)',
    neg: '(-$0)',
    mul: '($0 * $1)',
    div: '($0 / $1)',
    pow: '_rt.pow($0, $1)',
    sqrt: 'Math.sqrt($0)',
    abs: 'Math.abs($0)',
    exp: 'Math.exp($0)',
    ln: 'Math.log($0)',
    sin: 'Math.sin($0)',
    cos: 'Math.cos($0)',
    tan: 'Math.tan($0)',
    floor: 'Math.floor($0)',
    ceil: 'Math.ceil($0)',
    round: { text: '_round($0)', helpers: ['_round'] },
    mod: '_rt.mod($0, $1)',
    max: 'Math.max($0, $1)',
    min: 'Math.min($0, $1)',
    lt: '($0 < $1)',
    le: '($0 <= $1)',
    gt: '($0 > $1)',
    ge: '($0 >= $1)',
    eq: '($0 === $1)',
    ne: '($0 !== $1)',
    and: '($0 && $1)',
    or: '($0 || $1)',
    not: '(!$0)',
    elem: '$0[$1]',
    at: { text: '_at($0, $1)', helpers: ['_at'] },
    draw: '_rt.drawNextRandomNumber()',
    rangecount: '_rt.rangeCount($0, $1, $2)',
    rangestep: '($1 >= $0 ? 1 : -1)',
    trunc: 'Math.trunc($0)',
    sign: 'Math.sign($0)',
    log10: 'Math.log10($0)',
    hypot: 'Math.hypot($0, $1)',
    atan: 'Math.atan($0)',
    asin: 'Math.asin($0)',
    acos: 'Math.acos($0)',
    asinh: 'Math.asinh($0)',
    acosh: 'Math.acosh($0)',
    atanh: 'Math.atanh($0)',
    // The functions of `REAL_FUNCTIONS` and `COMPLEX_FUNCTIONS`, by name.
    ...Object.fromEntries(
      Object.entries({ ...REAL_FUNCTIONS, ...COMPLEX_FUNCTIONS }).map(
        ([f, g]) => [f, `_rt.${f}(${g.length === 2 ? '$0, $1' : '$0'})`]
      )
    ),
  },
  regions: {
    build: ({ outs: [out], args: [n], params: [k] }) => ({
      open: [
        `const ${out} = [], ${out}_n = ${n};`,
        guard(`${out}_n`, 'a list'),
        `for (let ${k} = 0; ${k} < ${out}_n; ${k}++) {`,
        tick,
      ],
      close: ([y]) => [`  ${out}.push(${y});`, '}'],
    }),
    filter: ({ outs: [count, out], args: [n], params: [k] }) => ({
      open: [
        `const ${out} = [], ${out}_n = ${n};`,
        guard(`${out}_n`, 'a list'),
        `for (let ${k} = 0; ${k} < ${out}_n; ${k}++) {`,
        tick,
      ],
      close: ([keep, y]) => [
        `  if (${keep}) ${out}.push(${y});`,
        '}',
        `const ${count} = ${out}.length;`,
      ],
    }),
    seeded: ({ outs, args: [seed] }) => ({
      open: [
        ...outs.map((o) => `let ${o};`),
        `_rt.withRandomSeed(${seed}, () => {`,
      ],
      close: (ys) => [...ys.map((y, j) => `  ${outs[j]} = ${y};`), '});'],
    }),
  },
  helpers: {
    _round: 'const _round = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));',
    _at: 'const _at = (l, i) => { const k = i > 0 ? i - 1 : l.length + i; return Number.isInteger(i) && i !== 0 && k >= 0 && k < l.length ? l[k] : NaN; };',
  },
  constant: ({ value: x }) =>
    typeof x === 'object'
      ? `({ re: ${number(x.re)}, im: ${number(x.im)} })`
      : typeof x === 'boolean'
        ? String(x)
        : number(x),
  input: (name) =>
    IDENTIFIER.test(name) ? `_.${name}` : `_[${JSON.stringify(name)}]`,
  positional: (_name, k) => `a${k}`,
  length: (list) => `${list}.length`,
  list: (elements) => `[${elements.join(', ')}]`,
  map: (lengths, body) => {
    const index = lengths.map((_, d) => `i${d}`);
    return lengths.reduceRight<string>(
      (s, n, d) => `Array.from({ length: ${n} }, (_e, ${index[d]}) => ${s})`,
      body(index)
    );
  },
  declare: (_type, name, value, mutable) =>
    `${mutable ? 'let' : 'const'} ${name}${value === undefined ? '' : ` = ${value}`};`,
  assign: (name, value) => `${name} = ${value};`,
  ifOpen: (cond) => `if (${cond}) {`,
  elseOpen: '} else {',
  loopOpen: (k, lo, hi) => [
    `const ${k}_lo = ${lo}, ${k}_hi = ${hi};`,
    guard(`${k}_hi - ${k}_lo`, 'a loop'),
    `for (let ${k} = ${k}_lo; ${k} <= ${k}_hi; ${k}++) {`,
    tick,
  ],
  close: '}',
  ret: (value, _type, copy) =>
    `return ${copy ? `structuredClone(${value})` : value};`,
  call: (fn, args) => `${fn}(${args.join(', ')})`,
  fn: (name, params, _result, body) =>
    [
      `const ${name} = (${params.map((p) => p.name).join(', ')}) => {`,
      ...body,
      '};',
    ].join('\n'),
});

[JS.ops, JS.regions, JS.helpers].forEach((t) => Object.freeze(t));

export type JavaScriptResult = {
  /** A JavaScript expression whose value is the function of the inputs
   *  object, in a scope where `_rt` is the runtime. */
  readonly code: string;
  /** The function of the inputs object, or of the positional arguments
   *  and then the inputs object (a root function literal). */
  readonly run: (...args: any[]) => number | boolean | unknown[];
  readonly printed: Printed;
};

/** The runtime of the code: over the frame slot and the draws of `ce`, or
 *  with no engine, a slot of its own and `Math.random()`. `tick()` begins
 *  each pass of a loop or a build: it checks the engine's deadline every
 *  1024 passes and, with a `budget`, adds one to the passes of the call
 *  (`resetPasses()` at its start), as `compile()`'s `iterationBudget`. */
export function javascriptRuntime(
  ce: ComputeEngine | undefined,
  budget?: number
) {
  const passes = makeLoopPassCounter();
  const limit = budget === undefined ? undefined : Math.floor(budget);
  let slot: RandomSeedFrame | undefined;
  const random = makeRandomHelpers({
    random: () => (ce ? ce._liveRandom() : Math.random()),
    draw: ce ? () => ce._random() : undefined,
    frame: () => (ce ? ce._randomFrame : slot),
    setFrame: (frame) => {
      if (ce) ce._randomFrame = frame;
      else slot = frame;
    },
    iterationLimit: () => ce?.iterationLimit ?? Infinity,
    deadline: () => ce?._deadlineFrame,
  });
  // `REAL_FUNCTIONS` and `COMPLEX_FUNCTIONS` first: a member of the same
  // name after them would replace one, which a test refuses.
  return {
    ...REAL_FUNCTIONS,
    ...COMPLEX_FUNCTIONS,
    ...random,
    withRandomSeed: <T>(seed: unknown, body: () => T): T => {
      if (typeof seed !== 'number' || !Number.isFinite(seed))
        throw new RangeError(
          `WithRandomSeed: the seed is ${String(seed)}, not a finite number`
        );
      return random.withRandomSeed(seed, body);
    },
    rangeCount,
    pow: realPow,
    mod: floorMod,
    tick:
      limit === undefined
        ? () => checkDeadlineEvery(ce?._deadlineFrame, 0x3ff)
        : () => {
            checkDeadlineEvery(ce?._deadlineFrame, 0x3ff);
            passes.countLoopPass(limit);
          },
    resetPasses: passes.resetLoopPasses,
  };
}

export function printJavaScript(
  p: Program,
  rows: readonly OperatorRow[],
  ce?: ComputeEngine,
  syntax: Syntax = JS,
  iterationBudget?: number
): JavaScriptResult {
  const printed = printProgram(p, syntax, rows);
  const entry = entryOf(p);
  const n = argumentIndex(entry, entry.positional ?? 0);
  const params =
    n === 0
      ? '_'
      : `${Array.from({ length: n }, (_, k) => `a${k}`).join(', ')}, _ = {}`;
  const fn = `(${params}) => {\n${printed.body.join('\n')}\n}`;
  const preamble = [...printed.helpers, ...printed.functions];
  const code =
    preamble.length === 0
      ? fn
      : `(() => {\n${preamble.join('\n').replace(/^/gm, '  ')}\n  return ${fn.replace(/\n/g, '\n  ')};\n})()`;
  let run: JavaScriptResult['run'];
  try {
    const rt = javascriptRuntime(ce, iterationBudget);
    const f = new Function('_rt', `return ${code};`)(rt);
    run =
      iterationBudget === undefined
        ? f
        : (...args: unknown[]) => {
            rt.resetPasses();
            return f(...args);
          };
  } catch (e) {
    throw new Error(
      `slice: the JavaScript printer made code that does not parse (${String(e)}), for the inputs ${entryOf(p).paramNames.join(', ')}:\n${code}`
    );
  }
  return { code, run, printed };
}
