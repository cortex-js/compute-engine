import { flatten } from './flatten.js';
import { isImaginaryUnit, isOperatorDef } from './utils.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isFunction, isSymbol, isString, isNumber } from './type-guards.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import {
  couldBeNumericTuple,
  isLinearAlgebraCollection,
} from '../collection-utils.js';

const MATRIX_TYPE = new BoxedType('matrix');
const FUNCTION_TYPE = new BoxedType('function');
const LIST_TYPE = new BoxedType('list');

export function canonicalInvisibleOperator(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | null {
  if (ops.length === 0) return null;

  const lhs = ops[0];
  if (ops.length === 1) return lhs.canonical;

  if (ops.length === 2) {
    //
    // Is it an implicit addition/mixed fraction, e.g. "3 1/4"
    // Note: the numerators and denominators are limited to 999
    //
    const lhsInteger = asInteger(lhs);
    if (!Number.isNaN(lhsInteger)) {
      const rhs = ops[1];
      if (
        (rhs.operator === 'Divide' || rhs.operator === 'Rational') &&
        isFunction(rhs)
      ) {
        const [n, d] = [rhs.op1.canonical.re, rhs.op2.canonical.re];
        if (
          n > 0 &&
          n <= 1000 &&
          d > 1 &&
          d <= 1000 &&
          Number.isInteger(n) &&
          Number.isInteger(d)
        ) {
          let frac = rhs.canonical;
          if (lhsInteger < 0) frac = frac.neg();

          return ce._fn('Add', [lhs.canonical, frac]);
        }
      }
    }

    //
    // Is it a complex (imaginary) number, i.e. "2i"?
    //
    const rhs = ops[1];
    if (!Number.isNaN(lhsInteger) && isImaginaryUnit(rhs)) {
      return ce.number(ce.complex(0, lhsInteger));
    }

    //
    // Is it a function application: symbol with a function
    // definition followed by delimiter
    //
    // Note: lhs might be a Subscript (e.g., f_\text{a}) which canonicalizes
    // to a symbol (f_a). Canonicalize first to handle this case.
    const lhsCanon = lhs.canonical;
    if (isSymbol(lhsCanon) && isFunction(rhs, 'Delimiter')) {
      // We have encountered something like `f(a+b)`, where `f` is not
      // defined. But it also could be `x(x+1)` where `x` is a number.
      // So, start with boxing the arguments and see if it makes sense.

      // No arguments, i.e. `f()`? It's definitely a function call.
      if (rhs.nops === 0) {
        const def = ce.lookupDefinition(lhsCanon.symbol);
        if (def) {
          if (isOperatorDef(def)) {
            // It's a known operator, all good (the canonicalization
            // will check the arity)
            return ce.expr([lhsCanon.symbol]);
          }

          if (def.value.type.isUnknown) {
            lhsCanon.infer('function');
            return ce.expr([lhsCanon.symbol]);
          }

          if (def.value.type.matches('function'))
            return ce.expr([lhsCanon.symbol]);

          // Uh. Oh. It's a symbol with a value that is not a function.
          return ce.typeError('function', def.value.type, lhsCanon);
        }
        // Auto-declared function application is a heuristic guess, not an
        // assertion by the user: mark the declaration INFERRED so a later
        // scalar use or `ce.assign(sym, value)` can widen/override it
        // (D11). A genuine function use keeps working — the inferred type
        // still matches `function`.
        ce.declare(lhsCanon.symbol, { type: 'function', inferred: true });
        return ce.expr([lhsCanon.symbol]);
      }

      // Parse the arguments first, in case they reference lhsCanon.symbol
      // i.e. `x(x+1)`.
      let args = isFunction(rhs.op1, 'Sequence') ? rhs.op1.ops : [rhs.op1];
      args = flatten(args);

      const def = ce.lookupDefinition(lhsCanon.symbol);

      // Explicitly declared as function/operator → function call
      if (def && (isOperatorDef(def) || def.value?.type?.matches('function'))) {
        return ce.function(lhsCanon.symbol, args);
      }

      // Multiple comma-separated args like `f(2, 1)` → always a function call,
      // since commas strongly signal function application, not multiplication.
      if (args.length > 1) {
        // Inferred (see above): a heuristic auto-declaration the user can
        // later widen/override.
        if (!def)
          ce.declare(lhsCanon.symbol, { type: 'function', inferred: true });
        else if (!isOperatorDef(def) && def.value?.type?.isUnknown)
          lhsCanon.infer('function');
        return ce.function(lhsCanon.symbol, args);
      }

      // Single arg: check if it's scalar-numeric.
      // If so, prefer multiplication: q(2q) → q·(2q), not q-as-function(2q)
      // Note: we exclude indexed collections (vectors, matrices, tuples)
      // since those as parenthesized args are more likely function arguments.
      const allArgsNumeric = args.every(
        (x) => x.isValid && (x.type.isUnknown || x.type.matches('number'))
      );

      if (allArgsNumeric) {
        return ce.function('Multiply', [lhsCanon, ...args]);
      }

      // The single argument is non-numeric (e.g. a collection like `\cos(S)`
      // where `S` is bound to a list). If the leading symbol is KNOWN to be a
      // NUMERIC value — declared with a numeric type or assigned a number — it
      // cannot be a function application, so the juxtaposition is multiplication
      // (scaling / broadcast over the collection), matching the scalar-arg case
      // above and the multi-operand invisible-multiplication path. Only a
      // numeric value scales a collection: a non-numeric non-function value
      // (e.g. a string) falls through to the function-call route below, which
      // surfaces the actual mistake (an illegal application of a non-function)
      // rather than a `Multiply` whose type error blames multiplication. An
      // undeclared or unknown-typed symbol stays genuinely ambiguous and also
      // falls through. (Tycho item 13: `k(\cos(S))` with `k` a number and `S` a
      // collection parsed as `k` applied — an illegal application of a number —
      // instead of `k·\cos(S)`.)
      if (def && !isOperatorDef(def) && def.value?.type?.matches('number')) {
        return ce.function('Multiply', [lhsCanon, ...args]);
      }

      // Non-numeric args → treat as function call
      // Inferred (see above): a heuristic auto-declaration the user can
      // later widen/override.
      if (!def)
        ce.declare(lhsCanon.symbol, { type: 'function', inferred: true });
      else if (!isOperatorDef(def) && def.value?.type?.isUnknown)
        lhsCanon.infer('function');
      return ce.function(lhsCanon.symbol, args);
    }

    // Is is an index operation, i.e. "v[1,2]"?
    if (
      isSymbol(lhsCanon) &&
      rhs.operator === 'Delimiter' &&
      isFunction(rhs) &&
      isString(rhs.op2) &&
      (rhs.op2.string === '[,]' || rhs.op2.string === '[;]')
    ) {
      const args = isFunction(rhs.op1, 'Sequence') ? rhs.op1.ops : [rhs.op1];
      return ce.function('At', [lhsCanon, ...args]);
    }
  }

  // Lift any nested invisible operators
  // (we do it explicitly here instead of via flatten to avoid
  //  boxing the arguments)
  ops = flattenInvisibleOperator(ops);

  // Text promotion: if any operand is a Text expression or a string,
  // absorb all operands into a single Text. This handles cases like
  // `a \text{ hello } b` where InvisibleOperator wraps math + text,
  // but the semantically correct result is a single Text flow.
  if (ops.some((op) => isFunction(op, 'Text') || isString(op))) {
    const runs: Expression[] = [];
    for (const op of ops) {
      if (isFunction(op, 'Text')) {
        // Flatten Text's inner runs into the parent
        runs.push(...op.ops);
      } else if (op.operator !== 'HorizontalSpacing') {
        runs.push(op.canonical);
      }
    }
    return ce._fn('Text', runs);
  }

  // Combine adjacent (function-symbol, Delimiter) pairs into function
  // applications. This handles cases like `2f \left(x\right)` where
  // the space causes the parser to produce [2, f, Delimiter(x)]
  // instead of [2, f(x)].
  ops = combineFunctionApplications(ce, ops);

  //
  // Is it a number juxtaposed with a tagged unit expression?
  // e.g. `12\,\mathrm{cm}` or `9.8\,\mathrm{m/s^2}`
  //
  // The unit expression handler in definitions-units.ts wraps recognised
  // units in `['__unit__', unitExpr]`.  We check BEFORE `flatten` because
  // flatten canonicalizes, which would strip the __unit__ wrapper.
  //
  // Filter out HorizontalSpacing (visual-space like `\,`) which
  // canonicalizes to Nothing but hasn't been flattened away yet.
  //
  {
    const significant = ops.filter((x) => x.operator !== 'HorizontalSpacing');
    if (significant.length === 2) {
      const [a, b] = significant;
      // A magnitude is a bare number or a measurement `a ± b`.  A parenthesised
      // measurement — `(5.1\pm0.2)\,\mathrm{cm}` — arrives wrapped in a
      // single-argument `Delimiter`, so look through it.
      const unwrap = (x: typeof a) =>
        isFunction(x, 'Delimiter') && x.nops === 1 ? x.op1 : x;
      const isMagnitude = (x: typeof a) => {
        const u = unwrap(x);
        return isNumber(u) || isFunction(u, 'Measurement');
      };
      if (isMagnitude(a) && isFunction(b, '__unit__')) {
        return ce._fn('Quantity', [unwrap(a).canonical, b.op1.canonical]);
      }
      if (isMagnitude(b) && isFunction(a, '__unit__')) {
        return ce._fn('Quantity', [unwrap(b).canonical, a.op1.canonical]);
      }
    }
  }

  //
  // Purely visual horizontal spacing (`\,`, `\;`, `\quad`, …) carries no
  // mathematical meaning. The unit/quantity check above needs these operands
  // (e.g. `12\,\mathrm{cm}`), but past this point they are noise: drop them.
  // If a single significant operand remains, the invisible operator is a
  // no-op — this prevents a trailing space from wrapping the expression in a
  // spurious single-element Tuple (e.g. `\operatorname{hsv}(1,1,1)\,`).
  //
  {
    const significant = ops.filter((x) => x.operator !== 'HorizontalSpacing');
    if (significant.length !== ops.length) {
      if (significant.length === 0) return null;
      if (significant.length === 1) return significant[0].canonical;
      ops = significant;
    }
  }

  // Only call flatten here, because it will bind (auto-declare) the arguments
  ops = flatten(ops);

  //
  // Is it an invisible multiplication?
  // (are all argument numeric or indexable collections?)
  //
  // A `Matrix(…)` operand is matched explicitly so that juxtaposed matrices
  // (e.g. `\begin{pmatrix}…\end{pmatrix}\begin{pmatrix}…\end{pmatrix}`) and
  // scalar·matrix (`2\begin{pmatrix}…\end{pmatrix}`) become a `Multiply` (the
  // matrix product / scaling) rather than a `Tuple`. The `Matrix(…)` wrapper —
  // which `Vector(…)` also canonicalizes to — reports
  // `isIndexedCollection === false`, so the collection test below misses it
  // (raw `List` vectors/matrices are caught by that test).
  //
  if (
    ops.every(
      (x) =>
        x.isValid &&
        (x.type.isUnknown ||
          x.type.type === 'any' ||
          x.type.type === 'expression' ||
          // `value` is the widest value type — a supertype spanning BOTH
          // scalars and collections (see VALUE_TYPES in common/type). A
          // symbol typed `value` (e.g. inferred from a `(value*)` signature
          // such as `Max`/`Min`) is NOT evidence of collection/point-ness: it
          // carries no constraint at all. Like `any`/`expression`/`unknown`
          // above, the charitable default for juxtaposition is multiplication,
          // not a silent `Tuple`. Concrete collection/tuple operands are still
          // caught by `isLinearAlgebraCollection`/`couldBeNumericTuple`/
          // `isIndexedCollection` below.
          x.type.type === 'value' ||
          x.type.matches('number') ||
          // A `broadcastable<…>`-typed operand — arithmetic over an
          // unknown-return call, e.g. `(2h(x)-1)` with `h: (number) ->
          // unknown` — is a number OR an indexed collection of numbers
          // (see the `Add`/`Multiply` type handlers). Juxtaposition is
          // multiplication in the scalar case and scaling in the collection
          // case, never a silent `Tuple`.
          (typeof x.type.type !== 'string' &&
            x.type.type.kind === 'broadcastable') ||
          // Matrix-typed symbols (`M P` → matrix product) and function-typed
          // symbols (`2f`, `f x` → scaled/product) are value-like operands:
          // juxtaposition is multiplication, not a silent `Tuple`.
          x.type.matches(MATRIX_TYPE) ||
          x.type.matches(FUNCTION_TYPE) ||
          // List/vector-typed operands (e.g. `2v` with `v: vector<3>`, or a
          // still-unevaluated `2\frac{[1,2,3]}{8}` whose scaled numerator has
          // type `vector<3>`/`list<number>`) are value-like: juxtaposition is
          // scaling, not a silent `Tuple`. The runtime `isIndexedCollection`
          // test below only catches operands that are already concrete
          // collections (raw `List`), so match the value type here as well.
          // `list` deliberately excludes heterogeneous `tuple` and `set`.
          x.type.matches(LIST_TYPE) ||
          // A symbol *declared* with an abstract `indexed_collection` /
          // `collection` type but not yet assigned a value (e.g. Tycho's
          // importer head-pre-pass, which derives `indexed_collection` for a
          // List/Range value) is still a value-like operand: juxtaposition is
          // scaling, not a silent `Tuple`. This is the same predicate the
          // `Add`/`Multiply` type handlers use, so the invisible-operator
          // decision stays consistent with them. It deliberately EXCLUDES
          // `tuple` kinds — numeric tuples are handled by `couldBeNumericTuple`
          // just below, and heterogeneous tuples must stay a `Tuple` — and
          // `set` (no scaling semantics).
          isLinearAlgebraCollection(x) ||
          // Numeric-tuple-typed operands (points/vectors in ℝⁿ, e.g. `3z`
          // with `z: tuple<number, number>`) are value-like: juxtaposition
          // is scaling. Literal tuples are already caught by the
          // `isIndexedCollection` test below; this covers tuple-typed
          // symbols and unevaluated tuple-typed expressions — with
          // COULD-semantics, so a tuple whose elements type `unknown`
          // (e.g. `PointList(S(x,y,0), S(x,y,1))` with `S: (…) -> unknown`,
          // typed `tuple<unknown, unknown>` and NOT an indexed collection)
          // is scaling too, not a silent nested `Tuple` (Tycho item 30).
          // Heterogeneous tuples (e.g. `tuple<string, number>`) still group
          // as `Tuple`.
          couldBeNumericTuple(x) ||
          isFunction(x, 'Matrix') ||
          (x.isIndexedCollection && !isString(x)))
    )
  ) {
    // Note: we don't want to use canonicalMultiply here, because
    // invisible operator canonicalization should not affect multiplication,
    // i.e. `1(2+3)` should not be simplified to `2+3`.
    //
    return ce._fn('Multiply', ops);
  }

  //
  // If some of the elements are not numeric (or of unknown domain)
  // group them as a Tuple
  //
  return ce._fn('Tuple', ops);
}

function flattenInvisibleOperator(
  ops: ReadonlyArray<Expression>
): Expression[] {
  const ys: Expression[] = [];
  for (const x of ops) {
    if (isFunction(x, 'InvisibleOperator'))
      ys.push(...flattenInvisibleOperator(x.ops));
    else ys.push(x);
  }
  return ys;
}

/**
 * Scan for adjacent (symbol, Delimiter) pairs where the symbol is a known
 * function, and combine them into function applications.
 *
 * For example, [2, f, Delimiter(x)] → [2, f(x)] when f is declared as
 * a function.  This handles cases like `2f \left(x\right)` where a
 * space between the function name and `\left` prevents the parser from
 * recognising the function call.
 */
function combineFunctionApplications(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression[] {
  const result: Expression[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (
      i < ops.length - 1 &&
      isSymbol(op) &&
      isFunction(ops[i + 1], 'Delimiter')
    ) {
      const symName = op.symbol;
      const def = ce.lookupDefinition(symName);
      const delim = ops[i + 1] as Expression & {
        op1: Expression;
        ops: ReadonlyArray<Expression>;
      };

      // Already declared as function/operator → function call
      if (def && (isOperatorDef(def) || def.value?.type?.matches('function'))) {
        let args: ReadonlyArray<Expression> = delim.op1
          ? isFunction(delim.op1, 'Sequence')
            ? delim.op1.ops
            : [delim.op1]
          : [];
        args = flatten(args);
        result.push(ce.function(symName, args));
        i += 2;
        continue;
      }

      // Undeclared symbol with multiple comma-separated args → auto-declare
      // as function (mirrors the 2-operand path behavior at line 106-111)
      if (delim.op1 && isFunction(delim.op1, 'Sequence')) {
        let args: ReadonlyArray<Expression> = delim.op1.ops;
        args = flatten(args);
        if (args.length > 1) {
          // Inferred: a heuristic auto-declaration the user can later
          // widen/override (D11).
          if (!def) ce.declare(symName, { type: 'function', inferred: true });
          else if (!isOperatorDef(def) && def.value?.type?.isUnknown)
            op.canonical.infer('function');
          result.push(ce.function(symName, args));
          i += 2;
          continue;
        }
      }
    }
    result.push(ops[i]);
    i++;
  }
  return result;
}

function asInteger(expr: Expression): number {
  if (isNumber(expr)) {
    const n = expr.re;
    if (Number.isInteger(n)) return n;
  }
  if (isFunction(expr, 'Negate')) {
    const n = asInteger(expr.op1);
    if (!Number.isNaN(n)) return -n;
  }
  return Number.NaN;
}
