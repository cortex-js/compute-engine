import { Expression } from '../../math-json/math-json-format';
import {
  DOMAIN_ALIAS,
  DOMAIN_CONSTRUCTORS,
  DOMAIN_EXPRESSION_CONSTRUCTORS,
  isDomainLiteral,
  isSubdomainOf,
} from '../dictionary/domains';
import {
  BoxedDomainExpression,
  BoxedExpression,
  BoxedParametricDomain,
  Domain,
  DomainCompatibility,
  DomainExpression,
  IComputeEngine,
  Metadata,
  ParametricDomain,
  PatternMatchOption,
  Substitution,
} from '../public';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import { serializeJsonSymbol } from './serialize';
import { hashCode } from './utils';

export class _Domain extends AbstractBoxedExpression implements Domain {
  _value: string | BoxedParametricDomain;
  private _isCanonical: boolean;
  private _hash: number;

  constructor(
    ce: IComputeEngine,
    dom: string | BoxedParametricDomain,
    metadata?: Metadata
  ) {
    super(ce, metadata);
    this._value = dom;
    this._isCanonical = typeof dom === 'string' && isDomainLiteral(dom);
  }

  get isCanonical(): boolean {
    return this._isCanonical;
  }

  get canonical(): _Domain {
    if (this._isCanonical) return this;
    const result = new _Domain(
      this.engine,
      makeCanonical(this.engine, this._value)
    );
    result._isCanonical = true;
    return result;
  }

  get domainExpression(): DomainExpression {
    return asDomainExpression(this);
  }

  get domainLiteral(): string | null {
    if (typeof this._value === 'string') return this._value;
    return null;
  }

  get domainConstructor(): string | null {
    if (Array.isArray(this._value)) return this._value[0];
    return null;
  }

  get domainParams(): Domain[] | null {
    if (Array.isArray(this._value)) return this._value.slice(1) as Domain[];
    return null;
  }

  get parametricDomain(): BoxedParametricDomain | null {
    if (Array.isArray(this._value)) return this._value;
    return null;
  }

  get hash(): number {
    if (this._hash !== undefined) this._hash;
    this._hash = hash(this._value);
    return this._hash;
  }

  isEqual(rhs: BoxedExpression): boolean {
    if (!(rhs instanceof _Domain)) return false;
    const lhsDomainLiteral = this.domainLiteral;
    if (lhsDomainLiteral) return lhsDomainLiteral === rhs.domainLiteral;

    // A domain constructor
    if (this.domainConstructor !== rhs.domainConstructor) return false;
    const rhsParams = rhs.domainParams!;
    const lhsParams = this.domainParams!;
    if (rhsParams.length !== lhsParams.length) return false;
    for (let i = 0; i <= lhsParams.length - 1; i++) {
      const lhsParam = lhsParams[i];
      const rhsParam = rhsParams[i];

      if (typeof lhsParam === 'string') {
        if (lhsParam !== rhsParam) return false;
      } else if (typeof rhsParam === 'string' || !lhsParam.isEqual(rhsParam))
        return false;
    }

    return true;
  }

  isSame(rhs: BoxedExpression): boolean {
    return this.canonical.isEqual(rhs.canonical);
  }

  isCompatible(
    rhs: Domain | string,
    compatibility: DomainCompatibility = 'covariant'
  ): boolean {
    const rhsExpr = asDomainExpression(rhs);
    const thisExpr = asDomainExpression(this);
    if (compatibility === 'covariant') return isSubdomainOf(thisExpr, rhsExpr);
    if (compatibility === 'contravariant')
      return isSubdomainOf(rhsExpr, thisExpr);
    if (compatibility === 'bivariant')
      return (
        isSubdomainOf(rhsExpr, thisExpr) && isSubdomainOf(thisExpr, rhsExpr)
      );

    // Invariant
    return (
      !isSubdomainOf(rhsExpr, thisExpr) && !isSubdomainOf(thisExpr, rhsExpr)
    );
  }

  get json(): Expression {
    return serializeJsonDomainExpression(this.engine, this);
  }

  match(
    rhs: BoxedExpression,
    options?: PatternMatchOption
  ): Substitution | null {
    if (!(rhs instanceof _Domain)) return null;
    if (options?.exact && this.isEqual(rhs)) return {};
    if (this.isSame(rhs)) return {};
    return null;
  }

  get head(): string {
    return 'Domain';
  }

  get domain(): Domain {
    return this.engine.domain('Domain');
  }

  get valueDomain(): Domain {
    if (this.domainConstructor !== 'Function')
      return this.engine.domain('Domain');
    const de = this._value as BoxedParametricDomain;
    return de[de.length - 1] as Domain;
  }

  is(rhs: BoxedExpression): boolean {
    return this.isSame(rhs);
  }

  get isNothing(): boolean {
    return this.domainLiteral === 'Nothing';
  }
  get isFunction(): boolean {
    return (
      this.domainConstructor === 'Function' || this.domainLiteral === 'Function'
    );
  }
  // get isPredicate(): boolean {
  //   if (this.domainLiteral === 'Predicate') return true;
  //   if (this.domainConstructor !== 'Function') return false;
  //   const resultDomain = this._value[this._value.length];
  //   if (!(resultDomain instanceof _Domain)) return false;
  //   return resultDomain.isBoolean;
  // }
  // get isNumericFunction(): boolean {
  //   if (this.domainLiteral === 'NumericFunction') return true;
  //   if (this.domainConstructor !== 'Function') return false;
  //   for (const arg of this.domainParams!)
  //     if (!isNumericSubdomain(arg, 'Number')) return false;

  //   return true;
  // }
  // get isBoolean(): boolean {
  //   const dom = this.domainLiteral;
  //   return dom === 'Boolean' || dom === 'MaybeBoolean';
  // }

  // get isRealFunction(): boolean {
  //   if (this.domainLiteral === 'RealFunction') return true;
  //   if (this.domainConstructor !== 'Function') return false;
  //   for (const arg of this.domainParams!)
  //     if (!isNumericSubdomain(arg, 'ExtendedRealNumber')) return false;
  //   return true;
  // }

  get isNumeric(): boolean {
    return this.isCompatible('Number');
  }

  // get isLogicOperator(): boolean {
  //   if (this.domainLiteral === 'LogicOperator') return true;
  //   if (!this.codomain?.isBoolean) return false;

  //   const params = this.domainParams!;
  //   if (params.length < 1 || params.length > 2) return false;

  //   if (!params[0].isBoolean) return false;
  //   if (params.length === 1) return true;

  //   if (!params[1].isBoolean) return false;
  //   return true;
  // }

  get isRelationalOperator(): boolean {
    if (this.domainLiteral === 'RelationalOperator') return true;
    if (!this.valueDomain?.isCompatible('MaybeBoolean')) return false;
    if (this.domainParams!.length !== 2) return false;

    return true;
  }
}

/**
 * Note that `boxDomain()` should only be called from `ComputeEngine`
 */

export function boxDomain(
  ce: IComputeEngine,
  dom: BoxedDomainExpression | DomainExpression,
  metadata?: Metadata
): Domain {
  if (dom instanceof _Domain) return dom;

  if (typeof dom === 'string') {
    if (!isDomainLiteral(dom))
      throw Error('Expected domain literal, got ' + dom);
    return new _Domain(ce, dom, metadata);
  }

  const constructor = dom[0];
  if (!DOMAIN_CONSTRUCTORS.includes(constructor))
    throw Error('Expected domain constructor, got ' + constructor);

  const params = (dom as BoxedParametricDomain | ParametricDomain).slice(1);

  if (DOMAIN_EXPRESSION_CONSTRUCTORS.includes(constructor))
    return new _Domain(
      ce,
      [constructor, ...params.map((x) => ce.box(x) as any)],
      metadata
    );

  return new _Domain(
    ce,
    [constructor, ...params.map((x) => ce.domain(x))],
    metadata
  );
}

/** Validate that `expr` is a Domain */
export function isDomain(
  expr: Expression | BoxedExpression | Domain | DomainExpression
): expr is Domain | DomainExpression {
  if (expr instanceof _Domain) return true;

  if (Array.isArray(expr)) {
    if (expr.length <= 1) return false;
    // Could be a parametric domain expression
    const fn = expr[0];
    if (typeof fn !== 'string' || !DOMAIN_CONSTRUCTORS.includes(fn))
      return false;
    if (
      fn === 'Head' ||
      fn === 'Symbol' ||
      fn === 'Literal' ||
      fn === 'Range' ||
      fn === 'Interval'
    ) {
      return true;
    }
    for (let i = 1; i <= expr.length - 1; i++)
      if (!isDomain(expr[i])) return false;
    return true;
  }
  if (typeof expr === 'string') return isDomainLiteral(expr);

  if (!(expr instanceof AbstractBoxedExpression)) return false;

  if (typeof expr.head === 'string' && DOMAIN_CONSTRUCTORS.includes(expr.head))
    return expr.ops!.every((x) => isDomain(x));

  return isDomainLiteral(expr.symbol);
}

function hash(dom: string | BoxedParametricDomain): number {
  if (typeof dom === 'string') return hashCode('domain:' + dom);
  const [constructor, ...params] = dom;
  let s = 'domain:' + hashCode(constructor);
  for (const arg of params)
    s += ':' + hash(arg.domainLiteral ?? arg.parametricDomain!);
  return hashCode(s);
}

export function serializeJsonDomainExpression(
  ce: IComputeEngine,
  dom: Domain
): Expression {
  if (dom.domainLiteral)
    return serializeJsonSymbol(ce, dom.domainLiteral, {
      wikidata: dom.wikidata,
    });

  const [head, ...params] = dom.parametricDomain!;

  const fn: Expression = [
    serializeJsonSymbol(ce, head),
    ...params.map((x: Domain) => serializeJsonDomainExpression(ce, x)),
  ];

  if (ce.jsonSerializationOptions.shorthands.includes('function')) return fn;
  return { fn };
}

function asDomainExpression(dom: string | Domain): DomainExpression {
  if (typeof dom === 'string') return dom;
  if (dom.domainLiteral) return dom.domainLiteral;

  const [head, ...params] = dom.parametricDomain!;
  if (DOMAIN_EXPRESSION_CONSTRUCTORS.includes(head))
    return [
      head,
      ...params.map((x: BoxedExpression) => x.json),
    ] as DomainExpression;

  return [
    head,
    ...params.map((x: Domain) => asDomainExpression(x)),
  ] as DomainExpression;
}

function makeCanonical(
  ce: IComputeEngine,
  dom: string | BoxedParametricDomain
): string | BoxedParametricDomain {
  // @todo:
  // - Range[-Infinity, +Infinity]
  // - Range[0, +Infinity]
  // Multiple `Optional`, `Some` in arguments
  // Multiple Invariant, Covariant, Contravariant in argument
  // Multiple Open
  // Normalize attributes: Open, Optional, Invariant, Some, etc...

  // A required argument cannot follow an Optional one
  // A rest argument (Some) must be the last one

  if (typeof dom === 'string') {
    const expr = DOMAIN_ALIAS[dom] as ParametricDomain | undefined;
    if (expr) return [expr[0], ...expr.slice(1).map((x) => ce.domain(x))];
    return dom;
  }
  return dom;
}
