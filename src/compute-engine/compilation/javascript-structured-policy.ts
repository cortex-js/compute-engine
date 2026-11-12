/**
 * The representations of the internal scalar JavaScript fragment target in
 * the structured representation (`structured-ir.ts`), and the verifier of a
 * program of that target.
 *
 * A real and an integer are a JavaScript number (`number`), a boolean is a
 * JavaScript boolean (`boolean`), and a complex number is an `{re, im}`
 * object (`complex`). A list of reals or of integers is a JavaScript array
 * of numbers (`array`), as the existing emitter holds a list input and the
 * list that a comprehension makes. The
 * target holds no list of booleans or of complex numbers: no program of the
 * structured route needs one yet. The conversions are `real-to-complex` and
 * the identity conversions of a write to a local of a wider type.
 */
import type { Expression } from '../global-types.js';
import type { ScalarRepresentation } from './javascript-fragment-facts.js';
import { initialPanelsForDimensions } from '../numerics/gauss-kronrod.js';
import {
  elementOf,
  isListType,
  isTupleType,
  listType,
  type AbortKind,
  type CollectionFunctionName,
  type CollectionResultArray,
  type IROperation,
  type IRProgram,
  type ValueType,
} from './structured-ir.js';
import {
  verifyProgram,
  type RepresentationPolicy,
} from './structured-verify.js';

/** The representation that holds a value of the type `type`, or
 *  `undefined` for a list or a tuple of booleans or of complex numbers, at
 *  any depth. A tuple of reals or of integers is an array of numbers, as a
 *  list is: the existing emitter writes both `[a, b]`; a list of such tuples
 *  is an array of them, and a list of lists an array of arrays at every
 *  rank (`[[x, 1], [2, x]]`). */
export function representationOfKind(
  type: ValueType
): ScalarRepresentation | undefined {
  const element = elementOf(type);
  // A list of tuples (a list of points) and a list of lists are arrays of
  // arrays, as the existing emitter holds `[[1, 2], [x, 3]]`.
  if (element !== undefined)
    return element === 'real' ||
      element === 'integer' ||
      ((isTupleType(element) || isListType(element)) &&
        representationOfKind(element) === 'array')
      ? 'array'
      : undefined;
  if (isTupleType(type))
    return type.elements.every((e) => e === 'real' || e === 'integer')
      ? 'array'
      : undefined;
  return type === 'real' || type === 'integer'
    ? 'number'
    : (type as 'boolean' | 'complex');
}

export const JAVASCRIPT_POLICY: RepresentationPolicy = {
  name: 'JS',
  representations: new Set<ScalarRepresentation>([
    'number',
    'boolean',
    'complex',
    'array',
  ]),
  representationOf: representationOfKind,
  // A JavaScript number is a `number`, a boolean a `boolean` and `{ re, im }`
  // a `complex`; a `bigint` value has no representation here.
  literalAdmits: (representation, value) =>
    typeof value === 'number'
      ? representation === 'number'
      : typeof value === 'boolean'
        ? representation === 'boolean'
        : typeof value === 'object' && representation === 'complex',
  conversions: {
    'real-to-complex': { from: 'number', to: 'complex', type: 'complex' },
    // A value written to a local of a wider type (an integer to a real
    // local, a list of integers to a local of a list of reals): the same
    // JavaScript value, with no code, as the existing emitter writes it.
    'integer-to-real': { from: 'number', to: 'number', type: 'real' },
    'integer-list-to-real-list': {
      from: 'array',
      to: 'array',
      type: listType('real'),
    },
    // A list of rows of integers written to a local of a list of rows of
    // reals: the same array of arrays.
    'integer-rows-to-real-rows': {
      from: 'array',
      to: 'array',
      type: listType(listType('real')),
    },
  },
  operations: {
    // A complex sum reads a real operand as its real part, with no
    // conversion, as the existing emitter writes it; the verifier checks
    // that a complex sum has a complex operand and a real sum none.
    'add': { results: ['number', 'complex'], operands: ['number', 'complex'] },
    'negate': { results: ['number', 'complex'], operands: 'same' },
    // A complex product is written per component, as the existing emitter
    // writes it; a real operand of it is a number, with no conversion. The
    // verifier checks that a complex product has a complex operand and a
    // real product none.
    'multiply': {
      results: ['number', 'complex'],
      operands: ['number', 'complex'],
    },
    'min': { results: ['number'], operands: ['number'] },
    'max': { results: ['number'], operands: ['number'] },
    'less': { results: ['boolean'], operands: ['number'] },
    'less-equal': { results: ['boolean'], operands: ['number'] },
    'equal': { results: ['boolean'], operands: ['number'] },
    'not-equal': { results: ['boolean'], operands: ['number'] },
    // `_SYS.floorMod`, `Math.floor` and `/`, as the existing emitter writes
    // them. A complex quotient is the guarded text of the existing emitter
    // (`Divide` in `javascript-target.ts`), with a real operand as a number.
    'mod': { results: ['number'], operands: ['number'] },
    'floor': { results: ['number'], operands: ['number'] },
    'divide': {
      results: ['number', 'complex'],
      operands: ['number', 'complex'],
    },
    'and': { results: ['boolean'], operands: ['boolean'] },
    'or': { results: ['boolean'], operands: ['boolean'] },
    // `Math.sqrt` of a number, `_SYS.csqrt` of an `{re, im}` object.
    'sqrt': { results: ['number', 'complex'], operands: 'same' },
    // `_SYS.atNumeric(list, index, element type)` and `list.length`, as the
    // existing emitter writes them for a list input or parameter,
    // `_SYS.at(tuple, index)` for a tuple, and `_SYS.atPoint(list, index,
    // size)` for a list of tuples, whose element is an array.
    'at': { results: ['number', 'array'], operands: ['array', 'number'] },
    'length': { results: ['number'], operands: ['array'] },
    // `[a, b, …]`, the array literal of the existing emitter for a list
    // literal and a tuple; `t[i]` for the element of a tuple at a literal
    // position.
    'list': { results: ['array'], operands: ['number', 'array'] },
    'tuple': { results: ['array'], operands: ['number'] },
    'get': { results: ['number'], operands: ['array'] },
    // `(r.push(x), r)` when the emitter writes the element into the array
    // in place, `[...r, x]` otherwise: the `result.push()` of the guarded
    // comprehension of the existing emitter.
    'append': { results: ['array'], operands: ['array', 'number'] },
    // `!x`, as the existing emitter writes `Not`.
    'not': { results: ['boolean'], operands: ['boolean'] },
    // A new array of numbers, filled in the order of the index. The
    // operands are the two bounds.
    'build': { results: ['array'], operands: ['number'] },
    // `_SYS.replaceAt(list, index, value)`, or `_SYS.replaceAtInPlace` when
    // the emitter updates the array in place, as the existing emitter
    // writes them. The value is a number, or an array for a row of a list
    // of lists.
    'replace-at': { results: ['array'], operands: ['array', 'number'] },
    // `list?.slice()`, or `list?.map((_r) => _r?.slice())` for two levels:
    // the copies of `listCopy()` and `_SYS.ownedCopyLevels`.
    'copy': { results: ['array'], operands: ['array'] },
    // The test heads take real operands and have a real value.
    'trace': { results: ['number'], operands: ['number'] },
    // `_SYS.drawNextRandomNumber()`, a number, as the existing emitter
    // writes `Random()`.
    'draw': { results: ['number'], operands: [] },
    // `_SYS.withRandomSeed(seed, () => { …; return value; })`, the closure
    // of the existing emitter: a real seed is a number, a complex one an
    // `{re, im}` object, which the helper reads as its real part when its
    // imaginary part is 0. The result is the scalar value of the body.
    'seeded': {
      results: ['number', 'boolean', 'complex'],
      operands: ['number', 'complex'],
    },
    // A function of the host called with numbers, or a value of the host
    // read at its position, as the existing emitter writes a `functions`
    // or `operators` entry and a `vars` source: a number.
    'host': { results: ['number'], operands: ['number'] },
    // A runtime helper of arrays, or a method of the array, as the existing
    // emitter writes the head (`collections`, below).
    'collection': {
      results: ['number', 'array', 'boolean'],
      operands: ['array', 'number'],
    },
  },
  // The emitter writes each function of lists as the existing emitter writes
  // its head for an array of numbers (`Norm`, `Mean`, `Dot`, `Take`, …, in
  // `javascript-target.ts`): `_SYS.norm(L)`, `_SYS.mean(L)`,
  // `_SYS.median(L)`, `_SYS.variance(L)`, `_SYS.matmul(L, M)`, `L.slice(…)`,
  // `L.slice().reverse()`, `L.slice().sort(…)`, `[...L, ...M]`,
  // `_SYS.range(a, b, step)`, `_SYS.rotl(L, k)` and `_SYS.rotr(L, k)`. Each
  // list result is a new array.
  collections: {
    // `_SYS.norm(L)`, and `_SYS.norm(L, p)` with an order.
    'norm': { results: ['number'], operands: ['array', 'number'] },
    'mean': { results: ['number'], operands: ['array'] },
    'median': { results: ['number'], operands: ['array'] },
    'variance': { results: ['number'], operands: ['array'] },
    'dot': { results: ['number'], operands: ['array'] },
    // `.slice(…)`, `.slice().reverse()`, `.slice().sort(…)`, `[...a, ...b]`
    // and `_SYS.rotl`, `_SYS.rotr`: a new outer array that holds the
    // elements (the rows) of the operands (`resultArray`, `copy`).
    'take': { results: ['array'], operands: ['array', 'number'], resultArray: 'copy' },
    'drop': { results: ['array'], operands: ['array', 'number'], resultArray: 'copy' },
    'reverse': { results: ['array'], operands: ['array'], resultArray: 'copy' },
    'sort': { results: ['array'], operands: ['array'], resultArray: 'copy' },
    'join': { results: ['array'], operands: ['array'], resultArray: 'copy' },
    'range': { results: ['array'], operands: ['number'], resultArray: 'new' },
    'rotate-left': { results: ['array'], operands: ['array', 'number'], resultArray: 'copy' },
    'rotate-right': { results: ['array'], operands: ['array', 'number'], resultArray: 'copy' },
    // The matrix functions: `_SYS.det(M)`, `_SYS.trace(M)`,
    // `_SYS.transpose(M)`, `_SYS.rref(M)`, `_SYS.inv(M)`,
    // `_SYS.matpow(M, p)`, `_SYS.matmul(A, B)`, `_SYS.diagonal(M)` and
    // `M.flat(Infinity)` (and `_SYS.mul(A, B)` for `matrix-product`), as the
    // existing emitter writes their heads on the
    // real lane. A list result that has no value is a number in place of the
    // array (`NaN`, or `0` for `_SYS.matmul` of two empty lists).
    //
    // The array of each list result (`resultArray`, `javascript-runtime.ts`):
    // `_SYS.transpose` gives its operand itself for a value that is not a
    // matrix (`[]`, a list, `NaN`): `operand`. Each other helper makes a new
    // array at every depth or gives a number: `_SYS.rref` and `_SYS.matpow`
    // copy each row (`M^1` too), `_SYS.inv` slices the rows of its working
    // copy, `_SYS.matmul` builds new rows (a list of `NaN` for an absent
    // second operand), `_SYS.diagonal` builds new rows or a list of
    // numbers, `.flat(Infinity)` a new list of numbers, and `_SYS.mul` of
    // two lists takes a product (an absent factor is never an operand of
    // `matrix-product`: `refuseAbsentMatrixUses()`).
    'determinant': { results: ['number'], operands: ['array'] },
    'trace': { results: ['number'], operands: ['array'] },
    'transpose': { results: ['array'], operands: ['array'], resultArray: 'operand' },
    'row-reduce': { results: ['array'], operands: ['array'], resultArray: 'new' },
    'inverse': { results: ['array'], operands: ['array'], resultArray: 'new' },
    'matrix-power': { results: ['array'], operands: ['array', 'number'], resultArray: 'new' },
    'matrix-multiply': { results: ['array'], operands: ['array'], resultArray: 'new' },
    // `_SYS.mul(A, B)`, as the existing emitter writes `Multiply` of two
    // operands whose types state their ranks, one a matrix.
    'matrix-product': { results: ['array'], operands: ['array'], resultArray: 'new' },
    'diagonal': { results: ['array'], operands: ['array'], resultArray: 'new' },
    'flatten': { results: ['array'], operands: ['array'], resultArray: 'new' },
    // The statistics: `_SYS.populationVariance(L)`, …,
    // `_SYS.covariance(L, M)`, a number.
    'population-variance': { results: ['number'], operands: ['array'] },
    'standard-deviation': { results: ['number'], operands: ['array'] },
    'population-standard-deviation': { results: ['number'], operands: ['array'] },
    'skewness': { results: ['number'], operands: ['array'] },
    'kurtosis': { results: ['number'], operands: ['array'] },
    'mode': { results: ['number'], operands: ['array'] },
    'interquartile-range': { results: ['number'], operands: ['array'] },
    'covariance': { results: ['number'], operands: ['array'] },
    'correlation': { results: ['number'], operands: ['array'] },
    // `_SYS.idxt(L, x)`, a number, and `L.includes(x)`, a boolean.
    'index-of': { results: ['number'], operands: ['array', 'number'] },
    'contains': { results: ['boolean'], operands: ['array', 'number'] },
    // The texts of the existing emitter for `Ordering(L)`, `Unique(L)`,
    // `Repeat`, `Linspace` and `Slice`, and `_SYS.atNumeric(L, I, label)`
    // of a list of indexes. Each reads, or makes, a flat list of numbers
    // only, and each gives a new array of numbers for every input
    // (`resultArray`, `new`): `Array.from(…)` sorted in place
    // (`ordering`), `[...new Set(L)]`, `[]` or `Array.from(…)` (`repeat`),
    // `[_s]` or `Array.from(…)` (`linspace`, whose bounds are finite
    // literals, so never the number `NaN`), `[]` or `_l.slice(…)`
    // (`slice`), and the new list `picked` of `_SYS.at` (`gather`; its
    // indexes are numbers, never a boolean mask). `at-real` gives a
    // number.
    'ordering': { results: ['array'], operands: ['array'], resultArray: 'new' },
    'unique': { results: ['array'], operands: ['array'], resultArray: 'new' },
    'repeat': { results: ['array'], operands: ['number'], resultArray: 'new' },
    'linspace': { results: ['array'], operands: ['number'], resultArray: 'new' },
    'slice': { results: ['array'], operands: ['array', 'number'], resultArray: 'new' },
    'at-real': { results: ['number'], operands: ['array', 'number'] },
    'gather': { results: ['array'], operands: ['array'], resultArray: 'new' },
  },
  // The emitter writes each function as the existing emitter writes it for
  // the same operand (`FUNCTION_CODE` in `javascript-structured-emit.ts`):
  // `Math.exp` of a number, `_SYS.cexp` of an `{re, im}` object, and so
  // on. `abs` of an `{re, im}` object is the number `_SYS.cabs`.
  functions: {
    'exp': { results: ['number', 'complex'], operands: 'same' },
    'ln': { results: ['number', 'complex'], operands: 'same' },
    'sin': { results: ['number', 'complex'], operands: 'same' },
    'cos': { results: ['number', 'complex'], operands: 'same' },
    'tanh': { results: ['number', 'complex'], operands: 'same' },
    'abs': { results: ['number'], operands: ['number', 'complex'] },
    'atan2': { results: ['number'], operands: ['number'] },
    // `_SYS.pow(b, e)` of numbers and `_SYS.cpow(b, e)` of `{re, im}`
    // objects, and `Math.pow(Math.abs(b), e)` with the sign rule of
    // `signed-pow`, as the existing emitter writes `Power`.
    'pow': { results: ['number', 'complex'], operands: 'same' },
    'abs-pow': { results: ['number'], operands: ['number'] },
    'signed-pow': { results: ['number'], operands: ['number'] },
    // `Math.pow(b, e)` for a constant exponent, `Math.cbrt(x)` and
    // `_SYS.root(x, n)`, as the existing emitter writes `Power` and `Root`.
    'real-pow': { results: ['number'], operands: ['number'] },
    'cbrt': { results: ['number'], operands: ['number'] },
    'root': { results: ['number'], operands: ['number'] },
    // `({ re: a, im: b })`.
    'complex': { results: ['complex'], operands: ['number'] },
    // The functions of the special and trigonometric heads: a runtime helper
    // of an `{re, im}` object where the existing emitter has one (`_SYS.ctan`,
    // `_SYS.casin`, `_SYS.clog10`, …), and a real kernel only otherwise.
    'tan': { results: ['number', 'complex'], operands: 'same' },
    'cot': { results: ['number', 'complex'], operands: 'same' },
    'sec': { results: ['number', 'complex'], operands: 'same' },
    'csc': { results: ['number', 'complex'], operands: 'same' },
    'sinh': { results: ['number', 'complex'], operands: 'same' },
    'cosh': { results: ['number', 'complex'], operands: 'same' },
    'atan': { results: ['number', 'complex'], operands: 'same' },
    'asinh': { results: ['number', 'complex'], operands: 'same' },
    'gamma': { results: ['number', 'complex'], operands: 'same' },
    'sign': { results: ['number', 'complex'], operands: 'same' },
    // `_SYS.cconj(z)`; the rule of `Conjugate` writes a real operand as
    // itself.
    'conjugate': { results: ['complex'], operands: ['complex'] },
    'asin': { results: ['number', 'complex'], operands: 'same' },
    'acos': { results: ['number', 'complex'], operands: 'same' },
    'acosh': { results: ['number', 'complex'], operands: 'same' },
    'atanh': { results: ['number', 'complex'], operands: 'same' },
    'log10': { results: ['number', 'complex'], operands: 'same' },
    'log2': { results: ['number', 'complex'], operands: 'same' },
    'erf': { results: ['number'], operands: ['number'] },
    'erfc': { results: ['number'], operands: ['number'] },
    'digamma': { results: ['number'], operands: ['number'] },
    'haversine': { results: ['number'], operands: ['number'] },
    'sinpi': { results: ['number'], operands: ['number'] },
    'cospi': { results: ['number'], operands: ['number'] },
    'tanpi': { results: ['number'], operands: ['number'] },
    'ceil': { results: ['number'], operands: ['number'] },
    'round-ties-away': { results: ['number'], operands: ['number'] },
    // The real code of the handler of the head (an expression for `acot`,
    // `acsc`, …, `coth`), and its runtime helper of an `{re, im}` object.
    'acot': { results: ['number', 'complex'], operands: 'same' },
    'acsc': { results: ['number', 'complex'], operands: 'same' },
    'asec': { results: ['number', 'complex'], operands: 'same' },
    'acoth': { results: ['number', 'complex'], operands: 'same' },
    'asech': { results: ['number', 'complex'], operands: 'same' },
    'acsch': { results: ['number', 'complex'], operands: 'same' },
    'coth': { results: ['number', 'complex'], operands: 'same' },
    // The rule of `Sech` and `Csch` admits a complex operand only.
    'sech': { results: ['complex'], operands: ['complex'] },
    'csch': { results: ['complex'], operands: ['complex'] },
    'factorial': { results: ['number'], operands: ['number'] },
    'factorial2': { results: ['number'], operands: ['number'] },
    'trunc': { results: ['number'], operands: ['number'] },
    'fract': { results: ['number'], operands: ['number'] },
    'mod-one': { results: ['number'], operands: ['number'] },
    'hypot': { results: ['number'], operands: ['number'] },
    // The real-only special functions and the continuation heads of real
    // operands: the real kernel that the existing emitter names for the head
    // (`_SYS.gammaQ`, `_SYS.heaviside`, `_SYS.remainder`, …). The helpers of
    // `real-remainder`, `real-gcd` and `real-lcm` throw a `RangeError` for
    // an operand beyond the safe integers or infinite, as `mod` does.
    ...Object.fromEntries(
      (
        [
          'heaviside',
          'ln-gamma',
          'sinc',
          'erfi',
          'erf-inv',
          'trigamma',
          'fresnel-s',
          'fresnel-c',
          'sin-integral',
          'cos-integral',
          'exp-integral-ei',
          'log-integral',
          'dirichlet-eta',
          'dirichlet-beta',
          'zeta',
          'stieltjes',
          'lambert-w',
          'elliptic-k',
          'elliptic-e',
          'gamma-q',
          'gamma-upper',
          'beta',
          'real-binomial',
          'clausen',
          'elliptic-f',
          'elliptic-e-incomplete',
          'elliptic-pi',
          'bessel-j',
          'bessel-y',
          'bessel-i',
          'bessel-k',
          'agm',
          'polygamma',
          'zeta-generalized',
          'stieltjes-generalized',
          'hurwitz-zeta',
          'polylog',
          'lambert-w-branch',
          'real-remainder',
          'real-gcd',
          'real-lcm',
          'chop',
        ] as const
      ).map((fn) => [fn, { results: ['number'], operands: ['number'] }])
    ),
  },
  // `_SYS.integrate(f, lo, hi[, panels])`, as the existing emitter writes a
  // definite `Integrate` with no closed form (`compileIntegrate()` in
  // `javascript-target.ts`): `f` is the body as a closure of the parameter.
  // The runtime keeps the count of the integrals in progress and a budget of
  // nested evaluations as module state (`quadrature`), and an outermost
  // integral that does not converge samples 10^7 points from the live
  // entropy source of the engine (`entropy`; a seeded frame does not
  // discharge it, `docs/RANDOMNESS-MODEL.md`). It throws only the timeout
  // of an ambient deadline (`error`); no value is `NaN`. The default of the
  // panels is the starting count of a single integral
  // (`initialPanelsForDimensions(1)`): the emitter writes no fourth argument
  // for it.
  routines: {
    integrate: {
      results: ['number'],
      operands: ['number'],
      parameter: 'number',
      effect: 'effectful',
      touches: ['entropy', 'quadrature'],
      aborts: ['error'],
      defaultPanels: initialPanelsForDimensions(1),
    },
  },
};

/** The kinds of abort of the operation `op` itself on the `bigint` policy
 *  (`JAVASCRIPT_BIGINT_POLICY.aborts`): a pole, and an index of `at` out of
 *  range, is the abort `no-value`; a helper above the size limit of the
 *  mode (10^6 decimal digits, `bigint-runtime.ts`), an `exact` quotient
 *  with a remainder, a `replace-at` at a position out of range and a
 *  `range` of more than 2^32 - 1 elements throw a `RangeError`, the abort
 *  `error`. A `loop` has no abort of its own. */
function bigintAborts(op: IROperation): readonly AbortKind[] | undefined {
  const both: readonly AbortKind[] = ['error', 'no-value'];
  // `_SYS.bat` at an index out of range: a pole carrying `NaN`.
  if (op.kind === 'mod' || op.kind === 'no-value' || op.kind === 'at')
    return ['no-value'];
  // `_SYS.breplaceAt` at an index out of range, and `_SYS.brange` of more
  // than 2^32 - 1 elements, throw a `RangeError`.
  if (op.kind === 'replace-at') return ['error'];
  if (op.kind === 'collection')
    return op.fn === 'range' ? ['error'] : undefined;
  if (op.kind !== 'integer') return undefined;
  switch (op.fn) {
    // `_SYS.bremainder`, `_SYS.bisqrt` at a zero divisor or a negative
    // operand.
    case 'remainder':
    case 'isqrt':
      return ['no-value'];
    // `_SYS.bexactDiv` throws a `RangeError` for a remainder.
    case 'quotient':
      return op.rounding === 'exact' ? both : ['no-value'];
    // `_SYS.bpow` and `_SYS.bpowRational`: `0^0`, `0^e` for `e < 0`, the
    // size limit; `_SYS.bfactorial`: a negative operand, the size limit.
    case 'rounded-pow':
    case 'int-pow':
    case 'factorial':
      return both;
    // The size limit only.
    case 'factorial2':
    case 'binomial':
    case 'fibonacci':
      return ['error'];
    default:
      return undefined;
  }
}

/**
 * The policy of the JavaScript target in the compile mode `bigint` (the
 * policy `JS-bigint`): an integer is a JavaScript `bigint` (`bigint`), a
 * boolean a JavaScript boolean (`boolean`), as the bigint emitter of the
 * existing compiler holds them (`compile-bigint-emit.ts`). A real and a
 * complex number have no representation, so no value of the program is
 * real: the verifier refuses a real value, which makes the exactness of the
 * mode a check of the representation. There is no conversion: a `number`
 * input is lifted at the entry, a boundary rule of the input
 * (`IRInput.lifted`).
 *
 * A pole aborts with `no-value` (`bigintAborts()`): the helper throws a
 * `_SYS.NonFiniteValue`, which one catch at the entry turns into the
 * `number` of the call, `NaN` or `Infinity` (`noValueResult`). A list of
 * integers is a JavaScript array of `bigint` values (`bigint-array`), as the
 * existing emitter holds a `list<integer>` input and the list that it makes;
 * an index, a count and a length are `bigint` values, which the helpers of
 * the runtime convert (`_SYS.bat`, `_SYS.btake`, …). No other list is held.
 */
export const JAVASCRIPT_BIGINT_POLICY: RepresentationPolicy = {
  name: 'JS-bigint',
  representations: new Set(['bigint', 'boolean', 'bigint-array']),
  representationOf: (type) =>
    type === 'integer'
      ? 'bigint'
      : type === 'boolean'
        ? 'boolean'
        : elementOf(type) === 'integer'
          ? 'bigint-array'
          : undefined,
  // An integer literal is a JavaScript `bigint` (`123n`), never a number.
  literalAdmits: (representation, value) =>
    typeof value === 'bigint'
      ? representation === 'bigint'
      : typeof value === 'boolean' && representation === 'boolean',
  conversions: {},
  // The operators of `bigint` values (`+`, unary `-`, `*`, `<`, `<=`,
  // `===`, `!==`), `_SYS.bmin`, `_SYS.bmax` and `_SYS.bfloorMod`, as the
  // existing emitter writes them; `&&`, `||` and `!` of booleans.
  operations: {
    'add': { results: ['bigint'], operands: ['bigint'] },
    'negate': { results: ['bigint'], operands: ['bigint'] },
    'multiply': { results: ['bigint'], operands: ['bigint'] },
    'min': { results: ['bigint'], operands: ['bigint'] },
    'max': { results: ['bigint'], operands: ['bigint'] },
    'less': { results: ['boolean'], operands: ['bigint'] },
    'less-equal': { results: ['boolean'], operands: ['bigint'] },
    'equal': { results: ['boolean'], operands: ['bigint'] },
    'not-equal': { results: ['boolean'], operands: ['bigint'] },
    'mod': { results: ['bigint'], operands: ['bigint'] },
    'and': { results: ['boolean'], operands: ['boolean'] },
    'or': { results: ['boolean'], operands: ['boolean'] },
    'not': { results: ['boolean'], operands: ['boolean'] },
    // `_SYS.bat(list, i)`, `_SYS.toBigint(list.length)`, the array literal
    // `[a, b, …]` and `_SYS.breplaceAt(list, i, v)`, as the existing emitter
    // writes `At`, `Length`, `List` and `ReplaceAt`.
    'at': { results: ['bigint'], operands: ['bigint-array', 'bigint'] },
    'length': { results: ['bigint'], operands: ['bigint-array'] },
    'list': { results: ['bigint-array'], operands: ['bigint'] },
    'replace-at': {
      results: ['bigint-array'],
      operands: ['bigint-array', 'bigint'],
    },
    'collection': {
      results: ['bigint-array'],
      operands: ['bigint-array', 'bigint'],
    },
  },
  // `_SYS.babs` and `_SYS.bsign`.
  functions: {
    abs: { results: ['bigint'], operands: ['bigint'] },
    sign: { results: ['bigint'], operands: ['bigint'] },
  },
  // `_SYS.btake(list, c)`, `_SYS.bdrop(list, c)` and `_SYS.brange(a, b)`,
  // as the existing emitter writes `Take`, `Drop` and `Range`. A tuple, a
  // `build`, an `append` and the other functions of lists are not in the
  // mode: the heads that make them decline at the lowering
  // (`javascript-structured-bigint.ts`).
  collections: {
    take: { results: ['bigint-array'], operands: ['bigint-array', 'bigint'], resultArray: 'copy' },
    drop: { results: ['bigint-array'], operands: ['bigint-array', 'bigint'], resultArray: 'copy' },
    range: { results: ['bigint-array'], operands: ['bigint'], resultArray: 'new' },
  },
  // The helpers of `bigint-runtime.ts` that the existing emitter calls for
  // the same heads (`javascript-structured-emit.ts`, `BIGINT_CODE`).
  integers: {
    'remainder': { results: ['bigint'], operands: ['bigint'] },
    'quotient': { results: ['bigint'], operands: ['bigint'] },
    'isqrt': { results: ['bigint'], operands: ['bigint'] },
    'rounded-pow': { results: ['bigint'], operands: ['bigint'] },
    'int-pow': { results: ['bigint'], operands: ['bigint'] },
    'neg-one-pow': { results: ['bigint'], operands: ['bigint'] },
    'gcd': { results: ['bigint'], operands: ['bigint'] },
    'lcm': { results: ['bigint'], operands: ['bigint'] },
    'factorial': { results: ['bigint'], operands: ['bigint'] },
    'factorial2': { results: ['bigint'], operands: ['bigint'] },
    'binomial': { results: ['bigint'], operands: ['bigint'] },
    'fibonacci': { results: ['bigint'], operands: ['bigint'] },
    'is-prime': { results: ['boolean'], operands: ['bigint'] },
  },
  aborts: bigintAborts,
  noValueResult: 'number',
};

/** The field `resultArray` of an `IRCollection` of the function `fn`
 *  under `policy`: the fact of the target's helper
 *  (`OperationRule.resultArray`), or none. */
export function collectionResultArray(
  policy: RepresentationPolicy,
  fn: CollectionFunctionName
): { resultArray?: CollectionResultArray } {
  const fact = policy.collections?.[fn]?.resultArray;
  return fact === undefined ? {} : { resultArray: fact };
}

/** Throw when `program` is not a well-formed program of the JavaScript
 *  fragment target (`verifyProgram()` with `JAVASCRIPT_POLICY`, or with
 *  `JAVASCRIPT_BIGINT_POLICY` for a program of the mode `bigint`). */
export function verifyJavaScriptProgram(
  program: IRProgram,
  preparedNodes: ReadonlySet<Expression>
): void {
  verifyProgram(
    program,
    preparedNodes,
    program.numericPolicy === 'bigint'
      ? JAVASCRIPT_BIGINT_POLICY
      : JAVASCRIPT_POLICY
  );
}
