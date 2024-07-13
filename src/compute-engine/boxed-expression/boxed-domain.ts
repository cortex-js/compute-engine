import Complex from 'complex.js';
import Decimal from 'decimal.js';
import { Expression } from '../../math-json/math-json-format';
import { functionDomain } from '../domain-utils';
import {
  ancestors,
  DOMAIN_CONSTRUCTORS,
  isDomainLiteral,
} from '../library/domains';
import {
  BoxedDomain,
  BoxedSubstitution,
  DomainCompatibility,
  DomainConstructor,
  DomainExpression,
  DomainLiteral,
  IComputeEngine,
  Metadata,
  PatternMatchOptions,
} from '../public';
import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode, isBoxedExpression } from './utils';
import { isWildcard, wildcardName } from './boxed-patterns';
import { BoxedExpression, SemiBoxedExpression } from './public';

/**
 * A `_BoxedDomain` is a wrapper around a boxed, canonical, domain
 * expression.
 *
 * It could be an invalid domain, in which case `isValid` is `false`.
 *
 * @noInheritDoc
 */
export class _BoxedDomain extends _BoxedExpression implements BoxedDomain {
  private _hash: number;

  // The closest ancestor (Least Upper Bound) domain literal
  readonly base: DomainLiteral;

  // If a domain expression, the domain constructor and its parameters/arguments
  readonly ctor: DomainConstructor | null;
  readonly params: DomainExpression<Expression>[];

  constructor(ce: IComputeEngine, dom: DomainExpression, metadata?: Metadata) {
    console.assert(!(dom instanceof _BoxedDomain));
    super(ce, metadata);

    //
    // 1/ Handle the case of a domain literal
    //
    if (typeof dom === 'string') {
      if (!isDomainLiteral(dom)) throw Error(`Unknown domain literal "${dom}"`);

      this.base = dom;
      this.ctor = null;
      this.params = [];
      return;
    }

    if (!Array.isArray(dom)) throw Error('Expected a domain expression');

    //
    // 2/ This is a domain expression with a constructor and some parameters
    //

    if (!DOMAIN_CONSTRUCTORS.includes(dom[0] as DomainConstructor))
      throw Error(`Unknown domain constructor "${dom[0]}`);

    const ctor = dom[0] as DomainConstructor;
    this.ctor = ctor;

    if (ctor === 'OptArg' || ctor === 'VarArg')
      throw Error(
        `Unexpected domain constructor "${ctor}" outside of FunctionOf`
      );

    this.params = dom
      .slice(1)
      .map((x) => (x instanceof _BoxedExpression ? x.json : x));

    if (ctor === 'FunctionOf') {
      this.base = 'Functions';
      // Check that the domain is valid, especially any VarArg and OptArg
      if (ce.strict) functionDomain(this);
    }

    if (ctor === 'DictionaryOf') this.base = 'Dictionaries';

    if (ctor === 'ListOf') this.base = 'Lists';

    if (ctor === 'TupleOf') this.base = 'Tuples';

    if (
      ctor === 'Covariant' ||
      ctor === 'Contravariant' ||
      ctor === 'Bivariant' ||
      ctor === 'Invariant'
    ) {
      const param = ce.domain(dom[1] as DomainExpression);
      this.ctor = ctor;
      this.base = param.base;
      this.params = [param.json as DomainExpression];
      if (dom.length !== 2) throw Error(`Invalid "${ctor}" in domain "${dom}"`);
    }

    if (ctor === 'Union' || ctor === 'Intersection') {
      let base: BoxedDomain | undefined = undefined;
      if (ctor === 'Union')
        for (const param of this.params) base = widen(base, ce.domain(param));
      else
        for (const param of this.params) base = narrow(base, ce.domain(param));
      this.base = base!.base;
    }
  }

  /** Boxed domains are always canonical. */
  get isCanonical(): boolean {
    return true;
  }
  get canonical(): _BoxedDomain {
    return this;
  }

  get isValid(): boolean {
    return true;
  }

  get json(): Expression {
    if (!this.ctor) return this.base;
    return [this.ctor, ...this.params];
  }

  get hash(): number {
    if (this._hash === undefined)
      this._hash = hashCode(JSON.stringify(this.json));
    return this._hash;
  }

  evaluate(): BoxedDomain {
    return this;
  }

  simplify(): BoxedDomain {
    return this;
  }

  isCompatible(
    dom: BoxedDomain | DomainLiteral,
    compatibility: DomainCompatibility = 'covariant'
  ): boolean {
    const lhs = this.json as DomainExpression;
    const rhs =
      dom instanceof _BoxedDomain
        ? (dom.json as DomainExpression)
        : (dom as DomainLiteral);
    const rhsCtor = Array.isArray(rhs) ? rhs[0] : null;
    if (rhsCtor) {
      const rhsParam = rhs[1] as DomainExpression<BoxedExpression>;
      if (rhsCtor === 'Covariant') return isSubdomainOf1(lhs, rhsParam);
      if (rhsCtor === 'Contravariant') return isSubdomainOf1(rhsParam, lhs);
      if (rhsCtor === 'Invariant')
        return !isSubdomainOf1(rhsParam, lhs) && !isSubdomainOf1(lhs, rhsParam);
      if (rhsCtor === 'Bivariant')
        return isSubdomainOf1(lhs, rhsParam) && isSubdomainOf1(rhsParam, lhs);
    }

    if (compatibility === 'covariant') return isSubdomainOf1(lhs, rhs);
    if (compatibility === 'contravariant') return isSubdomainOf1(rhs, lhs);
    if (compatibility === 'bivariant')
      return isSubdomainOf1(rhs, lhs) && isSubdomainOf1(lhs, rhs);

    // Invariant
    return !isSubdomainOf1(rhs, lhs) && !isSubdomainOf1(lhs, rhs);
  }

  isEqual(rhs: BoxedExpression): boolean {
    if (!(rhs instanceof _BoxedDomain)) return false;
    if (this === rhs) return true;
    return this.isCompatible(rhs, 'invariant');
  }

  isSame(rhs: BoxedExpression): boolean {
    return this.isEqual(rhs);
  }

  match(
    pattern:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression
      | BoxedExpression,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!isBoxedExpression(pattern))
      pattern = this.engine.box(pattern, { canonical: false });
    if (isWildcard(pattern as BoxedExpression))
      return { [wildcardName(pattern as BoxedExpression)!]: this };
    if (!(pattern instanceof _BoxedDomain)) return null;
    if (this.isCompatible(pattern, 'invariant')) return {};
    return null;
  }

  get head(): string {
    return 'Domain';
  }

  get domain(): BoxedDomain {
    return this.engine.domain('Domains');
  }

  get isFunction(): boolean {
    return this.base === 'Functions';
  }

  get isNumeric(): boolean {
    return this.isCompatible(this.engine.domain('Numbers'));
  }
}

/** Validate that `expr` is a Domain */
export function isDomain(
  expr: Expression | BoxedExpression | BoxedDomain | DomainExpression
): expr is BoxedDomain | DomainExpression {
  if (expr instanceof _BoxedDomain) return true;

  if (expr instanceof _BoxedExpression) expr = expr.json;

  if (typeof expr === 'string') return isDomainLiteral(expr);

  if (!Array.isArray(expr)) return false;

  if (expr.length <= 1) return false;

  // Could be a domain expression
  const ctor = expr[0] as DomainConstructor;
  if (typeof ctor !== 'string' || !DOMAIN_CONSTRUCTORS.includes(ctor))
    return false;

  if (ctor === 'ListOf' || ctor === 'OptArg' || ctor === 'VarArg')
    return expr.length === 2 && isDomain(expr[1]);

  if (ctor === 'FunctionOf') return expr.slice(1).every(isDomain);

  if (ctor === 'TupleOf' || ctor === 'Intersection' || ctor === 'Union')
    return expr.slice(1).every(isDomain);

  return expr.every((x) => x !== null);
}

function isSubdomainOf1(
  lhs: DomainExpression<BoxedExpression>,
  rhs: DomainExpression<BoxedExpression>
): boolean {
  const [result, rest] = isSubdomainOf([lhs], rhs);
  if (result && rest.length === 0) return true;
  return false;
}

// Return `true` if `lhs` is a sub domain of, or equal to, `rhs`
// `lhs` is the "template" that `rhs` is checked against
function isSubdomainOf(
  xlhs: DomainExpression<BoxedExpression>[],
  rhs: DomainExpression<BoxedExpression>
): [boolean, DomainExpression<BoxedExpression>[]] {
  let lhs = xlhs.shift() as DomainExpression<BoxedExpression>;

  const rhsLiteral = typeof rhs === 'string' ? rhs : null;
  if (rhsLiteral === 'Anything') return [true, xlhs];

  const lhsLiteral = typeof lhs === 'string' ? lhs : null;

  //
  // 1/ Compare two domain literals
  //
  if (lhsLiteral && rhsLiteral) {
    if (lhsLiteral === rhsLiteral) return [true, xlhs];
    return [ancestors(lhsLiteral).includes(rhsLiteral), xlhs];
  }

  //
  // 2/ Is the lhs domain constructor a subdomain of the rhs domain literal?
  //
  if (rhsLiteral) {
    const lhsConstructor = lhs[0] as DomainConstructor;
    if (lhsConstructor === 'FunctionOf')
      return [rhsLiteral === 'Functions', xlhs];
    if (lhsConstructor === 'DictionaryOf')
      return [rhsLiteral === 'Dictionaries', xlhs];
    if (lhsConstructor === 'ListOf') return [rhsLiteral === 'Lists', xlhs];
    if (lhsConstructor === 'TupleOf') return [rhsLiteral === 'Tuples', xlhs];

    if (lhsConstructor === 'Intersection') {
    }
    // @todo handle domain constructors

    // 'Intersection',
    // 'Union',

    // 'Head',
    // 'Symbol',
    // 'Value',
    return [true, xlhs];
  }

  //
  // 3/ Compare a rhs domain expression with a domain literal or expression
  //
  const rhsConstructor = rhs[0]! as DomainConstructor;

  if (rhsConstructor === 'FunctionOf') {
    // See https://www.stephanboyer.com/post/132/what-are-covariance-and-contravariance
    if (lhsLiteral === 'Functions') return [true, xlhs];
    if (lhsLiteral) return [false, xlhs];

    // Only a `Functions` ctor can be a subdomain of a `Functions`
    if (lhs[0] !== 'FunctionOf') return [false, xlhs];

    // Both constructors are 'Functions':

    if (lhs.length === 1 && rhs.length === 1) return [true, xlhs];

    // Check that the result are compatible (**covariant**):
    // return types may be more speicific than expected (declare return to
    // be `Numbers`, but return `Integers`)
    if (
      !isSubdomainOf1(
        lhs[lhs.length - 1] as DomainExpression<BoxedExpression>,
        rhs[rhs.length - 1] as DomainExpression<BoxedExpression>
      )
    )
      return [false, xlhs];

    // Check that the parameters are compatible (***contravariant**)
    // input types may be more general than expected (ask for `Numbers`, but
    // accept `RealNumbers`)
    const lhsParams = lhs.slice(1, -1) as DomainExpression<BoxedExpression>[];
    let rhsParams = rhs.slice(1, -1) as DomainExpression<BoxedExpression>[];
    // let j = 0;
    for (let i = 0; i <= lhsParams.length - 1; i++) {
      // `rhs` is not expected to include a `Sequence`, `Contravariant`, etc... ctor, but `lhs` might
      if (rhsParams.length === 0) {
        // We have run out of rhs parameters
        const lhsCtor = Array.isArray(lhsParams[i]) ? lhsParams[i][0] : null;
        if (lhsCtor !== 'OptArg') return [false, xlhs];
        // Any remaining lhs parameters should be optional
        return [true, xlhs];
      } else {
        let match = false;
        [match, rhsParams] = isSubdomainOf(rhsParams, lhsParams[i]);
        if (!match) return [false, xlhs];
      }
    }

    // There should be no `rhs` parameters left to check
    return [rhsParams.length === 0, xlhs];
  }

  // @todo handle domain constructors
  // 'Dictionary',
  // 'List',
  // 'Tuple',

  if (rhsConstructor === 'Intersection') {
    return [
      (rhs as DomainExpression<BoxedExpression>[])
        .slice(1, -1)
        .every((x: DomainExpression<BoxedExpression>) =>
          isSubdomainOf1(lhs, x)
        ),
      xlhs,
    ];
  }

  if (rhsConstructor === 'Union') {
    return [
      (rhs as DomainExpression<BoxedExpression>[])
        .slice(1, -1)
        .some((x: DomainExpression<BoxedExpression>) => isSubdomainOf1(lhs, x)),
      xlhs,
    ];
  }

  if (rhsConstructor === 'OptArg') {
    if (lhsLiteral === 'NothingDomain') return [true, xlhs];
    return isSubdomainOf(
      [lhs, ...xlhs] as DomainExpression<BoxedExpression>[],
      rhs[1]! as DomainExpression<BoxedExpression>
    );
  }

  if (rhsConstructor === 'VarArg') {
    const seq = rhs[1] as DomainExpression<BoxedExpression>;

    if (!isSubdomainOf1(lhs, seq)) return [false, xlhs];
    lhs = xlhs.shift() as DomainExpression<BoxedExpression>;

    // Skip over all other parameters of domain `seq`
    let match = true;
    while (xlhs.length > 0 && match) {
      [match, xlhs] = isSubdomainOf(xlhs, seq);
      lhs = xlhs.shift() as DomainExpression<BoxedExpression>;
    }
    return [true, xlhs];
  }

  if (rhsConstructor === 'TupleOf') {
    if (!Array.isArray(lhs) || lhs[0] !== 'TupleOf') return [false, xlhs];
    if (lhs.length > rhs.length) return [false, xlhs];
    for (let i = 1; i <= rhs.length - 1; i++) {
      if (
        !lhs[i] ||
        !isSubdomainOf1(
          lhs[i] as DomainExpression<BoxedExpression>,
          rhs[i] as DomainExpression<BoxedExpression>
        )
      )
        return [false, xlhs];
    }
    return [true, xlhs];
  }

  // 'Head',
  // 'Symbol',
  // 'Values',

  console.error('Unexpected domain constructor ' + rhsConstructor);

  return [false, xlhs];
}

/** Return the ancestor domain (Least Upper Bound) that is shared by both `a` and `b` */
export function widen(
  a: BoxedDomain | undefined | null,
  b: BoxedDomain | undefined | null
): BoxedDomain | undefined {
  if (a === undefined || a === null) return b!;
  if (b === undefined || b === null) return a;
  const aAncestors = [a.base, ...ancestors(a.base)];
  const bAncestors = [b.base, ...ancestors(b.base)];

  while (!bAncestors.includes(aAncestors[0])) aAncestors.shift();

  return a.engine.domain(aAncestors[0]);
}

// function widestDomain(a: DomainLiteral, b: DomainLiteral): DomainLiteral {
//   const aAncestors = [a, ...ancestors(a)];
//   const bAncestors = [b, ...ancestors(b)];

//   while (!bAncestors.includes(aAncestors[0])) aAncestors.shift();

//   return aAncestors[0];
// }

// function narrowestDomain(a: DomainLiteral, b: DomainLiteral): DomainLiteral {
//   const aAncestors = [a, ...ancestors(a)];
//   const bAncestors = [b, ...ancestors(b)];

//   while (!bAncestors.includes(aAncestors[0])) bAncestors.shift();

//   return bAncestors[0];
// }

export function narrow(
  a: BoxedDomain | undefined,
  b: BoxedDomain | undefined
): BoxedDomain {
  if (a === undefined) return b!;
  if (b === undefined) return a;
  if (isSubdomainOf1(a.base, b.base)) return a;
  if (isSubdomainOf1(b.base, a.base)) return b;
  return a.engine.Void;
}
