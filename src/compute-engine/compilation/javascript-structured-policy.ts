/**
 * The representations of the internal scalar JavaScript fragment target in
 * the structured representation (`structured-ir.ts`), and the verifier of a
 * program of that target.
 *
 * A real and an integer are a JavaScript number (`number`), a boolean is a
 * JavaScript boolean (`boolean`), and a complex number is an `{re, im}`
 * object (`complex`). The one conversion is `real-to-complex`.
 */
import type { Expression } from '../global-types.js';
import type { ScalarRepresentation } from './javascript-fragment-facts.js';
import type { IRProgram, ScalarKind } from './structured-ir.js';
import {
  verifyProgram,
  type RepresentationPolicy,
} from './structured-verify.js';

/** The representation that holds a value of the type `type`. */
export function representationOfKind(type: ScalarKind): ScalarRepresentation {
  return type === 'real' || type === 'integer' ? 'number' : type;
}

export const JAVASCRIPT_POLICY: RepresentationPolicy = {
  name: 'JS',
  representations: new Set<ScalarRepresentation>(['number', 'boolean', 'complex']),
  representationOf: representationOfKind,
  conversions: {
    'real-to-complex': { from: 'number', to: 'complex', type: 'complex' },
  },
  operations: {
    add: { results: ['number', 'complex'], operands: 'same' },
    negate: { results: ['number', 'complex'], operands: 'same' },
    multiply: { results: ['number'], operands: ['number'] },
    min: { results: ['number'], operands: ['number'] },
    max: { results: ['number'], operands: ['number'] },
    less: { results: ['boolean'], operands: ['number'] },
    equal: { results: ['boolean'], operands: ['number'] },
    and: { results: ['boolean'], operands: ['boolean'] },
    or: { results: ['boolean'], operands: ['boolean'] },
    // `Math.sqrt` of a number, `_SYS.csqrt` of an `{re, im}` object.
    sqrt: { results: ['number', 'complex'], operands: 'same' },
    // The test heads take real operands and have a real value.
    trace: { results: ['number'], operands: ['number'] },
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
