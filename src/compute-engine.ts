// This file is the root of the `compute-engine` package
// (i.e. the `compute-engine.js` and `compute-engine.esm.js` files)
// It includes the MathJSON library as well as the Compute Engine.
//
// The MathJSON library is also available separately if the whole
// Compute Engine is not required.

export * from './math-json/math-json-format';

export type {
  LatexToken,
  LatexString,
  RuntimeSignalCode,
  SignalMessage,
  SignalOrigin,
  Signal,
  ErrorSignal,
  CortexError,
  WarningSignal,
  WarningSignalHandler,
  ErrorCode,
  ParserFunction,
  SerializerFunction,
  LatexDictionaryEntry,
  LatexDictionary,
  ParseLatexOptions,
  SerializeLatexOptions,
  NumberFormattingOptions,
} from './math-json/public';

// MathJSON parse/serialize
export { LatexSyntax } from './math-json/latex-syntax';

// Compute Engine
export { ComputeEngine } from './compute-engine/compute-engine';
export { match, substitute } from './compute-engine/patterns';

export const version = '{{SDK_VERSION}}';
