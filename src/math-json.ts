// This is the root of the `math-json` package (i.e.  `math-json.js` and
// `math-json.esm.js`).
//
// It only includes the core data structures for MathJSON and some utilities
//
// See `compute-engine.ts` for the root of the library that includes
// **both** MathJSON and the Compute Engine.

export type {
  Attributes,
  Expression,
  MathJsonNumber,
  MathJsonSymbol,
  MathJsonString,
  MathJsonFunction,
  MathJsonIdentifier,
} from './math-json/types.ts';

export {
  isSymbolObject,
  isStringObject,
  isFunctionObject,
  stringValue as getStringValue,
  operator,
  operand,
  symbol,
  mapArgs,
  dictionary as getDictionary,
} from './math-json/utils.ts';

export const version = '{{SDK_VERSION}}';
