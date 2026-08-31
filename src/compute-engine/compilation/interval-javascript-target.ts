/**
 * JavaScript interval arithmetic compilation target
 *
 * Compiles mathematical expressions to JavaScript code using interval arithmetic
 * for reliable function evaluation with singularity detection.
 *
 * The target's value model is "one interval per quantity": every kernel here
 * answers ONE interval (or one `IntervalResult`) and takes scalar operands —
 * a provably collection-valued operand to a kernel fails closed
 * (`assertScalarIntervalOperands`). A collection is that many quantities: a
 * collection-valued ROOT (a comprehension) returns a JavaScript array of
 * intervals (`IntervalValue`), and a collection may appear as the OPERAND of
 * an accessor — `At`, `Length`, `PointX`/`PointY`/`PointZ` — where it is the
 * same array at run time and the accessor projects it back down to a single
 * interval (see `interval/collections.ts`). The array spelling of a LITERAL
 * `List`/`Tuple` is emitted only in those operand positions, never as an
 * ordinary lowering: see `compileIntervalCollectionOperand` for why.
 *
 * @module compilation/interval-javascript-target
 */

import type { Expression } from '../global-types.js';
import { normalizeDeprecatedCompileOptions } from './deprecation-warnings.js';
import { entrySource } from './function-purity.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isString,
} from '../boxed-expression/type-guards.js';
import { collectionElementType } from '../../common/type/utils.js';

import {
  BaseCompiler,
  compilationType,
  isProvablyStringOperand,
  pointHasBroadcastComponent,
} from './base-compiler.js';
import {
  couldBeIndexedCollectionOperand,
  couldBeStringOperand,
  isIndexedCollectionOperand,
  isNumericIndexOperand,
} from './javascript-target.js';
import { rewriteAngularUnit } from './angular-unit.js';
import type {
  CompileDiagnostic,
  CompileMode,
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  CompiledRunner,
  CompiledFunction,
  IntervalInput,
  IntervalValue,
  OperandCompiler,
} from './types.js';
import { compileDiagnosticOf } from './diagnostics.js';
import { IntervalArithmetic } from '../interval/index.js';
import {
  INTERVAL_QUADRATURE_BUDGET,
  INTERVAL_QUADRATURE_SUBDIVISIONS,
} from '../interval/integrate.js';
import { isSubtype } from '../../common/type/subtype.js';

/**
 * Interval arithmetic operators mapped to _IA library calls.
 *
 * Unlike regular operators, these produce function calls instead of infix notation.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const INTERVAL_JAVASCRIPT_OPERATORS: CompiledOperators = {
  __proto__: null as never,
  // We use high precedence since these become function calls
  Add: ['_IA.add', 20],
  Negate: ['_IA.negate', 20],
  Subtract: ['_IA.sub', 20], // Subtract canonicalizes to Add+Negate; kept as fallback
  Multiply: ['_IA.mul', 20],
  Divide: ['_IA.div', 20],
  // Comparisons return BoolInterval
  Equal: ['_IA.equal', 20],
  NotEqual: ['_IA.notEqual', 20],
  LessEqual: ['_IA.lessEqual', 20],
  GreaterEqual: ['_IA.greaterEqual', 20],
  Less: ['_IA.less', 20],
  Greater: ['_IA.greater', 20],
  And: ['_IA.and', 20],
  Or: ['_IA.or', 20],
  Not: ['_IA.not', 20],
};

/**
 * Emit the Euclidean (L2) norm of a fixed-arity point from its compiled
 * components: `hypot` for the 2-D case (tighter enclosure than the
 * sqrt-of-squares composition), √(Σ xᵢ²) otherwise.
 */
function compileIntervalPointNorm(
  components: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const comps = components.map((c) => compile(c));
  if (comps.length === 0) return '_IA.point(0)';
  if (comps.length === 1) return `_IA.abs(${comps[0]})`;
  if (comps.length === 2) return `_IA.hypot(${comps[0]}, ${comps[1]})`;
  let sum = `_IA.add(_IA.square(${comps[0]}), _IA.square(${comps[1]}))`;
  for (let i = 2; i < comps.length; i++)
    sum = `_IA.add(${sum}, _IA.square(${comps[i]}))`;
  return `_IA.sqrt(${sum})`;
}

/**
 * The assigned value of a SYMBOL operand when that value is a literal
 * `List`/`Tuple`/`PointList` an accessor can read at compile time; `undefined`
 * for any other operand.
 *
 * Everywhere else an assigned symbol folds through
 * `BaseCompiler.tryFoldKnownSymbol`, which compiles the VALUE — and this target
 * has no `List`/`Tuple` lowering (see `compileIntervalCollectionOperand`), so
 * `At(L, 2)` with `L := [1, 2, 3]` declined with "List: no lowering" even
 * though the element is right there. Looking through the symbol here keeps
 * the fold local to the accessor's operand position. Three symbols are never
 * looked through: one BOUND in the current compilation context (a lambda
 * parameter or a binder index shadows the engine's symbol of the same name),
 * one the caller pinned as a runtime input (`varsKeys`, which must survive to
 * run time), and one with no assigned value. A looked-through symbol is
 * recorded in `symbolDeps`, since the generated code bakes its current value,
 * exactly as `tryFoldKnownSymbol` records it.
 */
function assignedLiteral(
  e: Expression,
  target: CompileTarget<Expression>
): Expression | undefined {
  if (!isSymbol(e)) return undefined;
  const id = e.symbol;
  if (target.boundVars?.has(id) || target.varsKeys?.has(id)) return undefined;
  const value = e.engine._getSymbolValue(id);
  if (value === undefined || !isFunction(value)) return undefined;
  const h = value.operator;
  if (h !== 'List' && h !== 'Tuple' && h !== 'PointList') return undefined;
  target.symbolDeps?.add(id);
  return value;
}

/** The operands of a literal `List`/`Tuple` node — written inline or held as
 *  a symbol's assigned value (`assignedLiteral`) — or `undefined` for any
 *  other operand. A literal collection's length and elements are known at
 *  compile time, which lets `Length` and `At` fold instead of emitting a
 *  runtime array. */
function literalCollectionOps(
  e: Expression,
  target: CompileTarget<Expression>
): ReadonlyArray<Expression> | undefined {
  const literal = assignedLiteral(e, target) ?? e;
  if (isFunction(literal, 'List') || isFunction(literal, 'Tuple'))
    return literal.ops;
  return undefined;
}

/**
 * Compile the COLLECTION operand of `At`: a JavaScript array of intervals.
 *
 * A literal `List`/`Tuple` is lowered here rather than through a handler
 * registered in `INTERVAL_JAVASCRIPT_FUNCTIONS`, so the array spelling exists
 * ONLY in the operand position of an accessor that immediately projects it
 * back to a single interval. Registering it as an ordinary lowering would make
 * a literal list a legal value everywhere — and a contradicted `-> boolean`
 * declaration whose body is a list (`b(t) := [t < 1, t < 2]`) would then
 * compile in a scalar `Which` condition, where it is pinned to decline in
 * every scalar position. The kernels themselves are protected separately:
 * `assertScalarIntervalOperands` fails closed on any provably
 * collection-valued operand, since `_IA.add`, `_IA.piecewise`, … read
 * `.lo`/`.hi` off whatever they are handed and would answer NaN bounds behind
 * `success: true`.
 */
function compileIntervalCollectionOperand(
  e: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const ops = literalCollectionOps(e, target);
  if (ops !== undefined) return `[${ops.map((x) => compile(x)).join(', ')}]`;
  return compile(e);
}

/**
 * The coordinates of a literal SINGLE point — written inline or held as a
 * symbol's assigned value (`assignedLiteral`) — or `undefined` for any other
 * operand.
 *
 * A `Tuple` is always one point. An ALL-SCALAR `PointList` is one too —
 * component k is operand k — which is the same equivalence the JavaScript
 * target relies on (see `pointComponentSource` in `base-compiler.ts`, and the
 * byte-identical `PointList`/`Tuple` lowerings there). Requiring every operand
 * to be provably numeric is what excludes the other `PointList` shapes: a
 * component that is (or may be) an indexed collection is a SOURCE zipped
 * across points, so operand k is then not component k.
 */
function literalPointOps(
  e: Expression,
  target: CompileTarget<Expression>
): ReadonlyArray<Expression> | undefined {
  const literal = assignedLiteral(e, target) ?? e;
  if (isFunction(literal, 'Tuple')) return literal.ops;
  if (
    isFunction(literal, 'PointList') &&
    literal.ops.length > 0 &&
    literal.ops.every((op) => op.type.matches('number'))
  )
    return literal.ops;
  return undefined;
}

/**
 * The emitted spelling of this target's numeric absence marker: a whole-NaN
 * bare interval. Kept in step with the `absence` capability declared in
 * `createTarget`, whose `isAbsent` test reads `.lo` directly — so the marker
 * must be a bare `Interval`, never an `IntervalResult` wrapper.
 */
const INTERVAL_ABSENCE = '{ lo: NaN, hi: NaN }';

/**
 * Compile a point coordinate accessor (`PointX`/`PointY`/`PointZ`), where `k`
 * is the 0-based coordinate.
 *
 * The operand must be a SINGLE point: a literal `Tuple` (whose coordinate is
 * selected at compile time) or an operand whose static type is a tuple. A LIST
 * of points is refused: the interpreter and the JavaScript target broadcast the
 * coordinate over the list, and a list of coordinates is not a value this
 * target can hold — its result is one interval.
 */
function compileIntervalPointComponent(
  name: string,
  arg: Expression | null | undefined,
  k: number,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (arg === null || arg === undefined)
    throw new Error(`${name}: no argument`);
  const literal = literalPointOps(arg, target);
  if (literal !== undefined) {
    const coordinate = literal[k];
    // A coordinate past the end of the point selects nothing; the interpreter
    // yields no value there and this target projects "no value" to absence.
    if (coordinate === undefined) return INTERVAL_ABSENCE;
    return compile(coordinate);
  }
  const t = compilationType(arg);
  if (typeof t === 'string' || t.kind !== 'tuple')
    throw new Error(
      `${name}: cannot compile — the operand is not a single point (its type ` +
        `is \`${arg.type.toString()}\`, not a tuple). A list of points would ` +
        `give one coordinate per element, and the interval target's result is ` +
        `a single interval, not a collection. Fail closed (D6).`
    );
  return `_IA.component(${compile(arg)}, ${k})`;
}

/**
 * Compile an N-ary chained relation (`Less`, `Greater`, `Equal`, …) to the
 * conjunction of ALL pairwise comparisons, combined with the tri-state
 * `_IA.and`. The runtime `_IA.and` is strictly binary, so the conjunction is
 * nested. A 2-operand chain is a single comparison.
 */
function compileIntervalChain(
  op: string,
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>,
  target?: CompileTarget<Expression>
): string {
  if (args.length < 2)
    throw new Error(`${op}: expected at least two arguments`);
  // A MIDDLE operand appears in two comparisons (`a < m < b` → `and(a<m,
  // m<b)`). Emitting it twice evaluates it twice, diverging from the
  // interpreter — which evaluates each operand once — and doubling the work of
  // a non-trivial operand. Bind each non-trivial middle operand to a temporary
  // (the same treatment the scalar infix path in `BaseCompiler` gives them; a
  // symbol or number literal is safe to duplicate and stays inline).
  const bindings: Array<[name: string, value: string]> = [];
  const codes = args.map((arg, i) => {
    // Operands from index 2 on are the chained-relation lazy positions of the
    // shared inventory (`LAZY_OPERANDS`): pass the index so the CSE pass pushes
    // the region harvest opened for them. (This lowering is eager today —
    // `_IA.and` is a strict call — but the region must be pushed regardless, or
    // a later short-circuiting lowering would hoist a temp out of a position
    // that may not run.) A non-region index simply compiles as before.
    const code = compile(arg, i);
    const isMiddle = i >= 1 && i <= args.length - 2;
    if (
      target?.bindExpr !== undefined &&
      isMiddle &&
      !isSymbol(arg) &&
      !isNumber(arg)
    ) {
      const name = BaseCompiler.tempVar(target);
      bindings.push([name, code]);
      return name;
    }
    return code;
  });
  let result = `${op}(${codes[0]}, ${codes[1]})`;
  for (let i = 1; i < codes.length - 1; i++)
    result = `_IA.and(${result}, ${op}(${codes[i]}, ${codes[i + 1]}))`;
  if (bindings.length > 0 && target?.bindExpr !== undefined)
    return target.bindExpr(bindings, result);
  return result;
}

/**
 * Fold an N-ary `And`/`Or` over ALL operands. The runtime `_IA.and`/`_IA.or`
 * are strictly binary, so this is a left-nested fold.
 */
function compileIntervalFold(
  op: string,
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>
): string {
  if (args.length === 0)
    throw new Error(`${op}: expected at least one argument`);
  let result = compile(args[0], 0);
  // `And`/`Or` operands after the first are the inventory's short-circuit lazy
  // positions: pass the index so the harvested region is pushed. (`_IA.and` is
  // a strict call, so this lowering evaluates them eagerly today; the region
  // must still be pushed — see `compileIntervalChain`.)
  for (let i = 1; i < args.length; i++)
    result = `${op}(${result}, ${compile(args[i], i)})`;
  return result;
}

/**
 * Mathematical constants the interval target bakes into the emitted code,
 * keyed by MathJSON symbol. Each is a degenerate (point) interval — the
 * target's value model holds one interval per quantity.
 *
 * Consulted by the target's `var` resolver (both the fast path and the main
 * path) and, through `constant`, by the reference analysis that computes
 * `freeSymbols` — a symbol spelled here is inlined, so it is never an input
 * the caller has to supply.
 *
 * Null-prototype so a lookup answers only for a key the table actually
 * declares. A plain object literal inherits `Object.prototype`, so indexing it
 * with an ordinary symbol named `toString`, `constructor` or `valueOf` returns
 * an inherited function rather than `undefined` — which the reference analysis
 * would read as "the target inlines this" and drop a genuine input from
 * `freeSymbols`.
 */
/** See `varsObjectAccess` in `javascript-target.ts` — the same own-property
 * guard, for the interval target's own vars-object emission. */
function intervalVarsAccess(id: string): string {
  if (!Object.hasOwn(Object.prototype, id)) return `_.${id}`;
  // `Object.prototype.hasOwnProperty.call`, not `Object.hasOwn`: this text
  // becomes part of the emitted `.code` artifact, which the caller may run on
  // a host far older than the Node that compiled it (`Object.hasOwn` is
  // ES2022). The compiler's OWN lookups use `Object.hasOwn` freely.
  return `(Object.prototype.hasOwnProperty.call(_, ${JSON.stringify(
    id
  )}) ? _.${id} : undefined)`;
}

/**
 * The heads of `INTERVAL_JAVASCRIPT_FUNCTIONS` whose handlers accept a
 * collection-valued operand, and so are NOT wrapped by the scalar-operand gate
 * (`guardedIntervalFunction`): the accessors, which project a collection
 * operand back to one interval; `Norm`, whose operand is a point; and the
 * binders `Sum`/`Product`/`Integrate`, whose handlers judge their own body and
 * limits with more specific diagnostics (`assertScalarBigOpBody`,
 * `compileIntervalIntegrate`).
 */
const COLLECTION_AWARE_HEADS: ReadonlySet<string> = new Set([
  'At',
  'Length',
  'PointX',
  'PointY',
  'PointZ',
  'Norm',
  'Sum',
  'Product',
  'Integrate',
]);

/**
 * Fail closed (D6) when a scalar interval kernel is handed a provably
 * collection-valued operand.
 *
 * Every kernel in this target reads `.lo`/`.hi` off its operands: a
 * JavaScript array reaching `_IA.add` answers `{ lo: NaN, hi: NaN }` behind
 * `success: true`, and one reaching `_IA.less` answers `'maybe'` — a wrong
 * value where the interpreter broadcasts element-wise. The interval domain
 * has no element-wise convention (one interval per quantity), so such an
 * operand declines here with a message saying so; the interpreter evaluates
 * it. Only PROVABLE collection-ness is tested (`isCollection`, or a type that
 * matches the `collection<any>` shape top): a wide-declared operand
 * (`unknown`, a function's unannotated parameter) keeps compiling, since
 * scalar curve and implicit plotting ride this target on exactly such
 * operands.
 */
function assertScalarIntervalOperands(
  head: string,
  args: ReadonlyArray<Expression>
): void {
  for (const arg of args) {
    if (arg.isCollection || arg.type.matches('collection<any>'))
      throw new Error(
        `${head}: cannot compile — the operand \`${arg.toString()}\` is a ` +
          `collection (type \`${arg.type.toString()}\`), and the interval ` +
          `target's kernels take one interval per operand; the interval domain ` +
          `has no element-wise convention. Evaluate the expression instead, or ` +
          `compile a scalar per-element function. Fail closed (D6).`
      );
  }
}

/** Gate-wrapped handlers, built once per head (`guardedIntervalFunction`). */
const GUARDED_INTERVAL_FUNCTIONS = new Map<
  string,
  CompiledFunction<Expression>
>();

/**
 * The handler of `INTERVAL_JAVASCRIPT_FUNCTIONS` for `id`, wrapped so that
 * `assertScalarIntervalOperands` runs on its operands — unless the head is one
 * of `COLLECTION_AWARE_HEADS`, or there is no function-valued handler to wrap.
 * Both `functions` resolvers of this target (the bare `createTarget` one and
 * the `compileOrThrow` one that consults caller overrides first) go through
 * here, so a kernel is never reachable ungated.
 *
 * The gate runs AFTER the handler, not before: a handler that declines on its
 * own terms (`When`'s `assertScalarCondition` names the collection-valued
 * BRANCH CONDITION, `Round` its non-constant precision) reports the more
 * specific reason, and a decline discards the whole compilation anyway, so
 * the emission the handler produced first costs nothing.
 */
function guardedIntervalFunction(
  id: string
): CompiledFunction<Expression> | undefined {
  const handler = INTERVAL_JAVASCRIPT_FUNCTIONS[id];
  if (typeof handler !== 'function' || COLLECTION_AWARE_HEADS.has(id))
    return handler;
  let wrapped = GUARDED_INTERVAL_FUNCTIONS.get(id);
  if (wrapped === undefined) {
    wrapped = (args, compile, target) => {
      const code = handler(args, compile, target);
      assertScalarIntervalOperands(id, args);
      return code;
    };
    GUARDED_INTERVAL_FUNCTIONS.set(id, wrapped);
  }
  return wrapped;
}

const INTERVAL_JAVASCRIPT_CONSTANTS: Record<string, string> = {
  __proto__: null as never,
  Pi: '_IA.point(Math.PI)',
  ExponentialE: '_IA.point(Math.E)',
  // The boolean literals are constants, not free symbols: without them a bare
  // `True` compiled to a dangling `_.True` vars-object lookup that throws at
  // run time. This target's boolean domain is `BoolInterval`
  // (`'true' | 'false' | 'maybe'` — see `interval/types.ts`), so the inlined
  // spelling is the STRING, not a JavaScript boolean.
  True: "'true'",
  False: "'false'",
  NaN: '{ lo: NaN, hi: NaN }',
  ImaginaryUnit: '{ lo: NaN, hi: NaN }',
  Half: '_IA.point(0.5)',
  MachineEpsilon: '_IA.point(Number.EPSILON)',
  GoldenRatio: '_IA.point((1 + Math.sqrt(5)) / 2)',
  CatalanConstant: '_IA.point(0.91596559417721901)',
  EulerGamma: '_IA.point(0.57721566490153286)',
};

/**
 * Interval arithmetic function implementations.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const INTERVAL_JAVASCRIPT_FUNCTIONS: CompiledFunctions<Expression> = {
  __proto__: null as never,
  // Basic arithmetic - using function call syntax
  Add: (args, compile) => {
    if (args.length === 0) return '_IA.point(0)';
    if (args.length === 1) return compile(args[0]);
    // Chain additions: (a + b) + c
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.add(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  // No Subtract handler — canonicalizes to Add+Negate before compilation.
  Multiply: (args, compile) => {
    if (args.length === 0) return '_IA.point(1)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.mul(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Divide: (args, compile) => {
    if (args.length === 0) return '_IA.point(1)';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2)
      return `_IA.div(${compile(args[0])}, ${compile(args[1])})`;
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.div(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Negate: (args, compile) => `_IA.negate(${compile(args[0])})`,

  // Elementary functions
  // Note: `Abs` of a fixed-arity point never reaches this handler — the
  // shared compiler rewrites `Abs(Tuple)` → `Norm` (base-compiler.ts) so
  // the point compiles through the `Norm` codegen below (Tycho item 74).
  Abs: (args, compile) => `_IA.abs(${compile(args[0])})`,
  // Euclidean (L2) norm of a fixed-arity point. Only the default L2 norm of
  // a structural `Tuple` is representable here; any other operand, an
  // explicit norm-type argument, or a broadcasting component throws to fail
  // closed to scalar JS.
  Norm: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        'Norm: only the default L2 norm compiles on the interval target'
      );
    const arg = args[0];
    if (!isFunction(arg, 'Tuple'))
      throw new Error(
        'Norm: the interval target requires a fixed-arity point operand'
      );
    // A broadcasting component means one norm per zipped element — not
    // representable as a scalar interval. Fail closed (D6).
    if (pointHasBroadcastComponent(arg))
      throw new Error(
        'Norm: cannot compile a point with a broadcasting component. ' +
          'Fail closed (D6).'
      );
    return compileIntervalPointNorm(arg.ops, compile);
  },

  // Collection ACCESSORS — the heads of this table that take a collection
  // OPERAND (every other kernel fails closed on one, see
  // `assertScalarIntervalOperands`). The operand is a JavaScript array of
  // intervals at run time, and `_IA.at` / `_IA.length` / `_IA.component`
  // project it back down to a single interval (`interval/collections.ts`).
  // There is deliberately no `List` or `Tuple` lowering in this table — see
  // `compileIntervalCollectionOperand`.

  // Element count of a collection, as a point interval.
  Length: (args, compile, target) => {
    const arg = args[0];
    if (arg === null || arg === undefined)
      throw new Error('Length: no argument');
    // A string's length is its GRAPHEME-CLUSTER count, and this target has no
    // text model at all — its domain is numeric, one interval per quantity —
    // so there is nothing to count clusters with here. The union case
    // (`string | list<number>`) is refused for the same reason: it may hold a
    // string at run time.
    if (isProvablyStringOperand(arg) || couldBeStringOperand(arg))
      throw new Error(
        `Length: cannot compile — the operand may be text at run time, and ` +
          `the interval target's domain is numeric (one interval per ` +
          `quantity) with no text model. Fail closed (D6).`
      );
    if (!isIndexedCollectionOperand(arg))
      throw new Error(
        `Length: cannot compile — operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    // A literal collection's length is a compile-time constant.
    const ops = literalCollectionOps(arg, target);
    if (ops !== undefined) return `_IA.point(${ops.length})`;
    return `_IA.length(${compile(arg)})`;
  },

  // Positional access. CE `At` is 1-based and a negative index counts from the
  // end; an index of 0, an out-of-range index or a non-integer index selects
  // nothing, which this target reports as the numeric absence marker. The
  // index is an INTERVAL here, so it stands for a set of indices and `_IA.at`
  // answers the hull of the elements they select (see
  // `interval/collections.ts`).
  At: (args, compile, target) => {
    const coll = args[0];
    const index = args[1];
    if (
      coll === null ||
      coll === undefined ||
      index === null ||
      index === undefined
    )
      throw new Error('At: missing argument');
    if (args.length !== 2)
      throw new Error(
        `At: only the single-index form compiles; multi-index (nested) ` +
          `access is not supported. Fail closed (D6).`
      );
    // A string base is indexed by grapheme cluster, and this target has no
    // text model — see the `Length` handler above.
    if (isProvablyStringOperand(coll) || couldBeStringOperand(coll))
      throw new Error(
        `At: cannot compile — the base may be text at run time, and the ` +
          `interval target's domain is numeric (one interval per quantity) ` +
          `with no text model. Fail closed (D6).`
      );
    const provablyIndexed = isIndexedCollectionOperand(coll);
    if (!provablyIndexed && !couldBeIndexedCollectionOperand(coll))
      throw new Error(
        `At: cannot compile — first operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    // A base admitted only by the "could be" path may be a DICTIONARY at run
    // time, and a keyed lookup has no interval lowering: `_IA.at` answers the
    // absence marker for every non-array base, where the interpreter returns
    // the stored value. Require a provably numeric index there rather than
    // emit a silent absence behind `success: true`.
    if (!provablyIndexed && !isNumericIndexOperand(index))
      throw new Error(
        `At: cannot compile — the first operand is not provably an indexed ` +
          `collection (type \`${coll.type.toString()}\`) and the index is not ` +
          `provably numeric, so a keyed (dictionary) access cannot be ruled ` +
          `out. Fail closed (D6).`
      );
    // A TUPLE base with a component that is not a number (a `tuple<number,
    // string>` pair) matches the indexed-collection shape, but the selected
    // component has no interval reading: `_IA.at` would answer `entire` for
    // it at run time behind `success: true`. Decline statically instead.
    const baseType = compilationType(coll);
    if (
      typeof baseType !== 'string' &&
      baseType.kind === 'tuple' &&
      baseType.elements.some((el) => !isSubtype(el.type, 'number'))
    )
      throw new Error(
        `At: cannot compile — the tuple base has a component that is not a ` +
          `number (its type is \`${coll.type.toString()}\`), and the interval ` +
          `target's value is a numeric interval. Fail closed (D6).`
      );
    // A COLLECTION index is a gather or a boolean mask, whose result is itself
    // a collection — one element per index entry. This target's value is a
    // single interval, so there is nothing to put that in.
    if (
      isIndexedCollectionOperand(index) ||
      index.type.matches('collection<any>')
    )
      throw new Error(
        `At: cannot compile — a collection-valued index (a gather or a ` +
          `boolean mask) selects several elements, and the interval target's ` +
          `value is a single interval, not a collection. Fail closed (D6).`
      );
    // A literal collection indexed by a literal integer folds to the selected
    // element (or to the absence marker when the index selects nothing),
    // applying the interpreter's 1-based / negative-from-the-end convention at
    // compile time.
    const ops = literalCollectionOps(coll, target);
    if (ops !== undefined && isNumber(index) && index.im === 0) {
      const i = index.re;
      if (Number.isInteger(i)) {
        const k = i > 0 ? i - 1 : ops.length + i;
        if (i === 0 || k < 0 || k >= ops.length) return INTERVAL_ABSENCE;
        return compile(ops[k]);
      }
    }
    return `_IA.at(${compileIntervalCollectionOperand(
      coll,
      compile,
      target
    )}, ${compile(index)})`;
  },

  // Point coordinates. The operand must be a SINGLE point — see
  // `compileIntervalPointComponent`.
  PointX: (args, compile, target) =>
    compileIntervalPointComponent('PointX', args[0], 0, compile, target),
  PointY: (args, compile, target) =>
    compileIntervalPointComponent('PointY', args[0], 1, compile, target),
  PointZ: (args, compile, target) =>
    compileIntervalPointComponent('PointZ', args[0], 2, compile, target),

  Ceil: (args, compile) => `_IA.ceil(${compile(args[0])})`,
  Exp: (args, compile) => `_IA.exp(${compile(args[0])})`,
  Floor: (args, compile) => `_IA.floor(${compile(args[0])})`,
  Ln: (args, compile) => `_IA.ln(${compile(args[0])})`,
  Log: (args, compile) => {
    if (args.length === 1) return `_IA.log10(${compile(args[0])})`;
    // Log with custom base: log_b(x) = ln(x) / ln(b)
    return `_IA.div(_IA.ln(${compile(args[0])}), _IA.ln(${compile(args[1])}))`;
  },
  Lb: (args, compile) => `_IA.log2(${compile(args[0])})`,
  Max: (args, compile) => {
    if (args.length === 0) return '_IA.point(-Infinity)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.max(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Min: (args, compile) => {
    if (args.length === 0) return '_IA.point(Infinity)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.min(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  // Element-wise max/min and clamp. These lowerings are SCALAR: they fold the
  // operands with the interval max/min, and `Clamp(x, lo, hi)` becomes
  // `min(max(x, lo), hi)`. A collection operand has no element-wise treatment
  // here — this target's value is one interval.
  // Interval max/min/clamp are monotonic, so they map endpoint-wise — enabling
  // break detection for the common `Clamp(x, 0, 1)` line-series idiom.
  ElementMax: (args, compile) => {
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      result = `_IA.max(${result}, ${compile(args[i])})`;
    return result;
  },
  ElementMin: (args, compile) => {
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      result = `_IA.min(${result}, ${compile(args[i])})`;
    return result;
  },
  Clamp: (args, compile) =>
    `_IA.min(_IA.max(${compile(args[0])}, ${compile(args[1])}), ${compile(
      args[2]
    )})`,
  Power: (args, compile) => {
    const base = args[0];
    const exp = args[1];
    if (base === null) throw new Error('Power: no argument');
    // Check if this is e^x (base is ExponentialE)
    if (isSymbol(base, 'ExponentialE')) {
      return `_IA.exp(${compile(exp)})`;
    }
    // Check if exponent is a constant number
    if (isNumber(exp) && exp.im === 0) {
      const expVal = exp.re;
      if (expVal === 0.5) return `_IA.sqrt(${compile(base)})`;
      if (expVal === 2) return `_IA.square(${compile(base)})`;
      // Rational exponent p/q (in lowest terms) with an ODD denominator is real
      // for a negative base too (e.g. (-8)^(2/3) = 4). Route through
      // `powRational`, which applies the interpreter's real-root convention;
      // plain `_IA.pow` would return `empty` for the negative part.
      const p = exp.numerator?.re;
      const q = exp.denominator?.re;
      if (
        !Number.isInteger(expVal) &&
        Number.isInteger(p) &&
        Number.isInteger(q) &&
        q > 1 &&
        q % 2 !== 0
      ) {
        return `_IA.powRational(${compile(base)}, ${p}, ${q})`;
      }
      return `_IA.pow(${compile(base)}, ${expVal})`;
    }
    // Variable exponent - use powInterval
    return `_IA.powInterval(${compile(base)}, ${compile(exp)})`;
  },
  Root: (args, compile) => {
    const [arg, exp] = args;
    if (arg === null) throw new Error('Root: no argument');
    if (exp === null) return `_IA.sqrt(${compile(arg)})`;
    if (exp?.re === 2) return `_IA.sqrt(${compile(arg)})`;
    if (isNumber(exp) && exp.im === 0) {
      // Integer degree: `nthRoot` gives the real root for an odd degree over a
      // negative base (the interpreter's convention, e.g. Root(-8, 3) = -2);
      // an even degree reduces to x^(1/n) (no real value for a negative base).
      if (Number.isInteger(exp.re))
        return `_IA.nthRoot(${compile(arg)}, ${exp.re})`;
      // Non-integer degree: nth root = x^(1/n).
      return `_IA.pow(${compile(arg)}, ${1 / exp.re})`;
    }
    return `_IA.powInterval(${compile(arg)}, _IA.div(_IA.point(1), ${compile(
      exp
    )}))`;
  },
  Round: (args, compile) => {
    if (args.length < 2) return `_IA.round(${compile(args[0])})`;
    // Round(x, n) = Round(x·10ⁿ)/10ⁿ — round to `n` decimal places. Only the
    // constant-`n` form is representable here (the factor must be a point);
    // a non-constant precision throws to fail closed to scalar JS.
    const n = args[1];
    if (!isNumber(n) || n.im !== 0 || !Number.isInteger(n.re))
      throw new Error('Round: interval target requires a constant precision');
    const factor = `_IA.point(${Math.pow(10, n.re)})`;
    return `_IA.div(_IA.round(_IA.mul(${compile(args[0])}, ${factor})), ${factor})`;
  },
  Heaviside: (args, compile) => `_IA.heaviside(${compile(args[0])})`,
  Sign: (args, compile) => `_IA.sign(${compile(args[0])})`,
  Sqrt: (args, compile) => `_IA.sqrt(${compile(args[0])})`,
  Square: (args, compile) => `_IA.square(${compile(args[0])})`,

  // Trigonometric functions
  Sin: (args, compile) => `_IA.sin(${compile(args[0])})`,
  Cos: (args, compile) => `_IA.cos(${compile(args[0])})`,
  Tan: (args, compile) => `_IA.tan(${compile(args[0])})`,
  Cot: (args, compile) => `_IA.cot(${compile(args[0])})`,
  Sec: (args, compile) => `_IA.sec(${compile(args[0])})`,
  Csc: (args, compile) => `_IA.csc(${compile(args[0])})`,
  Arcsin: (args, compile) => `_IA.asin(${compile(args[0])})`,
  Arccos: (args, compile) => `_IA.acos(${compile(args[0])})`,
  Arctan: (args, compile) => `_IA.atan(${compile(args[0])})`,
  Arccot: (args, compile) => `_IA.acot(${compile(args[0])})`,
  Arccsc: (args, compile) => `_IA.acsc(${compile(args[0])})`,
  Arcsec: (args, compile) => `_IA.asec(${compile(args[0])})`,

  // Hyperbolic functions
  Sinh: (args, compile) => `_IA.sinh(${compile(args[0])})`,
  Cosh: (args, compile) => `_IA.cosh(${compile(args[0])})`,
  Tanh: (args, compile) => `_IA.tanh(${compile(args[0])})`,
  Coth: (args, compile) => `_IA.coth(${compile(args[0])})`,
  Csch: (args, compile) => `_IA.csch(${compile(args[0])})`,
  Sech: (args, compile) => `_IA.sech(${compile(args[0])})`,
  Arsinh: (args, compile) => `_IA.asinh(${compile(args[0])})`,
  Arcosh: (args, compile) => `_IA.acosh(${compile(args[0])})`,
  Artanh: (args, compile) => `_IA.atanh(${compile(args[0])})`,
  Arcoth: (args, compile) => `_IA.acoth(${compile(args[0])})`,
  Arcsch: (args, compile) => `_IA.acsch(${compile(args[0])})`,
  Arsech: (args, compile) => `_IA.asech(${compile(args[0])})`,

  // Cardinal sine
  Sinc: (args, compile) => `_IA.sinc(${compile(args[0])})`,

  // Fresnel integrals
  FresnelS: (args, compile) => `_IA.fresnelS(${compile(args[0])})`,
  FresnelC: (args, compile) => `_IA.fresnelC(${compile(args[0])})`,

  // Special functions
  Factorial: (args, compile) => `_IA.factorial(${compile(args[0])})`,
  Factorial2: (args, compile) => `_IA.factorial2(${compile(args[0])})`,
  Gamma: (args, compile) => `_IA.gamma(${compile(args[0])})`,
  GammaLn: (args, compile) => `_IA.gammaln(${compile(args[0])})`,
  Binomial: (args, compile) =>
    `_IA.binomial(${compile(args[0])}, ${compile(args[1])})`,
  // `Choose(n, k)` is the binomial coefficient — the same runtime helper,
  // exactly as on the JavaScript target (Tycho item 237).
  Choose: (args, compile) =>
    `_IA.binomial(${compile(args[0])}, ${compile(args[1])})`,
  GCD: (args, compile) => `_IA.gcd(${compile(args[0])}, ${compile(args[1])})`,
  LCM: (args, compile) => `_IA.lcm(${compile(args[0])}, ${compile(args[1])})`,
  // Tolerance baked at compile time from the engine, matching the
  // interpreter's `Chop` and the JS target (see `javascript-target.ts`).
  Chop: (args, compile) =>
    `_IA.chop(${compile(args[0])}, ${args[0]?.engine?.tolerance ?? 1e-10})`,
  Erf: (args, compile) => `_IA.erf(${compile(args[0])})`,
  Erfc: (args, compile) => `_IA.erfc(${compile(args[0])})`,
  Exp2: (args, compile) => `_IA.exp2(${compile(args[0])})`,
  Arctan2: (args, compile) =>
    `_IA.atan2(${compile(args[0])}, ${compile(args[1])})`,
  Hypot: (args, compile) =>
    `_IA.hypot(${compile(args[0])}, ${compile(args[1])})`,

  // Elementary
  Fract: (args, compile) => `_IA.fract(${compile(args[0])})`,
  Truncate: (args, compile) => `_IA.trunc(${compile(args[0])})`,

  // Mod / Remainder
  Mod: (args, compile) => `_IA.mod(${compile(args[0])}, ${compile(args[1])})`,
  Remainder: (args, compile) =>
    `_IA.remainder(${compile(args[0])}, ${compile(args[1])})`,

  // Sum / Product
  Sum: (args, compile, target) =>
    compileIntervalSumProduct('Sum', args, compile, target),
  Product: (args, compile, target) =>
    compileIntervalSumProduct('Product', args, compile, target),

  // Integration
  Integrate: (args, compile, target) =>
    compileIntervalIntegrate(args, compile, target),

  // Conditionals
  If: (args, compile) => {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    // For interval arithmetic, we need to handle indeterminate conditions.
    // Both arms are thunks — conditionally evaluated — so their operand
    // indices are passed to the compile callback (`OperandCompiler`), which
    // opens the matching CSE region.
    return `_IA.piecewise(
      ${compile(args[0])},
      () => ${compile(args[1], 1)},
      () => ${compile(args[2], 2)}
    )`;
  },
  // Domain restriction: When(body, cond) → body where cond holds, empty
  // where it doesn't. Must NOT fall through to the generic JS ternary: the
  // interval comparisons return the tri-state string 'true'|'false'|'maybe',
  // which is always truthy, so a ternary guard would never mask.
  When: (args, compile) => {
    if (args.length !== 2)
      throw new Error('When: expected 2 arguments (value, condition)');
    // `When` is not a selection form: its condition must be a scalar boolean.
    BaseCompiler.assertScalarCondition(args[1]);
    // The VALUE is the conditional position (operand 0); the condition is
    // eager — matching the `When` entry of the lazy-operand inventory.
    return `_IA.restrict(${compile(args[1])}, () => ${compile(args[0], 0)})`;
  },
  Which: (args, compile) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error(
        'Which: expected even number of arguments (condition/value pairs)'
      );
    // Build nested piecewise calls for each condition/value pair. Every value
    // arm, and every condition after the first, is conditionally evaluated —
    // pass its operand index so the CSE pass opens the matching region.
    const buildPiecewise = (i: number): string => {
      if (i >= args.length) return `{ kind: 'empty' }`;
      const cond = args[i];
      const val = args[i + 1];
      // If condition is the symbol True, it's the default branch
      if (isSymbol(cond, 'True')) {
        return compile(val, i + 1);
      }
      return `_IA.piecewise(
      ${i === 0 ? compile(cond) : compile(cond, i)},
      () => ${compile(val, i + 1)},
      () => ${buildPiecewise(i + 2)}
    )`;
    };
    return buildPiecewise(0);
  },
  // Epsil `Match`: structural pattern matching. An interval subject spanning
  // two cases' constants has the same discontinuity hazard as compiled `Which`,
  // but a faithful interval treatment (per-branch `singular` semantics for
  // structural equality dispatch) is an explicit v1 out (design §5). Fail closed
  // (D6) rather than invent it.
  Match: () => {
    throw new Error(
      'Match: pattern matching is not supported by the interval-js compile target in v1. Fail closed (D6).'
    );
  },
  // Comparisons. Chained (N-ary) relations conjoin ALL pairwise comparisons
  // with the tri-state `_IA.and` (e.g. `1 < x < 4` → less(1,x) ∧ less(x,4)).
  Equal: (args, compile, target) =>
    compileIntervalChain('_IA.equal', args, compile, target),
  NotEqual: (args, compile, target) =>
    compileIntervalChain('_IA.notEqual', args, compile, target),
  LessEqual: (args, compile, target) =>
    compileIntervalChain('_IA.lessEqual', args, compile, target),
  GreaterEqual: (args, compile, target) =>
    compileIntervalChain('_IA.greaterEqual', args, compile, target),
  Less: (args, compile, target) =>
    compileIntervalChain('_IA.less', args, compile, target),
  Greater: (args, compile, target) =>
    compileIntervalChain('_IA.greater', args, compile, target),
  And: (args, compile) => compileIntervalFold('_IA.and', args, compile),
  Or: (args, compile) => compileIntervalFold('_IA.or', args, compile),
  Not: (args, compile) => `_IA.not(${compile(args[0])})`,
  // Apply a function literal to arguments — the `f'` prime-derivative
  // spelling lowers to `Apply(Function(…), x)`. As on the JavaScript target,
  // `Apply` with a *symbol* head canonicalizes to a direct call, so only the
  // function-literal form reaches this handler; the literal compiles to an
  // arrow over intervals through the shared `Function` lowering.
  // (Tycho item 237.)
  Apply: (args, compile) => {
    if (args[0] == null) throw new Error('Apply: missing function');
    // Only an exact-arity application of a FUNCTION LITERAL compiles. The
    // interpreter THROWS on an over-applied call and CURRIES an
    // under-applied one (`function-utils.ts`, `makeLambda`); a plain
    // JavaScript call would instead silently truncate the extras or bind
    // the missing parameters to `undefined`. A non-literal callee (a
    // valueless function symbol) has no parameter list to check against.
    // Fail closed (D6) on all of those.
    const fn = args[0];
    if (!isFunction(fn, 'Function'))
      throw new Error(
        `Apply: only a function-literal callee compiles on the interval ` +
          `target. Fail closed (D6).`
      );
    const paramCount = fn.ops.length - 1;
    if (args.length - 1 !== paramCount)
      throw new Error(
        `Apply: the function takes ${paramCount} parameter(s) but ` +
          `${args.length - 1} argument(s) are supplied — the interpreter ` +
          `curries or throws there, which this target cannot express. ` +
          `Fail closed (D6).`
      );
    return `(${compile(args[0])})(${args
      .slice(1)
      .map((a) => compile(a))
      .join(', ')})`;
  },
  // A random draw, enclosed by its distribution's SUPPORT: every value
  // `Random()` can produce lies in [0, 1], so the constant interval is a
  // sound band for any draw, on any evaluation. Threading the actual seeded
  // sequence through this lane would be UNSOUND instead: the interval lane
  // samples at different points and in a different order than the scalar
  // lane, so its draw sequence would diverge from the values the scalar
  // lane actually plots, and the band would no longer enclose them. Only
  // the nullary form is claimed: `Random(source)` draws from an interval, a
  // range, or a collection, whose support this handler does not compute —
  // fail closed (D6) rather than emit a wrong enclosure.
  // (Tycho item 237.)
  Random: (args) => {
    if (args.length !== 0)
      throw new Error(
        `Random: only the nullary form compiles on the interval target — ` +
          `the support of \`Random(source)\` is not derived here. ` +
          `Fail closed (D6).`
      );
    return '({ lo: 0, hi: 1 })';
  },
  // The body's random draws are enclosed by their support (see `Random`
  // above), which no seed can narrow or shift — so the frame contributes
  // nothing on this target and only the body is emitted. The seed operand is
  // a plain value (a number or a string) and is not emitted.
  // (Tycho item 237.)
  WithRandomSeed: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `WithRandomSeed: expected exactly two arguments. Fail closed (D6).`
      );
    // Only a LITERAL seed is accepted — a finite real or a string, the
    // values the interpreter's own validation admits. A compound seed
    // expression would have to be evaluated once per frame entry (the
    // interpreter's contract), and this target has no emission for that
    // evaluation — silently discarding it would also discard the
    // out-of-range error an invalid seed raises. Fail closed (D6) instead.
    const seed = args[0];
    const literalSeed =
      (isNumber(seed) && seed.im === 0 && Number.isFinite(seed.re)) ||
      isString(seed);
    if (!literalSeed)
      throw new Error(
        `WithRandomSeed: only a literal finite real or string seed compiles ` +
          `on the interval target. Fail closed (D6).`
      );
    return compile(args[1]);
  },
};

/**
 * Maximum number of terms to unroll in an interval Sum/Product.
 */
const INTERVAL_UNROLL_LIMIT = 100;

/**
 * Extract index, lower, and upper from a Limits expression.
 * Returns the raw Expression nodes so they can be compiled.
 */
function extractIntervalLimits(limitsExpr: Expression): {
  index: string;
  lowerExpr: Expression;
  upperExpr: Expression;
  lowerNum: number | undefined;
  upperNum: number | undefined;
} {
  console.assert(limitsExpr.operator === 'Limits');
  const fn = limitsExpr as Expression & {
    op1: Expression;
    op2: Expression;
    op3: Expression;
  };
  const index = isSymbol(fn.op1) ? fn.op1.symbol : '_';
  const lowerExpr = fn.op2;
  const upperExpr = fn.op3;
  // A bound mentioning a compile-bound name (a user function's parameter, an
  // enclosing binder's index) is NOT a compile-time constant — see
  // `BaseCompiler.bigOpBoundConstant`.
  return {
    index,
    lowerExpr,
    upperExpr,
    lowerNum: BaseCompiler.bigOpBoundConstant(lowerExpr),
    upperNum: BaseCompiler.bigOpBoundConstant(upperExpr),
  };
}

/**
 * Fail closed (D6) on a Sum/Product bound that is statically non-finite (a
 * `±∞`/`NaN` literal, or an expression typed `infinity` or `nan`), so
 * `compile()` reports failure and the caller falls back to the interpreter.
 * `for (i = 1; i <= Infinity; i++)` never terminates and `-Infinity + 1` never
 * advances, so such a bound would lock the caller's thread. Mirrors
 * `assertFiniteBound` in the JavaScript target.
 */
function assertFiniteIntervalBound(
  kind: 'Sum' | 'Product',
  expr: Expression,
  which: 'lower' | 'upper'
): void {
  const nonFinite =
    (isNumber(expr) && !Number.isFinite(expr.re)) ||
    expr.type.matches('infinity') ||
    expr.type.matches('nan');
  if (!nonFinite) return;
  throw new Error(
    `${kind}: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop. ` +
      `Fail closed (D6).`
  );
}

/**
 * Compile a bound expression to a scalar JavaScript value for use as a loop
 * counter. For the interval target, bounds must be plain numbers (not intervals).
 *
 * At runtime, a compiled bound expression produces one of two shapes:
 * a bare `Interval` ({lo, hi}) — e.g. a plain input variable `_.n` — or an
 * `IntervalResult` wrapper ({kind, value: {lo, hi}}) returned by `_IA.*`
 * operators (e.g. a compound bound like `n + 2`). We extract the upper bound
 * from whichever shape is present (for point intervals lo === hi).
 */
function compileIntervalBound(
  expr: Expression,
  numVal: number | undefined,
  target: CompileTarget<Expression>
): string {
  if (numVal !== undefined) return String(numVal);
  // Compile the bound expression (produces an interval or an IntervalResult
  // wrapper at runtime), then extract the scalar upper bound for the loop
  // counter. Reading `.hi` directly off an IntervalResult is `undefined`
  // (→ NaN → the loop never runs), so unwrap `.value` when present.
  const compiled = BaseCompiler.compile(expr, target);
  return `Math.floor(((_b) => (_b && _b.value ? _b.value.hi : _b.hi))(${compiled}))`;
}

/**
 * Heads that broadcast ELEMENT-WISE over a collection operand in the
 * interpreter, used by `intervalCollectionElements` to decompose a
 * collection-valued big-op operand (`Sum([0.64, 0.77]²)`) into per-element
 * scalar expressions. Deliberately small: only heads whose one-collection
 * broadcast is a plain per-element map, with every OTHER operand scalar.
 * A head outside this set leaves the operand undecomposed, and the reduce
 * form then fails closed rather than guess.
 *
 * The rebuild re-emits the scalar SIBLING operand once per element
 * (`Add(L, s)` compiles `s` for every `L_k`). That is sound on this target
 * because every interval emission is effect-free and per-call stable —
 * `Random()` compiles to a constant support interval, and no lowering
 * writes state — so repeated emission cannot diverge from a once-evaluated
 * sibling. A future lowering that is NOT per-call stable must hoist the
 * sibling to a temporary first (the `compileIntervalChain` pattern).
 */
const ELEMENTWISE_INTERVAL_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Abs',
  'Exp',
  'Ln',
]);

/**
 * The per-element EXPRESSIONS of a collection-valued big-op operand, or
 * `undefined` when the operand cannot be decomposed statically (which makes
 * the reduce form fall back to the runtime-array path, or fail closed).
 * At most `budget` elements are produced — mirroring the indexed form's
 * `INTERVAL_UNROLL_LIMIT` cap on emitted terms.
 *
 * Shapes handled, recursively:
 * - a literal `List`/`Tuple`, written inline or held as a symbol's assigned
 *   value (`literalCollectionOps`);
 * - `Range` with literal integer bounds (ascending, unit or literal step);
 * - `Map(fn, collection)` — each element becomes `Apply(fn, element)`, which
 *   the `Apply` lowering compiles (and canonicalization may reduce);
 * - an element-wise head (`ELEMENTWISE_INTERVAL_HEADS`) with exactly ONE
 *   decomposable collection operand, every other operand provably scalar —
 *   rebuilt per element (`Power(L, 2)` → `Power(L_k, 2)`).
 */
function intervalCollectionElements(
  e: Expression,
  target: CompileTarget<Expression>,
  budget: number
): ReadonlyArray<Expression> | undefined {
  const literal = literalCollectionOps(e, target);
  if (literal !== undefined)
    return literal.length <= budget ? literal : undefined;

  const node = assignedLiteral(e, target) ?? e;
  if (!isFunction(node)) return undefined;
  const ce = node.engine;

  if (node.operator === 'Range') {
    // The interpreter's contract, mirrored from `literalRange` and the
    // Range collection handlers (`library/collections.ts`): `Range(hi)`
    // counts from 1; a two-operand range infers step ±1 from the bounds'
    // order; real bounds and steps are legal; the element count is
    // `max(0, floor((hi - lo) / step) + 1)` (a zero step is empty).
    // Iteration is COUNT-driven with `lo + i·step` elements — an
    // endpoint-driven `k += step` loop can fail to make progress past
    // 2^53 and hang the compilation.
    const nums = node.ops.map((op) =>
      isNumber(op) && op.im === 0 && Number.isFinite(op.re) ? op.re : undefined
    );
    if (nums.some((n) => n === undefined)) return undefined;
    let lo: number, hi: number, step: number;
    if (nums.length === 1) [lo, hi, step] = [1, nums[0]!, 1];
    else if (nums.length === 2)
      [lo, hi, step] = [nums[0]!, nums[1]!, nums[1]! >= nums[0]! ? 1 : -1];
    else if (nums.length === 3) [lo, hi, step] = [nums[0]!, nums[1]!, nums[2]!];
    else return undefined;
    if (step === 0) return [];
    const count = Math.max(0, Math.floor((hi - lo) / step) + 1);
    if (!Number.isFinite(count) || count > budget) return undefined;
    const elements: Expression[] = [];
    for (let i = 0; i < count; i++) elements.push(ce.number(lo + i * step));
    return elements;
  }

  if (node.operator === 'Map' && node.ops.length === 2) {
    const inner = intervalCollectionElements(node.ops[1], target, budget);
    if (inner === undefined) return undefined;
    const fn = node.ops[0];
    return inner.map((el) => ce.function('Apply', [fn, el]));
  }

  if (ELEMENTWISE_INTERVAL_HEADS.has(node.operator)) {
    let collectionAt = -1;
    let elements: ReadonlyArray<Expression> | undefined = undefined;
    for (let i = 0; i < node.ops.length; i++) {
      const op = node.ops[i];
      if (op.type.matches('number')) continue;
      // At most one non-scalar operand, and it must itself decompose.
      if (collectionAt !== -1) return undefined;
      const decomposed = intervalCollectionElements(op, target, budget);
      if (decomposed === undefined) return undefined;
      collectionAt = i;
      elements = decomposed;
    }
    if (collectionAt === -1 || elements === undefined) return undefined;
    return elements.map((el) =>
      ce.function(
        node.operator,
        node.ops.map((op, i) => (i === collectionAt ? el : op))
      )
    );
  }

  return undefined;
}

/**
 * Compile the collection (reduce) form of `Sum`/`Product` — no indexing set,
 * the operand IS the collection (`Sum([3, 4, 5])`, the Desmos sum-a-list
 * spelling; Tycho item 237). A statically decomposable operand
 * (`intervalCollectionElements`) folds its compiled elements with
 * `_IA.add`/`_IA.mul`; the empty collection is the identity, matching the
 * interpreter (`Sum([]) = 0`, `Product([]) = 1`). An operand that is
 * statically an indexed collection but not decomposable (a vars-supplied
 * list) folds at run time, `_IA.point`-lifting raw numeric elements; a
 * runtime scalar returns itself (the interpreter's `Sum(scalar) = scalar`).
 * Anything else fails closed (D6).
 */
function compileIntervalCollectionReduce(
  kind: 'Sum' | 'Product',
  operand: Expression,
  target: CompileTarget<Expression>
): string {
  const iaOp = kind === 'Sum' ? '_IA.add' : '_IA.mul';
  const identity = kind === 'Sum' ? '_IA.point(0)' : '_IA.point(1)';
  const elements = intervalCollectionElements(
    operand,
    target,
    INTERVAL_UNROLL_LIMIT
  );
  if (elements !== undefined) {
    // A provably NON-numeric element (a string, a boolean, a nested
    // collection) would reach `_IA.add`/`_IA.mul`, which read `.lo`/`.hi`
    // off whatever they are handed and answer NaN bounds behind
    // `success: true` — the same silent-wrong class the scalar-kernel gate
    // (`assertScalarIntervalOperands`) closes. The interpreter errors on
    // such an element; fail closed (D6) to match.
    for (const el of elements) {
      const t = el.type;
      if (
        t.matches('string') ||
        t.matches('boolean') ||
        t.matches('collection<any>')
      )
        throw new Error(
          `${kind}: cannot compile the collection form — an element is not ` +
            `numeric (type \`${t.toString()}\`). Fail closed (D6).`
        );
    }
    if (elements.length === 0) return identity;
    return elements
      .map((el) => BaseCompiler.compile(el, target))
      .reduce((acc, cur) => `${iaOp}(${acc}, ${cur})`);
  }
  // The runtime-array fold below hands each element to `_IA.add`/`_IA.mul`,
  // so it requires elements PROVABLY numeric — the bare shape test
  // (`isIndexedCollectionOperand`) admits `list<any>`, whose elements are
  // unconstrained, and a nested list or string element would fold to NaN
  // bounds behind `success: true` (this is the reduce-form counterpart of
  // `assertScalarBigOpBody` on the indexed form).
  // A `Range` that did not decompose (symbolic bounds, or a count past the
  // unroll budget) has no lowering of its own on this target — the indexed
  // Sum/Product form reads Range bounds directly and never compiles the
  // node — so letting it fall through to `BaseCompiler.compile` would
  // produce a generic "Range has no lowering" error blaming the wrong
  // node. Name the operation instead.
  const resolved = assignedLiteral(operand, target) ?? operand;
  if (isFunction(resolved, 'Range'))
    throw new Error(
      `${kind}: cannot compile the collection form — the Range operand has ` +
        `symbolic bounds or too many elements to expand statically. ` +
        `Fail closed (D6).`
    );
  const elementType = collectionElementType(operand.type.type);
  const elementsProvablyNumeric =
    elementType !== undefined &&
    operand.engine.type(elementType).matches('number');
  if (!isIndexedCollectionOperand(operand) || !elementsProvablyNumeric) {
    // Name the OPERATION in the diagnostic, not the operand's head: a
    // `Range` that did not decompose (symbolic bounds, or past the unroll
    // budget) has no lowering of its own on this target, and the generic
    // "Range has no lowering" message would blame the wrong node.
    throw new Error(
      `${kind}: cannot compile the collection form — the operand is not a ` +
        `statically decomposable collection, and its type ` +
        `(\`${operand.type.toString()}\`) does not prove an indexed ` +
        `collection of numbers. Fail closed (D6).`
    );
  }
  const code = BaseCompiler.compile(operand, target);
  return (
    `((_c) => Array.isArray(_c) ? _c.reduce((_a, _b) => ` +
    `${iaOp}(_a, typeof _b === 'number' ? _IA.point(_b) : _b), ${identity})` +
    ` : _c)(${code})`
  );
}

/**
 * Compile Sum or Product for the interval arithmetic target.
 *
 * The iteration variable is substituted with `_IA.point(k)` so the
 * body compiles correctly as interval expressions.  Accumulation uses
 * `_IA.add` / `_IA.mul`.
 *
 * When bounds are symbolic, emits a loop with compiled bound expressions.
 */
function compileIntervalSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  // No indexing set: the collection (reduce) form — the operand IS the
  // collection (`Sum([3, 4, 5])`). See `compileIntervalCollectionReduce`.
  if (!args[1] && args.length === 1)
    return compileIntervalCollectionReduce(kind, args[0], target);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): interval scalar accumulation over
  // arrays would silently produce a wrong value. Reached only for the indexed
  // form (the `!args[1]` guard above rules out the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  // Multi-index Sum/Product would drop the trailing indexing sets. Fail closed
  // (D6) rather than emit code with a dangling index.
  if (args.length > 2)
    throw new Error(
      `${kind}: multi-index (${args.length - 1} indexing sets) is not supported in the interval target`
    );

  const { index, lowerExpr, upperExpr, lowerNum, upperNum } =
    extractIntervalLimits(args[1]);

  // Before ANY lowering decision — the unroll path included, which a
  // non-finite bound would otherwise skip on its way to the loop arm.
  assertFiniteIntervalBound(kind, lowerExpr, 'lower');
  assertFiniteIntervalBound(kind, upperExpr, 'upper');

  const isSum = kind === 'Sum';
  const iaOp = isSum ? '_IA.add' : '_IA.mul';
  const identity = isSum ? '_IA.point(0)' : '_IA.point(1)';

  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  // Empty range (only knowable when both bounds are constant)
  if (bothConstant && lowerNum > upperNum) return identity;

  // Unroll when both bounds are constant and range is small
  if (bothConstant) {
    const termCount = upperNum - lowerNum + 1;
    if (termCount <= INTERVAL_UNROLL_LIMIT) {
      const terms: string[] = [];
      for (let k = lowerNum; k <= upperNum; k++) {
        const innerTarget: CompileTarget<Expression> = {
          ...target,
          var: (id) => (id === index ? `_IA.point(${k})` : target.var(id)),
          boundVars: BaseCompiler.withBoundNames(target, [index]),
        };
        terms.push(BaseCompiler.compile(args[0], innerTarget));
      }

      let result = terms[terms.length - 1];
      for (let i = terms.length - 2; i >= 0; i--) {
        result = `${iaOp}(${terms[i]}, ${result})`;
      }
      return result;
    }
  }

  // Emit a loop (either large constant range or symbolic bounds)
  const lowerCode = compileIntervalBound(lowerExpr, lowerNum, target);
  const upperCode = compileIntervalBound(upperExpr, upperNum, target);

  const acc = BaseCompiler.tempVar(target);
  const bodyCode = BaseCompiler.compile(args[0], {
    ...target,
    var: (id) => (id === index ? `_IA.point(${index})` : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, [index]),
  });

  // A SYMBOLIC bound can still be `±∞`/`NaN` at run time — the same
  // non-terminating loop. Guard once at loop entry (never per iteration);
  // `entire` is the interval target's "cannot bound this" answer. Constant
  // bounds are statically finite by `assertFiniteIntervalBound` above, so they
  // take the unguarded template and their code is unchanged.
  if (lowerNum === undefined || upperNum === undefined) {
    return `(() => { let ${acc} = ${identity}; const _upper = ${upperCode}; const _lower = ${lowerCode}; if (!Number.isFinite(_upper) || !Number.isFinite(_lower)) return { kind: 'entire' }; for (let ${index} = _lower; ${index} <= _upper; ${index}++) { ${acc} = ${iaOp}(${acc}, ${bodyCode}); } return ${acc}; })()`;
  }

  return `(() => { let ${acc} = ${identity}; const _upper = ${upperCode}; for (let ${index} = ${lowerCode}; ${index} <= _upper; ${index}++) { ${acc} = ${iaOp}(${acc}, ${bodyCode}); } return ${acc}; })()`;
}

/**
 * Compile `Integrate(f, (x, a, b))` for the interval arithmetic target.
 *
 * **Antiderivative-first, guarded.** The shared
 * `BaseCompiler.closedFormIntegral` resolves the integral symbolically under
 * its own wall-clock budget. When it closes, the straight-line expression is
 * compiled as interval code — an enclosure that is both tight (no partition
 * error at all) and cheap — but it is NOT returned bare: the symbolic step
 * differences an antiderivative at the bounds without checking that the
 * integrand is bounded between them (`∫₋₁¹ dt/t²` closes to `−2` although
 * the integral diverges at the interior pole), and a wrong closed form on
 * this target would be a zero-width "enclosure" of a divergent integral. So a
 * definite integral's closed form is emitted as a thunk handed to
 * `_IA.integrateClosed`, which scans the integrand over the range at run time
 * and returns the closed form only when the scan finds no pole, gap or
 * unbounded stretch — otherwise it falls back to the enclosure below (see
 * `interval/integrate.ts`). An INDEFINITE integral that closes (`∫ e^{−t²} dt`
 * → `½√π·erf(t)`) has no range to scan and compiles to the closed form
 * directly, as a function of its free bound. The closed form can name a head
 * this target has no lowering for, so it is compiled inside a `try` that
 * falls through to the enclosure emitter.
 *
 * **Enclosure.** Otherwise the integral lowers to
 * `_IA.integrate(f, lo, hi, n)`, which brackets the integral by a uniform
 * `n`-piece partition rather than estimating it. `n` is sized from
 * `INTERVAL_QUADRATURE_BUDGET` by nesting depth — 256 for a single or double
 * integral, fewer per level beyond that — so a d-fold integral never costs
 * more than the budget's worth of integrand evaluations. The bound
 * EXPRESSIONS are compiled, never the `bigOpBoundConstant` numbers
 * `extractIntervalLimits` also reports: those are floored, which is right for
 * the discrete `Sum`/`Product` counters that helper primarily serves and wrong
 * for a continuous integral (it would collapse `∫₀^0.5` to `∫₀^0`).
 *
 * The `quadrature: 'monte-carlo'` option is ignored here: it selects between
 * two STOCHASTIC/adaptive estimators on the scalar target, and this target has
 * no stochastic estimator — sampling produces no enclosure, which is the only
 * thing this target returns.
 */
/**
 * How much integration work a subtree can demand at run time, measured from
 * the tree: `paths` is the number of `Integrate` RUNS reachable per
 * evaluation of the subtree (an operand referenced twice runs twice, so
 * children's counts are SUMMED — path counting, which a per-distinct-node
 * memo computes in linear time), and `depth` is the deepest multiplicative
 * chain — integration levels (one per limit) accumulated through integrals
 * nested inside other integrals' integrands or bounds.
 *
 * `compileIntervalIntegrate` sizes every level's subdivision count from the
 * pair: an inner integral runs once per enclosing piece, so with a uniform
 * count n the subtree's total integrand evaluations are bounded by
 * ~paths·n^depth.
 *
 * The memo is sound unconditionally: both numbers are functions of the
 * expression tree alone (operator names and arity — no bindings, no
 * definitions), and boxed expressions are immutable. `paths` saturates at
 * a million — beyond that every sizing decision is already "decline", and
 * an unsaturated sum over a deeply shared tree would overflow.
 *
 * Composition through a FUNCTION CALL (`∫ g(x) dx` where `g`'s body
 * computes an integral) is invisible here — no `Integrate` node is in the
 * tree. That class is bounded at run time instead, by
 * `INTERVAL_NESTED_QUADRATURE_BUDGET` (`interval/integrate.ts`).
 */
type IntegrateStats = { paths: number; depth: number };

const INTEGRATE_STATS = new WeakMap<Expression, IntegrateStats>();

const INTEGRATE_PATHS_SATURATION = 1_000_000;

function integrateStats(expr: Expression): IntegrateStats {
  const cached = INTEGRATE_STATS.get(expr);
  if (cached !== undefined) return cached;
  let paths = 0;
  let depth = 0;
  if (isFunction(expr)) {
    for (const op of expr.ops) {
      const s = integrateStats(op);
      paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + s.paths);
      depth = Math.max(depth, s.depth);
    }
    if (expr.operator === 'Integrate') {
      // One integration level per limit clause; a bare `Integrate(f)` (no
      // clause) is indefinite and never reaches the enclosure emitter, but
      // count it as one level so the estimate stays conservative.
      const levels = Math.max(1, expr.nops - 1);
      paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + 1);
      depth += levels;
    }
  }
  const stats = { paths, depth };
  INTEGRATE_STATS.set(expr, stats);
  return stats;
}

function compileIntervalIntegrate(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const limits = args.slice(1).map(extractIntervalLimits);

  // An INDEFINITE integral (`\int f dx` — the `Limits` clause carries `Nothing`
  // for its bounds, or there is no clause at all) has no range to partition.
  // With a closed form it is that closed form — a function of its free bound.
  // Without one it has no value at a point: it denotes a function, not a
  // number, and compiling the `Nothing` bounds like any other free symbol
  // would hand `_IA.integrate` a `vars`-object lookup (`_.Nothing`) —
  // `undefined`, which the runtime reads as a non-finite endpoint and answers
  // `entire`, or with no clause at all would emit the bare integrand as if it
  // were the integral's value. Fail closed (D6) so the caller falls back to
  // the interpreter, which keeps the integral symbolic.
  const isUnbounded = (e: Expression | undefined) =>
    e === undefined || isSymbol(e, 'Nothing');
  const indefinite =
    limits.length === 0 ||
    limits.some((l) => isUnbounded(l.lowerExpr) || isUnbounded(l.upperExpr));

  // The integrand as a body in the limits' index variables: a `Function`
  // integrand is unwrapped, its parameters matched to the limits by name (a
  // mismatch fails closed — see `BaseCompiler.integrandLambda`). Judged
  // BEFORE the closed-form attempt: `Integrate` is exempt from the
  // scalar-operand gate (`COLLECTION_AWARE_HEADS`) so that its own
  // diagnostics win, and the closed form of a collection-valued body is the
  // collection itself (`∫₀¹ L dt` closes to `L`), which would compile as a
  // bare symbol and route around the gate.
  const { lambdaVars, bodyExpr } = indefinite
    ? { lambdaVars: [] as string[], bodyExpr: args[0] }
    : BaseCompiler.integrandLambda(
        args[0],
        limits.map((l) => l.index)
      );
  if (!indefinite) {
    // A collection-valued body would make the integrand lambda answer a JS
    // array, which `_IA.integrate` would read `.lo`/`.hi` off; a
    // collection-valued bound would be read as a non-finite endpoint and
    // answer `entire` — both behind `success: true`.
    BaseCompiler.assertScalarBigOpBody('Integrate', bodyExpr);
    for (const l of limits)
      assertScalarIntervalOperands('Integrate', [l.lowerExpr, l.upperExpr]);
  }

  // Antiderivative-first: a closed form when the integral resolves to one
  // (and does not reference a `vars`-mapped symbol, which must not fold).
  let closedCode: string | undefined;
  const closed = BaseCompiler.closedFormIntegral(args, target);
  if (closed !== undefined) {
    try {
      // Parenthesize: the closed form can be a low-precedence expression,
      // whereas it is spliced as an atomic operand.
      closedCode = `(${compile(closed)})`;
    } catch {
      // Unlowerable head: the enclosure emitter below stands alone.
    }
  }

  if (indefinite) {
    if (closedCode !== undefined) return closedCode;
    throw new Error(
      'Integrate: an indefinite integral with no closed-form antiderivative is a function, not a number — it has no value to compute at a point, and quadrature needs bounds. Fail closed (D6). Provide bounds for a definite integral, or evaluate symbolically instead.'
    );
  }

  // Per-level subdivision count from the total budget (see
  // `INTERVAL_QUADRATURE_BUDGET`): the inner enclosure of a nested integral
  // runs once per outer piece, so the counts multiply across levels — through
  // this node's own limits AND through every `Integrate` node visible in its
  // subtree (a distinct node inside the integrand or a bound runs once per
  // enclosing piece just the same). The OUTERMOST integral of a nest measures
  // the whole subtree (`integrateStats`) and picks one uniform count n with
  // paths·n^depth within the budget; every inner lowering inherits that n
  // through `target.intervalQuadraturePieces` rather than re-measuring its
  // own smaller subtree, which would pick a larger count and break the
  // product bound.
  //
  // The floor is a DECLINE, not a clamp: below 4 pieces per level the
  // "enclosure" is as uninformative as `entire` while still costing the whole
  // budget, so an integral whose subtree is too deep or too branchy to size
  // honestly fails closed instead (the caller falls back — in a two-lane
  // consumer, to its scalar estimate). Everything here is a function of the
  // expression tree alone: no clock, same answer on every run.
  let n: number;
  if (target.intervalQuadraturePieces !== undefined) {
    n = target.intervalQuadraturePieces;
  } else {
    let paths = 1;
    let depth = limits.length;
    for (const arg of args) {
      const s = integrateStats(arg);
      paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + s.paths);
      depth = Math.max(depth, limits.length + s.depth);
    }
    n = Math.min(
      INTERVAL_QUADRATURE_SUBDIVISIONS,
      Math.floor((INTERVAL_QUADRATURE_BUDGET / paths) ** (1 / depth))
    );
    if (n < 4)
      throw new Error(
        `Integrate: cannot compile an honest interval enclosure — this ` +
          `integral's subtree reaches ${paths} integral runs nested ` +
          `${depth} levels deep, and the evaluation budget ` +
          `(${INTERVAL_QUADRATURE_BUDGET} integrand evaluations) admits ` +
          `fewer than 4 subdivisions per level at that size, which is as ` +
          `uninformative as no bound at all. Fail closed (D6). Evaluate ` +
          `numerically on the scalar target, or reduce the nesting.`
      );
  }

  // Everything compiled within this integral — the integrand and every
  // bound — inherits the chosen count.
  const sized: CompileTarget<Expression> = {
    ...target,
    intervalQuadraturePieces: n,
  };

  // The lambda variable arrives as a bare `Interval` (`{lo, hi}`), which every
  // `_IA.*` operation accepts, so it compiles to its own name rather than to a
  // `vars`-object lookup or a `_IA.point(…)` wrapper.
  const scoped = (names: string[]): CompileTarget<Expression> => ({
    ...sized,
    var: (id) => (names.includes(id) ? id : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, names),
  });

  let code = BaseCompiler.compile(bodyExpr, scoped(lambdaVars));

  // Multiple limits nest, innermost last (Mathematica iterator convention:
  // the FIRST limit is the OUTERMOST integral). A bound of limit d may
  // reference the outer lambda variables 0..d−1 — at its nesting depth they
  // are in scope, so dependent bounds (∫₀¹dx ∫₀ˣdy) compile naturally. The
  // closed form, when there is one, guards the OUTERMOST call only: its scan
  // walks the outer range, and each scanned piece runs the inner enclosures.
  for (let d = limits.length - 1; d >= 0; d--) {
    const outer = lambdaVars.slice(0, d);
    const boundTarget = outer.length > 0 ? scoped(outer) : sized;
    const lo = BaseCompiler.compile(limits[d].lowerExpr, boundTarget);
    const hi = BaseCompiler.compile(limits[d].upperExpr, boundTarget);
    const f = `(${lambdaVars[d]}) => (${code})`;
    code =
      d === 0 && closedCode !== undefined
        ? `_IA.integrateClosed(() => ${closedCode}, ${f}, ${lo}, ${hi}, ${n})`
        : `_IA.integrate(${f}, ${lo}, ${hi}, ${n})`;
  }
  return code;
}

/**
 * JavaScript function that wraps compiled interval arithmetic code.
 *
 * Injects the _IA library and provides input conversion from various formats.
 */
export class ComputeEngineIntervalFunction extends Function {
  IA = IntervalArithmetic;

  constructor(body: string, preamble = '') {
    super(
      '_IA',
      '_',
      preamble ? `${preamble};return ${body}` : `return ${body}`
    );
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) => {
        try {
          // Process input arguments - convert to interval format
          const processedArgs = argumentsList.map(processInput);
          return super.apply(thisArg, [this.IA, ...processedArgs]);
        } catch {
          // Runtime error (e.g., missing _IA method) — return "entire"
          // to signal "cannot bound this" rather than crashing.
          return { kind: 'entire' };
        }
      },
      get: (target, prop) => {
        if (prop === 'toString') return (): string => body;
        if (prop === 'isCompiled') return true;
        return Reflect.get(target, prop);
      },
    });
  }
}

/**
 * Process an input value to interval format.
 *
 * Accepts:
 * - { lo: number, hi: number } - Direct interval
 * - { x: {...}, y: {...} } - Object with interval-valued properties
 * - number - Convert to point interval
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasIntervalBounds(
  value: unknown
): value is { lo: unknown; hi: unknown } {
  return isRecord(value) && 'lo' in value && 'hi' in value;
}

/**
 * Wrap an interpreter fallback result as a value honoring the interval-js
 * `run` contract (`IntervalValue`). A number becomes the degenerate interval
 * `{ lo: v, hi: v }`; a collection (materialized to an array, possibly
 * nested) becomes the array of its elements' wrappings — the same shape a
 * compiled comprehension returns; any other value (a boolean, text) has no
 * interval reading and is reported as `entire`, the same "cannot bound"
 * signal the runtime proxy uses.
 */
function toIntervalValue(value: unknown): IntervalValue {
  if (typeof value === 'number') return { lo: value, hi: value };
  if (Array.isArray(value)) return value.map(toIntervalValue);
  return { kind: 'entire' };
}

/**
 * Collapse an interval-shaped fallback input (`{ lo, hi }`) to a representative
 * scalar — its midpoint — so the number-based interpreter can consume it. A
 * variables object has each interval-valued entry collapsed recursively; other
 * values pass through unchanged.
 */
function collapseIntervalInput(value: unknown): unknown {
  if (hasIntervalBounds(value))
    return (Number(value.lo) + Number(value.hi)) / 2;
  // A collection input stays a collection for the interpreter — only its
  // ELEMENTS collapse. The record branch below would turn it into an object
  // keyed "0", "1", …, which the interpreter reads as a dictionary.
  if (Array.isArray(value)) return value.map(collapseIntervalInput);
  if (isRecord(value)) {
    // Prototype-free: `out['__proto__'] = v` on an ordinary object invokes the
    // inherited setter instead of creating an own key, so a variable named
    // `__proto__` was dropped from the copy entirely and read as unsupplied.
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value))
      out[k] = collapseIntervalInput(v);
    return out;
  }
  return value;
}

function processInput(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  // Already an interval
  if (hasIntervalBounds(input)) {
    return input;
  }

  // A COLLECTION input stays an array: the accessors (`_IA.at`, `_IA.length`,
  // `_IA.component`) dispatch on `Array.isArray` and read `.length`. The
  // generic record branch below would copy it into a null-prototype object
  // keyed "0", "1", … — silently losing both the length and the positional
  // access, so every collection access would answer absence.
  if (Array.isArray(input)) return input.map(processInput);

  // Object with properties - process recursively
  if (isRecord(input)) {
    // Prototype-free — see `collapseIntervalInput`: an ordinary object cannot
    // carry an own `__proto__` key, so the caller's value for a variable of
    // that name would be silently lost in this copy.
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(input)) {
      result[key] = processInput(value);
    }
    return result;
  }

  // Number - convert to point interval
  if (typeof input === 'number') {
    return { lo: input, hi: input };
  }

  return input;
}

/**
 * Interval arithmetic JavaScript target implementation.
 */
/**
 * The compile modes the interval target offers (`CompileMode`): `'strict'`
 * only — intervals are real.
 */
const INTERVAL_SUPPORTED_MODES: readonly CompileMode[] = ['strict'];

export class IntervalJavaScriptTarget implements LanguageTarget<Expression> {
  getOperators(): CompiledOperators {
    return INTERVAL_JAVASCRIPT_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return INTERVAL_JAVASCRIPT_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'interval-javascript',
      // Intervals are real: the strict discipline is the only mode this
      // target offers (`CompileMode`); a requested `'complex'`/`'auto'` is
      // the `unsupported-mode` decline.
      supportedModes: INTERVAL_SUPPORTED_MODES,
      // See `CompileTarget.varsObjectName`: free symbols read as `_.<id>`
      // (below), so a lambda parameter spelled `_` must not shadow the vars
      // object.
      varsObjectName: '_',
      // `_IA` is baked as a literal token by every interval lowering; `_SYS`
      // by the helpers it shares with the JavaScript target. See
      // `CompileTarget.reservedEmittedNames`.
      reservedEmittedNames: new Set(['_IA', '_SYS']),
      // Don't use operators - all arithmetic goes through functions
      // because interval arithmetic returns IntervalResult, not numbers
      operators: () => undefined,
      // The interval domain is scalar — one interval per quantity — so there is
      // no element-wise selection convention here. Decline a provably
      // collection-valued `Which`/`If` condition with a message that says so,
      // instead of the generic ``Unknown operator `List` `` the clause list used
      // to produce. Only PROVABLE collection-ness is tested: a wide-declared
      // condition (`q(x) < y` with `q: (unknown) -> unknown`) must keep
      // compiling unchanged — scalar curve/implicit plotting rides this target.
      selection: (args) => {
        for (let i = 0; i < args.length; i += 2) {
          const c = args[i];
          if (c.isCollection || c.type.matches('collection<any>'))
            throw new Error(
              'Which: a collection-valued condition has no interval-js lowering — ' +
                'the interval domain is scalar (one interval per quantity), so there ' +
                'is no elementwise selection convention. Evaluate the expression ' +
                'instead, or compile a scalar per-element function. Fail closed (D6).'
            );
        }
        return null;
      },
      functions: (id) => guardedIntervalFunction(id),
      constant: (id) => INTERVAL_JAVASCRIPT_CONSTANTS[id],
      var: (id) => {
        return INTERVAL_JAVASCRIPT_CONSTANTS[id];
      },
      string: (str) => JSON.stringify(str),
      number: (n) => `_IA.point(${n})`,
      // Evaluate a shared middle operand of a chained relation exactly once
      // (matching the interpreter) by binding it in an IIFE. Net-new here: the
      // interval target used to inline every operand, so `a < m < b` evaluated
      // `m` twice.
      bindExpr: (bindings, body) =>
        `((${bindings.map((b) => b[0]).join(', ')}) => ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      // Dependency-ordered CSE temporaries: a sequential-`const` IIFE (an
      // interval `{ lo, hi }` value is `const`-bindable like any other).
      cseBind: (bindings, body) =>
        `(() => { ${bindings
          .map(([name, code]) => `const ${name} = ${code};`)
          .join(' ')} return ${body}; })()`,
      // Absence capability (§3.F): numeric absence is a whole-NaN interval
      // (reusing the machinery already present for `NaN`); `isAbsent` tests the
      // lower endpoint. No object axis. Consumers land in P3.
      absence: {
        numeric: {
          make: () => '{ lo: NaN, hi: NaN }',
          isAbsent: (x) => `Number.isNaN((${x}).lo)`,
          coalesce: (x, d) => `((_c) => Number.isNaN(_c.lo) ? ${d} : _c)(${x})`,
        },
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      // Per-compilation naming state for generated temporaries (see the
      // JavaScript target).
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'interval-js', IntervalValue> {
    // See the note in `javascript-target.ts`: the target-level route bypasses
    // the standalone `compile()` export, where these deprecations were warned
    // about and where the `complexPromotion` alias is resolved, so each target
    // entry warns and normalizes for itself. This target declares `['strict']`
    // only, so the alias is NOT mapped onto `mode: 'complex'` (that would turn
    // a compile that used to succeed into an `unsupported-mode` decline); it
    // is merely cleared. Once-per-process per key.
    options = normalizeDeprecatedCompileOptions(
      options,
      INTERVAL_SUPPORTED_MODES.includes('complex')
    ).options;
    let result: CompilationResult<'interval-js', IntervalValue>;
    try {
      result = this.compileOrThrow(expr, options);
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
      if (options.fallback !== true) throw e;
      return this.buildIntervalFallback(expr, (e as Error).message, options);
    }
    // The primary failure class never throws: `compileToIntervalTarget`
    // reports an operator with no interval kernel as `success: false` (see its
    // internal catch), so the `catch` above cannot build the fallback for it.
    // When the caller opted into the failure-shape contract, normalize that
    // `success: false` to the same interpreter-backed fallback, preserving the
    // captured error detail (synthesizing a message only if none survived).
    if (!result.success && options.fallback === true) {
      const error =
        result.error ??
        `Cannot compile \`${expr.operator}\` to the interval-js target`;
      return this.buildIntervalFallback(
        expr,
        error,
        options,
        result.diagnostic
      );
    }
    return result;
  }

  /**
   * Build the documented `success: false` fallback for the interval-js target:
   * an interpreter-backed `run` whose results honor the interval contract.
   *
   * `BaseCompiler.buildInterpreterFallback` produces a runner that returns plain
   * numbers (and nested arrays for collections), so its scalar output is wrapped
   * as a degenerate interval `{ lo: v, hi: v }`, and interval-shaped *inputs*
   * (`{ lo, hi }`) are collapsed to their midpoint before interpretation. A
   * non-scalar result cannot be bounded as a single interval, so it is reported
   * as `{ kind: 'entire' }` — the same "cannot bound" signal the runtime proxy
   * uses. Returning a properly interval-typed `run` lets the result carry the
   * target's real value type without a force cast.
   */
  private buildIntervalFallback(
    expr: Expression,
    error: string,
    options: CompilationOptions<Expression>,
    diagnostic?: CompileDiagnostic
  ): CompilationResult<'interval-js', IntervalValue> {
    console.warn(
      `Compilation fallback for "${expr.operator}" (target: interval-js): ${error}`
    );
    const base = BaseCompiler.buildInterpreterFallback(
      expr,
      error,
      'interval-js',
      this.createTarget(),
      options.vars ? new Set(Object.keys(options.vars)) : undefined,
      diagnostic
    );
    // `run` is guaranteed present for an executable target (interval-js).
    // Through `unknown`: the fallback's `run` is typed with the interval
    // target's own result union, which does not overlap the plain
    // number/array shape the interpreter actually hands back here before
    // `toIntervalValue` wraps it.
    const interpreterRun = base.run as unknown as (
      ...args: unknown[]
    ) => unknown;
    const run: CompiledRunner<IntervalValue, IntervalInput> = (
      ...args: unknown[]
    ): IntervalValue =>
      toIntervalValue(interpreterRun(...args.map(collapseIntervalInput)));
    return { ...base, run };
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'interval-js', IntervalValue> {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
    const { functions, vars, preamble } = options;
    const unknowns = expr.unknowns;

    // Process custom functions
    // Null-prototype: this table collects CALLER-supplied function overrides
    // and is then indexed by an arbitrary operator name. A plain `{}` would
    // answer for every inherited `Object.prototype` member, so a head named
    // `toString` would read as a user override that the caller never wrote.
    // `Object.values` below is unaffected — it returns own properties only.
    const namedFunctions: { [k: string]: string } = Object.create(null);
    let preambleImports = '';

    if (functions) {
      for (const [k, entry] of Object.entries(functions)) {
        // `entrySource` unwraps the `{ source, pure? }` descriptor form as well
        // as the bare spellings. The `pure` half is not read here: purity buys
        // the NaN early exit in `BaseCompiler.isEmissionSkippable`, and this
        // target emits no such exit — its `Sum`/`Product` lowering has no
        // call site for it — so tracking it would be state nothing consults.
        const v = entrySource(entry);
        if (typeof v === 'function') {
          preambleImports += `const ${k} = ${v.toString()};\n`;
          namedFunctions[k] = k;
        } else if (typeof v === 'string') {
          namedFunctions[k] = v;
        }
      }
    }

    const target = this.createTarget({
      // The caller's requested compile mode; validated against
      // `supportedModes` (strict only here) by `BaseCompiler.compile`.
      mode: options.mode,
      // Constant folding is UNSOUND on this target, unconditionally: it bakes
      // a subtree's `.N()` value as a zero-width point, discarding the
      // outward-rounded enclosure the structural interval code computes. A
      // point for a value the doubles cannot represent exactly (`Ln(2)`) no
      // longer CONTAINS the true value — the guarantee this target exists to
      // provide. Number LITERALS in the source are exact by definition and
      // stay point intervals, as before.
      constantFold: false,
      // The names the caller pinned to runtime inputs. A symbol in this set is
      // a live input, not a value to bake: `BaseCompiler.closedFormIntegral`
      // declines to fold an `Integrate` that mentions one, and the
      // user-function resolution in `BaseCompiler` leaves such a name with the
      // caller's meaning rather than eta-expanding it. Populated on every other
      // executable target; its absence here left both behaviors silently
      // disabled for `interval-js` (`∫₀^k t dt` with `k` mapped still folded to
      // `k²/2`). The constant-fold consumer of this set is moot here — this
      // target sets `constantFold: false` unconditionally, just above.
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      constant: (id) => INTERVAL_JAVASCRIPT_CONSTANTS[id],
      functions: (id) =>
        namedFunctions?.[id] ? namedFunctions[id] : guardedIntervalFunction(id),
      var: (id) => {
        // Own-property test: a caller's `vars` map is a plain object, so
        // `in` finds `Object.prototype` members and a symbol named
        // `toString` would read the inherited FUNCTION as its spliced source.
        if (vars && Object.hasOwn(vars, id)) return vars[id] as string;
        const constant = INTERVAL_JAVASCRIPT_CONSTANTS[id];
        if (constant !== undefined) return constant;
        // See `varsObjectAccess` in `javascript-target.ts`: a name that
        // collides with an `Object.prototype` member needs an own-property
        // guard, or a missing symbol reads the inherited function.
        if (unknowns.includes(id)) return intervalVarsAccess(id);
        // An assigned value / declared constant: returning `undefined` lets
        // BaseCompiler fold it (see the JavaScript target) rather than emitting
        // a bare, dangling reference for a symbol that `expr.unknowns` omits.
        if (expr.engine._getSymbolValue(id) !== undefined) return undefined;
        // No value: a genuinely free symbol, possibly reachable only through a
        // folded value (so absent from `unknowns`). Emit the vars-object lookup
        // rather than a bare, dangling reference.
        return intervalVarsAccess(id);
      },
      preamble: (preamble ?? '') + preambleImports,
      // Opt in to compiling calls to user-defined function literals (`f(x) :=
      // …`) as named local functions collected into the preamble.
      userFunctions: { defs: new Map(), compiling: new Set() },
      // Root compilation boundary: fresh, deterministic numbering for the
      // generated temporaries (see the JavaScript target).
      naming: BaseCompiler.newNamingContext(expr, [
        preamble,
        preambleImports,
        ...Object.values(namedFunctions),
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // The compilation root: a user-function definition body compiles against
    // THIS target plus its own parameters, never against a nested requesting
    // one (see `CompileTarget.userFunctions.root`).
    target.userFunctions!.root = target;

    // Common-subexpression elimination (design §4.2), on the same
    // post-`rewriteAngularUnit` tree the emitters walk. The G1b provenance
    // predicates come from the RAW options (this target has no `operators`
    // override channel — `operators` always resolves to `undefined` here).
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      isOverriddenOperator: (name) =>
        Object.prototype.hasOwnProperty.call(namedFunctions, name),
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) =>
        vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name),
    });

    const result = compileToIntervalTarget(expr, target);
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }
}

/**
 * Compile expression to interval JavaScript executable.
 */
function compileToIntervalTarget(
  expr: Expression,
  target: CompileTarget<Expression>
): CompilationResult<'interval-js', IntervalValue> {
  let js: string;
  try {
    js = BaseCompiler.compileCseRoot(expr, target);
  } catch (e) {
    // Expression contains operators/functions not supported by the interval
    // target. Report failure so the caller can fall back to another target,
    // preserving the reason so `compile()` can surface it (this path does not
    // throw, so the wrapper cannot recover the message otherwise).
    return {
      target: 'interval-js',
      success: false,
      code: '',
      error: (e as Error).message,
      diagnostic: compileDiagnosticOf(e),
      ...BaseCompiler.modeReport(),
    } as CompilationResult<'interval-js', IntervalValue>;
  }
  // Prepend any user-defined function definitions accumulated while compiling
  // `expr` (a symbol with a `Function`-literal definition used as an operator)
  // to the preamble so their named local functions are in scope.
  const userDefs = BaseCompiler.userFunctionsPreamble(target);
  const preamble = userDefs
    ? target.preamble
      ? `${target.preamble}\n${userDefs}`
      : userDefs
    : target.preamble;
  const fn = new ComputeEngineIntervalFunction(js, preamble);
  return {
    target: 'interval-js',
    success: true,
    code: js,
    calling: 'expression',
    run: fn as unknown as CompiledRunner<IntervalValue, IntervalInput>,
  };
}
