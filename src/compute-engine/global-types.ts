// Barrel file — re-exports all types for backward compatibility.
//
// The actual type definitions are in:
//   types-expression.ts  — Expression, tensor types, compilation types
//   types-serialization.ts — serialization, pattern matching, canonical options
//   types-definitions.ts — symbol/operator definitions, collection handlers
//   types-evaluation.ts  — rules, assumptions, scopes, evaluation
//   types-engine.ts      — ComputeEngine interface

export type * from './types-expression';
export type * from './types-serialization';
export type {
  ValueDefinition,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
  OEISSequenceInfo,
  OEISOptions,
  OperatorDefinition,
  BaseDefinition,
  SimplifyOptions,
  SymbolDefinition,
  SymbolDefinitions,
  LibraryDefinition,
  AngularUnit,
  Sign,
  BaseCollectionHandlers,
  IndexedCollectionHandlers,
  CollectionHandlers,
  TaggedValueDefinition,
  TaggedOperatorDefinition,
  BoxedDefinition,
  BoxedBaseDefinition,
  BoxedValueDefinition,
  OperatorDefinitionFlags,
  BoxedOperatorDefinition,
} from './types-definitions';
export type * from './types-evaluation';
export type * from './types-engine';
