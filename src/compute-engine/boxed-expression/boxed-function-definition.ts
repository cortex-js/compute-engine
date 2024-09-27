import type {
  IComputeEngine,
  FunctionDefinition,
  BoxedFunctionDefinition,
  RuntimeScope,
} from '../public.ts';

import type {
  BoxedExpression,
  CollectionHandlers,
  CompiledExpression,
  EvaluateOptions,
  Sign,
} from './public.ts';

import { applicable } from '../function-utils.ts';
import { DEFAULT_COMPLEXITY } from './order.ts';
import { Type } from '../../common/type/types.ts';
import { parseType } from '../../common/type/parse.ts';
import { OneOf } from '../../common/one-of.ts';

const FUNCTION_DEF_KEYS = new Set([
  // Base
  'description',
  'wikidata',
  'url',

  // Function Flags
  'hold',
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

  hold: boolean;

  signature: Type;
  inferredSignature: boolean;

  type?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: IComputeEngine }
  ) => Type | undefined;

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

    this.hold = def.hold ?? false;

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
        ) => Type | undefined)
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
