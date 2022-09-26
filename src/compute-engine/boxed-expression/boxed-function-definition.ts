import {
  IComputeEngine,
  FunctionDefinition,
  BoxedFunctionDefinition,
  RuntimeScope,
  BoxedFunctionSignature,
  BoxedDomain,
} from '../public';
import { DEFAULT_COMPLEXITY } from './order';

class BoxedFunctionDefinitionImpl implements BoxedFunctionDefinition {
  engine: IComputeEngine;
  scope: RuntimeScope;
  name: string;
  description?: string | string[];
  wikidata?: string;
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
  dynamic: boolean;

  signature: BoxedFunctionSignature;

  constructor(ce: IComputeEngine, def: FunctionDefinition) {
    if (!ce.context) throw Error('No context available');

    this.engine = ce;
    this.scope = ce.context;

    const idempotent = def.idempotent ?? false;
    const involution = def.involution ?? false;

    if (idempotent && involution)
      throw new Error(
        `Function Definition "${def.name}": the 'idempotent' and 'involution' flags are mutually exclusive`
      );

    this.name = def.name;
    this.description = def.description;
    this.wikidata = def.wikidata;

    this.threadable = def.threadable ?? false;
    this.associative = def.associative ?? false;
    this.commutative = def.commutative ?? false;
    this.idempotent = idempotent;
    this.involution = involution;
    this.inert = def.inert ?? false;
    this.numeric = def.numeric ?? false;
    this.pure = def.pure ?? true;
    this.complexity = def.complexity ?? DEFAULT_COMPLEXITY;

    this.hold = def.hold ?? 'none';

    if (this.inert) {
      if (def.hold)
        throw Error(
          `Function Definition "${def.name}": an inert function should not have a hold`
        );
      this.hold = 'rest';
      if (def.signature) {
        const sig = def.signature;
        // `canonical` and `domain` is OK for an inert function, but none of the others
        if (
          'simplify' in sig ||
          'evaluate' in sig ||
          'N' in sig ||
          'evalDimension' in sig ||
          'sgn' in sig ||
          'compile' in sig
        )
          throw Error(
            `Function Definition "${def.name}": an inert function should only have 'canonical' or 'codomain' handlers`
          );
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
    if (def.signature) {
      const sig = def.signature;
      const domain = sig.domain
        ? ce.domain(sig.domain)
        : def.numeric
        ? ce.domain('NumericFunction')
        : ce.domain('Function');
      if (!domain.isValid)
        throw Error(
          `Function Definition "${def.name}": invalid domain ${JSON.stringify(
            sig.domain
          )}`
        );

      const codomain =
        sig.codomain ??
        domain.codomain ??
        (def.numeric ? ce.domain('Number') : ce.domain('Anything'));
      this.signature = {
        domain,
        codomain,
        canonical: sig.canonical,
        simplify: sig.simplify,
        evaluate: !sig.evaluate
          ? undefined
          : typeof sig.evaluate === 'function'
          ? sig.evaluate
          : ce.lambda(sig.evaluate, domain),
        N: sig.N,
        evalDimension: sig.evalDimension,
        sgn: sig.sgn,
        compile: sig.compile,
      };
    } else if (def.numeric) {
      this.signature = {
        domain: ce.domain('NumericFunction'),
        codomain: ce.domain('Number'),
      };
    } else {
      this.signature = {
        domain: ce.domain('Function') as BoxedDomain,
        codomain: ce.domain('Anything') as BoxedDomain,
      };
    }
  }
  reset() {
    return;
  }
}

export function makeFunctionDefinition(
  engine: IComputeEngine,
  def: FunctionDefinition
): BoxedFunctionDefinition {
  return new BoxedFunctionDefinitionImpl(engine, def);
}
