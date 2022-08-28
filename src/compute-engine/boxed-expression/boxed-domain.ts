import { Expression } from '../../math-json/math-json-format';
import {
  ancestors,
  DOMAIN_ALIAS,
  DOMAIN_CONSTRUCTORS,
  DOMAIN_EXPRESSION_CONSTRUCTORS,
  isDomainLiteral,
} from '../library/domains';
import {
  BoxedDomain,
  BoxedExpression,
  DomainCompatibility,
  DomainConstructor,
  DomainExpression,
  IComputeEngine,
  Metadata,
  PatternMatchOption,
  Substitution,
} from '../public';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import { BoxedFunction } from './boxed-function';
import { serializeJsonSymbol } from './serialize';
import { hashCode } from './utils';

/**
 * A `_BoxedDomain` is a wrapper around a boxed, canonical, domain expression.
 */
export class _BoxedDomain
  extends AbstractBoxedExpression
  implements BoxedDomain
{
  /** The boxed domain is either a string if a domain literal, or a boxed
   * function if a domain constructor (a non-literal domain expression).
   */
  _value: string | BoxedFunction;
  private _hash: number;

  constructor(ce: IComputeEngine, dom: DomainExpression, metadata?: Metadata) {
    super(ce, metadata);
    this._value = makeCanonical(ce, dom);
  }

  get isCanonical(): boolean {
    return true;
  }

  /** Boxed domains are always canonical. */
  get canonical(): _BoxedDomain {
    return this;
  }

  get json(): DomainExpression {
    if (typeof this._value === 'string')
      return serializeJsonSymbol(this.engine, this._value) as DomainExpression;

    return [
      serializeJsonSymbol(
        this.engine,
        this._value.head! as string
      ) as DomainConstructor,
      ...this._value.ops!.map((x) => x.json),
    ] as DomainExpression;
  }

  get domainLiteral(): string | null {
    if (typeof this._value === 'string') return this._value;
    return null;
  }

  get domainConstructor(): DomainConstructor | null {
    if (typeof this._value === 'string') return null;
    return this._value.head as DomainConstructor;
  }

  get domainParams(): BoxedExpression[] | null {
    if (typeof this._value === 'string') return null;
    return this._value.ops!;
  }

  get hash(): number {
    if (this._hash !== undefined) this._hash;

    if (typeof this._value === 'string')
      return hashCode('domain:' + this._value);
    let s = 'domain:' + hashCode(this._value.head! as string);
    for (const arg of this._value.ops!) s += ':' + arg.hash;

    this._hash = hashCode(s);
    return this._hash;
  }

  isEqual(rhs: BoxedExpression): boolean {
    if (!(rhs instanceof _BoxedDomain)) return false;

    // Is it a domain literal?
    if (typeof this._value === 'string') return this._value === rhs._value;

    // It's not a domain literal
    if (this.domainConstructor !== rhs.domainConstructor) return false;

    const rhsParams = rhs.domainParams!;
    const lhsParams = this.domainParams!;
    if (rhsParams.length !== lhsParams.length) return false;
    for (let i = 0; i <= lhsParams.length - 1; i++)
      if (!lhsParams[i].isEqual(rhsParams[i])) return false;

    return true;
  }

  isSame(rhs: BoxedExpression): boolean {
    return this.isEqual(rhs);
  }

  is(rhs: BoxedExpression): boolean {
    return this.isEqual(rhs);
  }

  isCompatible(
    rhs: BoxedDomain | string,
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

  match(
    rhs: BoxedExpression,
    _options?: PatternMatchOption
  ): Substitution | null {
    if (!(rhs instanceof _BoxedDomain)) return null;
    if (this.isSame(rhs)) return {};
    return null;
  }

  get head(): string {
    return 'Domain';
  }

  get domain(): BoxedDomain {
    return this.engine.domain('Domain');
  }

  get valueDomain(): BoxedDomain {
    return this.engine.domain('Domain');
  }

  get isNothing(): boolean {
    return this._value === 'Nothing';
  }

  get isFunction(): boolean {
    return this.domainConstructor === 'Function' || this._value === 'Function';
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
    if (this._value === 'RelationalOperator') return true;
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
  dom: BoxedDomain | DomainExpression,
  metadata?: Metadata
): BoxedDomain {
  if (dom instanceof _BoxedDomain) return dom;

  if (typeof dom === 'string') {
    if (!isDomainLiteral(dom))
      throw Error('Expected domain literal, got ' + dom);
    return new _BoxedDomain(ce, dom, metadata);
  }

  const constructor = dom[0];
  if (!DOMAIN_CONSTRUCTORS.includes(constructor))
    throw Error('Expected domain constructor, got ' + constructor);

  const params = (dom as BoxedParametricDomain | ParametricDomain).slice(1);

  if (DOMAIN_EXPRESSION_CONSTRUCTORS.includes(constructor))
    return new _BoxedDomain(
      ce,
      [constructor, ...params.map((x) => ce.box(x) as any)],
      metadata
    );

  return new _BoxedDomain(
    ce,
    [constructor, ...params.map((x) => ce.domain(x))],
    metadata
  );
}

/** Validate that `expr` is a Domain */
export function isDomain(
  expr: Expression | BoxedExpression | BoxedDomain | DomainExpression
): expr is BoxedDomain | DomainExpression {
  if (expr instanceof _BoxedDomain) return true;

  if (Array.isArray(expr)) {
    if (expr.length <= 1) return false;
    // Could be a domain expression
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

/** Turn a domain expression into a canonical boxed expression */
function makeCanonical(
  ce: IComputeEngine,
  dom: DomainExpression
): string | BoxedFunction {
  if (typeof dom === 'string') {
    const expr = DOMAIN_ALIAS[dom];
    if (expr) return [expr[0], ...expr.slice(1).map((x) => ce.domain(x))];
    if (!isDomainLiteral(dom)) throw Error('Unknown domain ' + dom);
    return dom;
  }

  // @todo:
  // - Range[-Infinity, +Infinity]
  // - Range[0, +Infinity]
  // Multiple `Optional`, `Some` in arguments
  // Multiple Invariant, Covariant, Contravariant in argument
  // Multiple Open
  // Normalize attributes: Open, Optional, Invariant, Some, etc...

  // A required argument cannot follow an Optional one
  // A rest argument (Some) must be the last one

  return dom;
}

export function isSubdomainOf(
  lhs: DomainExpression,
  rhs: DomainExpression
): boolean {
  // Build the domain lattice if necessary, by calculating all the ancestors of
  // `Void` (the bottom domain)
  if (!gDomainLiterals) {
    gDomainLiterals = {};
    ancestors('Void');
  }

  //
  // 1/ Compare two domain literals
  //
  if (typeof rhs === 'string' && typeof lhs === 'string') {
    if (!gDomainLiterals[rhs])
      throw Error('Expected a domain literal, got ' + rhs);
    if (!gDomainLiterals[lhs])
      throw Error('Expected a domain literal, got ' + lhs);

    if (lhs === rhs) return true;
    if (gDomainLiterals[lhs].has(rhs)) return true;
    return false;
  }

  //
  // 2/ Compare a rhs domain literal to a domain expression
  //
  if (typeof rhs === 'string') {
    if (!gDomainLiterals[rhs])
      throw Error('Expected a domain literal, got ' + rhs);
    const lhsConstructor = lhs[0];
    if (!DOMAIN_CONSTRUCTORS.includes(lhsConstructor))
      throw Error('Expected domain constructor, got ' + lhsConstructor);
    if (lhsConstructor === 'Function') {
      return rhs === 'Function';
      // @todo
    }
    // @todo handle domain constructors
    // 'Union',
    // 'List',
    // 'Record',
    // 'Tuple',
    // 'Intersection',
    // 'Range',
    // 'Interval',
    // 'Optional',
    // 'Some',
    // 'Head',
    // 'Symbol',
    // 'Literal',
    return true;
  }

  //
  // 3/ Compare a rhs domain expression with a domain literal or expression
  //
  const rhsConstructor = rhs[0];
  if (!DOMAIN_CONSTRUCTORS.includes(rhsConstructor))
    throw Error('Expected domain constructor, got ' + rhsConstructor);

  if (rhsConstructor === 'Function') {
    // True if LHS is a function, or an alias to a function
    if (typeof lhs === 'string') {
      if (lhs === 'Function') return true;
      lhs = DOMAIN_ALIAS[lhs];
      if (!lhs) return false;
    }
    if (lhs[0] !== 'Function') return false;

    // Both constructors are 'Function':
    // Check that the arguments and return values are compatible
    // Parameters should be contravariant, return values should be covariant
    if (!isSubdomainOf(rhs[rhs.length - 1], lhs[lhs.length - 1])) return false;
    for (let i = 1; i < rhs.length - 1; i++) {
      if (Array.isArray(rhs[i])) {
        const ctor = rhs[i][0];
        if (ctor === 'Optional') {
          if (lhs[i] && !isSubdomainOf(lhs[i], rhs[i][1] as DomainExpression))
            return false;
          if (!lhs[i] && lhs.length - 1 === i) return true;
        } else if (ctor === 'Some') {
          const param = rhs[i][1];
          if (!lhs[i] && lhs.length - 1 === i) return true;
          do {
            if (!isSubdomainOf(lhs[i], param as DomainExpression)) return false;
            i += 1;
          } while (i < lhs.length - 1);
          return true;
        } else if (!lhs[i] || !isSubdomainOf(lhs[i], rhs[i])) return false;
      } else if (!lhs[i] || !isSubdomainOf(lhs[i], rhs[i])) return false;
    }
    return true;
  }
  // @todo handle domain constructors
  // 'Function',
  // 'Union',
  // 'List',
  // 'Record',
  // 'Tuple',
  // 'Intersection',
  // 'Range',
  // 'Interval',
  // 'Optional',
  // 'Some',
  // 'Head',
  // 'Symbol',
  // 'Literal',

  return false;
}

/** Return the ancestor domain that is shared by both `a` and `b` */
export function sharedAncestorDomain(
  a: BoxedDomain,
  b: BoxedDomain
): BoxedDomain {
  const aAncestors = ancestors(domainLiteralAncestor(a));
  const bAncestors = ancestors(domainLiteralAncestor(b));

  while (!includesDomain(bAncestors, aAncestors[0])) aAncestors.shift();

  return a.engine.domain(aAncestors[0]);
}

// Return the domain literal that is the closest ancestor to `dom`
function domainLiteralAncestor(dom: BoxedDomain): string {
  let result = dom.domainLiteral;
  if (result) return result;
  result = dom.domainConstructor!;

  if (result === 'Optional') return result;
}

function includesDomain(xs: string[], y: string): boolean {
  for (const x of xs) if (x === y) return true;
  return false;
}
