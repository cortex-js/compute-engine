import type { Expression } from '../global-types.js';

import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { tryGetConstant } from './constant-folding.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { requirePrimitiveElements } from './javascript-target.js';

/**
 * Python mathematical constants, keyed by MathJSON symbol.
 *
 * Referenced both by the target's `var` resolver and — so an assigned value is
 * folded, matching the JavaScript target and `evaluate()` — by `compile()`.
 */
const PYTHON_CONSTANTS: Record<string, string> = {
  Pi: 'np.pi',
  ExponentialE: 'np.e',
  ImaginaryUnit: '1j',
  Infinity: 'np.inf',
  NaN: 'np.nan',
  GoldenRatio: '((1 + np.sqrt(5)) / 2)',
  CatalanConstant: '0.915965594177219015054603514932384110774',
  EulerGamma: '0.5772156649015328606065120900824024310421',
};

/**
 * Emit a Python equality test with the engine's numeric tolerance baked in at
 * compile time. The interpreter compares numbers within `engine.tolerance`
 * (default 1e-10) — so `0.1 + 0.2 == 0.3` is *true* — while a raw `==` on
 * floats is exact and would disagree. `kind` selects Equal (`<=`) vs NotEqual
 * (`>`). Chained (N-ary) forms are conjoined pairwise with `and`.
 */
function compilePythonEquality(
  kind: 'Equal' | 'NotEqual',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  if (args.length < 2)
    throw new Error(`${kind}: expected at least two arguments`);
  const tol = args[0]?.engine?.tolerance ?? 1e-10;
  const cmp = kind === 'Equal' ? '<=' : '>';
  const pair = (a: Expression, b: Expression): string =>
    `(abs((${compile(a)}) - (${compile(b)})) ${cmp} ${tol})`;
  if (args.length === 2) return pair(args[0], args[1]);
  const parts: string[] = [];
  for (let i = 0; i < args.length - 1; i++)
    parts.push(pair(args[i], args[i + 1]));
  return `(${parts.join(' and ')})`;
}

/**
 * Compile a Sum/Product bound. An integer constant is emitted as the literal;
 * anything else is compiled as an expression (symbolic bounds resolve at
 * runtime — a Python `range` needs the value to be an `int`).
 */
function compilePythonBound(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  if (isNumber(expr) && expr.im === 0 && Number.isFinite(expr.re))
    return String(Math.floor(expr.re));
  return BaseCompiler.compile(expr, target);
}

/**
 * Compile a Sum/Product upper bound *plus one* — the engine's upper bound is
 * inclusive, Python `range(a, b)` is exclusive. A literal integer folds the
 * `+ 1` into the number (`range(1, 11)`); a symbolic bound stays `<b> + 1`.
 */
function compilePythonUpperBound(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  if (isNumber(expr) && expr.im === 0 && Number.isFinite(expr.re))
    return String(Math.floor(expr.re) + 1);
  return `${BaseCompiler.compile(expr, target)} + 1`;
}

/**
 * Compile a `Sum`/`Product` to a single Python generator expression:
 *   `sum(<body> for i in range(<lo>, <hi> + 1))`
 *   `math.prod(<body> for i in range(<lo>, <hi> + 1))`
 *
 * Being a single expression (not a statement block), it composes everywhere —
 * lambda body, operand position, or a `compileFunction` single-line return.
 * The engine's inclusive upper bound maps to Python's exclusive `range` upper
 * (`<hi> + 1`); an empty/reversed range yields an empty `range`, so builtin
 * `sum` returns 0 and `math.prod` returns 1 — matching the interpreter.
 *
 * Multi-index forms (`Sum(body, Limits(i,…), Limits(j,…), …)`) are emitted as
 * nested generator clauses (`… for i in … for j in …`) — the natural, trivial
 * Python idiom — so every indexing set is honored (cf. the JS target, which
 * nests single-index loops; GPU targets fail closed instead).
 */
function compilePythonSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): `sum(generator)`/`math.prod(...)`
  // over arrays would silently produce a wrong value. Reached only for the
  // indexed form (the `!args[1]` guard above rules out the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  const body = args[0];
  const clauses = args.slice(1);
  const forClauses: string[] = [];

  // `idxTarget` binds every index seen so far, so an inner clause's bounds and
  // the body resolve the outer indices as bare identifiers.
  let idxTarget = target;
  for (const clause of clauses) {
    if (!isFunction(clause, 'Limits'))
      throw new Error(`${kind}: expected a Limits indexing set`);
    const ops = clause.ops;
    const indexExpr = ops[0];
    if (!isSymbol(indexExpr))
      throw new Error(`${kind}: index must be a symbol`);
    const index = indexExpr.symbol;

    const lowerExpr = ops[1];
    const upperExpr = ops[2];
    // A Python `range` needs finite bounds — reject an unbounded Sum/Product
    // (fail closed) rather than emit `range(1, inf + 1)`.
    if (
      lowerExpr === undefined ||
      upperExpr === undefined ||
      isSymbol(upperExpr, 'Nothing') ||
      upperExpr.isInfinity ||
      lowerExpr.isInfinity
    )
      throw new Error(`${kind}: an unbounded range is not supported`);

    const lowerCode = compilePythonBound(lowerExpr, idxTarget);
    const upperCode = compilePythonUpperBound(upperExpr, idxTarget);
    forClauses.push(`for ${index} in range(${lowerCode}, ${upperCode})`);

    const prev = idxTarget;
    idxTarget = {
      ...prev,
      var: (id) => (id === index ? index : prev.var(id)),
    };
  }

  const bodyCode = BaseCompiler.compile(body, idxTarget);
  const gen = `${bodyCode} ${forClauses.join(' ')}`;
  return kind === 'Sum' ? `sum(${gen})` : `math.prod(${gen})`;
}

/**
 * Indent every line of a (possibly multi-line) statement block by one Python
 * level (4 spaces). An empty block becomes `pass` (a valid non-empty suite).
 */
function indentPythonStatements(code: string): string {
  const body = code.trim() === '' ? 'pass' : code;
  return body
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

/**
 * Compile an expression as Python *statements* — evaluated for effect, no value
 * collected. Mirrors `BaseCompiler.compileLoopBody` (the statement dispatch the
 * JS target uses inside loop bodies) but emits Python:
 *
 * - `Nothing` → '' (a no-op; filtered out by the `Block` join).
 * - `Break` → `break`, `Continue` → `continue`, `Return(v)` → `return <v>`.
 * - `If(cond, then[, else])` → a Python `if`/`else` *statement* (not the
 *   expression-If's `(then) if (cond) else (else)`), recursing into each branch
 *   so nested control flow composes. An empty branch becomes `pass`.
 * - `Block` → its statements newline-joined (no trailing `return` — a loop /
 *   branch body is for effect).
 * - `Loop` → a nested statement loop (via `compilePythonLoop`).
 * - anything else → `BaseCompiler.compile` (an expression evaluated for effect,
 *   or an `Assign`).
 *
 * NOTE: statement-form `If` is reached ONLY here — inside a loop body — exactly
 * as the JS target statement-forms `If` only inside `compileLoopBody`. An `If`
 * anywhere else (e.g. a plain function-body `Block`) stays the expression
 * conditional emitted by the `If` function handler.
 */
function compilePythonStatements(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  if (isSymbol(expr, 'Nothing')) return '';
  if (!isFunction(expr)) return BaseCompiler.compile(expr, target);

  const h = expr.operator;

  if (h === 'Break') return 'break';
  if (h === 'Continue') return 'continue';
  if (h === 'Return')
    return `return ${BaseCompiler.compile(expr.ops[0], target)}`;

  if (h === 'If') {
    // The Python target's comparisons already emit real Python booleans, so —
    // unlike the JS `compileLoopBody`, whose interval-JS targets need a
    // `scalarConditionTarget` to avoid comparison *objects* — the condition is
    // compiled directly.
    const cond = BaseCompiler.compile(expr.ops[0], target);
    let code = `if ${cond}:\n${indentPythonStatements(
      compilePythonStatements(expr.ops[1], target)
    )}`;
    if (expr.ops.length > 2)
      code += `\nelse:\n${indentPythonStatements(
        compilePythonStatements(expr.ops[2], target)
      )}`;
    return code;
  }

  if (h === 'Block')
    return expr.ops
      .map((s) => compilePythonStatements(s, target))
      .filter((s) => s !== '')
      .join('\n');

  if (h === 'Loop') return compilePythonLoop(expr.ops, target);

  return BaseCompiler.compile(expr, target);
}

/**
 * Compile a `Loop` — imperative control flow, for effect (evaluates to
 * `Nothing`). Emits a Python statement loop (not a JS IIFE):
 *
 * - `Loop(body)` → `while True:` with the body indented beneath it.
 * - `Loop(body, Element(i, Range(lo, hi)))` (single ascending step-1 Range) →
 *   `for i in range(<lo>, <hi> + 1):` with the body indented beneath it.
 *
 * Other shapes the generic loop compiler accepts (multiple Element clauses, a
 * non-`Range` collection, a stepped/descending Range) fail closed here.
 *
 * The body is compiled as *statements* — a `Block` body is joined by newlines
 * WITHOUT the block hook's trailing `return` (a loop body has no return value),
 * then indented one level under the loop header.
 */
function compilePythonLoop(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error('Loop: no body');
  const body = args[0];
  const elements = args.slice(1);

  let header: string;
  let bodyTarget = target;

  if (elements.length === 0) {
    header = 'while True:';
  } else {
    if (elements.length > 1)
      throw new Error(
        'Loop: multiple Element clauses are not supported by the Python target'
      );
    const indexing = elements[0];
    if (!isFunction(indexing, 'Element'))
      throw new Error('Loop: expected Element(index, Range(lo, hi))');
    const indexExpr = indexing.ops[0];
    const rangeExpr = indexing.ops[1];
    if (!isSymbol(indexExpr)) throw new Error('Loop: index must be a symbol');
    if (!isFunction(rangeExpr, 'Range') || rangeExpr.ops.length > 2)
      throw new Error(
        'Loop: only a single ascending step-1 Range(lo, hi) is supported by the Python target'
      );
    const index = indexExpr.symbol;
    const lowerCode = compilePythonBound(rangeExpr.ops[0], target);
    const upperCode = compilePythonUpperBound(rangeExpr.ops[1], target);
    header = `for ${index} in range(${lowerCode}, ${upperCode}):`;
    const prev = target;
    bodyTarget = {
      ...prev,
      var: (id) => (id === index ? index : prev.var(id)),
    };
  }

  // Compile the body as statements — statement-form control flow
  // (`If`/`Break`/`Continue`/`Return`), a flattened `Block`, and nested `Loop`s
  // all compose, for effect (no trailing `return`).
  const indented = indentPythonStatements(
    compilePythonStatements(body, bodyTarget)
  );
  return `${header}\n${indented}`;
}

/**
 * Python operator mappings
 *
 * Python uses similar operators to JavaScript, but with ** for exponentiation.
 * NumPy arrays support element-wise operations with these operators.
 */
const PYTHON_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11], // Subtract canonicalizes to Add+Negate; kept as fallback
  Multiply: ['*', 12],
  Divide: ['/', 13],
  // Python exponentiation. A literal `0^0` is folded to NaN at canonicalization
  // (matching the interpreter) before it reaches here, and `x^0` folds to 1
  // (as the interpreter simplifies). The residual divergence is a *runtime*
  // dynamic `0**0` (both operands 0 only at run time): Python yields 1, the
  // interpreter NaN. Aligning that would require routing every power through a
  // helper — disproportionate churn (breaks `**` right-associativity) for a
  // rare edge — so it is left as a documented divergence. The JS target aligns
  // it via `_SYS.pow`. See finding CO-P2-24.
  Power: ['**', 15],
  // Equal / NotEqual are NOT operators: a raw `==` on floats is exact, but the
  // interpreter compares within `engine.tolerance`. They are handled as
  // function forms (see `compilePythonEquality`) so the tolerance is honored.
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['and', 4],
  Or: ['or', 3],
  Not: ['not', 14], // Unary operator
};

/** Whether an operand compiles to a NumPy array at run time — a concrete
 * collection or a statically list/collection-typed value. Mirrors the JS
 * target's `isIndexedCollectionOperand`. */
function isPyCollectionOperand(e: Expression): boolean {
  const t = e.type;
  return t.matches('list') || t.matches('indexed_collection');
}

/**
 * Module-level runtime helper injected (once, only when referenced) so
 * `ElementMax`/`ElementMin`/`Clamp` broadcast exactly like the interpreter's
 * `broadcastOverIndexedCollections` — instead of NumPy's own broadcasting,
 * which raises `ValueError` on a length mismatch that is not 1-vs-N.
 *
 * Semantics reproduced (verified empirically against `.evaluate()`):
 * - array operands **zip to the shortest** participating length (each array is
 *   trimmed to `n = min(len)` before the vectorized NumPy op is applied — so
 *   the fast NumPy path is kept, no per-element Python loop);
 * - scalar operands broadcast over the arrays;
 * - a **length-1** result stays a length-1 array (`ElementMax([1,2],[3]) → [3]`,
 *   zipping to the shortest operand), matching the interpreter — which returns a
 *   one-element `List`, never a bare scalar, whenever any operand is a
 *   collection;
 * - all-scalar operands give a scalar (handled on the direct fast path, not
 *   here — this helper is only reached when some operand is a collection).
 *
 * Divergence: an **empty** participating array yields an empty NumPy array
 * here, whereas the interpreter returns `Nothing` (no numeric analogue).
 * `_op` selects the op: `'max'`→`np.maximum`, `'min'`→`np.minimum`,
 * `'clip'`→`np.clip(x, lo, hi)`.
 *
 * This helper is **op-name-keyed** (a fixed set of NumPy routines), not a
 * generic scalar-closure broadcaster like the JavaScript target's `_SYS.bcast`.
 * So it does NOT cover arithmetic (`+`/`*`/…) over a possibly-collection-typed
 * operand (`2·h(x)` with an unknown-return `h`, or a `broadcastable<T>` symbol).
 * Such arithmetic cannot be compiled soundly on Python: the `+`/`*` operators
 * repeat/concatenate a plain `list` (`2 * [1, 2] → [1, 2, 1, 2]`) rather than
 * broadcasting element-wise like the interpreter, and while a NumPy-array
 * binding would broadcast, the artifact cannot constrain what the caller binds.
 * `base-compiler` therefore FAILS CLOSED (D6) on that shape — the engine falls
 * back to the interpreter — rather than emitting binding-dependent output.
 */
const PYTHON_BCAST_HELPER = `def _ce_bcast(_op, *args):
    _arrs = [np.asarray(a) for a in args]
    _lens = [a.shape[0] for a in _arrs if a.ndim > 0]
    if _lens:
        _n = min(_lens)
        _arrs = [a[:_n] if a.ndim > 0 else a for a in _arrs]
    if _op == 'clip':
        _r = np.clip(_arrs[0], _arrs[1], _arrs[2])
    else:
        _pair = np.maximum if _op == 'max' else np.minimum
        _r = _arrs[0]
        for _a in _arrs[1:]:
            _r = _pair(_r, _a)
    return np.asarray(_r)
`;

/**
 * Reduced row echelon form (Gauss–Jordan with partial pivoting), the runtime
 * side of the `RowReduce` lowering — NumPy has no built-in RREF. Mirrors the JS
 * target's `_SYS.rref`; matches the interpreter's `RowReduce` on well-scaled
 * inputs (float pivots, exact-zero test — the same convention as `np.linalg`).
 */
const PYTHON_RREF_HELPER = `def _ce_rref(_m):
    _a = np.asarray(_m, dtype=float).copy()
    _rows, _cols = _a.shape
    _r = 0
    for _c in range(_cols):
        if _r >= _rows:
            break
        _piv = _r + int(np.argmax(np.abs(_a[_r:, _c])))
        if _a[_piv, _c] == 0:
            continue
        _a[[_piv, _r]] = _a[[_r, _piv]]
        _a[_r] = _a[_r] / _a[_r, _c]
        for _k in range(_rows):
            if _k != _r:
                _a[_k] = _a[_k] - _a[_k, _c] * _a[_r]
        _r += 1
    return _a
`;

/** Prepend any referenced runtime helper definitions to the compiled `code`.
 * Idempotent per emission unit; a redefinition (if two units are concatenated)
 * is harmless in Python. */
function withPythonHelpers(code: string): string {
  let out = code;
  if (out.includes('_ce_rref(')) out = `${PYTHON_RREF_HELPER}\n${out}`;
  if (out.includes('_ce_bcast(')) out = `${PYTHON_BCAST_HELPER}\n${out}`;
  return out;
}

/**
 * Compile `Max`/`Min`, which **reduce** (fold every operand — including a
 * collection's elements — to a single extremum). A collection operand is
 * reduced with `np.max`/`np.min`; the per-operand results are then combined
 * with the element-wise `np.maximum`/`np.minimum`, which keeps scalar/array
 * operands (the plot variable) vectorized. `np.maximum`/`np.minimum` are
 * strictly binary, so an n-ary fold is emitted. (`np.maximum([…])` — a single
 * list to the element-wise function — is a runtime error and element-wise
 * anyway, which is why the old bare `'np.maximum'`/`'np.minimum'` string
 * mapping was wrong for the reduction.)
 */
function compilePythonExtremum(
  reduce: 'np.max' | 'np.min',
  pairwise: 'np.maximum' | 'np.minimum',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  const parts = args.map((a) =>
    isPyCollectionOperand(a) ? `${reduce}(${compile(a)})` : compile(a)
  );
  if (parts.length === 0) return reduce === 'np.max' ? '-np.inf' : 'np.inf';
  let result = parts[0];
  for (let i = 1; i < parts.length; i++)
    result = `${pairwise}(${result}, ${parts[i]})`;
  return result;
}

/**
 * Python/NumPy function implementations
 *
 * Maps mathematical functions to their NumPy equivalents.
 * Most functions are available in the numpy module with np. prefix.
 */
/**
 * Compile a collection operand, failing closed (D6) if it is not an indexed
 * collection (list/vector/range) — the Python analog of the JavaScript
 * target's `collArg`. (Local copy of `isIndexedCollectionOperand` to avoid
 * a cross-target import of a 2-line predicate.)
 */
function pyCollArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position?: number
): string {
  if (
    !arg ||
    !(arg.type.matches('list') || arg.type.matches('indexed_collection'))
  )
    throw new Error(
      `${kind}: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `is not an indexed collection (list/vector/range). Fail closed (D6).`
    );
  return compile(arg);
}

/**
 * Compile a mapping/predicate operand for the Python target. A `Function`
 * literal compiles through the target's lambda handler; a bare binary
 * arithmetic operator symbol lowers to a Python lambda. Anything else —
 * notably a user-defined function symbol, which the shared user-function
 * registry would emit as *JavaScript* source — fails closed (D6): without
 * this guard the base compiler emits a JS arrow function inside otherwise
 * valid Python.
 */
function pyFnArg(
  kind: string,
  op: Expression | undefined,
  compile: (expr: Expression) => string
): string {
  if (op && isFunction(op, 'Function')) return compile(op);
  if (op && isSymbol(op)) {
    const glyph = { Add: '+', Subtract: '-', Multiply: '*', Divide: '/' }[
      op.symbol
    ];
    if (glyph !== undefined) return `(lambda _a, _b: _a ${glyph} _b)`;
  }
  throw new Error(
    `${kind}: the function operand does not compile on the Python target ` +
      `(only function literals and binary arithmetic operator symbols ` +
      `lower to a Python lambda). Fail closed (D6).`
  );
}

const PYTHON_FUNCTIONS: CompiledFunctions<Expression> = {
  // Basic arithmetic (for when they're called as functions)
  Add: (args, compile) => {
    if (args.length === 0) return '0';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' + ');
  },
  Multiply: (args, compile) => {
    if (args.length === 0) return '1';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' * ');
  },
  // No Subtract handler — canonicalizes to Add+Negate before compilation.
  Divide: (args, compile) => {
    if (args.length === 0) return '1';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2) return `${compile(args[0])} / ${compile(args[1])}`;
    // For more than 2 args, fold left
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `${result} / ${compile(args[i])}`;
    }
    return result;
  },

  // Trigonometric functions (with complex dispatch via cmath)
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sin(${compile(args[0])})`;
    return `np.sin(${compile(args[0])})`;
  },
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.cos(${compile(args[0])})`;
    return `np.cos(${compile(args[0])})`;
  },
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.tan(${compile(args[0])})`;
    return `np.tan(${compile(args[0])})`;
  },
  Arcsin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.asin(${compile(args[0])})`;
    return `np.arcsin(${compile(args[0])})`;
  },
  Arccos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.acos(${compile(args[0])})`;
    return `np.arccos(${compile(args[0])})`;
  },
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.atan(${compile(args[0])})`;
    return `np.arctan(${compile(args[0])})`;
  },
  Arctan2: 'np.arctan2',
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sinh(${compile(args[0])})`;
    return `np.sinh(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.cosh(${compile(args[0])})`;
    return `np.cosh(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.tanh(${compile(args[0])})`;
    return `np.tanh(${compile(args[0])})`;
  },
  Arsinh: 'np.arcsinh',
  Arcosh: 'np.arccosh',
  Artanh: 'np.arctanh',

  // Reciprocal trigonometric functions
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Cot: no argument');
    return `(np.cos(${compile(x)}) / np.sin(${compile(x)}))`;
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Csc: no argument');
    return `(1 / np.sin(${compile(x)}))`;
  },
  Sec: ([x], compile) => {
    if (x === null) throw new Error('Sec: no argument');
    return `(1 / np.cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    // `np.arctan(1/x)` returns the wrong branch for x < 0. `π/2 - arctan(x)` is
    // branch-free and matches the interpreter's (0, π) range for all real x.
    return `(np.pi / 2 - np.arctan(${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    return `np.arcsin(1 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    return `np.arccos(1 / (${compile(x)}))`;
  },

  // Reciprocal hyperbolic functions
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    return `(np.cosh(${compile(x)}) / np.sinh(${compile(x)}))`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Csch: no argument');
    return `(1 / np.sinh(${compile(x)}))`;
  },
  Sech: ([x], compile) => {
    if (x === null) throw new Error('Sech: no argument');
    return `(1 / np.cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    return `np.arctanh(1 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `np.arcsinh(1 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    return `np.arccosh(1 / (${compile(x)}))`;
  },

  // Elementary
  Lb: 'np.log2',
  Square: ([x], compile) => {
    if (x === null) throw new Error('Square: no argument');
    return `np.square(${compile(x)})`;
  },
  Fract: ([x], compile) => {
    if (x === null) throw new Error('Fract: no argument');
    return `np.modf(${compile(x)})[0]`;
  },

  // Exponential and logarithmic
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.exp(${compile(args[0])})`;
    return `np.exp(${compile(args[0])})`;
  },
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.log(${compile(args[0])})`;
    return `np.log(${compile(args[0])})`;
  },
  Log: (args, compile) => {
    // Log with base: log(x, base)
    if (args.length === 1) return `np.log10(${compile(args[0])})`;
    if (args.length === 2)
      return `(np.log(${compile(args[0])}) / np.log(${compile(args[1])}))`;
    return 'np.log10';
  },
  Log10: 'np.log10',
  Log2: 'np.log2',
  Exp2: 'np.exp2',

  // Power and roots
  Power: (args, compile) => {
    if (args.length !== 2) return 'np.power';
    if (
      BaseCompiler.isComplexValued(args[0]) ||
      BaseCompiler.isComplexValued(args[1])
    )
      return `(${compile(args[0])} ** ${compile(args[1])})`;
    return `np.power(${compile(args[0])}, ${compile(args[1])})`;
  },
  Sqrt: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sqrt(${compile(args[0])})`;
    return `np.sqrt(${compile(args[0])})`;
  },
  Root: (args, compile) => {
    // Root(x, n) = x^(1/n)
    if (args.length !== 2) return 'np.power';
    const [x, n] = args;
    const nConst = tryGetConstant(n);
    // Odd integer degree: `np.power` is NaN for a negative base, but the real
    // root exists (interpreter convention, e.g. Root(-8, 3) = -2). Emit the
    // sign-corrected form `sign(x)·|x|^(1/n)`.
    if (nConst !== undefined && Number.isInteger(nConst) && nConst % 2 !== 0) {
      const c = compile(x);
      return `(np.sign(${c}) * np.power(np.abs(${c}), 1.0 / ${compile(n)}))`;
    }
    return `np.power(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Rounding and absolute value
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `abs(${compile(args[0])})`;
    return `np.abs(${compile(args[0])})`;
  },
  Sign: 'np.sign',
  Floor: 'np.floor',
  Ceil: 'np.ceil',
  // The interpreter rounds half away from zero (Round(-2.5) = -3, Round(2.5) =
  // 3); `np.round` uses banker's rounding (Round(2.5) = 2). Reconstruct
  // half-away as `sign(x)·floor(|x| + 0.5)`.
  Round: ([x], compile) => {
    if (x === null) throw new Error('Round: no argument');
    const c = compile(x);
    return `(np.sign(${c}) * np.floor(np.abs(${c}) + 0.5))`;
  },
  Truncate: 'np.trunc',

  // Min/Max — REDUCTIONS: fold every operand (a collection to its own extremum)
  // to a single value. `np.maximum`/`np.minimum` are element-wise and strictly
  // binary, so a bare mapping mis-handled a collection operand (element-wise
  // instead of reduced) and errored on 1 or 3+ arguments.
  Min: (args, compile) =>
    compilePythonExtremum('np.min', 'np.minimum', args, compile),
  Max: (args, compile) =>
    compilePythonExtremum('np.max', 'np.maximum', args, compile),
  // Element-wise max/min and clamp, matching the interpreter's broadcasting.
  //
  // When every operand is a scalar (statically), a length mismatch is
  // impossible, so we keep the direct `np.maximum`/`np.minimum`/`np.clip` fast
  // path (element-wise and broadcasting) — the common plotting shape and
  // unchanged output. When any operand is a collection, we route through the
  // injected `_ce_bcast` runtime helper (see PYTHON_BCAST_HELPER), which
  // zip-to-shortest trims the arrays before applying the vectorized NumPy op —
  // reproducing `broadcastOverIndexedCollections` (`ElementMax([1,2,3],[4,5]) →
  // [4,5]`; a length-1 result stays a one-element array, `[3]`, matching the
  // interpreter) instead of NumPy's own broadcasting, which raises `ValueError`
  // on a non-(1-vs-N) length mismatch.
  ElementMax: (args, compile) => {
    if (!args.some(isPyCollectionOperand)) {
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++)
        result = `np.maximum(${result}, ${compile(args[i])})`;
      return result;
    }
    return `_ce_bcast('max', ${args.map((a) => compile(a)).join(', ')})`;
  },
  ElementMin: (args, compile) => {
    if (!args.some(isPyCollectionOperand)) {
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++)
        result = `np.minimum(${result}, ${compile(args[i])})`;
      return result;
    }
    return `_ce_bcast('min', ${args.map((a) => compile(a)).join(', ')})`;
  },
  Clamp: (args, compile) => {
    if (!args.some(isPyCollectionOperand))
      return `np.clip(${compile(args[0])}, ${compile(args[1])}, ${compile(
        args[2]
      )})`;
    return `_ce_bcast('clip', ${compile(args[0])}, ${compile(
      args[1]
    )}, ${compile(args[2])})`;
  },

  // Modulo. `np.mod` is floored (matches the interpreter and D1). `Remainder`
  // uses the interpreter's truncated/round-to-nearest-quotient semantics, NOT
  // `np.remainder` (which is a floored modulo): mirror the JS target's
  // `a - b·round(a/b)`.
  Mod: 'np.mod',
  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    const ca = compile(a);
    const cb = compile(b);
    return `(${ca} - ${cb} * np.round(${ca} / ${cb}))`;
  },

  // Complex numbers
  Real: 'np.real',
  Imaginary: 'np.imag',
  Argument: 'np.angle',
  Conjugate: 'np.conj',

  // Array/Vector operations
  // Indexed Sum/Product compile to Python generator expressions (single
  // expressions, so they compose everywhere). The `Limits` clause carried by an
  // indexed Sum/Product would throw under a plain `np.sum(...)` string mapping.
  Sum: (args, _compile, target) => compilePythonSumProduct('Sum', args, target),
  Product: (args, _compile, target) =>
    compilePythonSumProduct('Product', args, target),
  Mean: 'np.mean',
  Median: 'np.median',
  Variance: 'np.var',
  StandardDeviation: 'np.std',
  // Covariance/Correlation: two-collection form only. numpy `np.cov` defaults
  // to ddof=1 (sample) and returns the 2×2 covariance matrix — the off-diagonal
  // entry [0][1] is Cov(x, y). `np.corrcoef` returns the correlation matrix.
  Covariance: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error('Covariance: expected two collection arguments');
    return `np.cov(${compile(x)}, ${compile(y)})[0][1]`;
  },
  PopulationCovariance: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error(
        'PopulationCovariance: expected two collection arguments'
      );
    return `np.cov(${compile(x)}, ${compile(y)}, ddof=0)[0][1]`;
  },
  Correlation: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error('Correlation: expected two collection arguments');
    return `np.corrcoef(${compile(x)}, ${compile(y)})[0][1]`;
  },

  // Linear algebra
  Dot: 'np.dot',
  Cross: 'np.cross',
  Norm: 'np.linalg.norm',
  Determinant: 'np.linalg.det',
  Inverse: 'np.linalg.inv',
  Transpose: 'np.transpose',
  MatrixMultiply: 'np.matmul',
  // Conjugate transpose: conjugate then transpose (a vector conjugates in
  // place, matching the interpreter and `np.transpose`).
  ConjugateTranspose: (args, compile) =>
    `np.transpose(np.conjugate(${compile(args[0])}))`,
  // `np.diag` is rank-dispatched exactly like the interpreter's `Diagonal`: a
  // matrix → its main-diagonal vector; a vector → the diagonal matrix.
  Diagonal: 'np.diag',
  // Integer matrix power (`M^0` identity, negative → inverse), like the
  // interpreter's `MatrixPower`.
  MatrixPower: 'np.linalg.matrix_power',
  // CE `Rank` is the TENSOR rank (number of axes), NOT the linear-algebra rank
  // — `np.ndim` matches (scalar 0, vector 1, matrix 2, …).
  Rank: 'np.ndim',
  // Reduced row echelon form — NumPy has no built-in, so route through the
  // injected `_ce_rref` runtime helper (Gauss–Jordan with partial pivoting).
  RowReduce: (args, compile) => `_ce_rref(${compile(args[0])})`,

  // Comparison — tolerance-aware equality (see compilePythonEquality). The
  // `abs(a - b) <= tol` form is element-wise for NumPy arrays too, so it also
  // serves the collection-operand path (where the base compiler skips the infix
  // operator). Less/Greater stay as the infix relational operators from
  // PYTHON_OPERATORS; their function forms below serve the collection path.
  Equal: (args, compile) => compilePythonEquality('Equal', args, compile),
  NotEqual: (args, compile) => compilePythonEquality('NotEqual', args, compile),
  Less: 'np.less',
  LessEqual: 'np.less_equal',
  Greater: 'np.greater',
  GreaterEqual: 'np.greater_equal',
  And: 'np.logical_and',
  Or: 'np.logical_or',
  Not: 'np.logical_not',

  // Control flow — the base compiler's default emits JS ternaries and a bare
  // `NaN`, both of which are Python SyntaxErrors. Emit Python conditional
  // expressions (`a if cond else b`) and `float('nan')`.
  If: (args, compile) => {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    return `((${compile(args[1])}) if (${compile(args[0])}) else (${compile(
      args[2]
    )}))`;
  },
  // DIVERGENCE (documented, CO-P2-24): a *non-boolean* condition (e.g. one that
  // evaluates to NaN) makes the interpreter throw ("Condition must evaluate to
  // True or False"), whereas this Python conditional expression treats it by
  // truthiness and takes the else branch. Aligning would require an inline
  // Python raise (no clean expression-position form) — left documented. The JS
  // target aligns via `_SYS.cond`; conditions built from relational/logical
  // operators (the common case) are already boolean, so no divergence arises.
  When: (args, compile) => {
    if (args.length !== 2)
      throw new Error('When: expected exactly 2 arguments (expr, cond)');
    if (isSymbol(args[1], 'True')) return `(${compile(args[0])})`;
    if (isSymbol(args[1], 'False')) return "float('nan')";
    return `((${compile(args[0])}) if (${compile(args[1])}) else float('nan'))`;
  },
  // See the divergence note on `When` above (non-boolean condition → else
  // branch here vs interpreter throw).
  Which: (args, compile) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error('Which: expected condition/value pairs');
    const build = (i: number): string => {
      if (i >= args.length) return "float('nan')";
      const cond = args[i];
      const val = args[i + 1];
      // `True` marks the default (else) branch.
      if (isSymbol(cond, 'True')) return `(${compile(val)})`;
      return `((${compile(val)}) if (${compile(cond)}) else ${build(i + 2)})`;
    };
    return build(0);
  },

  // Cortex `Match`: structural pattern matching. Not supported by the Python
  // target in v1 (a chained conditional lowering is a possible future bonus, not
  // required — design §5). Fail closed (D6).
  Match: () => {
    throw new Error(
      'Match: pattern matching is not supported by the Python compile target in v1. Fail closed (D6).'
    );
  },

  // Loop — a Python statement loop (`while True:` / `for … in range(…):`), not
  // the base compiler's JS `for`-IIFE (a Python SyntaxError). See
  // compilePythonLoop for the supported shapes.
  Loop: (args, _compile, target) => compilePythonLoop(args, target),

  // Special functions
  Erf: 'scipy.special.erf',
  Erfc: 'scipy.special.erfc',
  Gamma: 'scipy.special.gamma',
  GammaLn: 'scipy.special.loggamma',
  Factorial: 'scipy.special.factorial',
  // Regularized upper incomplete gamma Q(a, z); scipy's argument order matches
  // ours directly.
  GammaRegularized: 'scipy.special.gammaincc',
  // Regularized incomplete beta I_x(a, b); scipy.special.betainc(a, b, x)
  // takes a DIFFERENT argument order than ours (x, a, b) — reorder here.
  BetaRegularized: ([x, a, b], compile) => {
    if (x === null || a === null || b === null)
      throw new Error('BetaRegularized: missing argument');
    return `scipy.special.betainc(${compile(a)}, ${compile(b)}, ${compile(x)})`;
  },

  // Common patterns
  List: (args, compile) => {
    // Python list notation
    return `[${args.map((x) => compile(x)).join(', ')}]`;
  },
  // Matrix wraps List(List(...), ...) — compile as np.array for proper matrix ops
  Matrix: (args, compile) => `np.array(${compile(args[0])})`,
  // Tuple compiles to a Python tuple
  Tuple: (args, compile) => `(${args.map((x) => compile(x)).join(', ')})`,
  Sequence: (args, compile) => {
    // NumPy array
    return `np.array([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Range: (args, compile) => {
    // CE `Range` is INCLUSIVE of both endpoints, `Range(n)` is 1..n, and a
    // range with no explicit step auto-descends when stop < start
    // (`Range(5, 1)` → [5,4,3,2,1]). (Previously emitted a bare `np.arange`,
    // which excludes the stop, is 0-based in the one-argument form, and
    // never descends — silently diverging from the interpreter.) The count
    // is `⌊(stop − start)/step⌋ + 1`, computed explicitly so a fractional
    // step never overshoots the endpoint; a zero step yields [].
    if (args.length === 0) return '[]';
    const start = args.length === 1 ? '1' : compile(args[0]);
    const stop = args.length === 1 ? compile(args[0]) : compile(args[1]);
    if (args.length <= 2)
      return `(lambda _a, _b: [float(_a + (1 if _b >= _a else -1) * _i) for _i in range(int(np.floor(abs(_b - _a))) + 1)])(${start}, ${stop})`;
    return `(lambda _a, _b, _s: [] if _s == 0 else [float(_a + _s * _i) for _i in range(max(0, int(np.floor((_b - _a) / _s)) + 1))])(${start}, ${stop}, ${compile(args[2])})`;
  },

  // --- Function literals ---------------------------------------------------
  // A `Function` literal compiles to a Python lambda. Without this handler
  // the base compiler emits a JavaScript arrow function — invalid Python.
  // A lambda body must be a single expression, so a statement-shaped body
  // (`Block`) fails closed.
  Function: (args, compile, target) => {
    if (args[0] == null) throw new Error('Function: missing body');
    // Function-literal bodies canonicalize wrapped in a `Block`; a
    // single-expression Block unwraps into the lambda body. A genuine
    // multi-statement body fails closed — a Python lambda is
    // expression-only.
    let body = args[0];
    while (isFunction(body, 'Block') && body.nops === 1) body = body.ops[0];
    if (isFunction(body, 'Block'))
      throw new Error(
        `Function: a multi-statement (Block) body cannot compile to a ` +
          `Python lambda. Fail closed (D6).`
      );
    const params = args
      .slice(1)
      .map((x) => functionLiteralParameterName(x) || '_');
    const bodyCode = BaseCompiler.compile(body.canonical, {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
    });
    return `(lambda ${params.join(', ')}: ${bodyCode})`;
  },

  // --- List-shaped collection operators -------------------------------------
  // Same fail-closed (D6) discipline and interpreter-verified semantics as
  // the JavaScript target: 1-based indexes, `Nothing` → nan, counts clamped.
  Length: (args, compile) => `len(${pyCollArg('Length', args[0], compile)})`,
  Count: (args, compile) => `len(${pyCollArg('Count', args[0], compile)})`,
  IsEmpty: (args, compile) =>
    `(len(${pyCollArg('IsEmpty', args[0], compile)}) == 0)`,
  At: (args, compile) => {
    const coll = pyCollArg('At', args[0], compile);
    if (args[1] == null || args.length !== 2)
      throw new Error(
        `At: only the single-index form compiles. Fail closed (D6).`
      );
    // 1-based; negative counts from the end; 0/out-of-range → nan
    return `(lambda _l, _i: _l[int(_i) - 1] if 1 <= _i <= len(_l) else (_l[int(_i)] if -len(_l) <= _i <= -1 else float('nan')))(${coll}, ${compile(args[1])})`;
  },
  First: (args, compile) =>
    `(lambda _l: _l[0] if len(_l) > 0 else float('nan'))(${pyCollArg('First', args[0], compile)})`,
  Second: (args, compile) =>
    `(lambda _l: _l[1] if len(_l) > 1 else float('nan'))(${pyCollArg('Second', args[0], compile)})`,
  Third: (args, compile) =>
    `(lambda _l: _l[2] if len(_l) > 2 else float('nan'))(${pyCollArg('Third', args[0], compile)})`,
  Last: (args, compile) =>
    `(lambda _l: _l[-1] if len(_l) > 0 else float('nan'))(${pyCollArg('Last', args[0], compile)})`,
  Rest: (args, compile) => `${pyCollArg('Rest', args[0], compile)}[1:]`,
  Most: (args, compile) => `${pyCollArg('Most', args[0], compile)}[:-1]`,
  Take: (args, compile) => {
    const coll = pyCollArg('Take', args[0], compile);
    if (args[1] == null) throw new Error('Take: missing count');
    return `${coll}[:max(0, int(${compile(args[1])}))]`;
  },
  Drop: (args, compile) => {
    const coll = pyCollArg('Drop', args[0], compile);
    if (args[1] == null) throw new Error('Drop: missing count');
    return `${coll}[max(0, int(${compile(args[1])})):]`;
  },
  Reverse: (args, compile) => `${pyCollArg('Reverse', args[0], compile)}[::-1]`,
  Sort: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Sort: a custom comparator does not compile; only the default ` +
          `ascending numeric sort is supported. Fail closed (D6).`
      );
    return `sorted(${pyCollArg('Sort', args[0], compile)})`;
  },
  // 1-based indexes that sort ascending; `sorted` is stable, like the
  // interpreter.
  Ordering: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Ordering: a custom ordering function does not compile. ` +
          `Fail closed (D6).`
      );
    return `(lambda _l: [_i + 1 for _i in sorted(range(len(_l)), key=lambda _j: _l[_j])])(${pyCollArg('Ordering', args[0], compile)})`;
  },
  Join: (args, compile) => {
    if (args.length === 0) return '[]';
    return `[${args
      .map((a, i) => `*${pyCollArg('Join', a, compile, i + 1)}`)
      .join(', ')}]`;
  },
  Append: (args, compile) => {
    const coll = pyCollArg('Append', args[0], compile);
    if (args[1] == null) throw new Error('Append: missing value');
    return `[*${coll}, ${compile(args[1])}]`;
  },
  IndexOf: (args, compile) => {
    const coll = pyCollArg('IndexOf', args[0], compile);
    if (args[1] == null) throw new Error('IndexOf: missing value');
    return `(lambda _l, _v: _l.index(_v) + 1 if _v in _l else 0)(${coll}, ${compile(args[1])})`;
  },
  Contains: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Contains', args[0]);
    const coll = pyCollArg('Contains', args[0], compile);
    if (args[1] == null) throw new Error('Contains: missing value');
    return `(${compile(args[1])} in ${coll})`;
  },
  // First-occurrence order (`dict.fromkeys` preserves insertion order).
  Unique: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Unique', args[0]);
    return `list(dict.fromkeys(${pyCollArg('Unique', args[0], compile)}))`;
  },
  Zip: (args, compile) => {
    if (args.length === 0) return '[]';
    const colls = args.map((a, i) => pyCollArg('Zip', a, compile, i + 1));
    return `[list(_t) for _t in zip(${colls.join(', ')})]`;
  },
  // Both endpoints included (native np.linspace); count truncated and
  // clamped ≥ 0; defaults mirror the interpreter (start 1, count 50).
  Linspace: (args, compile) => {
    if (args[0] == null) throw new Error('Linspace: missing argument');
    const start = args[1] == null ? '1' : compile(args[0]);
    const end = args[1] == null ? compile(args[0]) : compile(args[1]);
    const count = args[2] == null ? '50' : compile(args[2]);
    return `[float(_v) for _v in np.linspace(${start}, ${end}, max(0, int(${count})))]`;
  },
  // --- Higher-order collection operators ------------------------------------
  Map: (args, compile) => {
    const coll = pyCollArg('Map', args[0], compile);
    if (args.length > 2)
      throw new Error('Map: multi-collection form is not compiled');
    if (args[1] == null) throw new Error('Map: missing mapping function');
    return `(lambda _f: [_f(_x) for _x in ${coll}])(${pyFnArg('Map', args[1], compile)})`;
  },
  Filter: (args, compile) => {
    const coll = pyCollArg('Filter', args[0], compile);
    if (args[1] == null) throw new Error('Filter: missing predicate');
    return `(lambda _f: [_x for _x in ${coll} if _f(_x)])(${pyFnArg('Filter', args[1], compile)})`;
  },
  CountIf: (args, compile) => {
    const coll = pyCollArg('CountIf', args[0], compile);
    if (args[1] == null) throw new Error('CountIf: missing predicate');
    return `(lambda _f: sum(1 for _x in ${coll} if _f(_x)))(${pyFnArg('CountIf', args[1], compile)})`;
  },
  Find: (args, compile) => {
    const coll = pyCollArg('Find', args[0], compile);
    if (args[1] == null) throw new Error('Find: missing predicate');
    return `(lambda _f: next((_x for _x in ${coll} if _f(_x)), float('nan')))(${pyFnArg('Find', args[1], compile)})`;
  },
  IndexWhere: (args, compile) => {
    const coll = pyCollArg('IndexWhere', args[0], compile);
    if (args[1] == null) throw new Error('IndexWhere: missing predicate');
    return `(lambda _f: next((_i + 1 for _i, _x in enumerate(${coll}) if _f(_x)), 0))(${pyFnArg('IndexWhere', args[1], compile)})`;
  },
  Position: (args, compile) => {
    const coll = pyCollArg('Position', args[0], compile);
    if (args[1] == null) throw new Error('Position: missing predicate');
    return `(lambda _f: [_i + 1 for _i, _x in enumerate(${coll}) if _f(_x)])(${pyFnArg('Position', args[1], compile)})`;
  },
  Any: (args, compile) => {
    const coll = pyCollArg('Any', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Any: only the predicate form compiles. Fail closed (D6).`
      );
    return `(lambda _f: any(_f(_x) for _x in ${coll}))(${pyFnArg('Any', args[1], compile)})`;
  },
  All: (args, compile) => {
    const coll = pyCollArg('All', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `All: only the predicate form compiles. Fail closed (D6).`
      );
    return `(lambda _f: all(_f(_x) for _x in ${coll}))(${pyFnArg('All', args[1], compile)})`;
  },
  TakeWhile: (args, compile) => {
    const coll = pyCollArg('TakeWhile', args[0], compile);
    if (args[1] == null) throw new Error('TakeWhile: missing predicate');
    return `(lambda _f, _l: _l[:next((_i for _i, _x in enumerate(_l) if not _f(_x)), len(_l))])(${pyFnArg('TakeWhile', args[1], compile)}, ${coll})`;
  },
  DropWhile: (args, compile) => {
    const coll = pyCollArg('DropWhile', args[0], compile);
    if (args[1] == null) throw new Error('DropWhile: missing predicate');
    return `(lambda _f, _l: _l[next((_i for _i, _x in enumerate(_l) if not _f(_x)), len(_l)):])(${pyFnArg('DropWhile', args[1], compile)}, ${coll})`;
  },
  // A collection-valued mapping is spliced; a scalar result is kept as-is.
  FlatMap: (args, compile) => {
    const coll = pyCollArg('FlatMap', args[0], compile);
    if (args[1] == null) throw new Error('FlatMap: missing mapping function');
    return `(lambda _f, _l: [_y for _x in _l for _y in (lambda _r: _r if isinstance(_r, list) else [_r])(_f(_x))])(${pyFnArg('FlatMap', args[1], compile)}, ${coll})`;
  },
  // Fold. Built-in combiners use the native reductions; an empty collection
  // with no initial value yields nan (the interpreter's `Nothing`). A custom
  // combiner must be a binary `Function` literal and requires an explicit
  // initial value (same rule as the JavaScript target).
  Reduce: (args, compile) => {
    const coll = pyCollArg('Reduce', args[0], compile);
    const op = args[1];
    const init = args[2];
    if (op == null) throw new Error('Reduce: missing combiner');
    const builtin = isSymbol(op)
      ? {
          Add: 'sum(_l)',
          Multiply: '__import__("math").prod(_l)',
          Min: 'min(_l)',
          Max: 'max(_l)',
        }[op.symbol]
      : undefined;
    if (builtin !== undefined) {
      if (init !== undefined && init !== null) {
        const seeded = {
          'sum(_l)': `sum(_l, ${compile(init)})`,
          '__import__("math").prod(_l)': `__import__("math").prod(_l, start=${compile(init)})`,
          'min(_l)': `min([${compile(init)}, *_l])`,
          'max(_l)': `max([${compile(init)}, *_l])`,
        }[builtin]!;
        return `(lambda _l: ${seeded})(${coll})`;
      }
      return `(lambda _l: float('nan') if len(_l) == 0 else ${builtin})(${coll})`;
    }
    if ((isFunction(op, 'Function') && op.nops - 1 === 2) || isSymbol(op)) {
      if (init === undefined || init === null)
        throw new Error(
          `Reduce: a custom combiner compiles only with an explicit ` +
            `initial value. Fail closed (D6).`
        );
      return `__import__('functools').reduce(${pyFnArg('Reduce', op, compile)}, ${coll}, ${compile(init)})`;
    }
    throw new Error(
      `Reduce: the combiner does not compile to a function on the Python ` +
        `target. Fail closed (D6).`
    );
  },
  // Running fold: `itertools.accumulate`. With an initial value the
  // accumulated seed is not emitted (slice it off, matching the
  // interpreter); without one the first element seeds and is emitted as-is.
  Scan: (args, compile) => {
    const coll = pyCollArg('Scan', args[0], compile);
    const op = args[1];
    const init = args[2];
    if (op == null) throw new Error('Scan: missing combiner');
    const builtin = isSymbol(op)
      ? {
          Add: '(lambda _a, _b: _a + _b)',
          Multiply: '(lambda _a, _b: _a * _b)',
          Min: '(lambda _a, _b: min(_a, _b))',
          Max: '(lambda _a, _b: max(_a, _b))',
        }[op.symbol]
      : undefined;
    const fn =
      builtin ??
      ((isFunction(op, 'Function') && op.nops - 1 === 2) || isSymbol(op)
        ? pyFnArg('Scan', op, compile)
        : undefined);
    if (fn === undefined)
      throw new Error(
        `Scan: the combiner does not compile to a function on the Python ` +
          `target. Fail closed (D6).`
      );
    if (init !== undefined && init !== null)
      return `list(__import__('itertools').accumulate(${coll}, ${fn}, initial=${compile(init)}))[1:]`;
    return `list(__import__('itertools').accumulate(${coll}, ${fn}))`;
  },
  // Apply the function to 1-based indexes; a statically non-positive
  // dimension is inert in the interpreter and fails closed.
  Tabulate: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Tabulate: missing argument');
    if (args.length > 3)
      throw new Error(
        `Tabulate: only the 1-D and 2-D forms compile. Fail closed (D6).`
      );
    for (let i = 1; i < args.length; i++) {
      const dim = tryGetConstant(args[i]!);
      if (dim !== undefined && Math.round(dim) <= 0)
        throw new Error(
          `Tabulate: a statically non-positive dimension (${dim}) is inert ` +
            `in the interpreter. Fail closed (D6).`
        );
    }
    const f = pyFnArg('Tabulate', args[0], compile);
    const n = compile(args[1]);
    if (args.length === 2)
      return `(lambda _f: [_f(_i + 1) for _i in range(max(0, round(${n})))])(${f})`;
    const m = compile(args[2]);
    return `(lambda _f: [[_f(_i + 1, _j + 1) for _j in range(max(0, round(${m})))] for _i in range(max(0, round(${n})))])(${f})`;
  },
  Fill: (args, compile) => {
    const dims = args[1];
    if (args[0] == null || dims == null)
      throw new Error('Fill: missing argument');
    if (!isFunction(dims) || dims.ops.length !== 2)
      throw new Error(
        `Fill: only the (function, (rows, cols)) form compiles. ` +
          `Fail closed (D6).`
      );
    const f = pyFnArg('Fill', args[0], compile);
    const rows = compile(dims.ops[0]);
    const cols = compile(dims.ops[1]);
    return `(lambda _f: [[_f(_i + 1, _j + 1) for _j in range(max(0, round(${cols})))] for _i in range(max(0, round(${rows})))])(${f})`;
  },
  // --- Core scalar operators -------------------------------------------------
  Boole: (args, compile) => {
    if (args[0] == null) throw new Error('Boole: missing argument');
    if (!BaseCompiler.isBooleanValued(args[0]))
      throw new Error(
        `Boole: the argument is not provably boolean. Fail closed (D6).`
      );
    return `(1 if ${compile(args[0])} else 0)`;
  },
  KroneckerDelta: (args, compile) => {
    if (args.length === 0 || args[0] == null)
      throw new Error('KroneckerDelta: missing argument');
    const tol = args[0].engine.tolerance ?? 1e-10;
    if (args.length === 1)
      return `(1 if abs(${compile(args[0])}) <= ${tol} else 0)`;
    return `(lambda *_v: 1 if all(abs(_x - _v[0]) <= ${tol} for _x in _v) else 0)(${args.map((a) => compile(a)).join(', ')})`;
  },
  Element: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Element: missing argument');
    requirePrimitiveElements('Element', args[1]);
    return `(${compile(args[0])} in ${pyCollArg('Element', args[1], compile)})`;
  },
  Identity: (args, compile) => {
    if (args[0] == null) throw new Error('Identity: missing argument');
    return compile(args[0]);
  },
  Apply: (args, compile) => {
    if (args[0] == null) throw new Error('Apply: missing function');
    return `(${compile(args[0])})(${args
      .slice(1)
      .map((a) => compile(a))
      .join(', ')})`;
  },
  // --- Linear algebra (numpy; regular arrays only) ---------------------------
  Flatten: (args, compile) => {
    if (args[1] != null)
      throw new Error(
        `Flatten: an explicit depth does not compile on the Python target. ` +
          `Fail closed (D6).`
      );
    // Recursive self-passing lambda: flattens ragged (non-rectangular)
    // nested lists, which np.asarray(...).ravel() rejects.
    return `(lambda _l: (lambda _f: _f(_f, _l))(lambda _f, _x: [_y for _e in _x for _y in (_f(_f, _e) if isinstance(_e, list) else [_e])]))(${pyCollArg('Flatten', args[0], compile)})`;
  },
  Shape: (args, compile) => {
    if (args[0] == null) throw new Error('Shape: missing argument');
    return `list(np.shape(${compile(args[0])}))`;
  },
  // Cyclic padding (np.resize repeats the source), like the interpreter.
  Reshape: (args, compile) => {
    const coll = pyCollArg('Reshape', args[0], compile);
    const dims = args[1];
    if (dims == null) throw new Error('Reshape: missing shape');
    if (!isFunction(dims) || dims.ops.length === 0 || dims.ops.length > 2)
      throw new Error(
        `Reshape: only a 1-D or 2-D target shape compiles. Fail closed (D6).`
      );
    return `np.resize(np.asarray(${coll}), (${dims.ops.map((d) => compile(d)).join(', ')},)).tolist()`;
  },
  Trace: (args, compile) => {
    if (args.length > 1)
      throw new Error(`Trace: explicit axes do not compile. Fail closed (D6).`);
    return `float(np.trace(np.asarray(${pyCollArg('Trace', args[0], compile)})))`;
  },
};

/**
 * Python/NumPy language target implementation
 *
 * Generates Python code that uses NumPy for mathematical operations.
 * The generated code is compatible with NumPy arrays and supports
 * vectorized operations.
 */
export class PythonTarget implements LanguageTarget<Expression> {
  /** Whether to include 'import numpy as np' in generated code */
  private includeImports: boolean;

  /** Whether to use scipy.special for advanced functions */
  private useScipy: boolean;

  constructor(options: { includeImports?: boolean; useScipy?: boolean } = {}) {
    this.includeImports = options.includeImports ?? false;
    this.useScipy = options.useScipy ?? false;
  }

  getOperators(): CompiledOperators {
    return PYTHON_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return PYTHON_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'python',
      // Chained relations join with Python's `and`, not `&&`.
      chainOp: 'and',
      // Evaluate a shared middle operand of a chained relation exactly once
      // (matching the interpreter) by binding it in an immediately-applied
      // `lambda` — Python's expression-position value binding.
      bindExpr: (bindings, body) =>
        `(lambda ${bindings.map((b) => b[0]).join(', ')}: ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      operators: (op) => PYTHON_OPERATORS[op],
      functions: (id) => PYTHON_FUNCTIONS[id],
      // Resolve a mathematical constant; otherwise return `undefined` so
      // BaseCompiler folds an assigned value / declared constant into the code
      // (matching `evaluate()` and the JavaScript target) and falls back to the
      // bare identifier — a Python parameter name — only for a genuinely free
      // symbol.
      var: (id) => PYTHON_CONSTANTS[id],
      complex: (re, im) => `complex(${re}, ${im})`,
      string: (str) => JSON.stringify(str),
      number: (n) => {
        // Python number literals
        if (!isFinite(n)) {
          if (n === Infinity) return 'np.inf';
          if (n === -Infinity) return '-np.inf';
          return 'np.nan';
        }
        return n.toString();
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      // A Python Block is a bare statement sequence (like GLSL/WGSL), never a
      // JS IIFE. Fail closed (D6) if such a block is spliced as a sub-operand.
      bareStatementBlocks: true,
      // Python has no declaration keyword; a `Declare`'s value rides on the
      // separate `name = value` assignment compileBlock emits. Ignore the GPU
      // type-hint argument (`vec2` etc. is meaningless here).
      declare: (_name) => '',
      // Return-prefix the last statement and newline-join. No semicolons.
      block: (stmts) => {
        if (stmts.length === 0) return '';
        const last = stmts.length - 1;
        // A `Loop` (or any for-effect statement) as the block's last element
        // compiles to a `for`/`while` statement — return-prefixing it would
        // produce `return for …:` (a SyntaxError). Emit it as-is and make the
        // block evaluate to `None` (the Loop's `Nothing` value).
        if (/^(for|while)\b/.test(stmts[last])) stmts.push('return None');
        else stmts[last] = `return ${stmts[last]}`;
        return stmts.join('\n');
      },
      ...options,
    };
  }

  /**
   * Build a `var` resolver honoring, in order: shadowed parameters (kept bare),
   * an explicit `vars` mapping (which always wins over folding — a per-call
   * substitution), mathematical constants, then `undefined` so BaseCompiler
   * folds an assigned value / emits the bare identifier for a free symbol.
   */
  private makeVarResolver(
    vars?: Record<string, string>,
    shadowed?: ReadonlyArray<string>
  ): (id: string) => string | undefined {
    return (id: string) => {
      if (shadowed?.includes(id)) return id;
      if (vars && id in vars) return JSON.stringify(vars[id]);
      return PYTHON_CONSTANTS[id];
    };
  }

  /**
   * Compile to Python source code (not executable in JavaScript)
   *
   * Returns Python code as a string. To execute it, use Python runtime.
   */
  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'python'> {
    try {
      return this.compileOrThrow(expr, options);
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
      if (options.fallback !== true) throw e;
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: python): ${error}`
      );
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        'python',
        this.createTarget(),
        options.vars ? new Set(Object.keys(options.vars)) : undefined
      );
    }
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'python'> {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
    const vars = options.vars as Record<string, string> | undefined;
    const target = this.createTarget({
      var: this.makeVarResolver(vars),
    });
    let code = withPythonHelpers(BaseCompiler.compile(expr, target));
    if (this.includeImports) code = this.withImports(code);

    const result: CompilationResult<'python'> = {
      target: 'python',
      success: true,
      code,
    };
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }

  /** Prepend the numpy / cmath / scipy imports when `includeImports` is set. */
  private withImports(code: string): string {
    let imports = 'import numpy as np\n';
    imports += 'import cmath\n';
    if (this.useScipy) imports += 'import scipy.special\n';
    // `math.prod` (from a compiled Product) needs `import math`. The `\b`
    // anchor avoids a false match on `cmath.` (no word boundary before `math`).
    if (/\bmath\./.test(code)) imports += 'import math\n';
    return `${imports}\n${code}`;
  }

  /**
   * Compile an expression to Python source code
   *
   * Returns the Python code as a string. Honors `options.vars` (per-call
   * substitution) and folds assigned symbols.
   */
  compileToSource(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): string {
    const vars = options.vars as Record<string, string> | undefined;
    const target = this.createTarget({ var: this.makeVarResolver(vars) });
    const code = withPythonHelpers(BaseCompiler.compile(expr, target));
    return this.includeImports ? this.withImports(code) : code;
  }

  /**
   * Create a complete Python function from an expression
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the Python function
   * @param parameters - Parameter names (e.g., ['x', 'y', 'z'])
   * @param docstring - Optional docstring for the function
   */
  compileFunction(
    expr: Expression,
    functionName: string,
    parameters: string[],
    docstring?: string
  ): string {
    // Shadow the declared parameters so they stay bare identifiers (never
    // folded to an assigned engine value).
    const target = this.createTarget({
      var: this.makeVarResolver(undefined, parameters),
    });
    const body = BaseCompiler.compile(expr, target);

    const params = parameters.join(', ');
    let code = '';

    if (this.includeImports) {
      code += 'import numpy as np\n';
      code += 'import cmath\n';
      if (this.useScipy) {
        code += 'import scipy.special\n';
      }
      // `math.prod` (from a compiled Product) needs `import math`.
      if (/\bmath\./.test(body)) code += 'import math\n';
      code += '\n';
    }

    // Emit the runtime helpers (once, at module level) when the body routed
    // through them.
    if (body.includes('_ce_rref(')) code += `${PYTHON_RREF_HELPER}\n`;
    if (body.includes('_ce_bcast(')) code += `${PYTHON_BCAST_HELPER}\n`;

    code += `def ${functionName}(${params}):\n`;

    if (docstring) {
      code += `    r"""${docstring}"""\n`;
    }

    if (body.includes('\n')) {
      // Block body — the block hook already put `return` on the last line.
      // Indent each statement under the `def`; do not wrap in `return`.
      const indented = body
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n');
      code += `${indented}\n`;
    } else {
      code += `    return ${body}\n`;
    }

    return code;
  }

  /**
   * Create a vectorized NumPy function from an expression
   *
   * The generated function will work with both scalar values and NumPy arrays.
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the Python function
   * @param parameters - Parameter names
   * @param docstring - Optional docstring
   */
  compileVectorized(
    expr: Expression,
    functionName: string,
    parameters: string[],
    docstring?: string
  ): string {
    const baseFunction = this.compileFunction(
      expr,
      `_${functionName}_scalar`,
      parameters,
      docstring
    );

    let code = baseFunction + '\n';

    code += `# Vectorized version\n`;
    code += `${functionName} = np.vectorize(_${functionName}_scalar)\n`;

    return code;
  }

  /**
   * Create a lambda function from an expression
   *
   * @param expr - The expression to compile
   * @param parameters - Parameter names
   */
  compileLambda(expr: Expression, parameters: string[]): string {
    const target = this.createTarget({
      var: this.makeVarResolver(undefined, parameters),
    });
    const body = BaseCompiler.compile(expr, target);
    // A multi-statement construct (loop-form Sum/Product, Loop, Block) can
    // never be a Python lambda body. This path bypasses the D6 value-operand
    // guard, so check explicitly.
    if (body.includes('\n'))
      throw new Error(
        'compileLambda: a multi-statement construct (loop-form Sum/Product, ' +
          'Loop, or Block) cannot be a Python lambda body — use ' +
          'compileFunction instead.'
      );
    // A collection-operand ElementMax/ElementMin/Clamp routes through the
    // module-level `_ce_bcast` helper, which a bare lambda has no place to
    // define. Fail closed rather than emit a reference to an undefined name.
    if (body.includes('_ce_bcast('))
      throw new Error(
        'compileLambda: ElementMax/ElementMin/Clamp over a collection operand ' +
          'needs the module-level _ce_bcast helper, which cannot ride along a ' +
          'bare lambda — use compileFunction instead.'
      );

    const params = parameters.join(', ');
    return `lambda ${params}: ${body}`;
  }
}
