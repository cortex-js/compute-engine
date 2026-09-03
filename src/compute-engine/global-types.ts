// Barrel file — re-exports all types for backward compatibility.
//
// The actual type definitions are in:
//   types-expression.ts  — Expression, tensor types, compilation types
//   types-serialization.ts — serialization, pattern matching, canonical options
//   types-definitions.ts — symbol/operator definitions, collection handlers
//   types-evaluation.ts  — rules, assumptions, scopes, evaluation
//   types-engine.ts      — ComputeEngine interface

export type * from './types-expression.js';
export type * from './types-serialization.js';
export type {
  ValueDefinition,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
  OEISSequenceInfo,
  OEISOptions,
  OEISCandidate,
  InterpretResult,
  OperatorDefinition,
  OperandDescriptor,
  OperandFacts,
  OperandStructure,
  Tri,
  PureEngineView,
  ReadonlyDefinitionView,
  TypeHandlerContext,
  OperatorTypeHandlerOnExpressions,
  OperatorTypeHandlerOnTypes,
  OperatorTypeHandlerVariant,
  EvaluateHandlerOptions,
  BaseDefinition,
  SimplifyOptions,
  ExplainOptions,
  SymbolDefinition,
  SymbolDefinitionInput,
  PartialSymbolDefinition,
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
  TypeProvenanceEntry,
  BoxedBaseDefinition,
  BoxedValueDefinition,
  OperatorDefinitionFlags,
  BroadcastExemption,
  BindingSite,
  BindingSiteSelector,
  BoxedOperatorDefinition,
  LambdaDefinition,
} from './types-definitions.js';
export type * from './types-evaluation.js';
export type * from './types-engine.js';
