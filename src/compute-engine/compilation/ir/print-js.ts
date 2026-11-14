/**
 * The JavaScript printer of the slice compiler, in the form of the stored
 * code of the existing compiler (`StoredJavaScript`): `preambleOnce`, the
 * helpers and the user functions, and `code`, an expression of the inputs
 * object `_` (for a root function literal, the function
 * `(a0, a1, …, _ = {}) => …` of the parameters by position, then the inputs
 * object for the free names of the body), in a scope where `_SYS` is the
 * runtime of `javascript-runtime.ts`. `run()` loads the code with the
 * loader of stored code (`twoStageRunner()`), so the code that runs here is
 * the code that a worker or another page loads.
 *
 * Each operation is spelled with the double arithmetic that the `fold` of
 * its row computes. An element-wise operation is an `Array.from()` over the
 * elements. A list result that can be (or hold) an input is a copy, so that
 * the host cannot change the input through it.
 *
 * A power, a `Mod` and the functions of `REAL_FUNCTIONS` and
 * `COMPLEX_FUNCTIONS` (a complex value is a `{ re, im }` object) call
 * `_SYS.ir`, the functions that the folds compute. A draw, a random frame,
 * an integral and the length of a `Range` call the members of the existing
 * compiler (`drawNextRandomNumber`, `withRandomSeed`, `integrate`,
 * `rangeCount`), so these are the interpreter's by construction; code that
 * draws or integrates is not shippable (`isShippableCode()`). Each loop and
 * build checks the deadline every 1024 iterations (`_SYS.tick()`); with an
 * `iterationBudget`, each pass of a `Loop` also counts one pass of the call
 * (`_SYS.countLoopPass()`), and the entry starts the count again.
 */

import type { IComputeEngine as ComputeEngine } from '../../global-types.js';
import {
  createSysRuntime,
  engineRuntimeSource,
  makeSysHelpers,
  twoStageRunner,
  type SysHelpers,
} from '../javascript-runtime.js';
import { argumentIndex, entryOf, type Program } from './ir.js';
import {
  COMPLEX_FUNCTIONS,
  REAL_FUNCTIONS,
  type OperatorRow,
} from './operators.js';
import { printProgram, type Printed, type Syntax } from './print.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The guard of a loop or a build of more than 2^32 iterations. */
const guard = (n: string, what: string) =>
  `if (!(${n} < 4294967296)) throw new RangeError('${what} of more than 2^32 iterations');`;

const tick = '  _SYS.tick();';

const number = (x: number) =>
  Object.is(x, -0) ? '(-0)' : x < 0 ? `(${x})` : String(x);

export const JS: Syntax = Object.freeze({
  ops: {
    add: '($0 + $1)',
    sub: '($0 - $1)',
    neg: '(-$0)',
    mul: '($0 * $1)',
    div: '($0 / $1)',
    pow: '_SYS.ir.pow($0, $1)',
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
    mod: '_SYS.ir.mod($0, $1)',
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
    draw: '_SYS.drawNextRandomNumber()',
    rangecount: '_SYS.rangeCount($0, $1, $2)',
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
        ([f, g]) => [f, `_SYS.ir.${f}(${g.length === 2 ? '$0, $1' : '$0'})`]
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
    integrate: ({ outs: [out], args: [a, b], params: [t] }) => ({
      open: [`const ${out} = _SYS.integrate((${t}) => {`],
      close: ([y]) => [`  return ${y};`, `}, ${a}, ${b});`],
    }),
    seeded: ({ outs, args: [seed] }) => ({
      open: [
        ...outs.map((o) => `let ${o};`),
        `_SYS.withRandomSeed(${seed}, () => {`,
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
  /** The value of a call: an expression of the inputs object `_`, or for
   *  a root function literal, the function of the positional arguments and
   *  then the inputs object. It reads `_SYS` and the names that
   *  `preambleOnce` defines. */
  readonly code: string;
  /** The helpers and the functions that `code` calls, evaluated once when
   *  the code is loaded (`''` when there is none). They read `_SYS`. */
  readonly preambleOnce: string;
  /** The function of the inputs object, or of the positional arguments
   *  and then the inputs object (a root function literal). */
  readonly run: (...args: any[]) => number | boolean | unknown[];
  readonly printed: Printed;
};

/** The runtime `_SYS` of the code: over the engine `ce` (its draws, its
 *  random frame and its deadline, read at each call), or with no engine,
 *  that of `createJavaScriptRuntime()`. */
export function runtimeOf(ce?: ComputeEngine): SysHelpers {
  return ce === undefined
    ? createSysRuntime()
    : makeSysHelpers(engineRuntimeSource(ce));
}

export function printJavaScript(
  p: Program,
  rows: readonly OperatorRow[],
  ce?: ComputeEngine,
  syntax: Syntax = JS,
  iterationBudget?: number
): JavaScriptResult {
  // With a budget, each pass of a `Loop` counts one pass of the call, as
  // `compile()`'s `iterationBudget` (floored, as the existing compiler).
  const budget =
    iterationBudget === undefined ? undefined : Math.floor(iterationBudget);
  const printed = printProgram(
    p,
    budget === undefined
      ? syntax
      : {
          ...syntax,
          loopOpen: (k, lo, hi, passes) => [
            ...syntax.loopOpen(k, lo, hi, passes),
            ...(passes ? [`  _SYS.countLoopPass(${budget});`] : []),
          ],
        },
    rows
  );
  const entry = entryOf(p);
  const n = argumentIndex(entry, entry.positional ?? 0);
  const params =
    n === 0
      ? '_'
      : `${Array.from({ length: n }, (_, k) => `a${k}`).join(', ')}, _ = {}`;
  const preambleOnce = [...printed.helpers, ...printed.functions].join('\n');
  // The count starts again at each call of the entry.
  const counts = [preambleOnce, ...printed.body].some((s) =>
    s.includes('_SYS.countLoopPass(')
  );
  const body = [
    ...(counts ? ['  _SYS.resetLoopPasses();'] : []),
    ...printed.body,
  ].join('\n');
  const literal = entry.literal === true;
  const code = literal
    ? `(${params}) => {\n${body}\n}`
    : `(() => {\n${body}\n})()`;
  // The construction of `load()` of `createJavaScriptRuntime()`.
  let run: JavaScriptResult['run'];
  try {
    const sys = runtimeOf(ce);
    run = (
      literal
        ? twoStageRunner(sys, preambleOnce, [], `return (${code});`)()
        : twoStageRunner(sys, preambleOnce, ['_'], `return ${code};`)
    ) as JavaScriptResult['run'];
  } catch (e) {
    throw new Error(
      `slice: the JavaScript printer made code that does not parse (${String(e)}), for the inputs ${entry.paramNames.join(', ')}:\n${preambleOnce}\n${code}`
    );
  }
  return { code, preambleOnce, run, printed };
}
