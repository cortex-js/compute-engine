import type {
  IComputeEngine,
  FunctionDefinition,
  BoxedFunctionDefinition,
  RuntimeScope,
} from '../public';

import type {
  BoxedExpression,
  CollectionHandlers,
  CompiledExpression,
  EvaluateOptions,
  Sign,
} from './public';

import { applicable } from '../function-utils';
import { DEFAULT_COMPLEXITY } from './order';
import { Type, TypeString } from '../../common/type/types';
import { parseType } from '../../common/type/parse';
import { OneOf } from '../../common/one-of';

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
  'evalDimension',
  'compile',

  'eq',
  'neq',
  'cmp',

  // Collection Handlers
  'collection',
]);

export class _BoxedFunctionDefinition implements BoxedFunctionDefinition {
  engine: IComputeEngine;
  scope: RuntimeScope;

  name: string;
  description?: string | string[];
  wikidata?: string;

  threadable: boolean;
  associative: boolean;
  commutative: boolean;
  commutativeOrder:
    | ((a: BoxedExpression, b: BoxedExpression) => number)
    | undefined;
  idempotent: boolean;
  involution: boolean;
  pure: boolean;

  complexity: number;

  lazy: boolean;

  signature: Type;
  inferredSignature: boolean;

  type?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: IComputeEngine }
  ) => Type | TypeString | undefined;

  sgn?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: IComputeEngine }
  ) => Sign | undefined;

  eq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;
  neq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;

  even?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: IComputeEngine }
  ) => boolean | undefined;

  canonical?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: IComputeEngine }
  ) => BoxedExpression | null;

  evaluate?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: EvaluateOptions & { engine: IComputeEngine }
  ) => BoxedExpression | undefined;

  evalDimension?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: IComputeEngine }
  ) => BoxedExpression;

  compile?: (expr: BoxedExpression) => CompiledExpression;

  collection?: Partial<CollectionHandlers>;

  constructor(ce: IComputeEngine, name: string, def: FunctionDefinition) {
    if (!ce.context) throw Error('No context available');

    this.engine = ce;
    this.scope = ce.context;

    for (const key in def) {
      if (!FUNCTION_DEF_KEYS.has(key))
        throw new Error(
          `Function Definition "${name}": unexpected key "${key}"`
        );
    }

    this.lazy = def.lazy ?? false;

    const idempotent = def.idempotent ?? false;
    const involution = def.involution ?? false;

    if (idempotent && involution)
      throw new Error(
        `Function Definition "${name}": the 'idempotent' and 'involution' flags are mutually exclusive`
      );

    this.name = name;
    this.description = def.description;
    this.wikidata = def.wikidata;

    this.threadable = def.threadable ?? false;
    this.associative = def.associative ?? false;
    this.commutative = def.commutative ?? false;
    this.commutativeOrder = def.commutativeOrder;
    this.idempotent = idempotent;
    this.involution = involution;

    if (this.commutativeOrder && !this.commutative)
      throw new Error(
        `Function Definition "${name}": the 'commutativeOrder' handler requires the 'commutative' flag`
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
        `Function Definition "${name}": the 'canonical' handler is incompatible with the 'associative', 'commutative', 'idempotent', and 'involution' flags`
      );

    this.pure = def.pure ?? true;
    this.complexity = def.complexity ?? DEFAULT_COMPLEXITY;

    let signature: Type;
    let inferredSignature = true;

    if (def.signature) {
      inferredSignature = false;
      signature = parseType(def.signature);
    } else signature = parseType('...any -> any');

    let resultType:
      | ((
          ops: ReadonlyArray<BoxedExpression>,
          options: { engine: IComputeEngine }
        ) => Type | TypeString | undefined)
      | undefined = undefined;
    if (def.type) {
      if (typeof def.type === 'string') parseType(def.type);
      else resultType = def.type;
    }

    let evaluate: ((xs) => BoxedExpression | undefined) | undefined = undefined;
    if (def.evaluate && typeof def.evaluate !== 'function') {
      const boxedFn = ce.box(def.evaluate, { canonical: false });
      if (!boxedFn.isValid)
        throw Error(`Invalid function ${boxedFn.toString()}`);
      const fn = applicable(boxedFn);
      evaluate = (xs) => fn(xs);
      Object.defineProperty(evaluate, 'toString', {
        value: () => boxedFn.toString(),
      }); // For debugging/_printScope
    } else evaluate = def.evaluate as any;

    this.inferredSignature = inferredSignature;
    this.signature = signature;
    this.type = resultType;
    this.evaluate = evaluate;
    this.canonical = def.canonical;
    this.evalDimension = def.evalDimension;
    this.sgn = def.sgn;
    this.even = def.even;
    this.compile = def.compile;
    this.eq = def.eq;
    this.neq = def.neq;

    this.collection = def.collection;
  }

  reset(): void {
    return;
  }
}

export function makeFunctionDefinition(
  engine: IComputeEngine,
  name: string,
  def: OneOf<[FunctionDefinition | BoxedFunctionDefinition]>
): BoxedFunctionDefinition {
  if (def instanceof _BoxedFunctionDefinition) return def;
  return new _BoxedFunctionDefinition(engine, name, def as FunctionDefinition);
}
