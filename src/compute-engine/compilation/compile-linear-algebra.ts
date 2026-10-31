// Matrix products and powers, inner products, and static collection widths.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  provenPointWidth,
  provenScalarPointWidth,
} from './javascript-value-facts.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import {
  couldBeNumericTuple,
  isTupleShapedType,
  leafwardElementType,
} from '../collection-utils.js';
import {
  collectionElementType,
  finitePartOfType,
  isNonRealNumber,
  resolveTypeAlias,
} from '../../common/type/utils.js';
import {
  isSubtype,
  isSubtypeOfBroadcastOrIndexed,
} from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { isTensorValue } from '../boxed-expression/tensor-view.js';
import { isPointListOperand } from '../boxed-expression/matrix-operand.js';
import { MIN_UNROLLED_WIDTH } from './fixed-width-unroll.js';
import type { CompileTarget } from './types.js';
import { EXACT_EXPONENT_HEADS, REPEATABLE_SOURCE } from './compiler-tables.js';
import {
  compilationType,
  isBoundPossiblyCollectionTyped,
  isGatedIndexedCollection,
  mayHoldNumericArrayOfRank,
  typeMayHoldTuple,
} from './compiler-type-facts.js';
import { _codeAliases, _runtimeMatrixPowerBases } from './compiler-mode.js';
import { callerOverrides, linearAlgebraLane } from './compile-lanes.js';
import { core } from './compiler-core-hooks.js';
import { tempVar } from './compiler-naming.js';
import { isArrayOperand } from './compile-real-analysis.js';

/**
 * Whether the value of the exponent `e` of a `Power` is EXACT in the
 * interpreter, which takes the matrix power of a square matrix for an exact
 * integer exponent only, and the power of each entry for a float, even one
 * with an integer value (`squareMatrixPower()` in `boxed-function.ts`).
 * Compiled code holds both as the same JavaScript number, so the compiler
 * decides from the expression:
 *
 * - `'int'`: an exact integer literal, or an expression of type `integer`
 *   (the interpreter takes the matrix power for such a type whatever its
 *   value: `Floor(1.5x)`, `2^k`, `Length(L)`);
 * - `'exact'`: an exact literal (a rational), a symbol (an input: a host
 *   number for it is exact in the interpreter when it is an integer, as
 *   `ce.box(2)` is, and a non-integer one gives the power of each entry on
 *   both sides), or `+`, `−`, `×`, `/`, `√` of exact literals and
 *   expressions of type `integer` (`n/2`), and an integer power of those
 *   (`2^k`);
 * - `'inexact'`: a float literal, or arithmetic with a float operand
 *   (`1.5x` is the float `3` at `x = 2`, whose power is the power of each
 *   entry), and a symbol whose assigned value is a float;
 * - `'unknown'`: anything else — arithmetic on a symbol that is not an
 *   integer (`2x` at the host float `x = 2.5` is the float `5`), a call of
 *   a user function, a transcendental function.
 */
export function exponentExactness(
  e: Expression
): 'int' | 'exact' | 'inexact' | 'unknown' {
  if (isNumber(e))
    return !e.isExact ? 'inexact' : e.isInteger === true ? 'int' : 'exact';
  if (isSubtype(finitePartOfType(e.type.type), 'integer')) return 'int';
  if (isSymbol(e)) {
    const value = e.value;
    if (value !== undefined && isNumber(value) && !value.isExact)
      return 'inexact';
    return 'exact';
  }
  if (!isFunction(e)) return 'unknown';
  const parts = e.ops.map((op) => {
    const c = exponentExactness(op);
    // An operand that is a symbol may hold a non-integer float.
    return c === 'exact' && isSymbol(op) ? 'unknown' : c;
  });
  // An integer power of an exact number is exact (`2^k`, typed `rational`
  // for a `k` that may be negative).
  const integerPower = e.operator === 'Power' && parts[1] === 'int';
  if (!integerPower && !EXACT_EXPONENT_HEADS.has(e.operator)) return 'unknown';
  if (parts.includes('inexact')) return 'inexact';
  if (parts.every((c) => c === 'int' || c === 'exact')) return 'exact';
  return 'unknown';
}

/**
 * The JavaScript code of `Power(base, exponent)` (the operands `args`) when
 * the type of the base does not give its rank, so that the base may hold
 * a square matrix at run time: a `tensor<number>`, a `list<list<number>>`,
 * a `broadcastable<number>`. `undefined` when the element-wise power that
 * `compileExpr` emits is the answer.
 *
 * `evaluate()` reads the VALUE of the base (`squareMatrixPower()` in
 * `boxed-function.ts`): an integer power of a square matrix is the matrix
 * power, also for each matrix inside a tensor of rank 3 or more, and any
 * other shape takes the power of each entry. The code does the same on the
 * shape of the value: `_SYS.matrixPowerShape` answers the matrix power, or
 * `undefined`, in which case the element-wise power runs. The operands are
 * evaluated once: an operand whose code cannot be repeated for free is
 * bound to a parameter, and the element-wise power reads that parameter
 * (`_codeAliases`).
 *
 * A collection exponent is paired with the base level by level, and the
 * helper throws when that pairing meets a matrix with an integer exponent
 * (`p^[1, 2]` for `p` of rank 3), a matrix power the code does not compute.
 * An integer power of a matrix that is not square throws too, as the
 * interpreter answers the `expected-square-matrix` error.
 *
 * Nothing changes for an exponent that is a number literal other than an
 * exact integer (`p^0.5`, the power of each entry in every case), for a
 * base whose rank is known (a vector, `list<number>`, and a `matrix`, which
 * `isSquareMatrixPower()` decides), and for a scalar base.
 *
 * Nothing changes either for a base whose type may hold a tuple (a point):
 * `list<unknown>`, a bare `list`, `any`, `list<tuple<…>>`. Compiled code
 * holds a point as an array, so a list of two points `[(1, 2), (3, 4)]`,
 * whose power is the power of each coordinate, and the matrix
 * `[[1, 2], [3, 4]]`, whose power is the matrix power, are the same value
 * at run time, and the hosts pass lists of points to compiled code. Such a
 * base keeps the element-wise power.
 */
export function compileRuntimeMatrixPower(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): string | undefined {
  const [base, exponent] = args;
  if (_runtimeMatrixPowerBases.has(base)) return undefined;
  // A caller's own `Power` lowering is not bypassed.
  if (callerOverrides(target, 'Power')) return undefined;
  const t = base.type.type;
  if (base.type.matches('matrix')) return undefined;
  if (
    !base.type.matches('indexed_collection<any>') &&
    !isBoundPossiblyCollectionTyped(base)
  )
    return undefined;
  const r = resolveTypeAlias(t);
  if (typeof r === 'string' || !mayHoldNumericArrayOfRank(r, 2))
    return undefined;
  // A base that may hold points keeps the element-wise power: compiled
  // code holds a point as an array, so it cannot tell a list of points
  // from a matrix by the shape of the value.
  if (typeMayHoldTuple(t)) return undefined;
  if (isNumber(exponent) && (!exponent.isExact || exponent.isInteger !== true))
    return undefined;
  const exactness = exponentExactness(exponent);
  if (exactness === 'inexact') return undefined;
  const params: string[] = [];
  const values: string[] = [];
  const reads: string[] = [];
  // Both operands are compiled first, with no alias in force: their code
  // is evaluated as the arguments of the arrow function that binds the
  // parameters, so it must not read one of them (an exponent `Length(b)`
  // over the same computed base `b`, with the common-subexpression pass
  // off, read the base's parameter outside its scope).
  //
  // An alias is keyed by node, so the two positions need two nodes: when
  // the exponent is the very node of the base (`f()^f()` with an impure
  // `f`, evaluated once per position), the element-wise power reads the
  // exponent from a copy of that node, aliased to its own parameter.
  const operands: Expression[] = [
    base,
    exponent === base && isFunction(exponent)
      ? engine._fn(exponent.operator, [...exponent.ops])
      : exponent,
  ];
  const bound: Array<[Expression, string]> = [];
  for (const op of operands) {
    const code = core.compile(op, target);
    if (REPEATABLE_SOURCE.test(code)) {
      reads.push(code);
      continue;
    }
    const v = tempVar(target);
    params.push(v);
    values.push(code);
    reads.push(v);
    bound.push([op, v]);
  }
  // The aliases this call installs, with the alias each node had before
  // (`undefined` for none), so that they are restored also when the
  // emission throws: a lane mismatch in the strict attempt of `auto` is
  // caught, and the complex retry compiles the same nodes again.
  const installed: Array<[Expression, string | undefined]> = [];
  let elementwise: string;
  try {
    for (const [op, v] of bound) {
      installed.push([op, _codeAliases.get(op)]);
      _codeAliases.set(op, v);
    }
    // The guard covers the element-wise emission of THIS power only, after
    // both operands are compiled: an operand may hold another `Power` of
    // the same base node (`p^(p^2)[1][1]`), which takes its own dispatch.
    _runtimeMatrixPowerBases.add(base);
    try {
      elementwise = core.compileExpr(
        engine,
        'Power',
        operands,
        prec,
        target,
        node
      );
    } finally {
      _runtimeMatrixPowerBases.delete(base);
    }
  } finally {
    for (const [op, previous] of installed.reverse()) {
      if (previous === undefined) _codeAliases.delete(op);
      else _codeAliases.set(op, previous);
    }
  }
  if (exactness === 'unknown') reads.push('true');
  const body = `(_SYS.matrixPowerShape(${reads.join(', ')}) ?? (${elementwise}))`;
  return params.length === 0
    ? body
    : `((${params.join(', ')}) => ${body})(${values.join(', ')})`;
}

/** The `Multiply` operand lists whose element-wise code
 * `compileMatrixProduct` is emitting, so that this emission does not
 * dispatch a second time. Keyed by the identity of the operand array. */
export const _runtimeMatrixProducts = new Set<ReadonlyArray<Expression>>();

/** Is the operand typed as a matrix or a tensor (a list type with two
 * dimensions or more, or a tensor of unknown rank)? A bare `list` and
 * `any` are not. */
export function isTypedMatrixOperand(a: Expression): boolean {
  if (isTensorValue(a)) return a.shape.length >= 2;
  const t = resolveTypeAlias(a.type.type);
  if (typeof t === 'string' || t.kind !== 'list') return false;
  return t.dimensions === null || (t.dimensions?.length ?? 0) >= 2;
}

/**
 * The dimensions of a `Multiply` operand that is a vector or a matrix of
 * numbers by its type or its literal value (`[3]`, `[2, 3]`, `-1` for a
 * dimension that is not known), or `undefined` when the type does not give
 * a rank of 1 or 2 (`tensor<number>`, `list<list<number>>`, a union).
 */
export function matrixProductDimensions(
  a: Expression
): ReadonlyArray<number> | undefined {
  if (isTensorValue(a)) {
    const shape = a.shape;
    return shape.length === 1 || shape.length === 2 ? shape : undefined;
  }
  const t = resolveTypeAlias(a.type.type);
  if (typeof t === 'string' || t.kind !== 'list') return undefined;
  if (!isSubtype(t.elements, 'number')) return undefined;
  if (t.dimensions === undefined) return [-1];
  if (t.dimensions === null) return undefined;
  return t.dimensions.length === 1 || t.dimensions.length === 2
    ? t.dimensions
    : undefined;
}

/**
 * Whether the value of the `Multiply` operand `a` may hold a tuple (a
 * point) at some level, for `compileMatrixProduct`. A symbol, a literal or
 * a call is read by its type (`typeMayHoldTuple`). An application of an
 * element-wise operator (`Add`, `Sin`, `Multiply`, …) has the shape of its
 * operands, so its operands are read instead of its type: the type of
 * `p + 1` for `p: list<number> | list<list<number>>` has a `list<any>` arm,
 * which would read as a possible list of points.
 */
export function mayHoldPoint(
  engine: ComputeEngine,
  a: Expression,
  depth = 0
): boolean {
  if (
    depth < 8 &&
    isFunction(a) &&
    a.operator !== 'List' &&
    a.operator !== 'Tuple'
  ) {
    const def = engine.lookupDefinition(a.operator);
    if (isOperatorDef(def) && def.operator.broadcastable === true)
      return a.ops.some(
        (x) => couldBeNumericTuple(x) || mayHoldPoint(engine, x, depth + 1)
      );
  }
  return typeMayHoldTuple(a.type.type);
}

/**
 * The JavaScript code of `Multiply(args)` when two operands or more are
 * arrays and one may be a matrix, or `undefined` when the code that
 * `compileExpr` emits otherwise is the answer.
 *
 * `evaluate()` computes the product of two matrices as the matrix product
 * (`mulTensors()` in `arithmetic-mul-div.ts`, user decision 2026-10-22):
 * the tensors are multiplied left to right, a step with a matrix is the
 * matrix product, a step between two vectors is the product of each
 * entry, and the numbers scale the result. The code does the same:
 *
 * - When the type of every array operand gives its rank (a `matrix`, a
 *   `vector`, a `list<number>`, a literal) and one is a matrix, the code
 *   calls `_SYS.mul` (`_SYS.cmul` for complex entries), which computes
 *   that product. Two dimensions that are known and do not agree make the
 *   compilation fail: `evaluate()` answers the `incompatible-dimensions`
 *   error.
 * - When the type of an operand does not give its rank (`tensor<number>`,
 *   `list<list<number>>`), the code decides on the shape of the values, as
 *   for `Power` (`compileRuntimeMatrixPower`): `_SYS.matrixProductShape`
 *   answers the product when an operand holds a matrix, or `undefined`, in
 *   which case the element-wise code runs. Each operand is evaluated once.
 * - On the Python target, the first case is `np.matmul` (and `np.multiply`
 *   for a step between two vectors). The second case answers `undefined`,
 *   and `compileExpr` refuses the product, as for any arithmetic over a
 *   list on that target.
 *
 * Nothing changes for an operand whose type may hold a tuple (a point):
 * a bare `list`, `list<unknown>`, `any`, `list<tuple<…>>`. Compiled code
 * holds a point as an array, so a list of two points and a 2×2 matrix are
 * the same value at run time, and the hosts pass lists of points to
 * compiled code: such a product keeps its element-wise code. Nothing
 * changes either for an operand whose shape is not known at all (a
 * `broadcastable<number>`, a call typed `unknown`): `tryCompileBroadcast`
 * already emits `_SYS.mul` for it, which dispatches on the rank of the
 * values.
 */
export function compileMatrixProduct(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): string | undefined {
  if (_runtimeMatrixProducts.has(args)) return undefined;
  // A caller's own `Multiply` lowering is not bypassed.
  if (callerOverrides(target, 'Multiply')) return undefined;
  const arrays = args.filter((a) => isArrayOperand(a, target));
  if (arrays.length < 2) return undefined;
  // Two factors typed as matrices beside a list of points: the interpreter
  // multiplies the matrices first, `(m·n)·P`, and scales the points by the
  // result. The element-wise code below pairs the factors one by one, so
  // the product is refused rather than compiled to another value. A bare
  // `list` or `any` factor is not typed as a matrix and keeps its code.
  if (
    arrays.some((a) => isPointListOperand(a)) &&
    arrays.filter((a) => isTypedMatrixOperand(a)).length >= 2
  )
    throw new Error(
      'Could not compile `Multiply`: two matrices beside a list of points are ' +
        'multiplied together first, then scale the points. The compiled ' +
        'code pairs the factors one by one. `evaluate()` computes the product.'
    );
  if (
    args.some(
      (a) =>
        couldBeNumericTuple(a) ||
        isBoundPossiblyCollectionTyped(a, target) ||
        isGatedIndexedCollection(a)
    )
  )
    return undefined;
  if (arrays.some((a) => mayHoldPoint(engine, a))) return undefined;
  const mayBeMatrix = (a: Expression): boolean =>
    isTensorValue(a)
      ? a.shape.length === 2
      : mayHoldNumericArrayOfRank(a.type.type, 2);
  if (!arrays.some(mayBeMatrix)) return undefined;
  // Every other operand must be a number: it scales the product.
  if (args.some((a) => !arrays.includes(a) && !a.type.matches('number')))
    return undefined;

  const dims = arrays.map((a) => matrixProductDimensions(a));
  if (dims.every((d) => d !== undefined) && dims.some((d) => d!.length === 2)) {
    // The rank of every array is known: check the dimensions, left to
    // right, as `mulTensors()` multiplies them.
    const agree = (a: number, b: number) => a < 0 || b < 0 || a === b;
    let shape: ReadonlyArray<number> = dims[0]!;
    for (const d of dims.slice(1) as ReadonlyArray<number>[]) {
      const inner = shape.length === 2 ? shape[1] : shape[0];
      if (!agree(inner, d[0]))
        throw new Error(
          'Could not compile `Multiply`: the product of these matrices is the matrix product, and their ' +
            'dimensions do not agree. `evaluate()` answers the `incompatible-dimensions` error.'
        );
      shape =
        shape.length === 1 && d.length === 1
          ? shape
          : shape.length === 2 && d.length === 2
            ? [shape[0], d[1]]
            : shape.length === 2
              ? [shape[0]]
              : [d[1]];
    }
    if (target.language === 'python') {
      // NumPy computes with complex entries as with real ones. A step with
      // a matrix is `np.matmul`, a step between two vectors is
      // `np.multiply`, and the numbers scale the result (a NumPy array).
      let product = core.compile(arrays[0], target);
      let rank = dims[0]!.length;
      for (const [i, a] of arrays.entries()) {
        if (i === 0) continue;
        const code = core.compile(a, target);
        const r = dims[i]!.length;
        product =
          rank === 1 && r === 1
            ? `np.multiply(${product}, ${code})`
            : `np.matmul(${product}, ${code})`;
        rank = rank === 2 && r === 2 ? 2 : 1;
      }
      // At the precedence of a product, so that a sum is in parentheses:
      // `(x + 1)·p·q` is `(x + 1) * np.matmul(p, q)`.
      const scalars = args
        .filter((a) => !arrays.includes(a))
        .map((a) => core.compile(a, target, 12));
      return scalars.length === 0
        ? product
        : `(${[...scalars, product].join(' * ')})`;
    }
    const complex =
      linearAlgebraLane(args) === 'complex' ||
      args.some((a) => core.isComplexValued(a));
    const helper = complex ? '_SYS.cmul' : '_SYS.mul';
    return `${helper}(${args.map((a) => core.compile(a, target)).join(', ')})`;
  }

  // Python: a product whose ranks are known only at run time keeps the
  // refusal below (`compileExpr`), as a `Power` of such a base does.
  if (target.language !== 'javascript') return undefined;

  // The rank of an operand is known only at run time: dispatch on the
  // shape of the values. Each operand that cannot be repeated for free is
  // bound to a parameter, which the element-wise code reads
  // (`_codeAliases`), as in `compileRuntimeMatrixPower`.
  //
  // An alias is keyed by node, so each position needs its own node: when
  // the same node is two factors (`f()·f()` with an impure `f`, evaluated
  // once per position), the second position reads a copy of that node,
  // aliased to its own parameter, as in `compileRuntimeMatrixPower`.
  const operands: Expression[] = args.map((a, i) =>
    args.indexOf(a) < i && isFunction(a)
      ? engine._fn(a.operator, [...a.ops])
      : a
  );
  const params: string[] = [];
  const values: string[] = [];
  const reads: string[] = [];
  const bound: Array<[Expression, string]> = [];
  for (const op of operands) {
    const code = core.compile(op, target);
    if (REPEATABLE_SOURCE.test(code)) {
      reads.push(code);
      continue;
    }
    const v = tempVar(target);
    params.push(v);
    values.push(code);
    reads.push(v);
    bound.push([op, v]);
  }
  const installed: Array<[Expression, string | undefined]> = [];
  let elementwise: string;
  try {
    for (const [op, v] of bound) {
      installed.push([op, _codeAliases.get(op)]);
      _codeAliases.set(op, v);
    }
    _runtimeMatrixProducts.add(operands);
    try {
      elementwise = core.compileExpr(
        engine,
        'Multiply',
        operands,
        prec,
        target,
        node
      );
    } catch (e) {
      // The element-wise code is refused when an operand is a matrix by
      // its type (`tryCompileBroadcast`). The helper then never answers
      // `undefined`: it finds that matrix in the values, and computes the
      // product or throws. So the element-wise branch is never run.
      if (!(e instanceof Error) || e.name === 'CancellationError') throw e;
      if (!dims.some((d) => d?.length === 2)) throw e;
      elementwise = 'NaN';
    } finally {
      _runtimeMatrixProducts.delete(operands);
    }
  } finally {
    for (const [op, previous] of installed.reverse()) {
      if (previous === undefined) _codeAliases.delete(op);
      else _codeAliases.set(op, previous);
    }
  }
  const body = `(_SYS.matrixProductShape(${reads.join(', ')}) ?? (${elementwise}))`;
  return params.length === 0
    ? body
    : `((${params.join(', ')}) => ${body})(${values.join(', ')})`;
}

/**
 * The number of elements an emitted source text holds when it is one array
 * LITERAL — `[a, b, c]` gives three — and `undefined` when the text is
 * anything else, so its run-time shape is not decided by reading it.
 *
 * The component fan-out of {@link tryCompileBroadcast} uses this to tell an
 * operand it may read by index (an array literal of the right length, which
 * a `List` node and an inner fan-out both compile to) from one it must test
 * first (a `vars` read, a call result, an element read).
 *
 * A quote anywhere in the text is answered as "not a literal": a comma
 * inside a string would be counted as an element separator, and a source
 * that is refused here is only tested at run time, never mis-read.
 */
export function arrayLiteralWidth(code: string): number | undefined {
  return arrayLiteralElements(code)?.length;
}

/**
 * The emitted text of a hoisted constant list literal when `code` is the
 * name of one (`hoistConstantListLiteral`), else `code` itself. The
 * component fan-outs read the elements of an array literal from its text
 * ({@link arrayLiteralElements}); a literal that was hoisted is read
 * through its text too, so `[1, 2, 3] x` is still written component by
 * component with the numbers in place, and the local nothing reads any
 * more is removed (`pruneUnreferencedVariantBases`). Only the fan-out
 * reads the text: a source bound whole, or handed to a run-time helper,
 * keeps the name, and with it the one-time evaluation.
 */
export function hoistedListLiteralText(
  target: CompileTarget<Expression>,
  code: string
): string {
  const literals = target.userFunctions?.listLiterals;
  if (literals === undefined || !code.startsWith('_lit_')) return code;
  for (const [text, name] of literals) if (name === code) return text;
  return code;
}

/**
 * The element source texts of an emitted array LITERAL — `[a, b + 1]`
 * gives `['a', '(b + 1)']` — or `undefined` when the text is anything else,
 * or when `width` is given and the count differs from it. The rules are
 * those of {@link arrayLiteralWidth}, which is this function's length.
 *
 * Every text answered is ATOMIC: an element of an array literal is compiled
 * at precedence zero, so `a + b` arrives unparenthesized, and the callers
 * splice a text straight into an operator position — a factor of a product,
 * an operand of the scalar codegen — without parenthesizing it. A text that
 * is not atomic on its own ({@link isAtomicSource}) is therefore wrapped
 * here. Without the wrap, `Dot((a+b,c),(d,e))` emitted
 * `(_.a + _.b * _.d + _.c * _.e)` and ran to 24 where the interpreter
 * answers 27.
 */
export function arrayLiteralElements(
  code: string,
  width?: number
): string[] | undefined {
  if (!code.startsWith('[') || !code.endsWith(']')) return undefined;
  if (/['"`]/.test(code)) return undefined;
  const inner = code.slice(1, -1);
  if (inner.trim() === '')
    return width === undefined || width === 0 ? [] : undefined;
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '[' || c === '(' || c === '{') depth += 1;
    else if (c === ']' || c === ')' || c === '}') {
      depth -= 1;
      // The opening bracket closed before the end of the text, so the text
      // is not one literal but an expression that starts with one
      // (`[1, 2].concat(x)`).
      if (depth === 0 && i !== code.length - 1) return undefined;
    } else if (c === ',' && depth === 1) {
      parts.push(code.slice(start + 1, i).trim());
      start = i;
    }
  }
  if (depth !== 0) return undefined;
  parts.push(code.slice(start + 1, code.length - 1).trim());
  if (width !== undefined && parts.length !== width) return undefined;
  return parts.map((p) => (isAtomicSource(p) ? p : `(${p})`));
}

/**
 * Whether a source text may be spliced into an operator position — a factor
 * of a product, an operand of the head's scalar codegen — without being
 * parenthesized first.
 *
 * True when the text holds nothing at nesting depth ZERO but the characters
 * of a name, a number, a property read and the brackets of a call or an
 * index: `Math.floor(_.x)`, `_tv1[0]`, `2.41` and an already-parenthesized
 * `(a + b)` all qualify, while `a + b` and `a ? b : c` do not. Such a text
 * is a primary expression, possibly followed by member reads and calls, so
 * it binds tighter than any binary operator.
 *
 * The test is deliberately conservative: a text it refuses is only wrapped
 * in parentheses, which is always sound, while a text it wrongly admits
 * would change the meaning of the code that splices it. A NEGATIVE number
 * literal is refused for that reason, and not as an oversight: exponentiation
 * binds tighter than unary minus in Python, so an unparenthesized `-4` as
 * the base of `**` reads as `-(4 ** k)`. A text that holds a string
 * literal is refused or wrapped, never wrongly admitted: a quote at depth
 * zero is refused, and a bracket inside a quoted text at a deeper level
 * can only leave the depth unbalanced, which is refused too.
 * {@link arrayLiteralElements} refuses any text that holds a quote before
 * it asks. The Python function lowerings of `Multiply` and `Power` read it
 * to parenthesize an operand (`python-target.ts`).
 */
export function isAtomicSource(code: string): boolean {
  let depth = 0;
  for (const c of code) {
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth < 0) return false;
    } else if (depth === 0 && !/[A-Za-z0-9_$.]/.test(c)) return false;
  }
  return depth === 0;
}

/** A tuple's list-valued coordinates represent several points, not a matrix. */
export function compileBroadcastInnerProduct(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string | undefined {
  if (args.length !== 2) return undefined;
  const types = args.map(compilationType);
  if (!types.every((t) => typeof t !== 'string' && t.kind === 'tuple'))
    return undefined;
  const [left, right] = types as [
    Extract<Type, { kind: 'tuple' }>,
    Extract<Type, { kind: 'tuple' }>,
  ];
  const n = left.elements.length;
  if (n === 0 || right.elements.length !== n) return undefined;
  const components = [...left.elements, ...right.elements];
  // A component may be a number, a list of numbers, or a collection whose
  // type does not say whether it is a list (`indexed_collection<number>`).
  if (
    !components.every((c) => isSubtypeOfBroadcastOrIndexed(c.type, 'number')) ||
    components.every((c) => isSubtype(c.type, 'number'))
  )
    return undefined;
  const realComponents = (t: Type): boolean => {
    if (typeof t !== 'string' && t.kind === 'union')
      return t.types.every(realComponents);
    // Toward the cells (`leafwardElementType`), as in `typeHasComplexLeaf`.
    const element = leafwardElementType(t);
    return element !== undefined
      ? realComponents(element)
      : !isNonRealNumber(t);
  };
  if (
    target.mode === 'complex' ||
    !components.every((c) => realComponents(c.type))
  )
    throw new Error(
      'Could not compile `Dot`: broadcasting complex point coordinates is not supported by this target.'
    );
  const values = args.map(() => tempVar(target));
  // A retained helper can have broad coordinate types while its body
  // constructs scalar coordinates. Bind both operands once and use that
  // value proof before selecting the component-broadcast fallback.
  if (args.every((a) => provenScalarPointWidth(a, target) === n)) {
    const sum = Array.from(
      { length: n },
      (_, k) => `${values[0]}[${k}] * ${values[1]}[${k}]`
    ).join(' + ');
    return `((${values.join(', ')}) => ${sum})(${args.map((a) => core.compile(a, target)).join(', ')})`;
  }
  const params = components.map(() => tempVar(target));
  const coords = values.flatMap((v) =>
    Array.from({ length: n }, (_, k) => `${v}[${k}]`)
  );
  const sum = Array.from(
    { length: n },
    (_, k) => `${params[k]} * ${params[n + k]}`
  ).join(' + ');
  const guard = values
    .map((v) => `Array.isArray(${v}) && ${v}.length === ${n}`)
    .join(' && ');
  return `((${values.join(', ')}) => ${guard} ? _SYS.bcast((${params.join(', ')}) => ${sum}, ${coords.join(', ')}) : _SYS.matmul(${values.join(', ')}))(${args.map((a) => core.compile(a, target)).join(', ')})`;
}

/**
 * The inner product of two points or vectors whose one width the compiler
 * can count, written out as the sum of the component products — `(a, b) ·
 * (c, d)` is `a * c + b * d` — or `undefined` when it cannot be.
 *
 * `_SYS.matmul` tests the rank of both operands and loops over the
 * components; for the two- and three-component points of a plotting
 * kernel that is a call, two shape tests and a loop for two
 * multiplications, on every sample. The shader targets already emit
 * `dot(vec2, vec2)` for the same expression.
 *
 * The admission is that of the component fan-out in
 * {@link tryCompileBroadcast}: both operands of one static width below
 * {@link MIN_UNROLLED_WIDTH} ({@link staticCollectionWidth} — a numeric
 * tuple type or a dimensioned numeric list type), no operand of unprovable
 * run-time shape, and no complex component, since the scalar `*` and `+`
 * written here are the real lowering. As in the fan-out, a source that is
 * not an array literal of the right width is bound once and tested at run
 * time, because a declared width constrains what the ENGINE assigns and not
 * what a caller puts in `vars`; the failing shapes go to `_SYS.matmul`,
 * which answers them the way the interpreter does. Without a test, a
 * literal is read component by component from its text. An IMPURE operand
 * (a point whose coordinates draw a random number) is always bound once,
 * in operand order, never read from its text or repeated: it is evaluated
 * exactly once per call, as the interpreter evaluates it.
 */
export function compileStaticInnerProduct(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string | undefined {
  if (args.length !== 2) return undefined;
  const widths = args.map((a) => staticCollectionWidth(a));
  const n = widths[0];
  if (n === undefined || widths[1] !== n) return undefined;
  if (n < 1 || n >= MIN_UNROLLED_WIDTH) return undefined;
  // The written-out sum is the REAL computation, so a complex lane
  // (`linearAlgebraLane`: a complex entry, or a wide entry under
  // `mode: 'complex'`) goes to the helper choice, which emits the complex
  // helper. This is the answer a parent reads for the value of the node.
  // A WIDE lane (`tuple<number, number>`, `vector<3>` in `strict` and
  // `auto` mode) is read as real, as the helper choice reads it: the
  // written-out sum is scalar arithmetic on the coordinates, as the same
  // sum written by hand (`p_0 q_0 + p_1 q_1`) is.
  if (linearAlgebraLane(args) === 'complex') return undefined;
  for (const a of args) {
    if (isBoundPossiblyCollectionTyped(a, target)) return undefined;
    const t = compilationType(a);
    if (typeof t === 'string') return undefined;
    if (t.kind === 'tuple') {
      if (t.elements.some((el) => isNonRealNumber(el.type))) return undefined;
    } else {
      const elt = collectionElementType(t);
      if (elt === undefined || isNonRealNumber(elt)) return undefined;
    }
  }
  const codes = args.map((a) => core.compile(a, target));
  const texts = codes.map((code) => hoistedListLiteralText(target, code));
  // A point whose coordinates a user function builds from scalars is
  // proved by `provenScalarPointWidth` (the proof that admits an impure
  // body, read through its helper locals); `provenPointWidth` adds the
  // constructed-list sources.
  const needsGuard = texts.map(
    (text, i) =>
      arrayLiteralWidth(text) !== n &&
      provenPointWidth(args[i], target) !== n &&
      provenScalarPointWidth(args[i], target) !== n
  );
  const anyGuard = needsGuard.some((g) => g);
  const bindings: string[] = [];
  const bound: string[] = [];
  const guarded: string[] = [];
  // With an impure operand, BOTH operands are bound once, in operand
  // order, before the sum reads them: an operand read from its literal
  // text or repeated inline would be evaluated after the bound one, and
  // an assignment inside the impure operand would then be seen by the
  // other operand's reads, where the interpreter evaluates the operands
  // in order.
  const anyImpure = args.some((a) => a.isPure !== true);
  const parts: (string | string[])[] = codes.map((code, i) => {
    if (!anyGuard && !anyImpure) {
      const elements = arrayLiteralElements(texts[i], n);
      if (elements !== undefined) return elements;
    }
    if (!needsGuard[i] && !anyImpure && REPEATABLE_SOURCE.test(code))
      return code;
    const v = tempVar(target);
    bindings.push(v);
    bound.push(code);
    if (needsGuard[i]) guarded.push(v);
    return v;
  });
  const read = (i: number, k: number): string => {
    const part = parts[i];
    return Array.isArray(part) ? part[k] : `${part}[${k}]`;
  };
  const terms: string[] = [];
  for (let k = 0; k < n; k++) terms.push(`${read(0, k)} * ${read(1, k)}`);
  const sum = `(${terms.join(' + ')})`;
  if (guarded.length > 0) {
    // The test claims RANK 1 as well as the length, because the sum below
    // multiplies the components as scalars. A declared type constrains what
    // the ENGINE assigns, never what a caller puts in the kernel's `vars`
    // object: a `tuple<number, number>` input may arrive as the matrix
    // `[[1, 2], [3, 4]]`, which has length two and passes a length test
    // alone, and the scalar sum then answers NaN where `_SYS.matmul` — and
    // the interpreter — answer `[5, 11]`. The first element decides the
    // rank, which is the test `_SYS.matmul` itself applies
    // (`Array.isArray(a?.[0])`, `javascript-target.ts`), so a shape this
    // refuses is one the fallback still answers the way the interpreter
    // does.
    const test = guarded
      .map(
        (v) =>
          `Array.isArray(${v}) && ${v}.length === ${n} && ` +
          `!Array.isArray(${v}[0])`
      )
      .join(' && ');
    // Every part is one source text here: a part is the element ARRAY of a
    // literal only when no operand needs the run-time test, and this branch
    // runs only when one does.
    const whole = parts as string[];
    return (
      `((${bindings.join(', ')}) => ${test} ? ${sum} : ` +
      `_SYS.matmul(${whole[0]}, ${whole[1]}))(${bound.join(', ')})`
    );
  }
  return bindings.length === 0
    ? sum
    : `((${bindings.join(', ')}) => ${sum})(${bound.join(', ')})`;
}

/**
 * The number of elements a collection operand holds when its TYPE states it
 * — a one-dimensional list of a fixed length whose elements are provably
 * numbers (`list<number^4>`, spelled `vector<4>`) — and `undefined`
 * otherwise.
 *
 * The element test keeps a point list, a nested list, a string and a
 * dictionary out: component k of one of those is not a scalar the head's
 * scalar codegen can consume.
 *
 * A POINT states its width too: a tuple type lists its components, so a
 * `tuple<number, number>` operand — a literal point, a symbol declared
 * so, or a user-function application whose reconciled result is a numeric
 * tuple — has two. The same element test applies: a component that is a
 * list (a point list), a nested tuple or an `unknown` is not a scalar.
 * The head-specific point rules (a point does not add to a scalar) are
 * applied by the caller, {@link staticBroadcastWidth}.
 */
export function staticCollectionWidth(a: Expression): number | undefined {
  const t = compilationType(a);
  if (typeof t === 'string') return undefined;
  if (t.kind === 'tuple') {
    return t.elements.every((el) => isSubtype(el.type, 'number'))
      ? t.elements.length
      : undefined;
  }
  if (t.kind !== 'list') return undefined;
  const dims = t.dimensions;
  // Only a rank-1 dimension list states a width. A plain list and a
  // tensor of unknown rank (`dimensions` is `null`) state none.
  if (!dims || dims.length !== 1) return undefined;
  const elt = collectionElementType(t);
  if (elt === undefined || !isSubtype(elt, 'number')) return undefined;
  return dims[0];
}

/**
 * The number of COMPONENTS every operand of a broadcast agrees on, when the
 * element-wise application may be emitted as one expression per component
 * instead of a run-time `_SYS.bcast` dispatch — `undefined` when it may not.
 *
 * `_SYS.bcast` allocates a closure, tests the shape of every operand and
 * fills the result array through a call per element. None of that is needed
 * when the compiler can already count the components: `W + 1` for a `W`
 * declared `list<number^4>` is four additions, which is what the interpreter
 * computes and what the shader targets already emit.
 *
 * Admitted only when every operand is PURE — the fan-out reads a collection
 * operand several times — and its shape is provable:
 *
 * - a collection operand states a static width in its type
 *   ({@link staticCollectionWidth}), and every collection operand states the
 *   SAME one, so no position is the length mismatch `_SYS.bcast` answers as
 *   NaN;
 * - every other operand is provably a single number, repeated at each
 *   component exactly as the broadcast repeats a scalar;
 * - no operand's run-time shape is unprovable. A `broadcastable<T>` node or
 *   a top-typed application may be a scalar or an array of any length, and
 *   only the run-time dispatch answers for both;
 * - a POINT operand (a numeric tuple) takes part only in the shapes the
 *   interpreter computes component-wise. A point summed with a scalar is
 *   an `incompatible-type` error there, a product of two points is the
 *   `no-product-between-points` error and a scalar divided by a point is
 *   `no-division-by-point`, so under `Add` every operand must be a point
 *   of the one width, under `Multiply` exactly one operand may be a point
 *   and under `Divide` only the dividend may be. A point beside a LIST is
 *   not a component-wise shape either (the interpreter broadcasts the list
 *   and keeps the point whole — the point lanes of
 *   {@link tryCompileBroadcast}), so the two never mix here. Every other
 *   head broadcasts over a point exactly as over a list — the interpreter
 *   answers `2^(1,2)` as `(2, 4)` and `sin((1,2))` as `(sin 1, sin 2)`,
 *   which is what the component code emitted here computes (measured).
 *
 * The width must be below {@link MIN_UNROLLED_WIDTH}, the same boundary
 * `unrollFixedWidthCollections` uses, read from the other side. That pass
 * fans a collection out BEFORE any target sees it and leaves the narrow
 * widths alone, because they have a native lowering everywhere — a
 * `vec2`/`vec3`/`vec4` on the shader targets, and, until this fan-out, the
 * `_SYS.bcast` closure on JavaScript. A collection still shaped as a runtime
 * array at five elements or more is one whose elements that pass could not
 * see (a declared `list<number^225>` input, say); for those the runtime
 * helper is both the shorter and the faster lowering, since writing out 225
 * expressions is neither.
 */
export function staticBroadcastWidth(
  h: string,
  args: ReadonlyArray<Expression>,
  isArrayOperand: (a: Expression) => boolean
): number | undefined {
  let width: number | undefined;
  let points = 0;
  let lists = 0;
  let scalars = 0;
  let firstIsPoint = false;
  for (const [i, a] of args.entries()) {
    if (a.isPure !== true) return undefined;
    if (isBoundPossiblyCollectionTyped(a)) return undefined;
    if (!isArrayOperand(a)) {
      if (!a.type.matches('number')) return undefined;
      scalars += 1;
      continue;
    }
    const n = staticCollectionWidth(a);
    if (n === undefined) return undefined;
    if (isTupleShapedType(compilationType(a))) {
      points += 1;
      if (i === 0) firstIsPoint = true;
    } else lists += 1;
    if (width === undefined) width = n;
    else if (width !== n) return undefined;
  }
  if (width === undefined || width < 1 || width >= MIN_UNROLLED_WIDTH)
    return undefined;
  if (points > 0) {
    if (lists > 0) return undefined;
    if (h === 'Add' && scalars > 0) return undefined;
    if (h === 'Multiply' && points !== 1) return undefined;
    if (h === 'Divide' && !(points === 1 && firstIsPoint)) return undefined;
  }
  return width;
}
