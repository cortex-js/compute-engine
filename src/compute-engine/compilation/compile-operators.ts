// Operator expressions: compileExprOperator, shadowed library lowerings, and
// the head tables that decide real-only and complex-propagating operators.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { broadcastsOverTuples } from '../boxed-expression/boxed-function.js';
import { lookupApplicable } from '../function-utils.js';
import { isTuple, isTupleOrTupleUnionShapedType } from '../collection-utils.js';
import {
  collectionElementType,
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  isInequalityOperator,
  isRelationalOperator,
} from '../latex-syntax/utils.js';
import { machineRangeCountDiffers } from '../library/range-closed-form.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { multiClauseState } from '../multi-clause.js';
import type { CompileTarget, TargetSource } from './types.js';
import { candidateAt, isCallerMapped, type CseHarvestOptions } from './cse.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { shadowedLibraryLoweringError } from './compile-definitions.js';
import {
  ELEMENTWISE_TUPLE_EXEMPT_HEADS,
  LOGICAL_BROADCAST_HEADS,
  NAMED_LOWERING_HEADS,
  REPEATABLE_SOURCE,
  WORD_KEYWORD_OPERATORS,
} from './compiler-tables.js';
import {
  declaredScalarTupleCall,
  tryCompileLocalFunctionCall,
} from './compile-user-functions.js';
import {
  compilationType,
  couldBeCollectionParticipant,
  exactRationalDivisor,
  isBoundPossiblyCollectionTyped,
  isGatedIndexedCollection,
  isMixedStringOrderingParticipants,
  isProvablyCharacterOperand,
  isProvablyStringOperand,
  unfaithfulComparisonAggregate,
} from './compiler-type-facts.js';
import { core } from './compiler-core-hooks.js';
import { _codeOverrides } from './compiler-mode.js';
import {
  canHoist,
  compileValueOperand,
  hoistStatement,
} from './compile-statements.js';
import { availableCseBinding, compileOpValue } from './compile-cse.js';
import { tempVar } from './compiler-naming.js';
import { isCompileBoundName, mentionsExcludedName } from './compiler-names.js';
import { cseRegionOf } from './compile-conditions.js';

/**
 * Statically splice `Spread` operands (`f(...p)`) into the call's argument
 * list. A literal tuple splices directly; a symbolic argument whose STATIC
 * type is a tuple of known arity n rewrites to n positional `At` accesses
 * (`f(At(p,1), …, At(p,n))`). An argument whose arity is not statically
 * known fails closed: the compiled code could not re-validate the
 * arity the interpreter enforces at splice time (a JS/Python dynamic
 * spread would silently mis-bind on a mismatch instead of erroring).
 */
export function spliceSpreadOperands(expr: Expression): Expression {
  if (!isFunction(expr)) return expr;
  const ce = expr.engine;
  const ops: Expression[] = [];
  for (const x of expr.ops) {
    if (x.operator !== 'Spread' || !isFunction(x) || x.nops !== 1) {
      ops.push(x);
      continue;
    }
    // A lazy parent (e.g. `Add`'s canonical handler) holds its operands
    // raw, so the Spread's argument may be unbound here — `.canonical` is
    // value-safe (binds structure, does not substitute assigned values)
    // and is required to read the declared type.
    const arg = x.op1.canonical;
    if (isFunction(arg, 'Tuple')) {
      ops.push(...arg.ops);
      continue;
    }
    // The arity is read through a transparent type ALIAS but NOT through a
    // nominal type, so `resolveTypeAlias` is the right resolver here and
    // `compilationType` is not: this gate asks what may be spliced, an
    // admissibility question, rather than what the layout is. A nominal type
    // is deliberately not a subtype of the tuple it names, so `At` rejects an
    // operand carrying the tag; unfolding the tag here spliced anyway and
    // built `f(At(Error(incompatible-type, …), 1), …)`, and the compiler then
    // reported that error node instead of the decline below. The interpreter
    // does not splice a nominal value either — it leaves the call symbolic.
    const t = resolveTypeAlias(arg.type.type);
    if (typeof t !== 'string' && t.kind === 'tuple') {
      for (let i = 1; i <= t.elements.length; i++)
        ops.push(ce.function('At', [arg, ce.number(i)]));
      continue;
    }
    throw new Error(
      `Could not compile \`Spread\`: the argument's tuple arity is not ` +
        `statically known (type '${arg.type.toString()}'). Annotate it ` +
        `with a tuple type, or evaluate first.`
    );
  }
  return ce.function(expr.operator, ops);
}

/**
 * The first `shadowedLibraryLoweringError()` of a head in `expr`, or
 * `undefined`. The walk also reads the user functions that the compiled
 * code reaches by name: the body of a function literal (the value of a
 * symbol, or the definition of an operator) and each clause of a
 * multi-clause function. Each name is read once. Other symbol values are
 * not read: the compiler compiles such a value as an expression, through
 * `_compileInner`, which checks each node.
 *
 * The walk also declines a `Range` whose operands are exact rationals
 * (number literals, or constant expressions such as `10^400`) when the
 * machine count of its elements, which compiled code uses, is not the
 * count of the interpreter (`machineRangeCountDiffers()`,
 * `library/range-closed-form.ts`): `Range(0, 9999999999999/10^12, 1)` has
 * 10 elements, and compiled code would count 11.
 */
export function findShadowedLibraryLowering(
  expr: Expression,
  target: CompileTarget<Expression>
): string | undefined {
  const engine = expr.engine;
  const heads = new Map<string, string | undefined>();
  const names = new Set<string>();
  const seen = new Set<Expression>();
  const viaName = (s: string): string | undefined => {
    if (names.has(s)) return undefined;
    names.add(s);
    const literal = userFunctionLiteral(engine, s);
    if (literal !== undefined) {
      const found = visit(literal);
      if (found !== undefined) return found;
    }
    const clauses = multiClauseState(engine.lookupDefinition(s))?.clauses;
    for (const clause of clauses ?? []) {
      const found = visit(clause.literal);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const visit = (e: Expression): string | undefined => {
    if (isSymbol(e)) return viaName(e.symbol);
    if (isDictionary(e)) {
      for (const v of e.values) {
        const found = visit(v);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!isFunction(e) || seen.has(e)) return undefined;
    seen.add(e);
    const h = e.operator;
    if (!heads.has(h))
      heads.set(h, shadowedLibraryLoweringError(engine, h, target));
    const error = heads.get(h);
    if (error !== undefined) return error;
    if (
      h === 'Range' &&
      machineRangeCountDiffers(
        e,
        (s) =>
          target.varsKeys?.has(s) === true || target.boundVars?.has(s) === true
      )
    )
      return (
        `Could not compile \`Range\`: its operands are exact rationals, ` +
        `and the interpreter counts its elements exactly, but compiled ` +
        `code counts them in machine arithmetic, which gives a different ` +
        `count. The interpreter evaluates it instead.`
      );
    for (const op of e.ops) {
      const found = visit(op);
      if (found !== undefined) return found;
    }
    return viaName(h);
  };
  return visit(expr);
}

/**
 * A call whose head has the name of a library operator that the compiler
 * lowers (`Ln` → `Math.log`, `Sin` → `Math.sin`), where the name is bound
 * in this compilation: a block local (`Declare(Ln, "function")`,
 * `Assign(Ln, t ↦ t + 1)`), or a parameter of an enclosing function
 * literal (`(Ln, y) ↦ Ln(y)`). The interpreter calls the binding, so the
 * call must not be lowered as the library operator. `shadowedLibraryLoweringError()`
 * does not see these bindings: it reads the scope chain of the engine, and
 * a compilation does not enter its bindings there.
 *
 * The call compiles as a call of the block-local function
 * (`tryCompileLocalFunctionCall`). It declines, with the reason, when the
 * target has no such route: a parameter, a block local that is not bound
 * to a function literal, or a target that does not bind a block-local
 * function as a value (the shader and Python targets).
 *
 * `undefined` when the head is not such a name.
 */
export function compileLocallyBoundLibraryCall(
  expr: Expression & FunctionInterface,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  const h = expr.operator;
  const lowered = (name: string): boolean =>
    NAMED_LOWERING_HEADS.has(name) ||
    target.functions?.(name) !== undefined ||
    target.operators?.(name) !== undefined;
  // A target that inlines `Apply(literal, …args)` by substitution (the
  // shader targets) replaces each parameter where it is a value, not where
  // it is the head of a call: `Apply((Sin, y) ↦ Sin(y), t ↦ t + 1, x)`
  // became `sin(x)`. The body is never compiled with the parameters bound,
  // so the test below cannot see them. Decline here, on every target.
  if (h === 'Apply' && isFunction(expr.ops[0], 'Function')) {
    const literal = expr.ops[0];
    const heads = new Set<string>();
    const walk = (e: Expression): void => {
      if (!isFunction(e)) return;
      heads.add(e.operator);
      for (const op of e.ops) walk(op);
    };
    walk(literal.ops[0]);
    for (const p of literal.ops.slice(1)) {
      const name = functionLiteralParameterName(p);
      if (name && heads.has(name) && lowered(name))
        throw new Error(
          `Could not compile \`${expr.toString()}\`: the parameter ` +
            `\`${name}\` of the function is called in its body, and ` +
            `\`${name}\` is also the name of a library operator. The ` +
            `interpreter calls the argument, and the compiled code would ` +
            `call the library operator.`
        );
    }
  }
  // Only a name that a `Declare` of an enclosing block or a parameter
  // binds. A block that assigns a library name with no `Declare` writes
  // the global binding, and the interpreter then still calls the library
  // operator.
  if (target.boundVars?.has(h) !== true || !lowered(h)) return undefined;
  const decline = (why: string): never => {
    throw new Error(
      `Could not compile \`${expr.toString()}\`: \`${h}\` is bound in ` +
        `this compilation (a block local or a parameter), and the ` +
        `interpreter calls that binding, not the library operator ` +
        `\`${h}\`. ${why}`
    );
  };
  // A tuple argument at a parameter declared as a scalar maps the call
  // over the components (`declaredScalarTupleCall`). That rewrite and the
  // binding of its arguments are made for the ordinary call route only.
  if (declaredScalarTupleCall(expr.engine, h, expr.ops, target) !== undefined)
    decline(
      'The call maps over a tuple argument, which this route does not compile.'
    );
  const local = tryCompileLocalFunctionCall(h, expr.ops, target);
  if (local !== undefined) return local;
  return decline(
    `Target '${target.language ?? 'javascript'}' has no lowering for a ` +
      `call of this binding.`
  );
}

/**
 * An operator of the target (`+`, `*`, `**`, …). A case of `compileExpr`: it
 * returns the code, or `undefined` when `compileExpr` continues with its next
 * case.
 */
export function compileExprOperator(
  h: string,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>,
  node: Expression | undefined,
  op: [string, number] | undefined,
  realPythonPower: boolean
): TargetSource | undefined {
  if (op !== undefined && !realPythonPower) {
    // Skip infix operators for complex operands — fall through to function
    // dispatch. An operand the D2 runtime rule has bound to a real
    // projection (`_codeOverrides`) is real here.
    const hasComplex = args.some(
      (a) => core.isComplexValued(a) && !_codeOverrides.has(a)
    );
    if (!hasComplex) {
      // Check if this looks like a function name rather than an operator.
      // Function names are alphanumeric identifiers, operators are symbols.
      // A word-spelled *keyword* operator (Python `and`/`or`/`not`) is
      // alphabetic but still infix/prefix — never a function call — so it is
      // excluded here (otherwise `And(a, b)` would emit `and(a, b)`).
      const isFunction =
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(op[0]) &&
        !WORD_KEYWORD_OPERATORS.has(h);
      // A word-spelled operator needs a separating space between the keyword
      // and its operand (`not x`, `a and b`); a symbolic one does not (`!x`,
      // `a && b`).
      const isWordOp = /^[a-zA-Z_]/.test(op[0]);

      if (isFunction) {
        // Compile as a function call (works for both scalar and collection arguments)
        return `${op[0]}(${args
          .map((arg) => compileValueOperand(arg, target))
          .join(', ')})`;
      } else {
        // A relational or logical head whose operand is merely
        // collection-TYPED must not take the raw infix path. `.isCollection`
        // is false for a computed `list<real>` (e.g. `|L - k|`, or
        // `Power(L, 2)`), so the check below lets it through and emits
        // `0 < X` — which, when `X` is an array at run time, stringifies it
        // (`0 < "1,0,1"`) and returns a silent scalar `false` behind a
        // `success: true`. The connectives are worse: a JS array is TRUTHY,
        // so `m1 && m2` yields a whole operand and `!m` yields `false`.
        // Decline here so the head falls through to function codegen, which
        // fails closed (`compileJSCollectionBoolean`) and lets the engine
        // fall back to the interpreter. `Equal`/`NotEqual` are unaffected:
        // they have no infix mapping and always reach their own codegen,
        // which already handles collection operands.
        //
        // JAVASCRIPT ONLY, so that other targets keep their existing
        // lowering unchanged: this diverts to a JS-specific handler, and the
        // hazard being avoided is a JS coercion rule.
        // A STRING operand is exempt from this divert: it matches
        // `collection` in the lattice (its elements are its grapheme
        // clusters) but lowers to a JS string, which the infix `<`/`===`
        // compares exactly as the interpreter does — the coercion hazard
        // this divert guards against does not arise.
        // A GATED collection (a restricted point or list, typed
        // `missing | C`) is an array at run time too: without it,
        // `Less(When((t, 1), c), 3)` emitted `[…] < 3`, a plain `false`
        // where the interpreter leaves the comparison of a point inert.
        const relationalOverCollection =
          target.language === 'javascript' &&
          (isRelationalOperator(h) || LOGICAL_BROADCAST_HEADS.has(h)) &&
          args.some(
            (x) =>
              !isProvablyStringOperand(x) &&
              (x.type.matches('collection<any>') ||
                isGatedIndexedCollection(x) ||
                isBoundPossiblyCollectionTyped(x))
          );
        // An ORDERING that MIXES a string operand with one that is not
        // provably a string. The raw infix `<` agrees with the interpreter
        // when EVERY operand is a string — it compares strings with `<` too
        // (`compare.ts`) — so an all-string ordering keeps this fast path. A
        // mixed pair does not agree: the interpreter leaves `Less("a", 1)`
        // symbolic whereas `"a" < 1` is a plausible-looking `false`. Decline
        // the infix path there so the head falls through to the JS ordering
        // codegen, which fails closed and lets the engine fall back to
        // the interpreter. An operand of unknown type alongside a string is
        // POSSIBLY mixed and declines too.
        //
        // JAVASCRIPT ONLY, like the collection divert above: the other
        // targets keep their existing lowering. `isSubtype`, not `.matches`,
        // so an `unknown`-typed operand is never itself string EVIDENCE (plot
        // comparisons with inferred parameters keep byte-identical output).
        //
        // Tested per PARTICIPANT, not per operand, and with the same pair of
        // predicates as the broadcast gate below: an operand that is a
        // broadcast SOURCE puts its elements on the scalar path, so a
        // `broadcastable<string>`-typed operand alongside a number is mixed
        // even though the operand's own type is not a subtype of `string`
        // (`Less(1, L)` compiled to `[false, false]` where the interpreter
        // leaves both comparisons inert).
        //
        // A BINARY ALL-STRING ordering diverts as well, even though it is
        // ADMITTED: the JavaScript ordering codegen emits the same infix
        // comparison, but with each operand first put through the ingress
        // conditioning the interpreter applies when it boxes a string (NFC
        // normalization, then the lone-surrogate replacement — `_SYS.ct`).
        // The interpreter compares content that was conditioned at boxing
        // time, so a raw infix comparison of a decomposed `"e" + U+0301`
        // bound to a string parameter against a precomposed `"é"` literal
        // disagrees with it. Maintainer ruling, 2026-08-16. A CHAINED
        // all-string ordering deliberately stays on the infix path here: the
        // chain lowering below binds temporaries so each operand is
        // evaluated exactly once and the comparisons short-circuit, and the
        // binary arm in `compileJSCollectionBoolean` reproduces neither — so
        // a chain keeps comparing un-conditioned operands.
        const orderingOverString =
          target.language === 'javascript' &&
          isRelationalOperator(h) &&
          (isMixedStringOrderingParticipants(args) ||
            (isInequalityOperator(h) &&
              args.length === 2 &&
              args.every(isProvablyStringOperand)));
        // PYTHON, the same two divert rules as the ordering gates on that
        // target (`assertPyNoMixedStringOrdering` /
        // `assertPyComparableAggregate`, python-target.ts): an ordering whose
        // participants mix string evidence with something not provably a
        // string, or whose participant is an unfaithful AGGREGATE, must not
        // take the infix `<`. A mixed pair emits `"a" < 1` — a
        // plausible-looking boolean where the interpreter stays symbolic —
        // and an aggregate emits `p < q` / `d1 < d2`, which Python answers
        // lexicographically (or raises) where the interpreter leaves the
        // comparison inert. Declining here lets the head fall through to
        // `compilePythonRelation`, which fails closed with the
        // diagnostic. An ALL-string ordering keeps the fast path: `"a" < "b"`
        // is the interpreter's own string comparison (probe-verified,
        // chains included).
        //
        // A participant that is merely collection-TYPED diverts too, with the
        // same STATIC evidence the JS collection divert above uses: the
        // `!x.isCollection` admission below is blind to an unassigned
        // collection-typed symbol, so `Less(sl1, sl2)` over two
        // `list<string>` parameters emitted the infix `sl1 < sl2` — ONE
        // lexicographic Python bool where the interpreter answers a list of
        // booleans (and the flat-all-string exemption let it straight
        // through). `compilePythonRelation` emits the element-wise
        // `np.less(sl1, sl2)` for the admitted shapes and D6-declines the
        // gated ones.
        const pyOrderingUnfaithful =
          target.language === 'python' &&
          isRelationalOperator(h) &&
          (args.some((x) => unfaithfulComparisonAggregate(x) !== null) ||
            args.some(
              (x) =>
                // A string operand is exempt — see the JavaScript divert
                // above. Python's `<` on `str` is the interpreter's own
                // string comparison.
                !isProvablyStringOperand(x) &&
                (x.type.matches('collection<any>') ||
                  isBoundPossiblyCollectionTyped(x))
            ) ||
            isMixedStringOrderingParticipants(args));
        // PYTHON, a logical connective (`And`, `Or`, `Not`) with an operand
        // that is, or may be, a collection. The infix `and`/`or`/`not` reads
        // the truthiness of a Python list, so `And(L, True)` for
        // `L: list<boolean>` emitted `L and True` and answered `True` where
        // the interpreter answers the element-wise `[True, False]`.
        // Declining here lets the head fall through to its function form
        // (`compilePythonLogical`, python-target.ts), which broadcasts a
        // provable list of booleans and fails closed for every other shape.
        // CE-278.
        const pyConnectiveOverCollection =
          target.language === 'python' &&
          LOGICAL_BROADCAST_HEADS.has(h) &&
          args.some(
            (x) =>
              !isProvablyStringOperand(x) &&
              (x.type.matches('collection<any>') ||
                isGatedIndexedCollection(x) ||
                isBoundPossiblyCollectionTyped(x) ||
                couldBeCollectionParticipant(x))
          );
        // An ORDERING with a CHARACTER participant, on EVERY target. The
        // interpreter orders two characters by their NFC CODE-POINT sequence
        // (`compare.ts`), whereas `String.prototype.<` compares UTF-16 code
        // UNITS — which places every astral character (U+10000 and above,
        // encoded as a surrogate pair starting at 0xD800) BELOW U+E000–U+FFFF.
        // Probed: `Less(CharacterFrom("\u{10000}"), CharacterFrom(""))`
        // is `False` in the interpreter and `true` under the raw infix `<`, a
        // wrong answer behind `success: true`. Declining here lets the head
        // fall through to the target's own ordering codegen, which emits a
        // code-point comparator on JavaScript and fails closed elsewhere.
        // (`docs/STRING_ROADMAP.md`, D8/D13.)
        const orderingOverCharacter =
          isRelationalOperator(h) && args.some(isProvablyCharacterOperand);
        // Compile as an operator (only for non-collection arguments). A
        // STRING operand is not a collection FOR THIS PURPOSE: it matches
        // `collection` in the lattice but lowers to a target string, which
        // the infix operators compare exactly as the interpreter does.
        if (
          args.every((x) => !x.isCollection || isProvablyStringOperand(x)) &&
          !relationalOverCollection &&
          !orderingOverString &&
          !orderingOverCharacter &&
          !pyOrderingUnfaithful &&
          !pyConnectiveOverCollection
        ) {
          if (isRelationalOperator(h) && args.length > 2) {
            // Chain relational operators, conjoined with the target's chain
            // operator (`&&` by default; Python `and`).
            //
            // A middle operand appears in TWO comparisons (`a < m < b` →
            // `(a < m) && (m < b)`). Emitting it twice would evaluate it
            // twice — drawing `Random()` twice, say — diverging from the
            // interpreter, which evaluates each operand once. Bind each
            // non-trivial middle operand (indices 1..n-2) to a temporary so it
            // is evaluated exactly once. A symbol or number literal is safe to
            // duplicate, so it is left inline (keeps output clean, no churn).
            //
            // A target WITHOUT `bindExpr` (the GPU shaders) has no
            // expression-level binding form, so it inlines everything. That
            // is safe for a PURE operand only: a shader `Random` draw is
            // deterministic per invocation but `_gpu_rnd_draw` advances a
            // runtime counter, so a second splice draws a DIFFERENT value
            // and shifts every later draw in the shader. An impure middle
            // operand is therefore bound to a hoisted temporary instead; if
            // there is no statement sink to hoist into, the head declines.
            //
            // A bound operand is evaluated BEFORE the body that uses it, so
            // binding only the MIDDLES would run a middle's draw ahead of an
            // impure ENDPOINT left inline in the body — reversing the
            // interpreter's argument order (`Less(Random(), Random(), 0.9)`
            // drew the middle first). So as soon as an impure operand is
            // bound at all, bind EVERY impure operand, in argument order:
            // `bindExpr`'s application form (JS `((a, b) => …)(x, y)`,
            // Python `(lambda a, b: …)(x, y)`) and the hoisted-statement sink
            // both evaluate left to right, so the draws then follow argument
            // order. A chain with no impure operand is untouched.
            //
            // The interpreter SHORT-CIRCUITS a chain (since 2026-08-15,
            // `evaluateChainOperands` in `library/relational-operator.ts`):
            // `Less(5, 1, Random())` stops at `5 < 1` and never draws. A
            // temporary bound AROUND the whole chain is evaluated before any
            // pair, so an operand at index ≥ 2 must instead be bound BEHIND
            // the pairs that precede it: `(a < b) && ((t) => (b < t) &&
            // (t < c))(draw())`. Operands 0 and 1 are always evaluated by
            // the interpreter (the first pair needs both), so their bindings
            // may wrap the whole chain. A target without `bindExpr` (the GPU
            // shaders) can only bind by hoisting a statement — which is
            // unconditional — so an impure operand at index ≥ 2 that must be
            // bound declines there (D6).
            const chainOp = target.chainOp ?? '&&';
            const impureMiddle = args.some(
              (arg, i) => i >= 1 && i <= args.length - 2 && arg.isPure === false
            );
            // Per operand: its code, or a temporary name plus the binding
            // that introduces it.
            const outerBindings: Array<[name: string, value: string]> = [];
            const innerBindings = new Map<
              number,
              [name: string, value: string]
            >();
            const codes = args.map((arg, i) => {
              // Each comparison after the first is short-circuited by the
              // chain operator, so operands from index 2 on are the lazy
              // edges of this (node-less) lowering — see `lazyOperandRegions`.
              const code =
                i >= 2
                  ? compileOpValue(node, i, target, op[1], arg)
                  : compileValueOperand(arg, target, op[1]);
              const isMiddle = i >= 1 && i <= args.length - 2;
              const isImpure = arg.isPure === false;
              if (
                target.bindExpr &&
                ((isMiddle && !isSymbol(arg) && !isNumber(arg)) ||
                  (impureMiddle && isImpure))
              ) {
                const name = tempVar(target);
                if (i >= 2) innerBindings.set(i, [name, code]);
                else outerBindings.push([name, code]);
                return name;
              }
              if (!target.bindExpr && impureMiddle && isImpure) {
                if (!canHoist(target) || i >= 2)
                  throw new Error(
                    `Could not compile \`${h}\`: an impure (Random) operand cannot be bound to a ` +
                      'temporary at this position — a repeated draw would ' +
                      'shift every later value in the shader, and a hoisted ' +
                      'draw at index ≥ 2 would fire even when an earlier ' +
                      'comparison already decided the chain.'
                  );
                const name = tempVar(target);
                const decl =
                  target.language === 'wgsl'
                    ? `var ${name}: f32`
                    : `float ${name}`;
                hoistStatement(target, `${decl} = ${code};`);
                return name;
              }
              return code;
            });
            // The conjunction of the pairs from pair `k` (comparing operands
            // `k` and `k+1`) to the last, flat — except that the pairs from
            // the first one that reads a bound operand `i+1` (`i ≥ 1`) on
            // are wrapped in that operand's binding, so the temporary is
            // evaluated only once every earlier pair has held. A binding is
            // consumed when wrapped so the recursion does not see it again.
            const chainFrom = (k: number): string => {
              const parts: string[] = [];
              for (let i = k; i < codes.length - 1; i++) {
                const binding = innerBindings.get(i + 1);
                if (binding && target.bindExpr) {
                  innerBindings.delete(i + 1);
                  parts.push(target.bindExpr([binding], chainFrom(i)));
                  break;
                }
                parts.push(`(${codes[i]} ${op[0]} ${codes[i + 1]})`);
              }
              return parts.join(` ${chainOp} `);
            };
            const body = chainFrom(0);
            if (outerBindings.length > 0 && target.bindExpr)
              return target.bindExpr(outerBindings, body);
            return body;
          }

          let resultStr: string;
          // The precedence of the operator that ends up at the ROOT of
          // `resultStr`. It is `op[1]` except when a `Multiply` is rewritten
          // as a division below, where the root becomes `Divide` (or the
          // unary `Negate` above it).
          let resultPrec = op[1];
          if (
            args.length === 1 &&
            (h === 'Add' ||
              h === 'Multiply' ||
              h === 'And' ||
              h === 'Or' ||
              h === 'Subtract')
          ) {
            // An n-ary operator with one operand is that operand. Only
            // non-canonical input reaches here. Read as a prefix operator
            // it would emit `* x` (CE-251.2). `Subtract(x)` is `x` in the
            // interpreter too, not `-x`: the prefix reading emitted
            // `3 * (-x + 1)` for `3·Subtract(x + 1)`, which negates the
            // operand and also lets the sum spread into the parent.
            resultStr = compileValueOperand(args[0], target, op[1]);
          } else if (args.length === 1 && (h === 'Divide' || h === 'Power')) {
            // A binary operator with one operand. Only non-canonical input
            // reaches here, and the interpreter answers an error for it
            // (`Divide(x)` evaluates to `Error("missing")`). Read as a prefix
            // operator it emitted `/x` or `**x`, which is not valid code.
            throw new Error(
              `Could not compile \`${h}\`: expected two operands, got one`
            );
          } else if (args.length === 1) {
            // Unary operator, assume prefix. Word operators get a space.
            const operandCode = compileValueOperand(args[0], target, op[1]);
            // Insert a separating space when gluing the operator to an
            // operand that begins with the same symbol would form a different
            // token: `-` + `-3.0` must not become `--3.0` (invalid in
            // GLSL/WGSL, a decrement in C-likes/JS). This arises when a
            // negative value is spliced in (e.g. a Sum unroll substituting a
            // negative index into `Negate(i)`). A leading `(` is already safe.
            const glues =
              !isWordOp &&
              operandCode.length > 0 &&
              operandCode[0] === op[0][op[0].length - 1];
            const sep = isWordOp || glues ? ' ' : '';
            resultStr = `${op[0]}${sep}${operandCode}`;
          } else {
            // `Power` is right-associative: `a ** b ** c` parses as
            // `a ** (b ** c)`. So a *left* operand of equal precedence must
            // be parenthesized — otherwise `(a^b)^c` would emit the
            // right-associative `a ** b ** c` (wrong grouping in Python,
            // where `**` is the only right-associative arithmetic operator).
            const rightAssoc = h === 'Power';
            // `Subtract`/`Divide` are left-associative and *non*-associative:
            // `a - (b - c) ≠ (a - b) - c`. So a *right* operand of equal
            // precedence must be parenthesized — otherwise a non-canonical
            // `Divide(a, Divide(b, c))` would emit `a / b / c` (= `(a/b)/c`,
            // wrong grouping). `Add`/`Multiply` are associative, so their
            // operands need no extra parens.
            const leftAssocNonAssociative = h === 'Subtract' || h === 'Divide';
            // A loop, not `args.map`: the callback and the frame of `map`
            // would be two more frames for each level of a nested
            // expression (ROADMAP CE-320.2).
            const operandCodes: TargetSource[] = [];
            for (let i = 0; i < args.length; i++) {
              let operandPrec = op[1];
              if (rightAssoc && i < args.length - 1) operandPrec = op[1] + 1;
              else if (leftAssocNonAssociative && i > 0)
                operandPrec = op[1] + 1;
              // Routed through the edge helper so a short-circuiting
              // connective (`And`/`Or`, whose operands after the first are
              // lazy edges) pushes its region instance; a non-region edge
              // compiles exactly as before.
              operandCodes.push(
                compileOpValue(node, i, target, operandPrec, args[i])
              );
            }
            /**
             * Drop a factor that the emitted code spells as the exact `1` of
             * the product above it.
             *
             * Such a literal is made by the target's emitted-code fold, not
             * by the expression tree: `Cos(0)` is emitted as `Math.cos(0)`
             * and the fold reduces that code to `1`, so no tree-level
             * simplification can ever see the unit factor. The result agrees
             * with the interpreter, which evaluates `Cos(0)` to the exact
             * `1` and then drops the unit factor at canonicalization.
             *
             * A factor spelled as the exact `-1` is dropped the same way and
             * the caller negates the product instead (the return value says
             * so; an EVEN number of such factors cancels and asks for no
             * negation). It arrives by the same route — the unrolled
             * `\sum_k (-1)^k x` emits `_.x * _SYS.pow(-1, 1)` and the fold
             * turns the call into the literal — and the rewrite is exact for
             * every IEEE value: negation only flips the sign bit, and
             * round-to-nearest is sign-symmetric, so `-(a * b)` and
             * `(-a) * b` are the same float. Unlike a `0` factor, a `-1`
             * factor also discards nothing: `NaN * -1`, `∞ * -1` and
             * `0 * -1` all keep the value the negation gives.
             *
             * `x * 1` returns `x` for every IEEE value — a negative zero and
             * a NaN included — so this drop is exact. The two neighbouring
             * folds are deliberately NOT made:
             *
             * - A product with a `0` factor is not collapsed to `0`. `0 · ∞`
             *   and `0 · NaN` are `NaN`, and an operand's type is no proof
             *   that the emitted code stays finite: a type describes the
             *   VALUE, while an out-of-range indexed read `P[i]` typed
             *   `integer` answers `undefined`, hence `NaN`, at run time.
             *   The collapse also discarded operands
             *   with an observable effect: `Sin(0) · Random()` lost its draw,
             *   which moves every later draw of a seeded sequence.
             * - A `0` summand is not dropped. `x + 0` is not the identity for
             *   a negative zero: `-0 + 0` is `+0`.
             *
             * JavaScript only, like the leading-numeric-run fold below. On a
             * shader target a literal factor also carries a TYPE — WGSL has
             * no implicit conversion between `i32` and `f32` — so dropping
             * one could leave an operand of the wrong type for the position
             * it sits in.
             *
             * `codes` is rewritten in place. Returns whether the product it
             * leaves behind must be NEGATED to keep its value.
             */
            const foldEmittedIdentityOperands = (codes: string[]): boolean => {
              if (
                target.language !== 'javascript' ||
                target.constantFold === false
              )
                return false;
              if (h !== 'Multiply' || op[0] !== '*') return false;
              const identity = target.number(1);
              // The emitted-code fold parenthesizes a negative literal it
              // splices where the code did not already start with a minus
              // sign, so both spellings of `-1` reach this point.
              const minusOne = target.number(-1);
              const isMinusOne = (c: string) =>
                c === minusOne || c === `(${minusOne})`;
              const kept = codes.filter(
                (c) => c !== identity && !isMinusOne(c)
              );
              if (kept.length === 0 || kept.length === codes.length)
                return false;
              const negations = codes.filter(isMinusOne).length;
              codes.splice(0, codes.length, ...kept);
              return negations % 2 === 1;
            };
            // Fold only a leading run of emitted numeric literals. It has
            // the same left-to-right rounding as the original product and
            // also catches constants introduced by lowering, such as degrees.
            const foldLeadingNumericRun = (codes: string[]): void => {
              // The fold MULTIPLIES the literals it absorbs, so it applies
              // to a product only. Running it over an `Add` would collapse
              // `2k + 1` at `k = 0` to `0`.
              if (
                target.language !== 'javascript' ||
                target.constantFold === false ||
                h !== 'Multiply' ||
                op[0] !== '*'
              )
                return;
              const numeric = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
              let count = 0;
              let product = 1;
              for (const code of codes) {
                if (!numeric.test(code) || !Number.isFinite(Number(code)))
                  break;
                const next = product * Number(code);
                if (!Number.isFinite(next)) break;
                product = next;
                count++;
              }
              if (count > 1)
                codes.splice(
                  0,
                  count,
                  Object.is(product, -0) ? '-0' : String(product)
                );
            };
            // A product with an exact rational factor `p/q` is lowered as a
            // DIVISION by the integer `q`, not as a multiplication by the
            // rounded reciprocal — see `exactRationalDivisor` for why the
            // reciprocal is wrong at exact multiples of `q`. The division
            // comes FIRST and the numerator `p` multiplies the quotient
            // afterwards (`x / q * p`, not `(p * x) / q`): the product
            // `p * x` overflows to infinity for a large `x` where the
            // quotient does not, and on a 32-bit shader float that limit is
            // only about 1e38. The exactness the rewrite exists for is kept:
            // at `x = k·q` the quotient is exactly `k`, and `k * p` is exact
            // for safe integers. A `p` of −1 becomes a unary negation of the
            // whole quotient, which is exact (IEEE negation is exact and
            // round-to-nearest is sign-symmetric, so `-(a / q)` and
            // `(-a) / q` are the same float).
            const divOp =
              h === 'Multiply' && op[0] === '*'
                ? target.operators?.('Divide')
                : undefined;
            const ratIndex =
              divOp === undefined
                ? -1
                : args.findIndex(
                    (arg) => exactRationalDivisor(arg) !== undefined
                  );
            const rat =
              ratIndex < 0 ? undefined : exactRationalDivisor(args[ratIndex]);
            // A unary negation the whole result takes, asked for either by a
            // `-1` numerator or by the `-1` factors the emitted-code fold
            // left behind. The two are combined into ONE negation: emitting
            // both would glue two minus signs into a JavaScript decrement.
            const negateResult = (): void => {
              const negOp = target.operators?.('Negate');
              if (negOp !== undefined) {
                // A bare name or member path (`_.x`, `_cse1`) takes the
                // minus sign without parentheses: member access binds
                // tighter than a unary operator in every target language, so
                // nothing can re-associate. Anything else keeps them.
                const atomic = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(
                  resultStr
                );
                const operand =
                  atomic || resultPrec >= negOp[1]
                    ? resultStr
                    : `(${resultStr})`;
                resultStr = `${negOp[0]}${operand}`;
                resultPrec = negOp[1];
              } else {
                // No unary negation on this target: fall back to an
                // explicit `-1` factor.
                resultStr = `${target.number(-1)} ${op[0]} ${resultStr}`;
                resultPrec = op[1];
              }
            };
            if (rat !== undefined && divOp !== undefined) {
              const factors = operandCodes.filter((_, i) => i !== ratIndex);
              const negateFactors = foldEmittedIdentityOperands(factors);
              foldLeadingNumericRun(factors);
              // A leading factor of exactly one is the multiplicative
              // identity for every IEEE value, so it is dropped. It appears
              // when a `Sum` unroll substitutes the index value 1 into the
              // body; before the division rewrite the numeric fold above
              // absorbed it into the reciprocal literal.
              if (factors.length > 1 && factors[0] === target.number(1))
                factors.shift();
              const numerator =
                factors.length > 1
                  ? `(${factors.join(` ${op[0]} `)})`
                  : factors[0];
              resultStr = `${numerator} ${divOp[0]} ${target.number(rat.q)}`;
              resultPrec = divOp[1];
              if (rat.p !== 1 && rat.p !== -1) {
                // Division binds at least as tightly as multiplication on
                // every target, so the quotient needs no parentheses as the
                // left operand of the `p` factor.
                const quotient =
                  resultPrec < op[1] ? `(${resultStr})` : resultStr;
                resultStr = `${quotient} ${op[0]} ${target.number(rat.p)}`;
                resultPrec = op[1];
              }
              if ((rat.p === -1) !== negateFactors) negateResult();
            } else {
              const negateFactors = foldEmittedIdentityOperands(operandCodes);
              foldLeadingNumericRun(operandCodes);
              resultStr = operandCodes.join(` ${op[0]} `);
              if (negateFactors) negateResult();
            }
          }
          // Same shape gate as the function-codegen and string-helper paths
          // (see `CompileTarget.checkOperandShapes`): the infix arithmetic
          // operators of a shader language are genType-polymorphic with
          // their own overload table, and a typed-symbol or `Matrix` operand
          // — for which `.isCollection` is false — reaches this path with
          // shapes the operator may have no overload for (`vec3 + vec2`,
          // `2.0 + mat2x2f(…)` on WGSL). Throws to fail closed.
          // No hook (JavaScript, Python, interval-js): unchanged.
          target.checkOperandShapes?.(h, args, resultStr, target);
          return resultPrec < prec ? `(${resultStr})` : resultStr;
        }
      }
    }
  }
  return undefined;
}

/**
 * Whether `arg` is a tuple with a tuple element: the literal
 * `((1, 2), (3, 4))`, or a symbol or call whose type is a tuple with a
 * tuple element type — one point with nested coordinates. The interpreter
 * does not contract such an operand of `Dot` (its `Norm` is the flattened
 * vector, its `PointX` is the first inner tuple), so the targets decline
 * it rather than hand its nested arrays to a matrix product.
 */
export function isTupleOfTuples(arg: Expression): boolean {
  if (isFunction(arg, 'Tuple') && arg.ops.some((op) => isTuple(op)))
    return true;
  const t = resolveTypeForCompilation(arg.type.type);
  return (
    typeof t !== 'string' &&
    t.kind === 'tuple' &&
    t.elements.some((e) => isTupleOrTupleUnionShapedType(e.type))
  );
}

/**
 * The failing-branch shape for a guarded real-only head (the `realGuard`
 * kind): a head that produces a COLOR answers the target's non-finite
 * color, so a caller reading the color's channels never sees the result
 * shape flip at runtime on data. Every other real-only lowering returns
 * a scalar. `Colormap`'s guarded form is
 * the two-argument sample — the one-argument palette form has no numeric
 * operand to promote — and `ColorMix` mixes to one color. An alpha is lost
 * on the FAILING branch, which the color representation absorbs: the color
 * carries its alpha in a key that is always present and `undefined` for an
 * opaque color, so the failing value has the same keys as the successful
 * one.
 */
export function realOnlyResultKind(h: string): 'number' | 'color' {
  switch (h) {
    case 'Rgb':
    case 'Hsv':
    case 'Hsl':
    case 'Oklab':
    case 'Oklch':
    case 'ColorFromColorspace':
    case 'Colormap':
    case 'ColorMix':
      return 'color';
    default:
      return 'number';
  }
}

/**
 * Element-wise broadcast of a `broadcastable` head (arithmetic + element-wise
 * math functions such as `Sin`/`Sqrt`) over one or more list-valued operands,
 * for the JavaScript target. Emits a call to the `_SYS.bcast` runtime helper
 * wrapping a scalar closure built from the head's OWN scalar codegen, so
 * complex handling and constant folding stay identical to the scalar path.
 * `_SYS.bcast` performs the shape logic at run time (shortest-length zip,
 * scalar broadcast, nested lists), matching the interpreter's
 * `broadcastOverIndexedCollections`.
 *
 * Returns `null` — deferring to the scalar / fail-closed path — when the head
 * is not broadcastable, no operand is list-valued, or the head has no
 * function codegen. Complex operands DO broadcast: each element parameter is
 * declared complex or real in a local frame, so the head's own scalar codegen
 * emits the matching lowering. Only an operand whose elements DISAGREE about
 * being complex declines, because one closure is emitted for all of them.
 */
/**
 * True when `a` is a point in `Hypot` position.
 *
 * A point is a single leg of the hypotenuse: it enters the sum of squares
 * through its own norm, so `Hypot((3, 4), 1)` is √(‖(3,4)‖² + 1²). Two
 * checks would otherwise claim such an operand because a point is a
 * collection, and both must stand aside for it: the element-wise broadcast,
 * which would pair each component with the other leg and produce a list of
 * hypotenuses, and the check that refuses scalar arithmetic over a
 * collection, which would refuse to compile the expression at all. Both ask
 * this one question, so they cannot disagree.
 *
 * Standing aside is not acceptance. A point whose component is itself a
 * collection has one norm per element, and the JavaScript target does not
 * compile that; its `Hypot` handler says so. Keeping that decision in the
 * handler is why this test asks only whether the operand is a point.
 */
export function isHypotPointLeg(h: string, a: Expression): boolean {
  return h === 'Hypot' && isTuple(a);
}

/**
 * True when `h` consumes the operand `a` as ONE value because its definition
 * declares the `'tuples'` broadcast exemption and `a` is a tuple whose shape
 * is visible at compile time.
 *
 * A `broadcastable` head maps over a collection operand, and a tuple is an
 * indexed collection, so the compiled lanes fan a tuple out the same way a
 * list is fanned out. A definition that declares
 * `broadcastExemptions: ['tuples']` says the opposite for that shape: the
 * interpreter stands the element-wise lift down and hands the tuple to the
 * head's own handler whole (`skipBroadcastForVectorOpsOnViews` in
 * `boxed-expression/broadcast-lift-type.ts`). That is how the color-space
 * conversions read `AsRgb((1, 0, 0))` as one color in 0-1 sRGB rather than
 * as three one-number applications. The compiled lanes must read it the same
 * way, or a compiled artifact and the interpreter answer different values
 * for the same input.
 *
 * Only a tuple written at the call site qualifies — an application such as a
 * literal `Tuple`, never a symbol. A tuple that reaches the head through a
 * variable has no compile-time shape, so the existing lanes keep it, exactly
 * as the color operand compilers of the JavaScript and GPU targets already
 * decide (`compileColorOperand`, `gpuColorOperand`).
 *
 * Standing the fan-out down is not acceptance. Whether the head can lower
 * THIS tuple stays the head's own decision: the color operand compilers
 * refuse a tuple of any width other than 3 or 4, which is the width the
 * interpreter answers `incompatible-type` for.
 */
/**
 * Whether the operator `h` applies to each coordinate of a tuple operand
 * (`Sin((1, 2))` is `(sin(1), sin(2))`), read from its definition with the
 * predicate the interpreter's component-wise tuple broadcast uses
 * (`broadcastsOverTuples`), so the two routes decide the same way.
 */
export function appliesToEachTupleCoordinate(
  engine: ComputeEngine,
  h: string
): boolean {
  const def = lookupApplicable(h, engine.context.lexicalScope);
  return isOperatorDef(def) && broadcastsOverTuples(h, def.operator);
}

export function isBroadcastExemptTupleOperand(
  engine: ComputeEngine,
  h: string,
  a: Expression
): boolean {
  if (ELEMENTWISE_TUPLE_EXEMPT_HEADS.has(h)) return false;
  if (!isFunction(a) || !isTuple(a)) return false;
  const def = engine.lookupDefinition(h);
  return (
    isOperatorDef(def) && def.operator.broadcastExemptions.includes('tuples')
  );
}

/**
 * An array operand that PROVABLY holds scalars — the shape an outer
 * `_SYS.bcast` may descend into while a point operand is kept whole (see
 * `atomicTuple` in `tryCompileBroadcast`). A list of points, or a source
 * whose element kind is unprovable (a top-typed call), is not one: the
 * outer broadcast would descend into each point.
 */
export function isScalarElementSource(
  a: Expression,
  target?: CompileTarget<Expression>
): boolean {
  const t = compilationType(a);
  if (typeof t !== 'string' && t.kind === 'broadcastable')
    return isSubtype(t.elements, 'number');
  // A top-typed application (`h(x)` with `h: (…) -> unknown`): its
  // run-time shape is unknowable.
  if (isBoundPossiblyCollectionTyped(a)) return false;
  const elt = collectionElementType(t);
  if (elt === undefined || !isSubtype(elt, 'number')) return false;
  // A SYMBOL declared `indexed_collection<number>` may itself be bound to a
  // point (a tuple inhabits that type); only a list-kind declaration proves
  // a symbol holds a list of scalars.
  if (isSymbol(a)) {
    if (
      t === 'list' ||
      t === 'range' ||
      (typeof t !== 'string' && t.kind === 'list')
    )
      return true;
    // The declared type does not prove list-ness, but the symbol's BINDING
    // can: a value whose own type is a list of scalars — a `Range`, or the
    // broadcast arithmetic over one that a plot uses to build a list of
    // sample points, which types `list<number>` — is never a point, which
    // resolves the concern the `indexed_collection` declaration leaves open.
    // A `Tuple` binding keeps declining.
    //
    // Two shapes must NOT trust the binding, because the value the compiler
    // reads here is not the value the kernel runs:
    //   - a COMPILE-BOUND name (a `Sum`/`Product` index, a lambda or
    //     user-function parameter, a broadcast element) shadows any
    //     same-named engine symbol, so reading a value through it would
    //     dereference the wrong definition. This is the guard
    //     `isComplexValued` applies before it reads a symbol's value.
    //   - a caller-`vars`-mapped symbol is a live by-reference input: the
    //     kernel reads it from the caller's scope, so only its declared type
    //     is the contract, and that admits a point. (When the symbol is not
    //     mapped, the compiler emits its binding inline or as a baked
    //     constant, so the binding is exactly what runs.)
    // Both decline, keeping the fail-closed behavior the declaration asks
    // for. The mention check is on the operand's own names, not transitive
    // through assigned values (`reachesExcludedName`): this reads the
    // SHAPE of the binding, which a mapped input inside the value does not
    // change, and evaluates nothing.
    if (isCompileBoundName(a.symbol)) return false;
    if (
      target !== undefined &&
      mentionsExcludedName(a, target.varsKeys, target.foldExcludedOps)
    )
      return false;
    // Read the node's OWN scope-correct binding (`a.value`), not a name-based
    // engine lookup.
    const value = a.value;
    if (value === undefined || isTuple(value)) return false;
    const vt = compilationType(value);
    // A `Range` binding types `range` — a list of integers, never a point.
    if (vt === 'range') return true;
    if (typeof vt === 'string' || vt.kind !== 'list') return false;
    const velt = collectionElementType(vt);
    return velt !== undefined && isSubtype(velt, 'number');
  }
  return true;
}

/**
 * The `_SYS.rotv(base, shift, ±1)` spelling of a `RotateLeft`/`RotateRight`
 * operand of a broadcast, or `undefined` when the operand must compile as
 * itself: it is not a rotation, its base is not provably a list of scalars
 * (a view reads the base by index, so the base must be an array whose
 * cells the closure applies to — a string or a list of points is not one),
 * the rotation head is caller-mapped (`functions`/`operators`/a compile
 * handler: the caller's implementation, not the built-in rotation, is what
 * the operand denotes), or the node already has a name — a loop-invariant
 * hoist override, a CSE temporary bound by an enclosing instance, or a CSE
 * candidate of the current region, which must go through `compile()` to
 * bind or read it.
 *
 * A view reads its base when the element loop runs, AFTER every operand of
 * the broadcast has been evaluated, where a materialized rotation copied
 * the base at its own evaluation. The two agree only if nothing evaluated
 * in between mutates the base, so the caller (`tryCompileBroadcast`) asks
 * for views only when every operand is pure and neither the head nor any
 * operand is caller-mapped — the checks `admission` carries.
 *
 * The base and the shift are compiled through the same `compile()` the
 * rotation's own handler would have used, so their CSE and override state
 * is honored. The rotation node itself is not compiled: compiling it would
 * bind or emit the materializing rotation, which is what the view replaces.
 */
export function rotationView(
  a: Expression,
  target: CompileTarget<Expression>,
  admission: CseHarvestOptions
): string | undefined {
  if (!isFunction(a)) return undefined;
  const dir =
    a.operator === 'RotateLeft' ? 1 : a.operator === 'RotateRight' ? -1 : 0;
  if (dir === 0 || a.nops < 1 || a.nops > 2) return undefined;
  if (!isScalarElementSource(a.op1, target)) return undefined;
  if (isCallerMapped(a, admission)) return undefined;
  if (_codeOverrides.has(a)) return undefined;
  const session = target.cse;
  if (session !== undefined && session.enabled) {
    const top = session.instances[session.instances.length - 1];
    if (top !== undefined) {
      if (availableCseBinding(session, a, true) !== undefined) return undefined;
      if (candidateAt(cseRegionOf(top), a) !== undefined) return undefined;
    }
  }
  const base = core.compile(a.op1, target);
  const shift = a.nops === 2 ? core.compile(a.op2, target) : '1';
  return `_SYS.rotv(${base}, ${shift}, ${dir})`;
}

/**
 * Emit `body`, which reads one already-compiled operand SEVERAL times, so
 * that the operand is still evaluated exactly once: `read` is the source
 * text the body must use for it — `code` itself when repeating it is free
 * ({@link REPEATABLE_SOURCE}), and otherwise the name of a temporary the
 * result binds it to.
 */
export function withRepeatableSource(
  code: string,
  target: CompileTarget<Expression>,
  body: (read: string) => string
): string {
  if (REPEATABLE_SOURCE.test(code)) return body(code);
  const v = tempVar(target);
  return `((${v}) => ${body(v)})(${code})`;
}
