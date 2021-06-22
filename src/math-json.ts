// This is the root of the `math-json` package (i.e.  `math-json.js` and
// `math-json.esm.js`).
// It only includes what is necessary to parse/serialize MathJSON.
// See `compute-engine.ts` for the root of the library that includes
// **both** MathJSON and the Compute Engine.

export { Expression } from './public';

// MathJSON parse/serialize
export { LatexSyntax, parse, serialize } from './latex-syntax/latex-syntax';

export const version = '{{SDK_VERSION}}';
