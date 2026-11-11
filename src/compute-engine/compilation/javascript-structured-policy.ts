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
import {
  elementOf,
  isTupleType,
  listType,
  type IRProgram,
  type ValueType,
} from './structured-ir.js';
import {
  verifyProgram,
  type RepresentationPolicy,
} from './structured-verify.js';

/** The representation that holds a value of the type `type`, or
 *  `undefined` for a list or a tuple of booleans or of complex numbers. A
 *  tuple of reals or of integers is an array of numbers, as a list is: the
 *  existing emitter writes both `[a, b]`. */
export function representationOfKind(
  type: ValueType
): ScalarRepresentation | undefined {
  const element = elementOf(type);
  if (element !== undefined)
    return element === 'real' || element === 'integer' ? 'array' : undefined;
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
    // existing emitter writes them for a list input or parameter, and
    // `_SYS.at(tuple, index)` for a tuple.
    'at': { results: ['number'], operands: ['array', 'number'] },
    'length': { results: ['number'], operands: ['array'] },
    // `[a, b, …]`, the array literal of the existing emitter for a list
    // literal and a tuple; `t[i]` for the element of a tuple at a literal
    // position.
    'list': { results: ['array'], operands: ['number'] },
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
    // writes them.
    'replace-at': { results: ['array'], operands: ['array', 'number'] },
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
  },
};

/** Throw when `program` is not a well-formed program of the JavaScript
 *  fragment target (`verifyProgram()` with `JAVASCRIPT_POLICY`). */
export function verifyJavaScriptProgram(
  program: IRProgram,
  preparedNodes: ReadonlySet<Expression>
): void {
  verifyProgram(program, preparedNodes, JAVASCRIPT_POLICY);
}
