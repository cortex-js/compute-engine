import {
  IComputeEngine,
  FunctionDefinition,
  BoxedFunctionDefinition,
  BoxedLambdaExpression,
  RuntimeScope,
  BoxedDomain,
  BoxedFunctionSignature,
} from '../public';
import { sharedAncestorDomain, _BoxedDomain } from './boxed-domain';
import { DEFAULT_COMPLEXITY } from './order';

class BoxedFunctionDefinitionImpl implements BoxedFunctionDefinition {
  engine: IComputeEngine;
  name: string;
  description?: string | string[];
  wikidata?: string;
  scope: RuntimeScope;
  threadable: boolean;
  associative: boolean;
  commutative: boolean;
  idempotent: boolean;
  involution: boolean;
  pure: boolean;
  inert: boolean;
  numeric: boolean;

  complexity: number;
  hold: 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

  valueDomain: BoxedDomain;

  signatures: BoxedFunctionSignature[];

  constructor(ce: IComputeEngine, def: FunctionDefinition) {
    this.engine = ce;

    const hold = def.hold ?? 'none';
    const idempotent = def.idempotent ?? false;
    const involution = def.involution ?? false;

    if (idempotent && involution)
      throw new Error(
        `Function Definition "${def.name}": the 'idempotent' and 'involution' flags are mutually exclusive`
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
    this.numeric = def.numeric ?? false;
    this.pure = def.pure ?? true;
    this.complexity = def.complexity ?? DEFAULT_COMPLEXITY;

    this.hold = hold;

    if (this.inert) {
      if (def.hold)
        throw Error(
          `Function Definition "${def.name}": an inert function should not have a hold`
        );
      this.hold = 'rest';
      if (def.signatures) {
        for (const sig of def.signatures) {
          // `canonical` is OK for an inert function, but none of the others
          if (
            'simplify' in sig ||
            'evaluate' in sig ||
            'N' in sig ||
            'evalDimension' in sig ||
            'sgn' in sig ||
            'compile' in sig
          )
            throw Error(
              `Function Definition "${def.name}": an inert function should not have any signatures`
            );
        }
      }
      if (this.threadable)
        throw Error(
          `Function Definition "${def.name}": an inert function should not be threadable`
        );
      if (this.associative)
        throw Error(
          `Function Definition "${def.name}": an inert function should not be associative`
        );
      if (this.commutative)
        throw Error(
          `Function Definition "${def.name}": an inert function should not be commutative`
        );
      if (this.idempotent)
        throw Error(
          `Function Definition "${def.name}": an inert function should not be idempotent`
        );
      if (this.involution)
        throw Error(
          `Function Definition "${def.name}": an inert function should not be involution`
        );
      if (!this.pure)
        throw Error(
          `Function Definition "${def.name}": an inert function should be pure`
        );
    }
    if (def.signatures) {
      let valueDomain = ce.domain('Void');
      const sigs: BoxedFunctionSignature[] = [];
      for (const sig of def.signatures) {
        const dom = !sig.domain ? ce.domain('Function') : ce.domain(sig.domain);
        sigs.push({
          domain: dom,
          simplify: sig.simplify,
          evaluate: !sig.evaluate
            ? undefined
            : typeof sig.evaluate === 'function'
            ? sig.evaluate
            : (ce.box(sig.evaluate).canonical as BoxedLambdaExpression),
          N: sig.N,
          evalDimension: sig.evalDimension,
          sgn: sig.sgn,
          compile: sig.compile,
        });
        valueDomain = sharedAncestorDomain(valueDomain, dom);
      }
      this.signatures = sigs;
    }
  }
  _purge() {
    return undefined;
  }
  getSignature(domains: BoxedDomain[]): BoxedFunctionSignature | null {
    const sig = this.engine.domain(['Function', ...domains, 'Anything']);
    return this.signatures?.find((x) => sig.isCompatible(x.domain)) ?? null;
  }
}

export function makeFunctionDefinition(
  engine: IComputeEngine,
  def: FunctionDefinition
): BoxedFunctionDefinition {
  return new BoxedFunctionDefinitionImpl(engine, def);
}
