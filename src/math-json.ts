// This is the root of the `math-json` package (i.e.  `math-json.js` and
// `math-json.esm.js`).
//
// It only includes what is necessary to parse/serialize MathJSON.
// See `compute-engine.ts` for the root of the library that includes
// **both** MathJSON and the Compute Engine.

export type {
  Attributes,
  Expression,
  MathJsonSymbol,
  MathJsonString,
  MathJsonFunction,
  MathJsonDictionary,
} from './math-json/math-json-format';

export type {
  RuntimeSignalCode,
  SignalCode,
  SignalMessage,
  SignalOrigin,
  Signal,
  WarningSignal,
  WarningSignalHandler,
  ErrorCode,
  LatexDictionary,
  LatexDictionaryEntry,
  LatexString,
  LatexToken,
  NumberFormattingOptions,
  ParseLatexOptions,
  ParserFunction,
  SerializeLatexOptions,
  SerializerFunction,
} from './math-json/public';

// MathJSON parse/serialize
export { LatexSyntax } from './math-json/latex-syntax';

export const version = '{{SDK_VERSION}}';
