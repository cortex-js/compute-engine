import {
  IComputeEngine,
  FunctionDefinition,
  BoxedFunctionDefinition,
  BoxedExpression,
  BoxedLambdaExpression,
  CompiledExpression,
  SemiBoxedExpression,
  RuntimeScope,
  Domain,
  DomainExpression,
} from '../public';
import { DEFAULT_COMPLEXITY } from './order';

class BoxedFunctionDefinitionImpl implements BoxedFunctionDefinition {
  name: string;
  description?: string | string[];
  wikidata?: string;
  scope: RuntimeScope;
  domain:
    | Domain
    | ((
        ce: IComputeEngine,
        args: BoxedExpression[]
      ) => Domain | DomainExpression);
  threadable: boolean;
  associative: boolean;
  commutative: boolean;
  idempotent: boolean;
  involution: boolean;
  pure: boolean;
  inert: boolean;

  complexity: number;
  hold: 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';
  sequenceHold: boolean;
  range?: [min: number, max: number];

  canonical?: (ce: IComputeEngine, args: BoxedExpression[]) => BoxedExpression;
  simplify?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression | undefined;
  evaluate?:
    | BoxedLambdaExpression
    | ((
        ce: IComputeEngine,
        args: BoxedExpression[]
      ) => BoxedExpression | undefined);
  N?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression | undefined;

  evalDimension?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression;
  sgn?: (ce: IComputeEngine, args: BoxedExpression[]) => -1 | 0 | 1 | undefined;

  compile?: (expr: BoxedExpression) => CompiledExpression;
  order?: (expr: BoxedExpression) => SemiBoxedExpression;

  constructor(ce: IComputeEngine, def: FunctionDefinition) {
    const domain = def.domain
      ? typeof def.domain === 'function'
        ? def.domain
        : ce.domain(def.domain)
      : ce.domain('Function');
    const hold = def.hold ?? 'none';
    const idempotent = def.idempotent ?? false;
    const involution = def.involution ?? false;

    if (idempotent && involution)
      throw new Error(
        `Function Definition "${def.name}": the 'idempotent' and 'involution' flags are mutually exclusive in function `
      );

    this.name = def.name;
    this.description = def.description;
    this.wikidata = def.wikidata;
    this.scope = ce.context;

    this.threadable = def.threadable ?? false;
    this.associative = def.associative ?? false;
    this.commutative = def.commutative ?? false;
    this.idempotent = idempotent;
    this.involution = involution;
    this.inert = def.inert ?? false;
    this.pure = def.pure ?? true;
    this.complexity = def.complexity ?? DEFAULT_COMPLEXITY;

    this.hold = hold;
    this.sequenceHold = def.sequenceHold ?? false;
    this.range = def.range;

    this.domain = domain;

    this.canonical = def.canonical;
    this.simplify = def.simplify;
    this.evaluate = !def.evaluate
      ? undefined
      : typeof def.evaluate === 'function'
      ? def.evaluate
      : ce.box(def.evaluate).canonical;
    this.N = def.N;
    this.evalDimension = def.evalDimension;
    this.sgn = def.sgn;
    this.compile = def.compile;
  }
  _purge() {
    return undefined;
  }
}

export function makeFunctionDefinition(
  engine: IComputeEngine,
  def: FunctionDefinition
): BoxedFunctionDefinition {
  return new BoxedFunctionDefinitionImpl(engine, def);
}
