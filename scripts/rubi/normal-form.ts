// Rubi Times/Power normal form (docs/rubi/RUBI.md §4A, risk 3).
//
// CE's canonical form keeps `Divide`, `Negate`, `Sqrt`, and `Root` as
// operators; Rubi's rules are written against a pure Add/Multiply/Power
// vocabulary. This pass rewrites a canonical expression into that
// vocabulary — applied symmetrically to compiled pattern skeletons and to
// runtime integrands, so both sides match structurally.
//
// Rebuilding uses `ce._fn` (no re-canonicalization), since the canonical
// constructors would immediately fold `Power(x, -1)` back into
// `Divide(1, x)`. The synthetic nodes are only used for structural
// matching; anything that flows into rule RHSs is rebuilt canonically by
// the builder.

import type {
  ComputeEngine,
  Expression,
} from '../../src/compute-engine/global-types';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

export function toTimesPower(ce: ComputeEngine, e: Expression): Expression {
  if (e.symbol || !e.ops) return e;
  const ops = e.ops.map((o) => toTimesPower(ce, o));

  switch (e.operator) {
    case 'Negate':
      return mul(ce, [ce.NegativeOne, ...factors(ops[0])]);
    case 'Subtract':
      return ce._fn('Add', [
        ops[0],
        mul(ce, [ce.NegativeOne, ...factors(ops[1])]),
      ]);
    case 'Divide':
      return mul(ce, [...factors(ops[0]), ...invert(ce, ops[1])]);
    case 'Sqrt':
      return pow(ce, ops[0], ce.box(['Rational', 1, 2] as any));
    case 'Root': {
      const n = ops[1];
      if (isNumber(n) && n.isInteger)
        return pow(ce, ops[0], ce.box(['Rational', 1, n.re as any] as any));
      break;
    }
    case 'Power':
      return pow(ce, ops[0], ops[1]);
  }

  if (e.operator === 'Multiply') return mul(ce, ops.flatMap(factors));
  return rebuilt(ce, e, ops);
}

function rebuilt(
  ce: ComputeEngine,
  e: Expression,
  ops: Expression[]
): Expression {
  if (ops.every((o, i) => o === e.ops![i])) return e;
  return ce._fn(e.operator, ops);
}

function factors(e: Expression): Expression[] {
  return e.operator === 'Multiply' && e.ops ? [...e.ops] : [e];
}

function mul(ce: ComputeEngine, fs: Expression[]): Expression {
  const flat = fs.flatMap(factors).filter((f) => !f.isSame(1));
  if (flat.length === 0) return ce.One;
  if (flat.length === 1) return flat[0];
  return ce._fn('Multiply', flat);
}

/** factors of 1/e in Times/Power form */
function invert(ce: ComputeEngine, e: Expression): Expression[] {
  if (e.operator === 'Multiply' && e.ops)
    return e.ops.flatMap((o) => invert(ce, o));
  if (e.operator === 'Power' && e.ops)
    return [pow(ce, e.ops[0], negate(ce, e.ops[1]))];
  if (isNumber(e) && e.isRational === true)
    return [ce.One.div(e).evaluate()];
  return [ce._fn('Power', [e, ce.NegativeOne])];
}

/** Power constructor: merges (B^k)^e → B^(k·e) when sound (k = ±1 or
 * e an integer), drops exponent 1. */
function pow(
  ce: ComputeEngine,
  base: Expression,
  exp: Expression
): Expression {
  if (exp.isSame(1)) return base;
  if (base.operator === 'Power' && base.ops) {
    const inner = base.ops[1];
    const mergeable =
      inner.isSame(-1) ||
      inner.isSame(1) ||
      (isNumber(exp) && exp.isInteger === true);
    if (mergeable) {
      const merged = inner.mul(exp).evaluate();
      return pow(ce, base.ops[0], merged);
    }
  }
  return ce._fn('Power', [base, exp]);
}

/**
 * Rebuild an expression through the canonical constructors. Pattern
 * matching binds slots to subtrees of the Times/Power normal form, which
 * contains synthetic `_fn` nodes that are NOT engine-canonical; anything
 * flowing into conditions or rule RHSs must be re-canonicalized first or
 * arithmetic produces unfolded artifacts (e.g. `a + 0·b`).
 */
export function recanonicalize(
  ce: ComputeEngine,
  e: Expression
): Expression {
  if (e.symbol || !e.ops) return e;
  return ce.function(
    e.operator,
    e.ops.map((o) => recanonicalize(ce, o))
  );
}

function negate(ce: ComputeEngine, e: Expression): Expression {
  if (isNumber(e)) return e.neg().evaluate();
  if (e.operator === 'Multiply' && e.ops && isNumber(e.ops[0]))
    return ce._fn('Multiply', [
      e.ops[0].neg().evaluate(),
      ...e.ops.slice(1),
    ]);
  return ce._fn('Multiply', [ce.NegativeOne, e]);
}
