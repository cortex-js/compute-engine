import type { Type, TypeString } from '../../common/type/types';
import { BoxedType } from '../../common/type/boxed-type';

import type {
  OperatorDefinition,
  Expression,
  BoxedOperatorDefinition,
  CollectionHandlers,
  CompiledExpression,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Scope,
  Sign,
} from '../global-types';

import { applicable } from '../function-utils';

import { DEFAULT_COMPLEXITY } from './constants';
import { isFunction } from './type-guards';
import { functionResult } from '../../common/type/utils';
import { isSubtype } from '../../common/type/subtype';
import { defaultCollectionHandlers } from '../collection-utils';

const OPERATOR_DEF_KEYS = new Set([
  // Base
  'engine',
  'name',
  'description',
  'examples',
  'wikidata',
  'url',

  // Function Flags
  'lazy',
  'scoped',
  'broadcastable',
  'associative',
  'commutative',
  'commutativeOrder',
  'idempotent',
  'involution',
  'pure',

  'inferredSignature',
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

export class _BoxedOperatorDefinition implements BoxedOperatorDefinition {
  engine: ComputeEngine;

  name: string;
  description?: string | string[];
  url?: string;
  wikidata?: string;

  broadcastable = false;
  associative = false;
  commutative = false;
  commutativeOrder: ((a: Expression, b: Expression) => number) | undefined;
  idempotent = false;
  involution = false;
  pure = true;

  complexity = DEFAULT_COMPLEXITY;

  lazy = false;
  scoped = false;

  signature: BoxedType;
  inferredSignature = true;

  type?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => BoxedType | Type | TypeString | undefined;

  sgn?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Sign | undefined;

  eq?: (a: Expression, b: Expression) => boolean | undefined;
  neq?: (a: Expression, b: Expression) => boolean | undefined;

  even?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => boolean | undefined;

  canonical?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Expression | null;

  evaluate?: (
    ops: ReadonlyArray<Expression>,
    options: Partial<EvaluateOptions> & { engine: ComputeEngine }
  ) => Expression | undefined;

  evaluateAsync?: (
    ops: ReadonlyArray<Expression>,
    options?: Partial<EvaluateOptions> & { engine?: ComputeEngine }
  ) => Promise<Expression | undefined>;

  evalDimension?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Expression;

  compile?: (expr: Expression) => CompiledExpression;

  collection?: CollectionHandlers;

  constructor(ce: ComputeEngine, name: string, def: OperatorDefinition) {
    this.name = name;
    this.engine = ce;

    if (def.signature) {
      this.inferredSignature = false;
      this.signature =
        def.signature instanceof BoxedType
          ? def.signature
          : new BoxedType(def.signature, ce._typeResolver);
    } else this.signature = new BoxedType('(any*) -> unknown');

    this.update(def);

    ce.listenToConfigurationChange(this);
  }

  /** For debugging */
  toJSON() {
    const result: Record<string, unknown> = { name: this.name };
    if (this.wikidata) result.wikidata = this.wikidata;
    if (this.description) result.description = this.description;
    if (this.url) result.url = this.url;
    result.broadcastable = this.broadcastable;
    result.associative = this.associative;
    result.commutative = this.commutative;
    result.idempotent = this.idempotent;
    result.involution = this.involution;
    result.pure = this.pure;
    result.lazy = this.lazy;
    result.complexity = this.complexity;
    result.scoped = this.scoped;
    result.signature = this.signature.toString();
    result.inferredSignature = this.inferredSignature;

    if (this.collection) result.collection = this.collection;

    return result;
  }

  infer(sig: Type): void {
    const newSig = new BoxedType(sig, this.engine._typeResolver);
    if (!newSig.matches(this.signature))
      throw new Error(
        `Operator Definition "${this.name}": inferred signature "${newSig}" does not match current signature "${this.signature}"`
      );
    if (this.inferredSignature) this.signature = newSig;
  }

  update(def: OperatorDefinition): void {
    if (this.engine.strict) {
      for (const key in def) {
        if (!OPERATOR_DEF_KEYS.has(key))
          throw new Error(
            `Operator Definition "${this.name}": unexpected key "${key}"`
          );
      }
    }

    if ('name' in def && def.name !== this.name)
      throw new Error(
        `Operator Definition "${this.name}": cannot change name to "${def.name}"`
      );

    if ('engine' in def && def.engine !== this.engine)
      throw new Error(
        `Operator Definition "${this.name}": cannot change engine`
      );

    this.lazy = def.lazy ?? this.lazy;
    this.scoped = def.scoped ?? this.scoped;

    const idempotent = def.idempotent ?? this.idempotent;
    const involution = def.involution ?? this.involution;

    if (idempotent && involution)
      throw new Error(
        `Operator Definition "${this.name}": the 'idempotent' and 'involution' flags are mutually exclusive`
      );
    this.idempotent = idempotent;
    this.involution = involution;

    this.description = def.description ?? this.description;
    this.collection = def.collection ?? this.collection;
    this.url = def.url ?? this.url;
    this.wikidata = def.wikidata ?? this.wikidata;

    this.broadcastable = def.broadcastable ?? this.broadcastable;
    this.associative = def.associative ?? this.associative;
    this.commutative = def.commutative ?? this.commutative;
    this.commutativeOrder = def.commutativeOrder ?? this.commutativeOrder;

    if (this.commutativeOrder && !this.commutative)
      throw new Error(
        `Operator Definition "${this.name}": the 'commutativeOrder' handler requires the 'commutative' flag`
      );

    // If the lazy flag is set, the arguments are not canonicalized, so they
    // cannot be associative, commutative, idempotent, or involution
    // if (
    //   def.lazy &&
    //   (def.associative || def.commutative || def.idempotent || def.involution)
    // )
    //   throw new Error(
    //     `Operator Definition "${name}": the 'lazy' flag is incompatible with the 'associative', 'commutative', 'idempotent', and 'involution' flags`
    //   );

    if (
      def.canonical &&
      (def.associative || def.commutative || def.idempotent || def.involution)
    )
      throw new Error(
        `Operator Definition "${this.name}": the 'canonical' handler is incompatible with the 'associative', 'commutative', 'idempotent', and 'involution' flags`
      );

    this.pure = def.pure ?? this.pure;
    this.complexity = def.complexity ?? this.complexity;

    if (def.signature) {
      const oldSig = def.signature;
      const newSig =
        def.signature instanceof BoxedType
          ? def.signature
          : this.engine.type(def.signature);
      if (oldSig && !newSig.matches(this.engine.type(oldSig))) {
        throw new Error(
          `Operator Definition "${this.name}": signature "${newSig}" does not match "${oldSig}"`
        );
      }
      this.signature = newSig;

      if ('inferredSignature' in def)
        this.inferredSignature = def.inferredSignature as boolean;
    }

    this.type = def.type ?? this.type;
    this.evaluateAsync = def.evaluateAsync ?? this.evaluateAsync;
    this.canonical = def.canonical ?? this.canonical;
    this.evalDimension = def.evalDimension ?? this.evalDimension;
    this.sgn = def.sgn ?? this.sgn;
    this.even = def.even ?? this.even;
    this.compile = def.xcompile ?? this.compile;
    this.eq = def.eq ?? this.eq;
    this.neq = def.neq ?? this.neq;
    this.scoped = def.scoped ?? this.scoped;
    this.lazy = def.lazy ?? this.lazy;

    if (def.collection)
      this.collection = defaultCollectionHandlers(def.collection);

    if (this.collection) {
      // If we have collection handlers, the result type must be a collection
      const resultType = functionResult(this.signature.type);
      if (!resultType)
        throw new Error(
          `Operator Definition "${this.name}": a collection handler is defined, but the signature "${this.signature}" does not have a result type`
        );
      if (!isSubtype(resultType, 'collection'))
        throw new Error(
          `Operator Definition "${this.name}": a collection handler is defined, but the signature "${this.signature}" is not a collection type`
        );
      if (isSubtype(resultType, 'indexed_collection') && !this.collection.at) {
        throw new Error(
          `Operator Definition "${this.name}" returns an indexed collection, but the 'at' handler is missing`
        );
      }
      // @fixme: this warning cannot reliably be checked, because some functions (Map, Filter) return an indexed collection if the input is indexed. Would need support for type arguments in signatures.
      // if (!isSubtype(resultType, 'indexed_collection') && this.collection.at) {
      //   throw new Error(
      //     `Operator Definition "${this.name}" returns a non-indexed collection, but the 'at' handler is defined`
      //   );
      // }
    }

    let evaluate: _BoxedOperatorDefinition['evaluate'] | undefined = undefined;
    if (def.evaluate && typeof def.evaluate !== 'function') {
      // If the function is scoped, create a local scope
      const scope: Scope | undefined = this.scoped
        ? {
            parent: this.engine.context.lexicalScope,
            bindings: new Map(),
          }
        : undefined;
      const boxedFn = this.engine.expr(def.evaluate, {
        form: 'raw',
        scope,
      });
      if (!boxedFn.isValid)
        throw Error(`Invalid function ${boxedFn.toString()}`);

      // If no explicit signature was provided and the evaluate handler is a
      // Function expression, infer the signature from the function parameters
      // and body type.
      if (
        this.inferredSignature &&
        isFunction(boxedFn) &&
        boxedFn.operator === 'Function'
      ) {
        const body = boxedFn.ops[0];
        const params = boxedFn.ops.slice(1);
        const bodyType = body.type.toString();
        const paramTypes = params.map(() => 'unknown').join(', ');
        this.signature = new BoxedType(
          `(${paramTypes}) -> ${bodyType}`,
          this.engine._typeResolver
        );
      }

      const fn = applicable(boxedFn);
      evaluate = (xs, _options) => fn(xs);
      Object.defineProperty(evaluate, 'toString', {
        value: () => boxedFn.toString(),
      }); // For debugging/_printScope
    } else if (typeof def.evaluate === 'function') {
      evaluate = def.evaluate;
    } else {
      evaluate = this.evaluate;
    }

    this.evaluate = evaluate;
  }

  onConfigurationChange(): void {
    return;
  }
}
