import { functionDomain } from '../domain-utils';
import { applicable } from '../function-utils';
import {
  IComputeEngine,
  FunctionDefinition,
  BoxedFunctionDefinition,
  RuntimeScope,
  BoxedFunctionSignature,
  Hold,
  BoxedDomain,
} from '../public';
import { DEFAULT_COMPLEXITY } from './order';
import { BoxedExpression } from './public';

export class _BoxedFunctionDefinition implements BoxedFunctionDefinition {
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
  hold: Hold;
  dynamic: boolean;

  signature: BoxedFunctionSignature;

  iterator?: (
    expr: BoxedExpression,
    start?: number,
    count?: number
  ) => Iterator<BoxedExpression>;
  at?: (
    expr: BoxedExpression,
    index: number | string
  ) => undefined | BoxedExpression;
  size?: (expr: BoxedExpression) => number;
  keys?: (expr: BoxedExpression) => undefined | Iterator<string>;
  indexOf?: (
    expr: BoxedExpression,
    target: BoxedExpression,
    from?: number
  ) => number | string | undefined;

  constructor(ce: IComputeEngine, name: string, def: FunctionDefinition) {
    if (!ce.context) throw Error('No context available');

    this.engine = ce;
    this.scope = ce.context;

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
    this.idempotent = idempotent;
    this.involution = involution;
    this.inert = def.inert ?? false;
    this.numeric = def.numeric ?? false;
    this.pure = def.pure ?? true;
    this.complexity = def.complexity ?? DEFAULT_COMPLEXITY;

    this.hold = def.hold ?? 'none';

    // Collections handlers
    if (def.at) this.at = def.at;

    if (def.iterator) this.iterator = def.iterator;
    if (def.size) this.size = def.size;

    if (def.keys) this.keys = def.keys;
    if (def.indexOf) this.indexOf = def.indexOf;

    if (def.at && !def.size) {
      this.size = (expr: BoxedExpression) => {
        // Fallback size handler. This is not very efficient, but it works.
        const at = def.at!;
        let i = 0;
        while (at(expr, i) !== undefined) i++;
        return i;
      };
    }
    if (def.at && !def.iterator) {
      // Fallback iterator handler.
      this.iterator = (expr: BoxedExpression, start = 1, count = -1) => {
        const at = def.at!;
        let i = start;
        return {
          next() {
            if (count >= 0 && i >= start + count)
              return { done: true, value: undefined };
            const result = at(expr, i);
            if (result === undefined) return { done: true, value: undefined };
            i++;
            return { done: false, value: result };
          },
        };
      };
    }

    if (this.iterator && !def.indexOf) {
      // Fallback indexOf handler.
      this.indexOf = (expr: BoxedExpression, target: BoxedExpression) => {
        let i = 1;
        const iterator = this.iterator!(expr);
        let result = iterator.next();
        while (!result.done) {
          if (target.isEqual(result.value)) return i;
          i++;
          result = iterator.next();
        }
        return undefined;
      };
    }

    if (this.inert) {
      if (def.hold)
        throw Error(
          `Function Definition "${name}": an inert function should not have a hold`
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
            `Function Definition "${name}": an inert function should only have 'canonical' or 'codomain' handlers`
          );
      }
      if (this.threadable)
        throw Error(
          `Function Definition "${name}": an inert function should not be threadable`
        );
      if (this.associative)
        throw Error(
          `Function Definition "${name}": an inert function should not be associative`
        );
      if (this.commutative)
        throw Error(
          `Function Definition "${name}": an inert function should not be commutative`
        );
      if (this.idempotent)
        throw Error(
          `Function Definition "${name}": an inert function should not be idempotent`
        );
      if (this.involution)
        throw Error(
          `Function Definition "${name}": an inert function should not be involution`
        );
      if (!this.pure)
        throw Error(
          `Function Definition "${name}": an inert function should be pure`
        );
    }
    if (def.signature) {
      const sig = def.signature;
      let params: BoxedDomain[];
      let optParams: BoxedDomain[];
      let restParam: BoxedDomain | undefined;
      let result:
        | BoxedDomain
        | ((
            ce: IComputeEngine,
            args: BoxedExpression[]
          ) => BoxedDomain | null | undefined)
        | undefined;

      let inferredSignature = false;

      if (sig.domain) {
        const domain = ce.domain(sig.domain);
        if (!domain.isValid)
          throw Error(
            `Function Definition "${name}": invalid domain ${JSON.stringify(
              sig.domain
            )}`
          );
        [params, optParams, restParam, result] = functionDomain(
          ce.domain(domain)
        );
      } else if (sig.params || sig.result) {
        params = sig.params?.map((x) => ce.domain(x)) ?? [];
        optParams = sig.optParams?.map((x) => ce.domain(x)) ?? [];
        restParam = sig.restParam ? ce.domain(sig.restParam) : undefined;
        if (typeof sig.result === 'function') result = sig.result;
        else if (sig.result) result = ce.domain(sig.result);
        else if (def.numeric) result = ce.Numbers;
        else result = ce.Anything;
      } else if (def.numeric) {
        inferredSignature = true;
        params = [];
        optParams = [];
        restParam = ce.Numbers;
        result = ce.Numbers;
      } else {
        inferredSignature = true;
        params = [];
        optParams = [];
        restParam = ce.Anything;
        result = ce.Anything;
      }

      let evaluate: ((ce, args) => BoxedExpression | undefined) | undefined =
        undefined;
      if (sig.evaluate && typeof sig.evaluate !== 'function') {
        const boxedFn = ce.box(sig.evaluate, { canonical: false });
        if (!boxedFn.isValid)
          throw Error(`Invalid function ${boxedFn.toString()}`);
        const fn = applicable(boxedFn);
        evaluate = (_ce, xs) => fn(xs);
        evaluate.toString = () => boxedFn.toString(); // For debugging/_printScope()
      } else evaluate = sig.evaluate as any;

      if (def.signature.result) {
        if (typeof def.signature.result === 'function')
          result = def.signature.result;
        else result = ce.domain(def.signature.result);
      }

      this.signature = {
        inferredSignature,
        params,
        optParams,
        restParam: restParam ? restParam : undefined,
        result,
        canonical: sig.canonical,
        simplify: sig.simplify,
        evaluate,
        N: sig.N,
        evalDimension: sig.evalDimension,
        sgn: sig.sgn,
        compile: sig.compile,
      };
    } else if (def.numeric) {
      this.signature = {
        inferredSignature: true,
        params: [],
        optParams: [],
        restParam: ce.Numbers,
        result: ce.Numbers,
      };
    } else {
      this.signature = {
        inferredSignature: true,
        params: [],
        optParams: [],
        restParam: ce.Anything,
        result: ce.Anything,
      };
    }
  }
  reset(): void {
    return;
  }
}

export function makeFunctionDefinition(
  engine: IComputeEngine,
  name: string,
  def: FunctionDefinition | BoxedFunctionDefinition
): BoxedFunctionDefinition {
  if (def instanceof _BoxedFunctionDefinition) return def;
  return new _BoxedFunctionDefinition(engine, name, def as FunctionDefinition);
}
