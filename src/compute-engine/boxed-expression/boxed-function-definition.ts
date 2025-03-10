import { Type, TypeString } from '../../common/type/types';
import { parseType } from '../../common/type/parse';
import { OneOf } from '../../common/one-of';
import { BoxedType } from '../../common/type/boxed-type';

import { applicable } from '../function-utils';
import type {
  FunctionDefinition,
  BoxedExpression,
  BoxedFunctionDefinition,
  CollectionHandlers,
  CompiledExpression,
  EvaluateOptions,
  ComputeEngine,
  RuntimeScope,
  Sign,
} from '../global-types';

import { DEFAULT_COMPLEXITY } from './order';

const FUNCTION_DEF_KEYS = new Set([
  // Base
  'description',
  'wikidata',
  'url',

  // Function Flags
  'lazy',
  'threadable',
  'associative',
  'commutative',
  'commutativeOrder',
  'idempotent',
  'involution',
  'pure',

  'signature',
  'type',
  'sgn',
  'even',
  'complexity',

  'canonical',
  'evaluate',
  'evaluateAsync',
  'evalDimension',
  'compile',

  'eq',
  'neq',
  'cmp',

  // Collection Handlers
  'collection',
]);

export class _BoxedFunctionDefinition implements BoxedFunctionDefinition {
  engine: ComputeEngine;
  scope: RuntimeScope;

  name: string;
  description?: string | string[];
  wikidata?: string;

  threadable = false;
  associative = false;
  commutative = false;
  commutativeOrder:
    | ((a: BoxedExpression, b: BoxedExpression) => number)
    | undefined;
  idempotent = false;
  involution = false;
  pure = true;

  complexity = DEFAULT_COMPLEXITY;

  lazy = false;

  signature: BoxedType;
  inferredSignature = true;

  type?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine }
  ) => BoxedType | Type | TypeString | undefined;

  sgn?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine }
  ) => Sign | undefined;

  eq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;
  neq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;

  even?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine }
  ) => boolean | undefined;

  canonical?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine }
  ) => BoxedExpression | null;

  evaluate?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: Partial<EvaluateOptions> & { engine: ComputeEngine }
  ) => BoxedExpression | undefined;

  evaluateAsync?: (
    ops: ReadonlyArray<BoxedExpression>,
    options?: Partial<EvaluateOptions> & { engine?: ComputeEngine }
  ) => Promise<BoxedExpression | undefined>;

  evalDimension?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine }
  ) => BoxedExpression;

  compile?: (expr: BoxedExpression) => CompiledExpression;

  collection?: Partial<CollectionHandlers>;

  constructor(ce: ComputeEngine, name: string, def: FunctionDefinition) {
    if (!ce.context) throw Error('No context available');

    this.name = name;
    this.engine = ce;
    this.scope = ce.context;

    if (def.signature) {
      this.inferredSignature = false;
      this.signature = new BoxedType(def.signature);
    } else this.signature = new BoxedType('...any -> any');

    this.update(def);
  }

  infer(sig: Type): void {
    const newSig = new BoxedType(sig);
    if (!newSig.matches(this.signature))
      throw new Error(
        `Function Definition "${this.name}": inferred signature "${newSig}" does not match current signature "${this.signature}"`
      );
    if (this.inferredSignature) this.signature = newSig;
  }

  update(def: FunctionDefinition): void {
    if (this.engine.strict) {
      for (const key in def) {
        if (!FUNCTION_DEF_KEYS.has(key))
          throw new Error(
            `Function Definition "${this.name}": unexpected key "${key}"`
          );
      }
    }

    this.lazy = def.lazy ?? this.lazy;

    const idempotent = def.idempotent ?? this.idempotent;
    const involution = def.involution ?? this.involution;

    if (idempotent && involution)
      throw new Error(
        `Function Definition "${this.name}": the 'idempotent' and 'involution' flags are mutually exclusive`
      );
    this.idempotent = idempotent;
    this.involution = involution;

    this.description = def.description ?? this.description;
    this.wikidata = def.wikidata ?? this.wikidata;

    this.threadable = def.threadable ?? this.threadable;
    this.associative = def.associative ?? this.associative;
    this.commutative = def.commutative ?? this.commutative;
    this.commutativeOrder = def.commutativeOrder ?? this.commutativeOrder;

    if (this.commutativeOrder && !this.commutative)
      throw new Error(
        `Function Definition "${this.name}": the 'commutativeOrder' handler requires the 'commutative' flag`
      );

    // If the lazy flag is set, the arguments are not canonicalized, so they
    // cannot be associative, commutative, idempotent, or involution
    // if (
    //   def.lazy &&
    //   (def.associative || def.commutative || def.idempotent || def.involution)
    // )
    //   throw new Error(
    //     `Function Definition "${name}": the 'lazy' flag is incompatible with the 'associative', 'commutative', 'idempotent', and 'involution' flags`
    //   );

    if (
      def.canonical &&
      (def.associative || def.commutative || def.idempotent || def.involution)
    )
      throw new Error(
        `Function Definition "${this.name}": the 'canonical' handler is incompatible with the 'associative', 'commutative', 'idempotent', and 'involution' flags`
      );

    this.pure = def.pure ?? this.pure;
    this.complexity = def.complexity ?? this.complexity;

    if (def.signature) {
      const oldSig = def.signature;
      const newSig = new BoxedType(parseType(def.signature));
      if (oldSig && !newSig.matches(oldSig))
        throw new Error(
          `Function Definition "${this.name}": signature "${newSig}" does not match "${oldSig}"`
        );
      this.inferredSignature = false;
      this.signature = newSig;
    }

    let evaluate: ((xs) => BoxedExpression | undefined) | undefined = undefined;
    if (def.evaluate && typeof def.evaluate !== 'function') {
      const boxedFn = this.engine.box(def.evaluate, { canonical: false });
      if (!boxedFn.isValid)
        throw Error(`Invalid function ${boxedFn.toString()}`);
      const fn = applicable(boxedFn);
      evaluate = (xs) => fn(xs);
      Object.defineProperty(evaluate, 'toString', {
        value: () => boxedFn.toString(),
      }); // For debugging/_printScope
    } else evaluate = (def.evaluate as any) ?? this.evaluate;

    this.type = def.type ?? this.type;
    this.evaluate = evaluate;
    this.evaluateAsync = def.evaluateAsync ?? this.evaluateAsync;
    this.canonical = def.canonical ?? this.canonical;
    this.evalDimension = def.evalDimension ?? this.evalDimension;
    this.sgn = def.sgn ?? this.sgn;
    this.even = def.even ?? this.even;
    this.compile = def.compile ?? this.compile;
    this.eq = def.eq ?? this.eq;
    this.neq = def.neq ?? this.neq;

    this.collection = def.collection ?? this.collection;
  }

  reset(): void {
    return;
  }
}

export function makeFunctionDefinition(
  engine: ComputeEngine,
  name: string,
  def: OneOf<[FunctionDefinition | BoxedFunctionDefinition]>
): BoxedFunctionDefinition {
  if (def instanceof _BoxedFunctionDefinition) return def;
  return new _BoxedFunctionDefinition(engine, name, def as FunctionDefinition);
}

export function isBoxedFunctionDefinition(
  x: any
): x is BoxedFunctionDefinition {
  return x instanceof _BoxedFunctionDefinition;
}
