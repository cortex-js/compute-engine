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
  MathJsonDictionary,
  MathJsonIdentifier,
} from './math-json/math-json-format';

export {
  isSymbolObject,
  isStringObject,
  isFunctionObject,
  isDictionaryObject,
  stringValue as getStringValue,
  head,
  headName,
  symbol,
  applyRecursively,
  mapArgs,
  op,
  nops,
  dictionary as getDictionary,
} from './math-json/utils';

export const version = '{{SDK_VERSION}}';
