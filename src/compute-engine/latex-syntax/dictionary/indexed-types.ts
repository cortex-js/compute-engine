/**
 * Type definitions for the indexed LaTeX dictionary.
 *
 * These are separated from definitions.ts to break a circular dependency:
 * types.ts needs these types for the Serializer interface, while definitions.ts
 * needs types from types.ts. This file is a leaf module imported by both.
 */

import type {
  Delimiter,
  EnvironmentParseHandler,
  ExpressionParseHandler,
  InfixParseHandler,
  LatexString,
  LatexToken,
  MatchfixParseHandler,
  PostfixParseHandler,
  Precedence,
  SerializeHandler,
} from '../types';

export type CommonEntry = {
  /** Note: a name is required if a serialize handler is provided */
  name?: string;

  serialize?: SerializeHandler;

  /** Note: not all kinds have a `latexTrigger` or `symbolTrigger`.
   * For example, matchfix operators use `openTrigger`/`closeTrigger`
   */
  latexTrigger?: LatexString;
  symbolTrigger?: string;
};

export type IndexedSymbolEntry = CommonEntry & {
  kind: 'symbol';

  // The 'precedence' of symbols is used to determine appropriate wrapping when serializing
  precedence: Precedence;

  parse: ExpressionParseHandler;
};

export type IndexedExpressionEntry = CommonEntry & {
  kind: 'expression';

  // The 'precedence' of expressions is used to determine appropriate wrapping when serializing
  precedence: Precedence;

  parse: ExpressionParseHandler;
};

/**
 * A function has the following form:
 * - a prefix such as `\mathrm` or `\operatorname`
 * - a trigger string, such as `gcd`
 * - some postfix operators such as `\prime`
 * - an optional list of arguments in an enclosure (parentheses)
 *
 * Functions of this type are indexed in the dictionary by their trigger string.
 */
export type IndexedFunctionEntry = CommonEntry & {
  kind: 'function';

  parse: ExpressionParseHandler;

  arguments?: 'enclosure' | 'implicit';
};

export type IndexedMatchfixEntry = CommonEntry & {
  kind: 'matchfix';

  openTrigger: Delimiter | LatexToken[];
  closeTrigger: Delimiter | LatexToken[];

  parse: MatchfixParseHandler;
};

export type IndexedInfixEntry = CommonEntry & {
  kind: 'infix';
  associativity: 'right' | 'left' | 'none' | 'any';
  precedence: Precedence;

  parse: InfixParseHandler;
};

export type IndexedPrefixEntry = CommonEntry & {
  kind: 'prefix';
  precedence: Precedence;

  parse: ExpressionParseHandler;
};

export type IndexedPostfixEntry = CommonEntry & {
  kind: 'postfix';
  precedence: Precedence;

  parse: PostfixParseHandler;
};

export type IndexedEnvironmentEntry = CommonEntry & {
  kind: 'environment';

  parse: EnvironmentParseHandler;
};

/** @internal */
export type IndexedLatexDictionaryEntry =
  | IndexedExpressionEntry
  | IndexedFunctionEntry
  | IndexedSymbolEntry
  | IndexedMatchfixEntry
  | IndexedInfixEntry
  | IndexedPrefixEntry
  | IndexedPostfixEntry
  | IndexedEnvironmentEntry;

/** @internal */
export type IndexedLatexDictionary = {
  // Mapping from  MathJSON symbols to dictionary entry
  ids: Map<string, IndexedLatexDictionaryEntry>;

  // Maximum number of tokens ahead of the current one that need to be
  // considered (longest trigger length)
  lookahead: number;

  defs: IndexedLatexDictionaryEntry[];

  // Index of matchfix entries by their opening delimiter token
  // This allows fast lookup of which matchfix defs could match a given opening token
  matchfixByOpen: Map<string, IndexedMatchfixEntry[]>;

  // Trigger-based indexes for fast operator lookup
  // Maps latexTrigger string to definitions of each kind
  // Reduces O(n*lookahead) to O(lookahead) for operator lookups
  infixByTrigger: Map<string, IndexedInfixEntry[]>;
  prefixByTrigger: Map<string, IndexedPrefixEntry[]>;
  postfixByTrigger: Map<string, IndexedPostfixEntry[]>;
  functionByTrigger: Map<string, IndexedFunctionEntry[]>;
  symbolByTrigger: Map<string, IndexedSymbolEntry[]>;
  expressionByTrigger: Map<string, IndexedExpressionEntry[]>;
};
