import { AssumeResult, BoxedExpression, IComputeEngine } from './public.ts';

import { isSubtype } from '../common/type/subtype.ts';
import { functionResult } from '../common/type/utils.ts';

import { findUnivariateRoots } from './boxed-expression/solve.ts';
import { isInequality, domainToType } from './boxed-expression/utils.ts';

/**
 * Add an assumption, in the form of a predicate, for example:
 *
 * - `x = 5`
 * - `x ∈ ℕ`
 * - `x > 3`
 * - `x + y = 5`
 *
 * Assumptions that represent a symbol definition (equality to an expression,
 * membership to a type, >0, <=0, etc...) are stored directly in the current
 * scope's symbols dictionary, and an entry for the symbol is created if
 * necessary.
 *
 * Predicates that involve multiple symbols are simplified (for example
 * `x + y = 5` becomes `x + y - 5 = 0`), then stored in the `assumptions`
 * record of the current context.
 *
 * New assumptions can 'refine' previous assumptions, if they don't contradict
 * previous assumptions.
 *
 * To set new assumptions that contradict previous ones, you must first
 * `forget` about any symbols in the new assumption.
 *
 */

export function assume(proposition: BoxedExpression): AssumeResult {
  if (proposition.operator === 'Element') return assumeElement(proposition);
  if (proposition.operator === 'Equal') return assumeEquality(proposition);
  if (isInequality(proposition)) return assumeInequality(proposition);

  throw new Error(
    'Unsupported assumption. Use `Element`, `Equal` or an inequality'
  );
}

function assumeEquality(proposition: BoxedExpression): AssumeResult {
  console.assert(proposition.operator === 'Equal');
  // Four cases:
  // 1/ proposition contains no unknowns
  //    e.g. `2 + 1 = 3`, `\pi + 1 = \pi`
  //    => evaluate and return
  //
  // 2/ lhs is a single unknown and `rhs` does not contain `lhs`
  //    e.g. `x = 2`, `x = 2\pi`
  //    => if `lhs` has a definition, set its value to `rhs`, otherwise
  //          declare a new symbol with a value of `rhs`
  //
  // 3/ proposition contains a single unknown
  //    => solve for the unknown, create new def or set value of the
  //      unknown with the root(s) as value
  //
  // 4/ proposition contains multiple unknowns
  //    => add (lhs - rhs = 0) to assumptions DB

  // Case 1
  const unknowns = proposition.unknowns;
  if (unknowns.length === 0) {
    const val = proposition.evaluate();
    if (val.symbol === 'True') return 'tautology';
    if (val.symbol === 'False') return 'contradiction';
    console.log(proposition.canonical.evaluate());
    return 'not-a-predicate';
  }

  const ce = proposition.engine;

  // Case 2
  // @todo: this is dubious. Should we allow this?
  // i.e. `ce.assume(ce.parse("x = 3"))`
  // that's not really an assumption, that's an assignment.
  // Assumptions are meant to be complementary to declarations, not replacing
  // them, i.e. `ce.assume(ce.parse("x > 0"))`
  const lhs = proposition.op1.symbol;
  if (lhs && !hasValue(ce, lhs) && !proposition.op2.has(lhs)) {
    const val = proposition.op2.evaluate();
    if (!val.isValid) return 'not-a-predicate';
    const def = ce.lookupSymbol(lhs);
    if (!def) {
      ce.defineSymbol(lhs, { value: val });
      return 'ok';
    }
    if (def.type && !isSubtype(val.type, def.type))
      if (!def.inferredType) return 'contradiction';

    def.value = val;
    if (def.inferredType) def.type = val.type;
    return 'ok';
  }

  // Case 3
  if (unknowns.length === 1) {
    const lhs = unknowns[0];
    const sols = findUnivariateRoots(proposition, lhs);
    if (sols.length === 0) {
      ce.assumptions.set(
        ce.function('Equal', [proposition.op1.sub(proposition.op2), 0]),
        true
      );
    }

    const val = sols.length === 1 ? sols[0] : ce.function('List', sols);
    const def = ce.lookupSymbol(lhs);
    if (!def) {
      ce.defineSymbol(lhs, { value: val });
      return 'ok';
    }
    if (
      def.type &&
      !sols.every((sol) => !sol.type || isSubtype(val.type, sol.type))
    )
      return 'contradiction';
    def.value = val;
    return 'ok';
  }

  ce.assumptions.set(proposition, true);
  return 'ok';
}

function assumeInequality(proposition: BoxedExpression): AssumeResult {
  //
  // 1/ lhs is a single **undefined** free var e.g. "x < 0"
  //    => define a new var, if the domain can be inferred set it, otherwise
  // RealNumbers and add to assumptions (e.g. x < 5)
  // 2/ (lhs - rhs) is an expression with no free vars
  //  e.g. "\pi < 5"
  //  => evaluate
  // 3/ (lhs - rhs) is an expression with a single **undefined** free var
  //    e.g. "x + 1 < \pi"
  //    => add def as RealNumbers, add to assumptions
  // 4/ (lhs - rhs) is an expression with multiple free vars
  //    e.g. x + y < 0
  //    => add to assumptions

  const ce = proposition.engine;
  // Case 1
  if (proposition.op1!.symbol && !hasDef(ce, proposition.op1!.symbol)) {
    if (proposition.op2.is(0)) {
      if (proposition.operator === 'Less') {
        // x < 0
        ce.defineSymbol(proposition.op1.symbol, {
          type: 'real',
          flags: { sgn: 'negative' },
        });
      } else if (proposition.operator === 'LessEqual') {
        // x <= 0
        ce.defineSymbol(proposition.op1.symbol, {
          type: 'real',
          flags: { sgn: 'non-positive' },
        });
      } else if (proposition.operator === 'Greater') {
        // x > 0
        ce.defineSymbol(proposition.op1.symbol, {
          type: 'real',
          flags: { sgn: 'positive' },
        });
      } else if (proposition.operator === 'GreaterEqual') {
        // x >= 0
        ce.defineSymbol(proposition.op1.symbol, {
          type: 'real',
          flags: { sgn: 'non-negative' },
        });
      }
    } else {
      ce.defineSymbol(proposition.op1.symbol, { type: 'real' });
      ce.assumptions.set(proposition, true);
    }
    return 'ok';
  }
  // @todo: handle if proposition.op1 *has* a def (and no value)

  // Normalize to Less, LessEqual
  let op = '';
  let lhs: BoxedExpression;
  let rhs: BoxedExpression;
  if (proposition.operator === 'Less') {
    lhs = proposition.op1;
    rhs = proposition.op2;
    op = '<';
  } else if (proposition.operator === 'LessEqual') {
    lhs = proposition.op1;
    rhs = proposition.op2;
    op = '<=';
  } else if (proposition.operator === 'Greater') {
    lhs = proposition.op2;
    rhs = proposition.op1;
    op = '<';
  } else if (proposition.operator === 'GreaterEqual') {
    lhs = proposition.op2;
    rhs = proposition.op1;
    op = '<=';
  }
  if (!op) return 'internal-error';
  const p = lhs!.sub(rhs!);

  // Case 2
  const result = ce.box([op === '<' ? 'Less' : 'LessEqual', p, 0]).evaluate();

  if (result.symbol === 'True') return 'tautology';
  if (result.symbol === 'False') return 'contradiction';

  const unknowns = result.unknowns;
  if (unknowns.length === 0) return 'not-a-predicate';

  // Case 3
  if (unknowns.length === 1) {
    if (!ce.lookupSymbol(unknowns[0]))
      ce.defineSymbol(unknowns[0], { type: 'real' });
  }

  // Case 3, 4
  console.assert(result.operator === 'Less' || result.operator === 'LessEqual');
  ce.assumptions.set(result, true);
  return 'ok';
}

function assumeElement(proposition: BoxedExpression): AssumeResult {
  console.assert(proposition.operator === 'Element');

  // Four cases:
  // 1/ lhs is a single free variable with no definition
  //    e.g. `x \in \R`
  //    => define a new var with the specified domain
  // 2/ lhs is a symbol with a definition
  //    => update domain, if compatible
  // 3/ lhs is an expression with some free variables with no definition
  //    => add to assumptions DB
  // 4/ otherwise  (expression)
  //    e.g. `x+2 \in \R`
  //    => evaluate and return result (contradiction or tautology)

  const ce = proposition.engine;
  // Note: this is not 'unknowns' because proposition is not canonical (so all symbols are "unknowns")
  const undefs = undefinedIdentifiers(proposition.op1);
  // Case 1
  if (undefs.length === 1) {
    const dom = proposition.op2.evaluate();
    if (!dom.isValid) return 'not-a-predicate';

    const type = domainToType(dom);
    if (type === 'unknown') {
      throw new Error(`Invalid domain "${dom.toString()}"`);
    }
    ce.declare(undefs[0], type);
    return 'ok';
  }

  // Case 2
  if (proposition.op1.symbol && hasDef(ce, proposition.op1.symbol)) {
    const domain = proposition.op2.evaluate();
    if (!domain.isValid) return 'not-a-predicate';
    const type = domainToType(domain);

    if (!ce.context?.ids?.has(proposition.op1.symbol))
      ce.declare(proposition.op1.symbol, domainToType(domain));

    const def = ce.lookupSymbol(proposition.op1.symbol);
    if (def) {
      if (def.type && !isSubtype(type, def.type)) return 'contradiction';
      def.type = type;
      return 'ok';
    }
    const fdef = ce.lookupFunction(proposition.op1.symbol);
    if (fdef) {
      if (!isSubtype(type, functionResult(fdef.signature)!))
        return 'contradiction';

      return 'ok';
    }
    return 'not-a-predicate';
  }

  // Case 3
  if (undefs.length > 0) {
    ce.assumptions.set(proposition, true);
    return 'ok';
  }

  // Case 4
  const val = proposition.evaluate();
  if (val.symbol === 'True') return 'tautology';
  if (val.symbol === 'False') return 'contradiction';
  return 'not-a-predicate';
}

function hasDef(ce: IComputeEngine, s: string): boolean {
  return (ce.lookupSymbol(s) ?? ce.lookupFunction(s)) !== undefined;
}

function undefinedIdentifiers(expr: BoxedExpression): string[] {
  return expr.symbols.filter((x) => !hasDef(expr.engine, x));
}

function hasValue(ce: IComputeEngine, s: string): boolean {
  if (ce.lookupFunction(s)) return false;
  return ce.lookupSymbol(s)?.value !== undefined;
}
