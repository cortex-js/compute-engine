// This is the root of the `math-json` package (i.e.  `math-json.js` and
// `math-json.esm.js`).
// It only includes what is necessary to parse/serialize MathJSON.
// See `compute-engine.ts` for the root of the library that includes
// **both** MathJSON and the Compute Engine.

export {
  RuntimeSignalCode,
  SignalCode,
  SignalMessage,
  SignalOrigin,
  Signal,
  WarningSignal,
  ErrorSignalHandler,
  WarningSignalHandler,
  ErrorListener,
  ErrorCode,
  Attributes,
  Expression,
  MathJsonBasicNumber,
  MathJsonRealNumber,
  MathJsonSymbol,
  MathJsonString,
  MathJsonFunction,
  MathJsonDictionary,
  DictionaryCategory,
} from './public';

export {
  LatexDictionary,
  LatexDictionaryEntry,
  LatexString,
  LatexToken,
  NumberFormattingOptions,
  ParseLatexOptions,
  ParserFunction,
  SerializeLatexOptions,
  SerializerFunction,
} from './latex-syntax/public';

// MathJSON parse/serialize
export { LatexSyntax, parse, serialize } from './latex-syntax/latex-syntax';

export const version = '{{SDK_VERSION}}';
