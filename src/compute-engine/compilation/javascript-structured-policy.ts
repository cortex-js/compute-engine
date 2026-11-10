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
 * structured route needs one yet. The one conversion is `real-to-complex`.
 */
import type { Expression } from '../global-types.js';
import type { ScalarRepresentation } from './javascript-fragment-facts.js';
import { elementOf, type IRProgram, type ValueType } from './structured-ir.js';
import {
  verifyProgram,
  type RepresentationPolicy,
} from './structured-verify.js';

/** The representation that holds a value of the type `type`, or
 *  `undefined` for a list of booleans or of complex numbers. */
export function representationOfKind(
  type: ValueType
): ScalarRepresentation | undefined {
  const element = elementOf(type);
  if (element !== undefined)
    return element === 'real' || element === 'integer' ? 'array' : undefined;
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
  },
  operations: {
    // A complex sum reads a real operand as its real part, with no
    // conversion, as the existing emitter writes it; the verifier checks
    // that a complex sum has a complex operand and a real sum none.
    'add': { results: ['number', 'complex'], operands: ['number', 'complex'] },
    'negate': { results: ['number', 'complex'], operands: 'same' },
    // A complex product is written per component, as the existing emitter
    // writes it.
    'multiply': { results: ['number', 'complex'], operands: 'same' },
    'min': { results: ['number'], operands: ['number'] },
    'max': { results: ['number'], operands: ['number'] },
    'less': { results: ['boolean'], operands: ['number'] },
    'less-equal': { results: ['boolean'], operands: ['number'] },
    'equal': { results: ['boolean'], operands: ['number'] },
    'not-equal': { results: ['boolean'], operands: ['number'] },
    // `_SYS.floorMod`, `Math.floor` and `/`, as the existing emitter writes
    // them.
    'mod': { results: ['number'], operands: ['number'] },
    'floor': { results: ['number'], operands: ['number'] },
    'divide': { results: ['number'], operands: ['number'] },
    'and': { results: ['boolean'], operands: ['boolean'] },
    'or': { results: ['boolean'], operands: ['boolean'] },
    // `Math.sqrt` of a number, `_SYS.csqrt` of an `{re, im}` object.
    'sqrt': { results: ['number', 'complex'], operands: 'same' },
    // `_SYS.atNumeric(list, index, element type)` and `list.length`, as the
    // existing emitter writes them for a list input or parameter.
    'at': { results: ['number'], operands: ['array', 'number'] },
    'length': { results: ['number'], operands: ['array'] },
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
  },
  // The emitter writes each function as the existing emitter writes it for
  // the same operand (`FUNCTION_CODE` in `javascript-structured-emit.ts`):
  // `Math.exp` of a number, `_SYS.cexp` of an `{re, im}` object, and so
  // on. `abs` of an `{re, im}` object is the number `_SYS.cabs`.
  functions: {
    exp: { results: ['number', 'complex'], operands: 'same' },
    ln: { results: ['number', 'complex'], operands: 'same' },
    sin: { results: ['number', 'complex'], operands: 'same' },
    cos: { results: ['number', 'complex'], operands: 'same' },
    tanh: { results: ['number', 'complex'], operands: 'same' },
    abs: { results: ['number'], operands: ['number', 'complex'] },
    atan2: { results: ['number'], operands: ['number'] },
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
