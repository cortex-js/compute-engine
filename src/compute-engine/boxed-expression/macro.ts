/**
 * The macro kind (`ce.declare(name, { macro: body })`,
 * `docs/plans/2026-11-12-macro-kind-spec.md`).
 *
 * A macro is a value definition that keeps a raw MathJSON body, with no value
 * and the type `unknown`. A name of the input that resolves to it, where
 * boxing makes a canonical or a structural symbol of that name, is replaced
 * by the body, boxed at that place with the options of the occurrence
 * (`box.ts`, and `BoxedSymbol.canonical` for a symbol boxed raw and made
 * canonical later). A symbol that code makes with `ce.symbol()` is not
 * expanded.
 *
 * A leaf module: it imports types only, so that `box.ts` and
 * `boxed-symbol.ts` can both use it.
 */

import type { MathJsonExpression } from '../../math-json/types.js';
import { matchesSymbol } from '../../math-json/utils.js';
import type { Type } from '../../common/type/types.js';
import type {
  BoxedDefinition,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  ComputeEngine,
  Expression,
} from '../global-types.js';

/** True when a name can be expanded as a macro on `ce` now: a macro has
 * been declared on it (`ce._macroCount`), and no evaluation is in progress
 * on it (rule 2). Otherwise the boxing routes skip every test, and a name
 * that resolves to a macro is the plain symbol of that name (rule 7). */
export function anyMacroDeclared(ce: ComputeEngine): boolean {
  return ce._macroCount > 0 && !evaluationInProgress(ce);
}

/** True while an evaluation (`evaluate()`, `N()`, `simplify()`,
 * `compile()`, a slice of `evaluateAsync()`, and the other operations, which
 * run handlers) is in progress on `ce`: an operation environment is in place
 * (`ce._opensOperation()`). The environment of an Epsil program is one only
 * while the run driver evaluates a statement, so the boxing of the program
 * expands. */
function evaluationInProgress(ce: ComputeEngine): boolean {
  const state = ce._boxingState;
  const operation = state.currentOperation();
  return (
    operation !== undefined &&
    (!operation.isProgram || state.inProgramStatement)
  );
}

/** Record that a macro definition of `name` was made on `ce`. */
export function noteMacroDeclared(ce: ComputeEngine, name: string): void {
  ce._macroCount += 1;
  ce._macroNames.add(name);
}

/** True when `def` is a macro definition. */
export function isMacroDef(def: BoxedDefinition | undefined): boolean {
  return def !== undefined && 'value' in def && def.value.macro !== undefined;
}

/** The error of a write of a value to the macro `name` (`ce.assign()`, an
 * evaluated `Assign`, `ce.withValues()`): a macro has no value. */
export function macroWriteError(
  route: 'assign' | 'withValues',
  name: string
): Error {
  return new Error(
    `${route}(): "${name}" is a macro, which has no value. Declare the macro again in a new scope to change it`
  );
}

/**
 * True when `x` has the shape of a MathJSON expression: a number, a string,
 * a function array whose head is a string or a function array, or an object
 * with a `fn`, `sym`, `num`, `str` or `dict` field. This is the only check
 * that `ce.declare(name, { macro })` makes on the body: it is not boxed.
 */
export function isMathJsonShape(x: unknown): boolean {
  if (typeof x === 'number' || typeof x === 'string') return true;
  if (Array.isArray(x)) {
    if (x.length === 0) return false;
    const head = x[0];
    if (typeof head !== 'string' && !Array.isArray(head)) return false;
    return x.every(isMathJsonShape);
  }
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if ('fn' in o) return Array.isArray(o.fn) && isMathJsonShape(o.fn);
  if ('sym' in o) return typeof o.sym === 'string';
  if ('num' in o) return typeof o.num === 'string' || typeof o.num === 'number';
  if ('str' in o) return typeof o.str === 'string';
  if ('dict' in o) return typeof o.dict === 'object' && o.dict !== null;
  return false;
}

/**
 * The operands that take a name and that neither the signature nor the
 * operand roles of their operator mark: a parameter typed `any` that the
 * handler reads as the name of an unknown, or a variable of a calling form
 * that the signature does not describe. Each entry is an operator, the first
 * operand index, counted from 0, from which every operand takes a name,
 * `last` to end the run, and `when`, a test of the raw operands for a form
 * that has the variable. An operator added to a library with such an
 * operand adds a line here.
 */
type NameOperandRun = {
  first: number;
  last?: number;
  when?: (ops: ReadonlyArray<Expression>) => boolean;
};
const NAME_OPERANDS: ReadonlyMap<string, NameOperandRun> = new Map<
  string,
  NameOperandRun
>([
  ['Solve', { first: 1 }],
  ['NSolve', { first: 1 }],
  ['FindRoot', { first: 1, last: 1 }],
  ['FindFit', { first: 2, last: 3 }],
  // The forms with a variable that the `canonical` handler of `Limit` tests
  // for: `Limit(f, To(x, a))`, and `Limit(f, x, a)` or
  // `Limit(f, x, a, direction)` where `f` is not a `Function` literal
  // (`\lim_{x \to a^+}`) and holds `x`. Otherwise the second operand is the
  // point.
  [
    'Limit',
    {
      first: 1,
      last: 1,
      when: (ops) => {
        const x = ops[1] as { operator?: string; symbol?: string };
        if (ops.length === 2) return x.operator === 'To';
        return (
          (ops.length === 3 || ops.length === 4) &&
          (ops[0] as { operator?: string }).operator !== 'Function' &&
          x.symbol !== undefined &&
          holdsSymbol(ops[0], x.symbol)
        );
      },
    },
  ],
]);

/** True when the raw tree `x` holds the symbol `name`, at any depth. */
function holdsSymbol(x: Expression, name: string): boolean {
  const todo: Expression[] = [x];
  while (todo.length > 0) {
    const y = todo.pop() as {
      symbol?: string;
      ops?: ReadonlyArray<Expression>;
    };
    if (y.symbol === name) return true;
    if (y.ops !== undefined) todo.push(...y.ops);
  }
  return false;
}

/**
 * True when operand `i` of a call of `name` with the raw operands `ops`,
 * defined by `def`, takes a name, so a macro name written there is not an occurrence
 * (rule 2): the parameter of the signature at that position names the type
 * `symbol` (`Assign`, `Declare`, `DefineFunction`, the variables of `D`, the
 * parameters of `Function`, the index of `Limits`), or `NAME_OPERANDS` lists
 * it. A `bound` or `clause` operand, and a binder's variable, are handled by
 * the caller from the operand roles and the binding sites.
 */
export function isNameOperand(
  name: string,
  def: BoxedOperatorDefinition,
  i: number,
  ops: ReadonlyArray<Expression>
): boolean {
  const run = NAME_OPERANDS.get(name);
  if (
    run !== undefined &&
    i >= run.first &&
    (run.last ?? i) >= i &&
    (run.when?.(ops) ?? true)
  )
    return true;
  const p = parameterTypeAt(def.signature.type, i);
  return p !== undefined && namesSymbol(p);
}

function parameterTypeAt(signature: Type, i: number): Type | undefined {
  if (typeof signature === 'string' || signature.kind !== 'signature')
    return undefined;
  const req = signature.args ?? [];
  if (i < req.length) return req[i].type;
  const opt = signature.optArgs ?? [];
  if (i < req.length + opt.length) return opt[i - req.length].type;
  return signature.variadicArg?.type;
}

/** True when `type` is `symbol`, or a union with the member `symbol`. */
function namesSymbol(type: Type): boolean {
  if (type === 'symbol') return true;
  return (
    typeof type !== 'string' &&
    type.kind === 'union' &&
    type.types.some((t) => t === 'symbol')
  );
}

/** The macro definitions being expanded, for the cycle test (rule 3). A
 * definition is in the set while its body is boxed, and is removed in a
 * `finally`, so the set is empty once the outer boxing call ends. */
const expanding = new Set<BoxedValueDefinition>();

/** For a walk that expands without recursion (`box.ts`): true when `def`
 * is being expanded, so a name of it is `macro-cycle`. */
export function isExpanding(def: BoxedValueDefinition): boolean {
  return expanding.has(def);
}

/** For a walk that expands without recursion: `def` is being expanded from
 * now until `endExpansion(def)`, which the walk calls in a `finally`. */
export function beginExpansion(def: BoxedValueDefinition): void {
  expanding.add(def);
}

export function endExpansion(def: BoxedValueDefinition): void {
  expanding.delete(def);
}

/**
 * The body of the macro `def`, written at an occurrence of `name`, boxed by
 * `boxBody` (which boxes a MathJSON expression with the options of the
 * occurrence). The root of the result takes `sourceOffsets`, the source
 * range of the occurrence, when there is one. A macro that reaches itself is
 * `Error('macro-cycle', name)`.
 */
export function expandMacro(
  ce: ComputeEngine,
  def: BoxedValueDefinition,
  name: string,
  sourceOffsets: [start: number, end: number] | undefined,
  boxBody: (body: MathJsonExpression) => Expression
): Expression {
  if (expanding.has(def)) return ce.error('macro-cycle', name);
  const body = def.macro!;
  expanding.add(def);
  try {
    return boxBody(
      sourceOffsets === undefined
        ? body
        : withSourceOffsets(body, sourceOffsets)
    );
  } finally {
    expanding.delete(def);
  }
}

/** `body` with `sourceOffsets` on its root. A body that is a number or a
 * string literal is returned as it is. */
export function withSourceOffsets(
  body: MathJsonExpression,
  sourceOffsets: [start: number, end: number]
): MathJsonExpression {
  if (Array.isArray(body))
    return { fn: body, sourceOffsets } as MathJsonExpression;
  if (typeof body === 'string' && matchesSymbol(body))
    return { sym: body, sourceOffsets };
  if (typeof body === 'object' && body !== null)
    return { ...body, sourceOffsets } as MathJsonExpression;
  return body;
}
