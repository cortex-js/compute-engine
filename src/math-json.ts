// This is the root of the `math-json` package (i.e.  `math-json.js` and
// `math-json.esm.js`).
//
// It only includes the core data structures for MathJSON and some utilities
//
// See `compute-engine.ts` for the root of the library that includes
// **both** MathJSON and the Compute Engine.

export type {
  MathJsonExpression,
  MathJsonAttributes,
  MathJsonNumberObject,
  MathJsonSymbolObject,
  MathJsonStringObject,
  MathJsonFunctionObject,
  MathJsonDictionaryObject,
  MathJsonSymbol,
} from './math-json/types.js';

export {
  isSymbolObject,
  isStringObject,
  isFunctionObject,
  stringValue,
  operator,
  operand,
  symbol,
  mapArgs,
  dictionaryFromExpression,
} from './math-json/utils.js';

export const version = '{{SDK_VERSION}}';
