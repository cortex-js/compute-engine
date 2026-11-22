// Entry point for the `@cortex-js/compute-engine/epsil-highlight` sub-path.
//
// Syntax highlighting of Epsil source, with no engine and no parser behind
// it: a CodeMirror 6 stream parser and a function that returns the styled
// ranges of a source. The bundle imports nothing.

export {
  epsilStreamParser,
  epsilHighlightTokens,
} from './epsil/highlight.js';

export type {
  EpsilHighlightToken,
  EpsilHighlightState,
  EpsilStreamParser,
  EpsilStringStream,
} from './epsil/highlight.js';
