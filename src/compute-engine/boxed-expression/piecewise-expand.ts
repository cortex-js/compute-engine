import type { Expression } from '../global-types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isTransitivelyPure } from './transitive-purity.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { add } from './arithmetic-add.js';
import { mul } from './arithmetic-mul-div.js';

/**
 * `PiecewiseExpand`: rewrite `Abs`, `Sign`, `Min`, `Max` and `Heaviside`,
 * wherever they occur in an expression, into one `Which(c1, v1, …, True, vd)`.
 *
 * An expression is carried as an ordered list of arms, each a conjunction of
 * conditions and a value; the arm with no condition is the default. A call
 * whose operands are conditional combines their arms in lexicographic order,
 * which keeps the first-match meaning of `Which`: the first arm selected is
 * the one whose conditions all hold, and an earlier arm of an operand can
 * only be skipped when one of its own conditions fails.
 *
 * The conditions are the assumptions' to decide: a condition that evaluates
 * to `True` (with `x > 0` assumed, `x ≥ 0`) is not written, and an arm with a
 * condition that evaluates to `False` is dropped. The assumptions of the
 * engine are only read; nothing is assumed for the rewrite.
 */

/** `lhs REL rhs`, written `lhs - rhs REL 0`. */
interface Cond {
  expr: Expression;
  lhs: Expression;
  rhs: Expression;
  rel: '>=' | '>' | '<' | '<=';
}

interface Arm {
  /** A conjunction; empty is `True`. */
  conds: Cond[];
  value: Expression;
}

/** The arms of a conditional value; the last one has no condition. */
type Piecewise = Arm[];

/**
 * A cartesian product of conditional operands multiplies the number of
 * arms (`Sign(x) * Sign(y) * Sign(z)` has 27). Past this many, the
 * expression is left as it is rather than expanded to an unreadable form.
 */
const PIECEWISE_ARM_LIMIT = 256;

const SPLIT_HEADS = new Set(['Abs', 'Sign', 'Min', 'Max', 'Heaviside']);

/** Thrown when the arms outgrow `PIECEWISE_ARM_LIMIT`. */
class TooManyArms extends Error {}

const REL_OPERATOR = {
  '>=': 'GreaterEqual',
  '>': 'Greater',
  '<': 'Less',
  '<=': 'LessEqual',
} as const;

/**
 * `lhs − rhs`. `.sub()` combines like terms (`(x + y) − y` is `x`), which
 * lets `tidy()` match equal conditions, but for two exact number literals
 * with different radicals it gives a float, whose sign can be wrong: those
 * are built with `ce.function()`.
 */
function difference(lhs: Expression, rhs: Expression): Expression {
  if (rhs.isSame(0)) return lhs;
  if (isNumber(lhs) && isNumber(rhs) && lhs.isExact && rhs.isExact)
    return lhs.engine.function('Subtract', [lhs, rhs]);
  return lhs.sub(rhs);
}

function condition(lhs: Expression, rhs: Expression, rel: Cond['rel']): Cond {
  const ce = lhs.engine;
  const of = difference(lhs, rhs);
  return { lhs, rhs, rel, expr: ce.function(REL_OPERATOR[rel], [of, ce.Zero]) };
}

/**
 * `True`, `False` or `undefined` (undecided) for a condition: first from
 * what is known of the sign of the difference, then by evaluating the
 * comparison of the operands.
 */
function decide({ expr, lhs, rhs, rel }: Cond): boolean | undefined {
  const of = difference(lhs, rhs);
  const [pos, neg, nonneg, nonpos] = [
    of.isPositive,
    of.isNegative,
    of.isNonNegative,
    of.isNonPositive,
  ];
  switch (rel) {
    case '>=':
      if (pos === true || nonneg === true) return true;
      if (neg === true) return false;
      break;
    case '>':
      if (pos === true) return true;
      if (neg === true || nonpos === true) return false;
      break;
    case '<':
      if (neg === true) return true;
      if (pos === true || nonneg === true) return false;
      break;
    case '<=':
      if (neg === true || nonpos === true) return true;
      if (pos === true) return false;
      break;
  }
  // The two operands, as the assumptions are written: `x > 3` decides
  // `x >= 2`, but not `x - 2 >= 0`
  for (const c of [lhs.engine.function(REL_OPERATOR[rel], [lhs, rhs]), expr]) {
    const r = c.evaluate();
    if (isSymbol(r, 'True')) return true;
    if (isSymbol(r, 'False')) return false;
  }
  return undefined;
}

/**
 * `Abs` and `Sign` of a complex argument are not a split on a sign, so they
 * need a known real argument. `Min`, `Max` and `Heaviside` also take an
 * extended real (`real | signed_infinity`, the type inferred for `x` in
 * `Heaviside(x)`) and an argument whose type is not a number type (an
 * undeclared `u`: `unknown`, or `value` inside `Max`), and refuse a number
 * type that admits a non-real value: a
 * declared `complex` or `number` admits `1 + i`, for which `Max(z, 1)`
 * stays unevaluated while a split on `z - 1 >= 0` would pick `1`.
 */
function splittable(head: string, values: Expression[]): boolean {
  if (head === 'Abs' || head === 'Sign')
    return values.length === 1 && isKnownReal(values[0]);
  if (head === 'Heaviside' && values.length !== 1) return false;
  if ((head === 'Min' || head === 'Max') && values.length === 0) return false;
  return values.every(
    (v) =>
      v.isCollection !== true &&
      (isKnownReal(v) ||
        v.type.matches('real | signed_infinity') ||
        (isSubtype('real', v.type.type) && !v.type.matches('number')))
  );
}

/** Declared real, or a sign the assumptions give it. */
function isKnownReal(v: Expression): boolean {
  return (
    v.type.matches('real') ||
    v.isPositive === true ||
    v.isNegative === true ||
    v.isNonNegative === true ||
    v.isNonPositive === true
  );
}

/** The arms of the head applied to scalar values, or `undefined`. */
function split(head: string, values: Expression[]): Piecewise | undefined {
  if (!splittable(head, values)) return undefined;
  const ce = values[0].engine;
  const [a, b] = values;
  const cmp = (rel: Cond['rel'], v: Expression, w: Expression = ce.Zero) =>
    condition(v, w, rel);
  switch (head) {
    case 'Abs':
      return [
        { conds: [cmp('>=', a)], value: a },
        { conds: [], value: a.neg() },
      ];
    case 'Sign':
      return [
        { conds: [cmp('>', a)], value: ce.One },
        { conds: [cmp('<', a)], value: ce.NegativeOne },
        { conds: [], value: ce.Zero },
      ];
    case 'Heaviside':
      return [
        { conds: [cmp('<', a)], value: ce.Zero },
        { conds: [cmp('>', a)], value: ce.One },
        // H(0) = 1/2
        { conds: [], value: ce.Half },
      ];
    case 'Max':
    case 'Min': {
      // Pairwise from the left: the other operands are folded by the caller
      return [
        {
          conds: [cmp(head === 'Max' ? '>=' : '<=', a, b)],
          value: a,
        },
        { conds: [], value: b },
      ];
    }
  }
  return undefined;
}

/**
 * The arms of `head(v1, …)` for each combination of the arms of its
 * operands. `build` gives the arms of the call on one combination of values.
 */
function combine(
  operands: Piecewise[],
  build: (values: Expression[]) => Piecewise
): Piecewise {
  // Each operand is already tidied, so the product of their lengths bounds
  // the arms: past the limit, nothing is built (`Abs(x1) + … + Abs(x20)`
  // would build 2^20 arms before `tidy()` could refuse them). A product
  // that `tidy()` would reduce below the limit (six terms that all split on
  // the sign of one `x`) is refused too: the call is then left as it is.
  let size = 1;
  for (const p of operands) {
    size *= p.length;
    if (size > PIECEWISE_ARM_LIMIT) throw new TooManyArms();
  }
  const out: Piecewise = [];
  const walk = (i: number, conds: Cond[], values: Expression[]) => {
    if (i === operands.length) {
      for (const arm of build(values)) out.push(withConds(conds, arm));
      return;
    }
    for (const arm of operands[i])
      walk(i + 1, conds.concat(arm.conds), [...values, arm.value]);
  };
  walk(0, [], []);
  return tidy(out);
}

function withConds(conds: Cond[], arm: Arm): Arm {
  return { conds: [...conds, ...arm.conds], value: arm.value };
}

/**
 * Drop what the assumptions decide, repeated conditions, and arms that an
 * earlier arm already selects (all of the earlier arm's conditions are among
 * its own). Stops at the first arm with no condition.
 */
function tidy(arms: Piecewise): Piecewise {
  const out: Piecewise = [];
  for (const arm of arms) {
    const conds: Cond[] = [];
    let possible = true;
    for (const c of arm.conds) {
      const d = decide(c);
      if (d === false) {
        possible = false;
        break;
      }
      if (d === true || conds.some((k) => k.expr.isSame(c.expr))) continue;
      conds.push(c);
    }
    if (!possible) continue;
    if (
      out.some((e) =>
        e.conds.every((k) => conds.some((c) => c.expr.isSame(k.expr)))
      )
    )
      continue;
    out.push({ conds, value: arm.value });
    if (conds.length === 0) break;
    if (out.length > PIECEWISE_ARM_LIMIT) throw new TooManyArms();
  }
  return out;
}

/** The `lazy` heads whose operands are plain values. */
const VALUE_OPERATORS = new Set([
  'Add',
  'Multiply',
  'List',
  'Equal',
  'NotEqual',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
]);

/** Does the call evaluate its operands as values, in no scope of its own? */
function isTransparent(expr: Expression): boolean {
  const def = expr.operatorDefinition;
  if (def === undefined) return false;
  if (def.scoped || def.selectsOperands) return false;
  return !def.lazy || VALUE_OPERATORS.has(expr.operator);
}

function piecewise(expr: Expression): Piecewise {
  if (!isFunction(expr)) return [{ conds: [], value: expr }];

  // A binder (`Sum`'s index) or a selector (`Which`) holds its operands: a
  // condition on a bound variable would escape its scope
  if (!isTransparent(expr)) return [{ conds: [], value: expr }];

  const head = expr.operator;
  const ops = expr.ops.map(piecewise);

  const unchanged = ops.every(
    (p, i) =>
      p.length === 1 && p[0].conds.length === 0 && p[0].value === expr.ops[i]
  );
  if (unchanged && !SPLIT_HEADS.has(head)) return [{ conds: [], value: expr }];

  const ce = expr.engine;
  // A sum and a product fold what the substitution made trivial
  // (`x - x`, `0·y`): `ce.function()` leaves them as written
  const rebuild = (values: Expression[]): Piecewise => [
    {
      conds: [],
      value:
        head === 'Add'
          ? add(...values)
          : head === 'Multiply'
            ? mul(...values)
            : ce.function(head, values),
    },
  ];

  // `Max()` and `Min()` with no operand are left as they are
  if ((head === 'Max' || head === 'Min') && ops.length === 0)
    return [{ conds: [], value: expr }];

  if (head === 'Max' || head === 'Min') {
    // Fold n operands from the left: Max(a, b, c) = Max(Max(a, b), c)
    let acc = ops[0];
    for (const next of ops.slice(1))
      acc = combine([acc, next], (v) => split(head, v) ?? rebuild(v));
    if (ops.length === 1) acc = combine([acc], rebuild);
    return acc;
  }

  const result = combine(
    ops,
    SPLIT_HEADS.has(head) ? (v) => split(head, v) ?? rebuild(v) : rebuild
  );
  return unchanged &&
    result.length === 1 &&
    result[0].conds.length === 0 &&
    result[0].value.isSame(expr)
    ? [{ conds: [], value: expr }]
    : result;
}

/**
 * The conditional value of `expr`, or `expr` itself when it holds none of
 * the heads, when the arms would pass `PIECEWISE_ARM_LIMIT`, or when it is
 * not pure.
 */
export function piecewiseExpand(expr: Expression): Expression {
  // The conditions are lifted in front of the whole expression and decided
  // by evaluating them: an impure part would run once more
  // (`Abs(Random() - 1/2)`), or its value would differ between the
  // condition and the arm
  if (!isTransitivelyPure(expr)) return expr;
  let arms: Piecewise;
  try {
    arms = piecewise(expr);
  } catch (e) {
    if (e instanceof TooManyArms) return expr;
    throw e;
  }
  if (arms.length === 1 && arms[0].conds.length === 0) return arms[0].value;

  const ce = expr.engine;
  const clauses: Expression[] = [];
  for (const { conds, value } of arms) {
    clauses.push(
      conds.length === 0
        ? ce.True
        : conds.length === 1
          ? conds[0].expr
          : ce.function(
              'And',
              conds.map((c) => c.expr)
            ),
      value
    );
  }
  return ce.function('Which', clauses);
}
