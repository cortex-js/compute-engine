import { ComputeEngine, Definition, Domain } from '../compute-engine-interface';
import { Expression } from '../math-json-format';

/**
 * Abstract BoxedExpression
 */

export abstract class BoxedExpression {
  protected readonly _engine: ComputeEngine | undefined;
  constructor(ce?: ComputeEngine) {
    if (ce) this._engine = ce;
  }
  abstract get head(): BoxedExpression | string;
  abstract get def(): Definition | null;
  // The domain of the expression, using available definitions and assumptions if necessary
  abstract get domain(): Domain;
  abstract get json(): Expression;

  get sgn(): -1 | 0 | 1 | undefined {
    return undefined;
  }

  //
  // Predicates: use assumptions, if available to answer
  //
  isEqual(rhs: BoxedExpression | number | string): boolean | undefined {
    if (rhs === 0) {
      const s = this.sgn;
      if (s !== undefined) return s === 0;
    }
    return undefined;
  }

  isLess(_rhs: BoxedExpression): boolean | undefined {
    // @todo: could check for rhs === 0 and use sgn
    return false;
  }
  isLessEqual(rhs: BoxedExpression): boolean | undefined {
    // @todo: could check for rhs === 0 and use sgn
    // @todo add a fastpath
    const eq = this.isEqual(rhs);
    if (eq === undefined) return undefined;
    const lt = this.isLess(rhs);
    if (lt === undefined) return undefined;
    return lt;
  }
  isGreater(rhs: BoxedExpression): boolean | undefined {
    // @todo: could check for rhs === 0 and use sgn
    // @todo add a fastpath
    const lt = this.isLess(rhs);
    if (lt === undefined) return undefined;
    return !lt;
  }
  isGreaterEqual(rhs: BoxedExpression): boolean | undefined {
    // @todo: could check for rhs === 0 and use sgn
    // @todo add a fastpath
    const eq = this.isEqual(rhs);
    if (eq === undefined) return undefined;
    if (eq === true) return true;
    const lt = this.isLess(rhs);
    if (lt === undefined) return undefined;
    return !lt;
  }
  get isZero(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined) return undefined;
    return s === 0;
  }
  // x > 0
  get isPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined) return undefined;
    return s > 0;
  }
  get isInfinity(): boolean | undefined {
    return undefined;
  }

  // Not +- Infinity, not NaN
  get isFinite(): boolean | undefined {
    const p = this.isInfinity;
    if (p === undefined) return p;
    return !p;
  }
  // x >= 0
  get isNonNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined) return undefined;
    return s >= 0;
  }
  // x < 0
  get isNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined) return undefined;
    return s < 0;
  }
  // x <= 0
  get isNonPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined) return undefined;
    return s <= 0;
  }
  get isNumeric(): boolean | undefined {
    return false;
  }
  get isInteger(): boolean | undefined {
    return false;
  }
  get isRational(): boolean | undefined {
    return false;
  }
  get isAlgebraic(): boolean | undefined {
    return false;
  }
  get isReal(): boolean | undefined {
    return false;
  }
  // Real or +-Infinity
  get isExtendedReal(): boolean | undefined {
    return false;
  }
  get isComplex(): boolean | undefined {
    return false;
  }
  get isOne(): boolean | undefined {
    return this.isEqual(1);
  }
  get isNegativeOne(): boolean | undefined {
    return this.isEqual(-1);
  }
  isElement(_set: BoxedExpression): boolean | undefined {
    return false;
  }
}

export declare function box(
  expr: Expression | BoxedExpression,
  ce?: ComputeEngine
): BoxedExpression;

export declare function isBoxed(
  expr: BoxedExpression | Expression
): expr is BoxedExpression;
