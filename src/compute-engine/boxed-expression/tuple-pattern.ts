import type { Expression } from '../global-types.js';
import { parseType } from '../../common/type/parse.js';
import {
  isAbsentSymbol,
  isDictionary,
  isFunction,
  isString,
  isSymbol,
  sym,
} from './type-guards.js';

/**
 * The statement that the block operand `op` holds. A return-type annotation
 * of a function literal moves onto the last statement of its body, so that
 * statement is `Typed(statement, type)`
 * (`canonicalFunctionLiteralArguments()`, `function-utils.ts`). The type does
 * not change which names the statement declares or assigns, so the loops of
 * `canonicalBlock()` (`control-structures.ts`) that find the block locals,
 * and the free-variable walk of a block, read through the wrapper.
 * Without this, `function f() -> integer { x = 2 }` did not make `x` a local
 * of the body, and its write was a `scope` write.
 */
export function typedStatement(op: Expression): Expression {
  return isFunction(op, 'Typed') ? op.op1 : op;
}

/** The names that the block statement `op` declares: the target of a
 * `Declare` or an `Assign` (each leaf of a destructuring pattern, without
 * the `_` positions, which bind nothing), or the name of a
 * `DefineFunction`. A statement wrapped in `Typed` declares the names of
 * the statement it holds (`typedStatement()`). Another statement, or another
 * target (a `Subscript` or a property store), declares no name. */
export function statementDeclaredNames(op: Expression): string[] {
  const statement = typedStatement(op);
  if (isFunction(statement, 'DefineFunction')) {
    const name = sym(statement.ops[0]);
    return name === undefined ? [] : [name];
  }
  if (!isFunction(statement, 'Declare') && !isFunction(statement, 'Assign'))
    return [];
  const target = statement.ops[0];
  if (isFunction(target, 'Tuple')) return tuplePatternNames(target);
  const name = sym(target);
  return name === undefined ? [] : [name];
}

/**
 * The initial value of the `Declare` with the operands `args` (not
 * canonical) when the declaration states no type: the positional value
 * (`Declare(f, "unknown", v)`) or the `value` entry of an attributes
 * dictionary read from its raw pairs (`let f = v`). Otherwise `undefined`.
 */
function rawDeclaredValue(
  args: ReadonlyArray<Expression>
): Expression | undefined {
  const statesNoType = (op: Expression | undefined): boolean =>
    op === undefined ||
    (isString(op) && op.string === 'unknown') ||
    isSymbol(op, 'unknown');
  if (args.length >= 3) return statesNoType(args[1]) ? args[2] : undefined;
  const dict = args[1];
  if (isDictionary(dict))
    return statesNoType(dict.get('type')) ? dict.get('value') : undefined;
  if (!isFunction(dict, 'Dictionary')) return undefined;
  let value: Expression | undefined;
  let type: Expression | undefined;
  for (const pair of dict.ops) {
    if (!isFunction(pair) || pair.ops.length !== 2) continue;
    const key = isString(pair.ops[0]) ? pair.ops[0].string : sym(pair.ops[0]);
    if (key === 'value') value = pair.ops[1];
    else if (key === 'type') type = pair.ops[1];
  }
  return statesNoType(type) ? value : undefined;
}

/**
 * A declaration reads the outer binding of its own target in an eager
 * initializer. The body of a function initializer reads the new local.
 */
export function declarationReadsOuterNames(
  args: ReadonlyArray<Expression>
): boolean {
  return (
    !isFunction(args[2], 'Function') &&
    !isFunction(rawDeclaredValue(args), 'Function')
  );
}

/**
 * Every name a destructuring `Tuple` pattern binds, in pattern order: the
 * pattern's leaf symbols, nested patterns included, with the `_` positions —
 * which bind nothing — dropped.
 */
export function tuplePatternNames(pattern: Expression): string[] {
  const names: string[] = [];
  const walk = (p: Expression): void => {
    if (isFunction(p, 'Tuple')) {
      for (const el of p.ops) walk(el);
      return;
    }
    const n = sym(p);
    if (n !== undefined && n !== '_') names.push(n);
  };
  walk(pattern);
  return names;
}

/**
 * Match a destructuring `Tuple` pattern against a value, returning the
 * `(name, value)` pairs to bind — in pattern order, `_` positions dropped — or
 * an `Error` value if the shapes do not match.
 *
 * The pattern is irrefutable in FORM (a raw `Tuple` of bare symbols, `_`, or
 * nested tuple patterns), so the only way to fail is a runtime SHAPE mismatch:
 * the value is not a tuple, or its arity differs from the pattern's. A tuple is
 * required specifically — an indexed collection of the right length does NOT
 * destructure (the rule `let (a, b) = v` established, 2026-08-07).
 *
 * The ENTIRE tree is matched here, before the caller binds anything: a mismatch
 * nested under an already-matched sibling — `(a, (b, c))` against `(1, 5)` —
 * must not leave `a` bound. (It did when matching and binding shared one pass:
 * the nested level's shape was only checked once the walk reached it.)
 *
 * Shared by the three destructuring routes so they report the SAME error for
 * the same mismatch: the `let (x, y) = v` declaration and the `(x, y) := v`
 * assignment (`Declare`/`Assign`, `library/core.ts`), and a lambda's
 * destructuring parameter (`((p, q)) => …`, bound by `makeLambda` in
 * `function-utils.ts`).
 */
export function collectTuplePattern(
  pattern: Expression,
  v: Expression,
  out: [name: string, value: Expression][]
): Expression | null {
  const ce = pattern.engine;
  if (!isFunction(pattern, 'Tuple'))
    return ce.typeError('tuple', pattern.type, pattern.toString());
  // Destructuring a missing whole value binds every leaf to Missing, just
  // as destructuring a present tuple with missing coordinates does.
  if (isAbsentSymbol(v)) {
    for (const p of pattern.ops) {
      if (isFunction(p, 'Tuple')) {
        const err = collectTuplePattern(p, v, out);
        if (err) return err;
        continue;
      }
      const name = sym(p);
      if (!name) return ce.typeError('symbol', p.type, p.toString());
      if (name === '_') continue;
      out.push([name, ce.Missing]);
    }
    return null;
  }
  if (!isFunction(v, 'Tuple')) {
    // A value whose type is a tuple type but that is not a `Tuple` did not
    // evaluate: `SVD` of an exact matrix stays `SVD(…)` until `N`. A type
    // error would read "expected `tuple`, got `tuple<…>`". An arity that
    // the type already shows to be wrong is the arity error below, which
    // holds whatever the value becomes. The payload names the operator of
    // an application, the only kind of value that `N` can make a tuple.
    if (v.type.matches('tuple')) {
      const t = v.type.type;
      const arity =
        typeof t === 'object' && t.kind === 'tuple'
          ? t.elements.length
          : undefined;
      if (arity === undefined || arity === pattern.nops)
        return ce.error(
          isFunction(v)
            ? ['unevaluated-tuple', v.operator]
            : ['unevaluated-tuple'],
          v.toString()
        );
      return arityError(pattern.nops, v);
    }
    return ce.typeError('tuple', v.type, v.toString());
  }
  if (v.nops !== pattern.nops) return arityError(pattern.nops, v);
  for (let i = 0; i < pattern.nops; i++) {
    const p = pattern.ops[i];
    const el = v.ops[i];
    if (isFunction(p, 'Tuple')) {
      const err = collectTuplePattern(p, el.evaluate(), out);
      if (err) return err;
      continue;
    }
    const name = sym(p);
    if (!name) return ce.typeError('symbol', p.type, p.toString());
    if (name === '_') continue;
    out.push([name, el]);
  }
  return null;
}

/** The error of a tuple value `v` whose arity is not `arity`, the arity of
 * the pattern. */
function arityError(arity: number, v: Expression): Expression {
  return v.engine.typeError(
    parseType(`tuple<${Array(arity).fill('unknown').join(', ')}>`)!,
    v.type,
    v.toString()
  );
}
