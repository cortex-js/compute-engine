/**
 * The JavaScript printer of the slice compiler, in the form of stored
 * code (`StoredJavaScript`): `preambleOnce`, the
 * helpers and the user functions, and `code`, an expression of the inputs
 * object `_` (for a root function literal, the function
 * `(a0, a1, …, _ = {}) => …` of the parameters by position, then the inputs
 * object for the free names of the body), in a scope where `_SYS` is the
 * runtime of `javascript-runtime.ts`. `run()` loads the code with the
 * loader of stored code (`twoStageRunner()`), so the code that runs here is
 * the code that a worker or another page loads.
 *
 * Each operation is spelled with the double arithmetic that the `fold` of
 * its row computes. An element-wise operation is an array of its length
 * filled by a `for` loop, one loop for a chain of such operations of one
 * shape. A result is read-only: it can be an input, hold a part of one, or
 * be a list of constants that every call shares.
 *
 * A power, a `Mod`, the functions of the folds, a draw, a random frame,
 * an integral and the count of the passes of a loop call `_SYS` (README,
 * "Loops and the runtime").
 */

import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../../global-types.js';
import { isCancellationError } from '../../interval/run-support.js';
import {
  isMutableArray,
  isNumber,
  isString,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import {
  createSysRuntime,
  engineRuntimeSource,
  makeSysHelpers,
  twoStageRunner,
  type SysHelpers,
} from '../javascript-runtime.js';
import {
  argumentIndex,
  entryOf,
  loopPasses,
  recursiveFunctions,
  regionsOf,
  useIndex,
  type ArrayMaker,
  type ArrayUse,
  type Assigned,
  type HostCall,
  type Instr,
  type IRType,
  type Program,
  type Region,
  type V,
} from './ir.js';
import {
  COMPLEX_FUNCTIONS,
  deepFreeze,
  REAL_FUNCTIONS,
  rowOfOp,
  type OperatorRow,
} from './operators.js';
import {
  ARITHMETIC,
  calls,
  COMPARISONS,
  LOGIC,
  printProgram,
  type Printed,
  type RegionSpelling,
  type Syntax,
} from './print.js';
import { TEXT, TEXT_REGIONS } from './print-js-text.js';
import { arrayEntryCheck } from './lower-arrays.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The guard of a loop or a build of more than 2^32 iterations (2^53 for
 *  a loop with an exit: it can end sooner). */
const guard = (n: string, what: string, bits = 32) =>
  `if (!(${n} < ${2 ** bits})) throw new RangeError('${what} of more than 2^${bits} iterations');`;

/** The integers of a mode: `zero`, the literal `c` (`5` or `5n`), the
 *  number of an integer (`toNumber()`), the least of two (`min()`) and the
 *  integer part of a difference of bounds (`floor()`). */
type Ints = {
  zero: string;
  c: (x: number) => string;
  toNumber: Wrap;
  min: (a: string, b: string) => string;
  floor: Wrap;
};
type Wrap = (n: string) => string;
const NUMBERS: Ints = {
  zero: '0',
  c: String,
  toNumber: (n) => n,
  min: (a, b) => `Math.min(${a}, ${b})`,
  floor: (x) => `Math.floor(${x})`,
};
const BIGINTS: Ints = {
  zero: '0n',
  c: (x) => `${x}n`,
  toNumber: (n) => `Number(${n})`,
  min: (a, b) => `(${a} < ${b} ? ${a} : ${b})`,
  floor: (x) => x,
};

/** The head of a loop of `n` passes of the index `i` from 0, run in blocks
 *  `[i_b, i_e)` of at most 1024 passes: the inner `for` (whose brace the
 *  printer closes) runs a block, and the update of the outer one adds the
 *  passes of the block to the deadline count of the runtime
 *  (`_SYS.tick(passes)`, on the deadline frame), so no pass makes a call. A
 *  block left by a throw is not counted. `done`: the flag of an exit; both
 *  loops stop when it is true, and the block charges the passes it ran.
 *  `from`: the first pass of a window (no `done`), 0 by default. */
const blocks = (
  z: Ints,
  i: string,
  n: string,
  done?: string,
  from?: string
): string => {
  if (done === undefined)
    return `for (let ${i}_b = ${from ?? z.zero}, ${i}_e = ${z.min(from === undefined ? z.c(1024) : `${from} + ${z.c(1024)}`, n)}; ${i}_b < ${n}; _SYS.tick(${z.toNumber(`${i}_e - ${i}_b`)}), ${i}_b = ${i}_e, ${i}_e = ${z.min(`${i}_b + ${z.c(1024)}`, n)}) for (let ${i} = ${i}_b; ${i} < ${i}_e; ${i}++) {`;
  return `for (let ${i}_b = ${z.zero}, ${i}_e = ${z.min(z.c(1024), n)}, ${i} = ${z.zero}; ${i}_b < ${n} && !${done}; _SYS.tick(${z.toNumber(`${i} - ${i}_b`)}), ${i}_b = ${i}_e, ${i}_e = ${z.min(`${i}_b + ${z.c(1024)}`, n)}) for (${i} = ${i}_b; ${i} < ${i}_e && !${done}; ${i}++) {`;
};

/** A counted loop of `n` passes, from `lo` while the index is at most `hi`
 *  (a bound can be a real: `Floor(hi - lo) + 1` passes): the index is
 *  `lo + i` for a count `i` of the passes, so that the loop ends also where
 *  `k++` would not advance (from 2^53). A loop that a pass budget below
 *  2^32 bounds (`counted`) throws the budget's cancellation before the
 *  2^32nd pass, and its index is exact, so it is refused only for a count
 *  that is NaN: a loop of 1e12 passes stops on the budget (CE-1525). */
const loopOpen =
  (z: Ints): Syntax['loopOpen'] =>
  (k, lo, hi, _passes, done, window, counted) =>
    window === undefined
      ? [
          `const ${k}_lo = ${lo}, ${k}_n = ${z.floor(`${hi} - ${k}_lo`)} + ${z.c(1)};`,
          counted
            ? `if (${k}_n !== ${k}_n) throw new RangeError('a loop of a count that is not a number');`
            : guard(
                `${k}_n - ${z.c(1)}`,
                'a loop',
                done === undefined ? 32 : 53
              ),
          blocks(z, `${k}_i`, `${k}_n`, done),
          `  const ${k} = ${k}_lo + ${k}_i;`,
        ]
      : // The passes `i0 <= i < i1` of the count, each index as above.
        [
          `const ${k}_lo = ${lo};`,
          blocks(z, `${k}_i`, window[1], undefined, window[0]),
          `  const ${k} = ${k}_lo + ${k}_i;`,
        ];

const number = (x: number) =>
  Object.is(x, -0) ? '(-0)' : x < 0 ? `(${x})` : String(x);

/** The regions `build` and `filter` of the integers `z`, whose count of
 *  the list `out` is `count(out)`, and `rows.build` and `rows.filter`. A
 *  build fills an array of its length; a filter pushes. */
const builds = (z: Ints, count: Wrap): Syntax['regions'] => {
  const toNumber = z.toNumber;
  const open = (out: string, n: string, k: string, filter: boolean) => [
    `const ${out}_n = ${n};`,
    guard(`${out}_n`, 'a list'),
    `const ${out} = ${filter ? '[]' : `new Array(${toNumber(`${out}_n`)})`};`,
    blocks(z, k, `${out}_n`),
  ];
  return {
    'build': ({ outs: [out], args: [n], params: [k] }) => ({
      open: open(out, n, k, false),
      close: ([y]) => [`  ${out}[${toNumber(k)}] = ${y};`, '}'],
    }),
    'filter': ({ outs: [c, out], args: [n], params: [k] }) => ({
      open: open(out, n, k, true),
      close: ([keep, y]) => [
        `  if (${keep}) ${out}.push(${y});`,
        '}',
        `const ${c} = ${count(out)};`,
      ],
    }),
    // A list of lists of run-time length (the lane `rows`): an array whose
    // element `k` is the array of the row `k`.
    'rows.build': ({ outs: [out], args: [n], params: [k] }) => ({
      open: open(out, n, k, false),
      close: ([y]) => [`  ${out}[${toNumber(k)}] = ${y};`, '}'],
    }),
    'rows.filter': ({ outs: [out], args: [n], params: [k] }) => ({
      open: open(out, n, k, true),
      close: ([keep, y]) => [`  if (${keep}) ${out}.push(${y});`, '}'],
    }),
  };
};

/** The operations of a row on another lane than the function that they
 *  call: the integer lane of a function of `REAL_FUNCTIONS` (the bigint mode
 *  spells it with its own helper), the real lane of an integer row. */
const OTHER_LANES = {
  'remainder.int': '_SYS.ir.remainder($0, $1)',
  'fibonacci.int': '_SYS.ir.fibonacci($0)',
  'rbinomial': '_SYS.binomial($0, $1)',
  'rgcd': '_SYS.ir.gcd($0, $1)',
  'rlcm': '_SYS.ir.lcm($0, $1)',
};

/** `Flatten` of a value of the lane `rows` (`rows.flat`,
 *  `rows.flat.int`): the elements of its rows (the host's arrays or typed
 *  arrays, or the arrays that the program built), in order, and their
 *  count. */
const flatRows: RegionSpelling = ({ outs: [c, out], args: [g] }) => ({
  open: [
    `const ${out} = [];`,
    `for (const _row of ${g}) for (const _x of _row) ${out}.push(_x);`,
    `const ${c} = ${out}.length;`,
  ],
  close: () => [],
});

/** A value of the lane `rows` whose rows have one length, read as a list
 *  of rank 2 (`rows.matrix`, `rows.matrix.int`): the same array of
 *  arrays. */
const matrixOfRows: RegionSpelling = ({ outs: [out], args: [g] }) => ({
  open: [`const ${out} = ${g};`],
  close: () => [],
});

/** The text of the result of the entry of the record type `t`, read from
 *  `value`: a record of a named tuple type is an object keyed by the names
 *  of its fields; a record with no names stays the array of its fields; a
 *  record in a field is converted the same way. A field of the lane
 *  `nothing` is `null` in the array already. A field that holds a complex
 *  value gets the result convention (`_SYS.ir.normalize`), which the
 *  boundary does not apply inside an object. `undefined` when no record in
 *  `t` has names: the array is the result. */
function recordResult(value: string, t: IRType): string | undefined {
  if (t.lane !== 'record') return undefined;
  const nested = (t.fields ?? []).map((f, k) =>
    recordResult(`${value}[${k}]`, f)
  );
  if (t.names === undefined && nested.every((x) => x === undefined))
    return undefined;
  const fields = (t.fields ?? []).map(
    (f, k) =>
      nested[k] ??
      (holdsComplex(f) ? `_SYS.ir.normalize(${value}[${k}])` : `${value}[${k}]`)
  );
  if (t.names !== undefined)
    return `{ ${t.names.map((n, k) => `${JSON.stringify(n)}: ${fields[k]}`).join(', ')} }`;
  return `[${fields.join(', ')}]`;
}

/** Whether a value of the type `t` can hold a complex number. */
function holdsComplex(t: IRType): boolean {
  return t.lane === 'complex' || (t.fields ?? []).some(holdsComplex);
}

export const JS: Syntax = deepFreeze({
  ops: {
    ...ARITHMETIC,
    'pow': '_SYS.ir.pow($0, $1)',
    ...calls('Math.', ['sqrt', 'abs', 'exp']),
    'ln': 'Math.log($0)',
    ...calls('Math.', ['sin', 'cos', 'tan']),
    'cot': '(1 / Math.tan($0))',
    'sec': '(1 / Math.cos($0))',
    'csc': '(1 / Math.sin($0))',
    ...calls('Math.', ['sinh', 'cosh', 'tanh']),
    'sech': '(1 / Math.cosh($0))',
    'csch': '(1 / Math.sinh($0))',
    'deg': '(($0 * Math.PI) / 180)',
    ...calls('Math.', ['floor', 'ceil']),
    'round': { text: '_round($0)', helpers: ['_round'] },
    'mod': '_SYS.ir.mod($0, $1)',
    'max': 'Math.max($0, $1)',
    'min': 'Math.min($0, $1)',
    'emax': 'Math.max($0, $1)',
    'emin': 'Math.min($0, $1)',
    ...COMPARISONS,
    'eq': '($0 === $1)',
    'ne': '($0 !== $1)',
    ...LOGIC,
    'boole': '($0 ? 1 : 0)',
    'elem': '$0[$1]',
    // A record (`README.md`, "Records"): the field at an index from 0, and
    // `Nothing`.
    'field': '$0[$1]',
    'nothing': 'null',
    'at': { text: '_at($0, $1)', helpers: ['_at'] },
    'atu': { text: '_atu($0, $1)', helpers: ['_atu'] },
    'atp': { text: '_atp($0, $1, $2)', helpers: ['_atp'] },
    'atrow': { text: '_atu($0, $1)', helpers: ['_atu'] },
    // A list local written in place (`operators.ts`).
    'copy': '$0.slice()',
    'wix': { text: '_wix($0, $1)', helpers: ['_wix'] },
    'get': '$0[$1]',
    'set': '($0[$1] = $2)',
    'getat': { text: '_at($0, $1)', helpers: ['_at'] },
    'getatu': { text: '_atu($0, $1)', helpers: ['_atu'] },
    // A mutable array of the engine (`operators.ts`, `lower-arrays.ts`):
    // the storage and the count are read from the array at each use. A read
    // outside the cells of a typed array is `undefined`, which the unary
    // plus makes NaN; a store there is ignored. A tuple cell is four bytes
    // of the storage; at an index on the real lane (`.r`), one that is not
    // an integer names no cell or byte (`c.length + i` of a fraction can
    // round to an integer).
    'arr.get': '(+$0._cells[$1 > 0 ? $1 - 1 : $0._cells.length + $1])',
    'arr.set':
      '($0._version++, $0._cells[$1 > 0 ? $1 - 1 : $0._cells.length + $1] = $2)',
    'arr.get.int': '(+$0._cells[$1 > 0 ? $1 - 1 : $0._cells.length + $1])',
    'arr.set.int':
      '($0._version++, $0._cells[$1 > 0 ? $1 - 1 : $0._cells.length + $1] = $2)',
    'arr.get.r':
      '(+$0._cells[Number.isInteger($1) ? ($1 > 0 ? $1 - 1 : $0._cells.length + $1) : -1])',
    'arr.set.r':
      '($0._version++, $0._cells[Number.isInteger($1) ? ($1 > 0 ? $1 - 1 : $0._cells.length + $1) : -1] = $2)',
    'arr.get.int.r':
      '(+$0._cells[Number.isInteger($1) ? ($1 > 0 ? $1 - 1 : $0._cells.length + $1) : -1])',
    'arr.set.int.r':
      '($0._version++, $0._cells[Number.isInteger($1) ? ($1 > 0 ? $1 - 1 : $0._cells.length + $1) : -1] = $2)',
    'arr.byte': '(+$0._cells[4 * ($1 > 0 ? $1 - 1 : $0._count + $1) + $2])',
    'arr.byte.r':
      '(+$0._cells[Number.isInteger($1) ? 4 * ($1 > 0 ? $1 - 1 : $0._count + $1) + $2 : -1])',
    'arr.setbyte':
      '($0._cells[4 * ($1 > 0 ? $1 - 1 : $0._count + $1) + $2] = $3)',
    'arr.setbyte.r':
      '($0._cells[Number.isInteger($1) ? 4 * ($1 > 0 ? $1 - 1 : $0._count + $1) + $2 : -1] = $3)',
    'arr.touch': '($0._version++)',
    'arr.len': '$0._count',
    'arr.swap': { text: '_aswap($0, $1)', helpers: ['_aswap'] },
    'arr.ref': '_SYS.arrays.refs[$0]',
    'arr.from.list': '_SYS.arrays.make[$1]($0)',
    'arr.from.copy': '_SYS.arrays.make[$1]($0)',
    'arr.from.fill': '_SYS.arrays.make[$2]($0, $1)',
    'arr.from.fillrec': '_SYS.arrays.make[$2]($0, $1)',
    // A variable of the engine around a call of the host (`operators.ts`).
    'state.stage': '_SYS.state.stage($0, $1)',
    'state.stage.bool': '_SYS.state.stage($0, $1)',
    'state.stage.arr': '_SYS.state.stage($0, $1)',
    'state.get': '_SYS.state.get($0)',
    'state.get.int': '_SYS.state.get($0)',
    'state.get.bool': '_SYS.state.get($0)',
    'state.get.arr': '_SYS.state.get($0)',
    'isnan': 'Number.isNaN($0)',
    'isundef': '($0 === undefined)',
    ...Object.fromEntries(
      [
        'present.int',
        'present',
        'cpresent',
        'present.bool',
        'text.present',
      ].map((op) => [op, { text: '_present($0, $1)', helpers: ['_present'] }])
    ),
    'count.int': { text: '_count($0)', helpers: ['_count'] },
    'listlen': { text: '_listlen($0)', helpers: ['_listlen'] },
    'count.round': 'Math.round($0)',
    'linspace.count': { text: '_lincount($0)', helpers: ['_lincount'] },
    'linspace': { text: '_linspace($0, $1, $2, $3)', helpers: ['_linspace'] },
    'draw': '_SYS.drawNextRandomNumber()',
    'shuffle': '_SYS.shuffle($0)',
    'sort': { text: '_sort($0)', helpers: ['_sort'] },
    'ordering': { text: '_ordering($0)', helpers: ['_ordering'] },
    'median': { text: '_median($0)', helpers: ['_median'] },
    // The interpreter's statistics (`javascript-runtime.ts`).
    'mode': '_SYS.mode($0)',
    'quartile1': '_SYS.quartile($0, 0)',
    'quartile3': '_SYS.quartile($0, 2)',
    'skewness': '_SYS.skewness($0)',
    'kurtosis': '_SYS.kurtosis($0)',
    'covariance': '_SYS.covariance($0, $1)',
    'pcovariance': '_SYS.populationCovariance($0, $1)',
    'correlation': '_SYS.correlation($0, $1)',
    // `Chunk` and `Partition` whose rows can have different lengths
    // (`javascript-runtime.ts`), the two groups of a predicate, and the
    // checks of their counts.
    'rows.chunk': '_SYS.chunk($0, $1)',
    'rows.partition': '_SYS.partition($0, $1)',
    'rows.pair': '[$0, $1]',
    'rows.chunks': '_SYS.chunkCount($0)',
    'rows.size': '_SYS.partitionSize($0)',
    // An element of an input or a parameter of the lane `rows`.
    'rows.at': { text: '_atr($0, $1, $2)', helpers: ['_atr'] },
    'rows.at.int': { text: '_atr($0, $1, $2)', helpers: ['_atr'] },
    // The same value read row by row, at indices in range.
    'rows.count': '$0.length',
    'rows.len': '$0[$1].length',
    // The length of the rows of a matrix, and the checks of two lengths
    // (`agree()` of `lower-lists.ts`).
    'rows.width': '($0.length === 0 ? 0 : $0[0].length)',
    // The host's array of arrays, as it is.
    'rows.of': '$0',
    'rows.agree': { text: '_agree($0, $1)', helpers: ['_agree'] },
    'rows.square': { text: '_square($0, $1)', helpers: ['_square'] },
    'rows.order': { text: '_order($0, $1)', helpers: ['_order'] },
    'rows.get': '$0[$1][$2]',
    'rows.get.int': '$0[$1][$2]',
    // The row at an index known at run time.
    'rows.row': { text: '_rowr($0, $1)', helpers: ['_rowr'] },
    'rows.rowlen': { text: '_lenr($0, $1, 0)', helpers: ['_lenr'] },
    'rows.rowlen.nan': { text: '_lenr($0, $1, NaN)', helpers: ['_lenr'] },
    // The rows of two values of the lane, in order.
    'rows.join': '[...$0, ...$1]',
    'mdet': '_SYS.matrixDeterminant($0, $1)',
    'minverse': '_SYS.matrixInverse($0)',
    'mpower': '_SYS.matrixPower($0, $1)',
    // Of a matrix of the lane `rows`, of the order `rows.order`.
    'rows.inverse': '_SYS.matrixInverse($0, $1)',
    'rows.power': '_SYS.matrixPower($0, $1, $2)',
    'mrowreduce': '_SYS.matrixRowReduce($0, $1)',
    'binomial': '_SYS.binomial($0, $1)',
    // A count that is NaN (a bound with no value) is an empty list.
    'rangecount': '(_SYS.rangeCount($0, $1, $2) || 0)',
    'rangestep': '($1 >= $0 ? 1 : -1)',
    ...calls('Math.', ['trunc', 'sign', 'log10', 'log2']),
    'hypot': 'Math.hypot($0, $1)',
    ...calls('Math.', ['atan', 'asin', 'acos', 'asinh', 'acosh', 'atanh']),
    // A colour is the runtime's object (`CompiledColor`): a
    // constructor gives it in OKLCh, a conversion in the space it names.
    'rgb': '_SYS.rgb($0, $1, $2)',
    'hsl': '_SYS.hsl($0, $1, $2)',
    'hsv': '_SYS.hsv($0, $1, $2)',
    'oklab': '_SYS.oklab($0, $1, $2)',
    'oklch': '_SYS.oklch($0, $1, $2)',
    'asrgb': '_SYS.asRgb($0)',
    'ashsl': '_SYS.asHsl($0)',
    'ashsv': '_SYS.asHsv($0)',
    'asoklab': '_SYS.asOklab($0)',
    'asoklch': '_SYS.asOklch($0)',
    'colormix': '_SYS.colorMix($0, $1, $2)',
    'colorcontrast': '_SYS.colorContrast($0, $1)',
    'colordelta': '_SYS.colorDelta($0, $1)',
    'contrastingcolor': '_SYS.contrastingColor($0, $1, $2)',
    'contrastingcolor.bw': '_SYS.contrastingColorBW($0)',
    'gamutmap': '_SYS.gamutMap($0, false)',
    'gamutmap.p3': '_SYS.gamutMap($0, true)',
    'colormap': '_SYS.colormap($0, $1)',
    'ashsv.own': '_SYS.hsvChannels($0, $1, $2)',
    'ashsl.own': '_SYS.hslChannels($0, $1, $2)',
    ...Object.fromEntries(
      ['rgb', 'hsl', 'hsv', 'oklab', 'oklch'].map((s) => [
        `colorchannel.${s}`,
        `_SYS.colorChannel($0, '${s}', $1)`,
      ])
    ),
    // The functions of `REAL_FUNCTIONS` and `COMPLEX_FUNCTIONS`, by name.
    ...Object.fromEntries(
      Object.entries({ ...REAL_FUNCTIONS, ...COMPLEX_FUNCTIONS }).map(
        ([f, g]) => [
          f,
          `_SYS.ir.${f}(${Array.from({ length: g.length }, (_, k) => `$${k}`).join(', ')})`,
        ]
      )
    ),
    ...OTHER_LANES,
    ...TEXT,
  },
  regions: {
    ...builds(NUMBERS, (out) => `${out}.length`),
    ...TEXT_REGIONS,
    'integrate': ({ outs: [out], args: [a, b], params: [t] }) => ({
      open: [`const ${out} = _SYS.irIntegrate((${t}) => {`],
      close: ([y]) => [`  return ${y};`, `}, ${a}, ${b});`],
    }),
    // The indices sorted by a comparison, as the interpreter sorts them.
    'sortby': ({ outs: [out], args: [n], params: [i, j] }) => ({
      open: [
        `const ${out} = Array.from({ length: ${n} }, (_, k) => k).sort((${i}, ${j}) => {`,
      ],
      close: ([y]) => [`  return ${y};`, '});'],
    }),
    // The elements of an `Iterate`: the accumulator is a variable that
    // each pass sets to its element.
    'iterate': ({ outs: [out], args: [n, x0], params: [k, acc] }) => ({
      open: [
        `const ${out}_n = ${n};`,
        guard(`${out}_n`, 'a list'),
        `const ${out} = new Array(${out}_n);`,
        `let ${acc} = ${x0};`,
        blocks(NUMBERS, k, `${out}_n`),
      ],
      close: ([y]) => [`  ${acc} = ${out}[${k}] = ${y};`, '}'],
    }),
    // The numeric derivative of the runtime (`_SYS.nd`).
    'derivative': ({ outs: [out], args: [x], params: [t] }) => ({
      open: [`const ${out} = _SYS.nd((${t}) => {`],
      close: ([y]) => [`  return ${y};`, `}, 1, 'scalar')(${x});`],
    }),
    'choice': ({ outs: [c, out], args: [n] }) => ({
      open: [
        `const ${out} = _SYS.randomChoice(_SYS.domainInterval('RandomChoice', 0, 1), ${n});`,
        `const ${c} = ${out}.length;`,
      ],
      close: () => [],
    }),
    // `Flatten` of an input or a parameter of the lane `rows`: the elements
    // of the host's rows (arrays or typed arrays), in order.
    'rows.flat': flatRows,
    'rows.flat.int': flatRows,
    // A value of the lane `rows` read as a list of rank 2: the same array.
    'rows.matrix': matrixOfRows,
    'rows.matrix.int': matrixOfRows,
    // The indices of `RandomSample(L, k)`, drawn as the interpreter draws.
    'sample': ({ outs: [c, out], args: [n, k] }) => ({
      open: [
        `const ${out} = _SYS.randomSample(${n}, ${k});`,
        `const ${c} = ${out}.length;`,
      ],
      close: () => [],
    }),
    'seeded': ({ outs, args: [seed] }) => ({
      open: [
        ...outs.map((o) => `let ${o};`),
        `_SYS.withRandomSeed(${seed}, () => {`,
      ],
      close: (ys) => [...ys.map((y, j) => `  ${outs[j]} = ${y};`), '});'],
    }),
    // The private list of a list accumulator in a worker program: a
    // `Float64Array`, which the pool transfers.
    'zeros': ({ outs: [out], args: [n] }) => ({
      open: [],
      close: ([y]) => [`const ${out} = new Float64Array(${n}).fill(${y});`],
    }),
  },
  helpers: {
    _round: 'const _round = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));',
    // `Swap(a, b)` of two arrays of one cell type, which the lowering
    // proved (`lower-arrays.ts`): the exchange of their storages and counts
    // (`BoxedArray._swapWith()`, with no test of the cell types), each
    // version incremented. Its value is NaN, the `Nothing` that the code
    // does not read.
    _aswap:
      'const _aswap = (a, b) => { if (a !== b) { const c = a._cells, n = a._count; a._cells = b._cells; a._count = b._count; b._cells = c; b._count = n; a._version++; b._version++; } return NaN; };',
    _at: 'const _at = (l, i) => { const k = i > 0 ? i - 1 : l.length + i; return Number.isInteger(i) && i !== 0 && k >= 0 && k < l.length ? l[k] : NaN; };',
    _atu: 'const _atu = (l, i) => { const k = i > 0 ? i - 1 : l.length + i; return Number.isInteger(i) && i !== 0 && k >= 0 && k < l.length ? l[k] : undefined; };',
    // The length of a list that is not built (`listlen`): the guard of a
    // build of that length.
    _listlen: `const _listlen = (n) => { ${guard('n', 'a list')} return n; };`,
    // The index from 0 of the write `ReplaceAt(L, i, v)` or `AddTo(At(L,
    // i), e)` in a list of `n` elements; the interpreter's value of an
    // index that is 0, not an integer or out of range is an error.
    _wix: 'const _wix = (n, i) => { const k = i > 0 ? i - 1 : n + i; if (Number.isInteger(i) && i !== 0 && k >= 0 && k < n) return k; throw new Error(`out-of-range: the index ${i} of a list of ${n} elements`); };',
    // The index from 0 of the row `At(g, i)` of a list of rows whose
    // lengths can differ, -1 where `i` is out of range; the length of the
    // row at that index, `absent` at -1.
    _rowr:
      'const _rowr = (g, i) => { const k = i > 0 ? i - 1 : g.length + i; return Number.isInteger(i) && i !== 0 && k >= 0 && k < g.length ? k : -1; };',
    _lenr: 'const _lenr = (g, k, absent) => (k < 0 ? absent : g[k].length);',
    // Two lengths that an operation reads at each index (an element-wise
    // operation, a call mapped over lists, `Dot`, the inner lengths of
    // `MatrixMultiply`), and the two lengths of the matrix of `Trace`: the
    // interpreter's value where they differ is the error
    // `incompatible-dimensions` or `expected-square-matrix`.
    _agree:
      'const _agree = (a, b) => { if (a !== b) throw new RangeError(`incompatible-dimensions: lists of lengths ${a} and ${b}`); return 0; };',
    _square:
      'const _square = (a, b) => { if (a !== b) throw new RangeError(`expected-square-matrix: Trace of a matrix of ${a} rows and ${b} columns`); return 0; };',
    // The order of the matrix of `Determinant`, `Inverse` and
    // `MatrixPower`: the interpreter's value of another is the error
    // `expected-square-matrix`.
    _order:
      'const _order = (a, b) => { if (a !== b) throw new RangeError(`expected-square-matrix: a matrix of ${a} rows and ${b} columns`); return a; };',
    // `At(At(g, i), j)` of a list of rows whose lengths can differ: NaN
    // where `i` is out of range of `g` or `j` of its row.
    _atr: 'const _atr = (g, i, j) => { const k = i > 0 ? i - 1 : g.length + i; if (!(Number.isInteger(i) && i !== 0 && k >= 0 && k < g.length)) return NaN; const r = g[k]; const m = j > 0 ? j - 1 : r.length + j; return Number.isInteger(j) && j !== 0 && m >= 0 && m < r.length ? r[m] : NaN; };',
    _atp: 'const _atp = (l, i, n) => { const k = i > 0 ? i - 1 : l.length + i; return Number.isInteger(i) && i !== 0 && k >= 0 && k < l.length ? l[k] : new Array(n).fill(NaN); };',
    // A sorted copy, NaN last, as the interpreter's `Sort`; the indices
    // from 1 of that order, stable, as its `Ordering`.
    _sort:
      'const _sort = (l) => [...l].sort((a, b) => (a < b ? -1 : a > b ? 1 : Number.isNaN(a) - Number.isNaN(b)));',
    _ordering:
      'const _ordering = (l) => Array.from(l, (_, i) => i).sort((i, j) => (l[i] < l[j] ? -1 : l[i] > l[j] ? 1 : Number.isNaN(l[i]) - Number.isNaN(l[j]))).map((i) => i + 1);',
    // The interpreter's `median()` (`numerics/statistics.ts`): NaN when an
    // element is NaN, and of no element.
    _median:
      'const _median = (l) => { if (l.some(Number.isNaN)) return NaN; const s = [...l].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]; };',
    // `AssertPresent`: the interpreter's value is the error
    // `expected-present`.
    _present:
      "const _present = (m, x) => { if (m) throw new Error('expected-present: AssertPresent of an absent value'); return x; };",
    // A real count of `RotateLeft` or `RotateRight`: the interpreter's
    // value is the error `incompatible-type` where it is not an integer,
    // and unevaluated past the safe integers (`1e20`): both throw.
    _count:
      "const _count = (x) => { if (!Number.isSafeInteger(x)) throw new Error('incompatible-type: a count that is not an integer'); return x; };",
    // The count of `Linspace` and its element `k` from 0 of `d + 1`, the
    // interpreter's `linspaceSample()` (`library/collections.ts`).
    _lincount:
      'const _lincount = (c) => (Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 50);',
    _linspace:
      'const _linspace = (a, b, k, d) => { const s = b - a; if (Number.isFinite(s)) { const t = s / d; return Number.isInteger(t) && Number.isInteger(a) && Math.abs(s) <= Number.MAX_SAFE_INTEGER ? a + k * t : a + (s * k) / d; } const u = k / d; return a * (1 - u) + b * u; };',
  },
  // A `bigint` literal is made in the bigint mode only (`JS_BIGINT`).
  constant: ({ value: x }) =>
    typeof x === 'string'
      ? JSON.stringify(x)
      : typeof x === 'object'
        ? `({ re: ${number(x.re)}, im: ${number(x.im)} })`
        : typeof x === 'boolean'
          ? String(x)
          : number(x as number),
  input: (name) =>
    IDENTIFIER.test(name) ? `_.${name}` : `_[${JSON.stringify(name)}]`,
  positional: (_name, k) => `a${k}`,
  length: (list) => `${list}.length`,
  width: (list) => `(${list}.length === 0 ? 0 : ${list}[0].length)`,
  part: (tuple, index) => `${tuple}[${index}]`,
  list: (elements) => `[${elements.join(', ')}]`,
  // An array of the length, filled in index order by a `for` loop: an
  // expression, so a function called at once.
  map: (lengths, body) => {
    const index = lengths.map((_, d) => `i${d}`);
    return lengths.reduceRight<string>(
      (s, n, d) =>
        `((_n) => { const _r = new Array(_n); ${blocks(NUMBERS, index[d], '_n')} _r[${index[d]}] = ${s}; } return _r; })(${n})`,
      body(index)
    );
  },
  updateList: (list, length, body) => {
    const k = `${list}_j`;
    return [
      blocks(NUMBERS, k, String(length)),
      `  ${list}[${k}] = ${body(k)};`,
      '}',
    ];
  },
  declare: (_type, name, value, mutable) =>
    `${mutable ? 'let' : 'const'} ${name}${value === undefined ? '' : ` = ${value}`};`,
  loopOpen: loopOpen(NUMBERS),
  retTuple: (values) => `return [${values.join(', ')}];`,
  record: recordResult,
  polygon: (value, kind) =>
    kind === 'single'
      ? `{ __tag: "Polygon", geom: ${value} }`
      : `(${value}).map((geom) => ({ __tag: "Polygon", geom }))`,
  call: (fn, args) => `${fn}(${args.join(', ')})`,
  fn: (name, params, _result, body) =>
    [
      `const ${name} = (${params.map((p) => p.name).join(', ')}) => {`,
      ...body,
      '};',
    ].join('\n'),
});

/**
 * The syntax of `mode: 'bigint'`: every integer is a JavaScript `bigint`
 * (`5n`), also an index and a length, converted with `Number()` where
 * JavaScript reads a number (an element, the length of an array) and with
 * `BigInt()` where it gives one (an input, the length of a list). The
 * operations that it spells are exact on `bigint` values, with the helpers
 * of the mode (`bigint-runtime.ts`, members of `_SYS`); it spells no other,
 * so a program with another operation declines (`admits()`). A helper
 * throws a `NonFiniteValue` at a pole, and one catch around the entry
 * returns its number.
 */
export const JS_BIGINT: Syntax = deepFreeze({
  ...JS,
  updateList: undefined,
  ops: {
    'add.int': '($0 + $1)',
    'sub.int': '($0 - $1)',
    'neg.int': '(-$0)',
    'mul.int': '($0 * $1)',
    'abs.int': '_SYS.babs($0)',
    'mod.int': '_SYS.bfloorMod($0, $1)',
    'floordiv.int': '_SYS.bfloorDiv($0, $1)',
    'max.int': '_SYS.bmax($0, $1)',
    'min.int': '_SYS.bmin($0, $1)',
    'emax.int': '_SYS.bmax($0, $1)',
    'emin.int': '_SYS.bmin($0, $1)',
    'pow.int': '_SYS.bpow($0, $1)',
    'factorial.int': '_SYS.bfactorial($0)',
    'sign': '_SYS.bsign($0)',
    'binomial': '_SYS.bbinomial($0, $1)',
    'gcd': '_SYS.bgcd($0, $1)',
    'lcm': '_SYS.blcm($0, $1)',
    'remainder.int': '_SYS.bremainder($0, $1)',
    'fibonacci.int': '_SYS.bfibonacci($0)',
    ...COMPARISONS,
    'eq': JS.ops.eq,
    'ne': JS.ops.ne,
    ...LOGIC,
    'boole': '($0 ? 1n : 0n)',
    'elem': '$0[Number($1)]',
    'at': '_SYS.bat($0, $1)',
    'sort.int': '_SYS.bsort($0)',
    'wix': '_SYS.bwix($0, $1)',
    'rangecount': '_SYS.brangeCount($0, $1, $2)',
    'rangestep': '($1 >= $0 ? 1n : -1n)',
  },
  regions: builds(BIGINTS, (out) => `BigInt(${out}.length)`),
  loopOpen: loopOpen(BIGINTS),
  constant: (l) =>
    l.lane !== 'integer'
      ? JS.constant(l)
      : l.value < 0
        ? `(${BigInt(l.value)}n)`
        : `${BigInt(l.value)}n`,
  length: (list) => `BigInt(${list}.length)`,
  read: (text, t) =>
    t.lane === 'integer' && t.shape.length === 0 ? `BigInt(${text})` : text,
  map: (lengths, body) =>
    JS.map!(
      lengths.map((n) => `Number(${n})`),
      body
    ),
  entry: (body) => [
    'try {',
    ...body,
    '} catch (_e) { if (_e instanceof _SYS.NonFiniteValue) return _e.value; throw _e; }',
  ],
});

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
  /** The asynchronous text of `runAsync()` when the program has pool
   *  loops (`outline()`): the per-call code of a runner of the parameters
   *  `_` (the inputs object) and `_run` (the state of the call,
   *  `run-async.ts`) over `preambleOnce`, which gives the promise of the
   *  value. */
  readonly asyncCode?: string;
};

/** The runtime `_SYS` of the code: over the engine `ce` (its draws, its
 *  random frame and its deadline, read at each call), or with no engine,
 *  that of `createJavaScriptRuntime()`. With `hosts`, the functions of the
 *  host that the code calls, as `_SYS.hosts` (`hostCaller()`). With
 *  `arrays`, the arrays of the program (`ArrayUse`), as `_SYS.arrays`:
 *  the references and the constructions; and the step after the stores of
 *  a unit (`arrayNote()`), which a call of the host runs first. With
 *  `hosts` and `assigns`, the write and the read of each variable that the
 *  code makes around a call of the host, as `_SYS.state` (`readAssigned()`,
 *  `writeAssigned()`). */
export function runtimeOf(
  ce?: ComputeEngine,
  hosts?: readonly HostCall[],
  arrays?: ArrayUse,
  assigns?: readonly Assigned[],
  pending?: ReturnType<typeof assignmentState>
): SysHelpers {
  if (ce === undefined) {
    if (hosts !== undefined)
      throw new Error('slice: a call of a function of the host with no engine');
    if (arrays !== undefined)
      throw new Error('slice: an array of the engine with no engine');
    return createSysRuntime();
  }
  const sys = makeSysHelpers(engineRuntimeSource(ce));
  const note = arrays?.stores === true ? arrayNote(ce) : undefined;
  const before = pending === undefined
    ? note
    : () => {
        pending.flush();
        note?.();
      };
  if (hosts !== undefined)
    Object.defineProperty(sys, 'hosts', {
      value: Object.freeze(hosts.map((h) => hostCaller(ce, h, before))),
    });
  if (assigns !== undefined && (pending !== undefined || hosts !== undefined || (arrays?.makers.length ?? 0) > 0))
    Object.defineProperty(sys, 'state', {
      value: Object.freeze({
        stage: (j: number, y: unknown) => {
          pending!.put(j, y);
          return NaN;
        },
        get: (j: number) => readAssigned(ce, assigns[j]),
      }),
    });
  if (arrays !== undefined)
    Object.defineProperty(sys, 'arrays', {
      value: Object.freeze({
        refs: Object.freeze([...arrays.refs]),
        make: Object.freeze(arrays.makers.map((m) => {
          const make = arrayMaker(ce, m);
          return (...args: unknown[]) => {
            before?.();
            return make(...args);
          };
        })),
      }),
    });
  return sys;
}

/** Actual writes of the current call. Recursive entry from a host callback
 *  starts a fresh frame and restores the caller's frame on exit. */
function assignmentState(ce: ComputeEngine, assigns: readonly Assigned[]) {
  let writes: Map<number, unknown> | undefined;
  const flush = (): void => {
    if (writes === undefined) return;
    for (const [index, value] of writes) writeAssigned(ce, assigns[index], value);
    writes.clear();
  };
  return {
    put: (index: number, value: unknown) => writes!.set(index, value),
    flush,
    run(body: JavaScriptResult['run']): JavaScriptResult['run'] {
      return (...args) => {
        const caller = writes;
        writes = new Map();
        try {
          const result = body(...args);
          flush();
          return result;
        } finally {
          writes = caller;
        }
      };
    },
  };
}

/** What a store of the interpreter does after its write
 *  (`BoxedArray._store()`), once for the stores of a unit of compiled code
 *  (decision C4 of `docs/plans/2026-11-25-mutable-arrays-spec.md`): the
 *  store epoch of the engine advances, which the memo of a pure
 *  application reads, and one state event is registered. The code runs it
 *  before each call of a function of the host and when `run()` returns or
 *  throws. */
export function arrayNote(ce: ComputeEngine): () => void {
  return () => {
    ce._objectStoreEpoch += 1;
    ce._noteStateEvent({ kind: 'object-store' });
  };
}

/** The construction `m` (`ArrayFrom(xs, type)` of the program) of the
 *  engine: the call of the program over the engine's value of the source
 *  that the code gives (a `List` of its numbers, `Repeat(v, n)`, or the
 *  array), evaluated as the interpreter evaluates it, so that the
 *  allocation function and `ce.arrayCreated` of the host see it and the
 *  array has the cell type of the operand. An error of the engine
 *  (`array-allocation-refused`, `incompatible-type`) throws. */
function arrayMaker(
  ce: ComputeEngine,
  m: ArrayMaker
): (...args: unknown[]) => Expression {
  const call = m.call as unknown as {
    _withSameBinding(ops: ReadonlyArray<Expression>): Expression;
    ops: ReadonlyArray<Expression>;
  };
  const type = call.ops.slice(1, 2);
  return (x, n) => {
    const source =
      m.source === 'copy'
        ? (x as Expression)
        : m.source === 'fill'
          ? ce.function('Repeat', [
              m.value!.lane === 'record'
                ? boxValue(ce, m.value!, undefined, x)
                : ce.number(x as number),
              ce.number(n as number),
            ])
          : ce.function(
              'List',
              Array.from(x as ArrayLike<number>, (y) => ce.number(y))
            );
    const r = call._withSameBinding([source, ...type]).evaluate();
    if (!isMutableArray(r))
      throw new Error(
        `ArrayFrom of compiled code gives ${r.toString()}, not an array`
      );
    return r;
  };
}

/**
 * The engine's value of the value `x` of the code, of the IR type `t` and
 * the tuple mark `mark`, as the interpreter holds it (CE-1652, step 5;
 * `README.md`, "Records"): a record of a named tuple type is the
 * application of the constructor of its type to its fields, the record of
 * the arguments of a rest parameter the `Tuple` of its fields and
 * `ListFrom` of it their `List` (`IRType.head`), a list a `List` and a
 * tuple (the axis of its mark) a `Tuple` of its elements, a field of the
 * lane `nothing` the symbol `Nothing`, a string a string, a boolean `True`
 * or `False`, and a number a number. `unboxable()` of `lower.ts` admits no
 * other type (a record of no names, a colour, a complex number).
 */
function boxValue(
  ce: ComputeEngine,
  t: IRType,
  mark: number | undefined,
  x: unknown
): Expression {
  // An array of the engine: the same reference.
  if (t.lane === 'array') return x as Expression;
  if (t.lane === 'record') {
    const xs = x as readonly unknown[];
    // A dictionary literal (CE-1771): the dictionary of its keys.
    if (t.head === 'Dictionary')
      return ce.function(
        'Dictionary',
        (t.fields ?? []).map((f, k) =>
          ce.function('KeyValuePair', [
            ce.string(t.names![k]),
            boxValue(ce, f, t.marks?.[k], xs[k]),
          ])
        )
      );
    return ce.function(
      t.nominal ?? t.head!,
      (t.fields ?? []).map((f, k) => boxValue(ce, f, t.marks?.[k], xs[k]))
    );
  }
  if (t.shape.length > 0) {
    const inner: IRType = { lane: t.lane, shape: t.shape.slice(1) };
    const m = mark === undefined || mark === 0 ? undefined : mark - 1;
    return ce.function(
      mark === 0 ? 'Tuple' : 'List',
      Array.from(x as ArrayLike<unknown>, (y) => boxValue(ce, inner, m, y))
    );
  }
  switch (t.lane) {
    case 'nothing':
      return ce.symbol('Nothing');
    case 'boolean':
      return x ? ce.True : ce.False;
    case 'string':
      return ce.string(x as string);
    default:
      return ce.number(x as number);
  }
}

/**
 * The function that the code calls for a call of the function `h` of the
 * host (`hostCall()` of `lower.ts`): it boxes each argument (a number, a
 * boolean or a string; a list, a tuple or a record with
 * `boxValue()`), evaluates the call in the engine, as the
 * interpreter evaluates it, and gives its value on the lane of `h`: a
 * machine number (NaN for a value that is not a real number), a boolean
 * (a `TypeError` for another value), or NaN for `nothing`, whose value the
 * code does not read. The call is bound to the definition of the call of
 * the program (`_withSameBinding()`), whatever the scope of the engine is
 * when the code runs.
 */
function hostCaller(
  ce: ComputeEngine,
  h: HostCall,
  before?: () => void
): (...args: unknown[]) => number | boolean {
  const call = h.call as unknown as {
    _withSameBinding(ops: ReadonlyArray<Expression>): Expression;
  };
  return (...args) => {
    // The stores of the unit before the call (`arrayNote()`).
    before?.();
    const ops = args.map((x, k) =>
      h.types[k].shape.length > 0 ||
      h.marks[k] !== undefined ||
      h.types[k].lane === 'record' ||
      h.types[k].lane === 'array'
        ? boxValue(ce, h.types[k], h.marks[k], x)
        : h.args[k] === 'boolean'
          ? x
            ? ce.True
            : ce.False
          : h.args[k] === 'string'
            ? ce.string(x as string)
            : ce.number(x as number)
    );
    const value = call._withSameBinding(ops).evaluate();
    if (h.result === 'nothing') return NaN;
    if (h.result === 'boolean') {
      if (isSymbol(value, 'True')) return true;
      if (isSymbol(value, 'False')) return false;
      throw new TypeError(
        `The function "${h.name}" of the host gives ${value.toString()}, ` +
          `not a boolean.`
      );
    }
    // A value that still holds a call of the function (one that `evaluate`
    // left unevaluated) is not read: its `N()` would call the host function
    // again. An exact value (`Sqrt(3)`, `2Pi`) is read as its machine number.
    if (!isNumber(value) && value.has(h.name)) return NaN;
    const n = value.N();
    return isNumber(n) && n.im === 0 ? n.re : NaN;
  };
}

/**
 * The value of the variable `x` of the engine that a root function literal
 * assigns (`Program.assigns`), as the code takes it: a machine number, a
 * boolean, a list of them or a list of such lists, or the engine's array.
 * `run()` reads it when it starts, and the code after each call of a
 * function of the host (`_SYS.state`). An exact value (`1/30 * pi`) is read
 * as its machine number, and a list that an interpreted call holds lazily
 * (`Rest(List(1, 2, 3))`) by its elements. A variable that holds no value of
 * its lane (no value, a complex number for a `number`, an array of other
 * cells) throws a `TypeError`.
 */
export function readAssigned(
  ce: ComputeEngine,
  x: Assigned
):
  | number
  | boolean
  | Expression
  | (number | boolean)[]
  | (number | boolean)[][] {
  const v = x.definition.value;
  if (x.array !== undefined) {
    arrayEntryCheck(ce, x.array, `The variable "${x.name}"`)(v);
    return v!;
  }
  // The machine value of the element `y` of the lane of `x`, or `undefined`.
  const scalar = (y: Expression | undefined): number | boolean | undefined => {
    if (x.lane === 'boolean') {
      if (isSymbol(y, 'True')) return true;
      if (isSymbol(y, 'False')) return false;
      return undefined;
    }
    const n = y?.N();
    return isNumber(n) && n.im === 0 ? n.re : undefined;
  };
  const elements = (y: Expression | undefined): Expression[] | undefined =>
    y?.isFiniteCollection === true && !isString(y) ? [...y.each()] : undefined;
  if (x.rows) {
    // A list of lists: an array of arrays of the values of the elements.
    const rows = elements(v)?.map((row) => elements(row)?.map(scalar));
    if (rows?.every((row) => row?.every((y) => y !== undefined)))
      return rows as (number | boolean)[][];
  } else if (x.list) {
    const items = elements(v)?.map(scalar);
    if (items?.every((y) => y !== undefined))
      return items as (number | boolean)[];
  } else {
    const y = scalar(v);
    if (y !== undefined) return y;
  }
  const what = x.rows
    ? 'list of lists of values'
    : x.list
      ? 'list of values'
      : 'value';
  throw new TypeError(
    `The variable "${x.name}" that the compiled function assigns holds ` +
      `${v === undefined ? 'no value' : v.toString()}, not a ` +
      `${what} of the lane ${x.lane}.`
  );
}

/** The write of the value `y` of the code to the variable `x` of the engine
 *  (`readAssigned()`), as an evaluation of an assignment writes it: a
 *  number, `True` or `False`, a `List` of them or of such lists, or the
 *  array itself. `run()` writes each variable when it returns, and the code
 *  before each call of a function of the host (`_SYS.state`). */
export function writeAssigned(
  ce: ComputeEngine,
  x: Assigned,
  y: unknown
): void {
  const box = (z: unknown): Expression =>
    x.lane === 'boolean' ? (z ? ce.True : ce.False) : ce.number(z as number);
  const list = (z: unknown): Expression =>
    ce.function('List', Array.from(z as ArrayLike<unknown>, box));
  x.definition.value =
    x.array !== undefined
      ? (y as Expression)
      : x.rows
        ? ce.function('List', Array.from(y as ArrayLike<unknown>, list))
        : x.list
          ? list(y)
          : box(y);
}

/** The lists of constants (and of such lists) of at least 16 constants in
 *  all, and the lists that they hold, in any function and region, which the
 *  code computes once, when it is loaded (below 16, the literal at each call
 *  is as fast); and every pure colour operation and element-wise operation
 *  of lists of constants, of such values and of constants, with the lists
 *  it reads. No code writes to a list or to a
 *  colour; a result can be such a value, which every call shares (results
 *  are read-only). */
function onceLists(
  p: Program,
  rows: readonly OperatorRow[],
  elementwise: boolean
): Set<V> {
  const size = new Map<V, number>();
  const lists: (Instr & { k: 'list' })[] = [];
  const once = new Set<V>();
  const known = (a: V) => size.has(a) || once.has(a);
  const walk = (r: Region): void =>
    r.body.forEach((i) => {
      regionsOf(i).forEach(walk);
      if (i.k === 'const') size.set(i.out, 1);
      if (
        i.k === 'op' &&
        (p.types[i.out].lane === 'color' ||
          (elementwise && p.types[i.out].shape.length > 0)) &&
        rowOfOp(rows, i.op)?.row.effect === 'pure' &&
        i.args.every(known)
      ) {
        once.add(i.out);
        i.args.forEach((a) => p.types[a].shape.length > 0 && once.add(a));
      }
      if (i.k !== 'list' || !i.args.every((a) => size.has(a))) return;
      size.set(
        i.out,
        i.args.reduce((n, a) => n + size.get(a)!, 0)
      );
      lists.push(i);
    });
  p.functions.forEach((f) => walk(f.body));
  for (const i of lists.reverse())
    if (once.has(i.out) || size.get(i.out)! >= 16) {
      once.add(i.out);
      i.args.forEach((a) => p.types[a].shape.length > 0 && once.add(a));
    }
  return once;
}

/** The pool loops of a program, as the printer reads them (the `Outline`
 *  of `outline.ts`): each loop with the values its driver call passes, and
 *  the functions that wait. */
export type PoolText = {
  readonly loops: readonly {
    readonly loop: Instr;
    readonly passed: readonly V[];
    readonly lists: readonly V[];
  }[];
  readonly waits: ReadonlySet<string>;
};

/** `pool`: the pool loops of `p` (`outline()`), whose asynchronous text it
 *  prints too (`asyncCode`). `lazy`: `run` is built at its first call. */
export function printJavaScript(
  p: Program,
  rows: readonly OperatorRow[],
  ce?: ComputeEngine,
  syntax: Syntax = JS,
  iterationBudget?: number,
  pool?: PoolText,
  lazy = false
): JavaScriptResult {
  // With a budget, each pass of a `Loop` counts one pass of the call, as
  // `compile()`'s `iterationBudget` (floored).
  // No count where it cannot reach the budget: a bound of the passes of a
  // call at compile time (`loopPasses()`) within it, and no recursion.
  const limit = Math.floor(iterationBudget ?? Infinity);
  const budget =
    !Number.isFinite(limit) ||
    (recursiveFunctions(p.functions).size === 0 &&
      loopPasses(p, limit, useIndex(p).def, Infinity) <= limit)
      ? undefined
      : limit;
  // Not under an `entry` wrapper (the bigint mode): a value computed once
  // is outside its catch of a pole.
  const once = onceLists(p, rows, syntax.entry === undefined);
  const printed = printProgram(
    p,
    budget === undefined
      ? syntax
      : {
          ...syntax,
          loopOpen: (k, lo, hi, passes, done, window) => [
            ...syntax.loopOpen(
              k,
              lo,
              hi,
              passes,
              done,
              window,
              passes && budget < 2 ** 32
            ),
            ...(passes ? [`  _SYS.countLoopPass(${budget});`] : []),
          ],
        },
    rows,
    once
  );
  // The asynchronous text: the `async` copies of the functions that wait,
  // and the entry, each of which restores the caller's state when it ends.
  let asyncCode: string | undefined;
  if (pool !== undefined) {
    const loops = new Map(
      pool.loops.map((x, id) => [
        x.loop,
        { id, passed: x.passed, lists: x.lists },
      ])
    );
    const a = printProgram(p, syntax, rows, once, {
      loops,
      waits: pool.waits,
    });
    asyncCode = [
      ...a.functions,
      'return (async () => {',
      'try {',
      ...a.body,
      '} finally { _run.d(); }',
      '})();',
    ].join('\n');
  }
  const entry = entryOf(p);
  const n = argumentIndex(entry, entry.positional ?? 0);
  const params =
    n === 0
      ? '_'
      : `${Array.from({ length: n }, (_, k) => `a${k}`).join(', ')}, _ = {}`;
  const preambleOnce = [
    ...printed.helpers,
    ...[...printed.once.values()].map(([x, value]) => `const ${x} = ${value};`),
    ...printed.functions,
  ].join('\n');
  // The count starts again at each call of the entry.
  const counts = [preambleOnce, ...printed.body].some((s) =>
    s.includes('_SYS.countLoopPass(')
  );
  const body = [
    ...(counts ? ['  _SYS.resetLoopPasses();'] : []),
    ...(syntax.entry?.(printed.body) ?? printed.body),
  ].join('\n');
  const literal = entry.literal === true;
  const code = literal
    ? `(${params}) => {\n${body}\n}`
    : `(() => {\n${body}\n})()`;
  // The construction of `load()` of `createJavaScriptRuntime()`.
  const make = (): JavaScriptResult['run'] => {
    try {
      const pending =
        ce !== undefined && p.stagedAssignments
          ? assignmentState(ce, p.assigns!)
          : undefined;
      const sys = runtimeOf(ce, p.hosts, p.arrays, p.assigns, pending);
      const run = (
        literal
          ? twoStageRunner(sys, preambleOnce, [], `return (${code});`)()
          : twoStageRunner(sys, preambleOnce, ['_'], `return ${code};`)
      ) as JavaScriptResult['run'];
      return pending?.run(run) ?? run;
    } catch (e) {
      // A deadline that expires while the values computed once are computed.
      if (isCancellationError(e)) throw e;
      // Code nested deeper than the parser's stack (a chain of 1,000 `If`s
      // on a platform with a small stack): `sliceError()` declines it as
      // too deep.
      if (e instanceof RangeError && /call stack/.test(e.message)) throw e;
      throw new Error(
        `slice: the JavaScript printer made code that does not parse (${String(e)}), for the inputs ${entry.paramNames.join(', ')}:\n${preambleOnce}\n${code}`
      );
    }
  };
  // `lazy`: built at the first call (a worker program, which the calling
  // thread runs only for a sub-range that the pool did not complete).
  let built: JavaScriptResult['run'] | undefined = lazy ? undefined : make();
  const run: JavaScriptResult['run'] = lazy
    ? (...args) => (built ??= make())(...args)
    : built!;
  return {
    code,
    preambleOnce,
    run,
    printed,
    ...(asyncCode === undefined ? {} : { asyncCode }),
  };
}
