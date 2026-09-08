import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  collectionElementType,
  resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { BaseCompiler } from './base-compiler.js';
import { isCallerMapped } from './cse.js';
import type { CompileTarget } from './types.js';

type Value = {
  expr: Expression;
  kind: 'literal' | 'input' | 'rotate' | 'arithmetic' | 'comparison';
  array: boolean;
  args: Value[];
};

const arithmetic = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Square',
  'Power',
  'Abs',
  'Floor',
]);
const relations = new Set([
  'Equal',
  'NotEqual',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
]);

/** Fuse pure numeric selection into one cell loop. Runtime guards establish
 * flat numeric inputs and equal, nonzero lengths before any scalar emission
 * runs. The original selection handles every other shape, including empty
 * lists and scalar values supplied for list-declared inputs. */
export function compileNumericSelection(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  fallback: (target: CompileTarget<Expression>) => string
): string | undefined {
  const admission = target.cse?.harvestOptions;
  if (
    target.cse?.enabled !== true ||
    !admission ||
    BaseCompiler.mode === 'complex' ||
    args.length > 16
  )
    return undefined;
  const options = { ...admission, shadowedNames: target.boundVars };
  const values: Value[] = [];
  const inputs: Value[] = [];
  let remaining = 128;
  const plan = (expr: Expression): Value | undefined => {
    if (--remaining < 0 || expr.isPure !== true) return undefined;
    let value: Value;
    if (isNumber(expr) && expr.im === 0) {
      value = { expr, kind: 'literal', array: false, args: [] };
    } else if (isSymbol(expr)) {
      if (
        target.varsKeys?.has(expr.symbol) &&
        !target.boundVars?.has(expr.symbol)
      )
        return undefined;
      // Bound values can compile to a definition with its own evaluation
      // behavior. Capture only runtime inputs and compiler-bound parameters.
      if (
        !target.boundVars?.has(expr.symbol) &&
        expr.engine._getSymbolValue(expr.symbol) !== undefined
      )
        return undefined;
      // A carrier is an input whose declared type is a list or an indexed
      // collection of numbers — the same two shapes the entry plan classes
      // as a JS array (`isListEntryType`, `javascript-target.ts`). The
      // runtime guard (`_SYS.numericSelectionInputs`) then establishes flat
      // numeric arrays of one length, so a declared `indexed_collection`
      // bound to anything else takes the generic selection. Gating on the
      // `list` kind alone left an `indexed_collection<number>` carrier on
      // the generic path (Tycho item 266's neighbour, found 2026-09-07).
      const type = resolveTypeForCompilation(expr.type.type);
      const element = collectionElementType(type);
      const array =
        typeof type === 'object' &&
        (type.kind === 'list' || type.kind === 'indexed_collection') &&
        element !== undefined &&
        isSubtype(element, 'number');
      if (!array && !isSubtype(type, 'number')) return undefined;
      value = { expr, kind: 'input', array, args: [] };
    } else if (isFunction(expr) && !isCallerMapped(expr, options)) {
      const op = expr.operator;
      if (
        (op === 'RotateLeft' || op === 'RotateRight') &&
        expr.nops >= 1 &&
        expr.nops <= 2 &&
        (expr.nops === 1 ||
          (isNumber(expr.op2) &&
            expr.op2.im === 0 &&
            Number.isFinite(expr.op2.re)))
      ) {
        const base = plan(expr.op1);
        // Rotating an input has no intervening element-wise work or effects.
        if (!base || base.kind !== 'input' || !base.array) return undefined;
        value = { expr, kind: 'rotate', array: true, args: [base] };
      } else {
        if (!arithmetic.has(op) && !relations.has(op)) return undefined;
        if (
          op === 'Power' &&
          (!isNumber(expr.op2) ||
            expr.op2.im !== 0 ||
            !Number.isInteger(expr.op2.re) ||
            expr.op2.re < 2 ||
            expr.op2.re > 5)
        )
          return undefined;
        const unary = ['Negate', 'Square', 'Abs', 'Floor'].includes(op);
        if (
          (unary && expr.nops !== 1) ||
          (!unary && op !== 'Add' && op !== 'Multiply' && expr.nops !== 2) ||
          expr.nops === 0
        )
          return undefined;
        const operands = expr.ops.map(plan);
        if (operands.some((x) => !x || x.kind === 'comparison'))
          return undefined;
        const children = operands as Value[];
        const array = children.some((x) => x.array);
        if (relations.has(op)) {
          // Array/array equality is a whole-value comparison, not a map.
          // Restrict every relation to array/scalar so all admitted conditions
          // have an element-wise result, including equality.
          if (children.filter((x) => x.array).length !== 1) return undefined;
          value = { expr, kind: 'comparison', array: true, args: children };
        } else value = { expr, kind: 'arithmetic', array, args: children };
      }
    } else return undefined;
    // Validate every occurrence before sharing it, including all descendants.
    const previous = values.find((v) => v.expr.isSame(expr));
    if (previous) return previous;
    values.push(value);
    if (value.kind === 'input') inputs.push(value);
    return value;
  };
  const clauses: Array<{ condition: Value | boolean; arm: Value }> = [];
  for (let i = 0; i < args.length; i += 2) {
    const cond = args[i];
    if (
      isSymbol(cond) &&
      (isSymbol(cond, 'True') || isSymbol(cond, 'False')) &&
      (target.varsKeys?.has(cond.symbol) || target.boundVars?.has(cond.symbol))
    )
      return undefined;
    if (isSymbol(cond, 'True') && i !== args.length - 2) return undefined;
    const condition = isSymbol(cond, 'True')
      ? true
      : isSymbol(cond, 'False')
        ? false
        : plan(cond);
    const arm = plan(args[i + 1]);
    if (
      condition === undefined ||
      !arm ||
      arm.kind === 'comparison' ||
      (typeof condition !== 'boolean' && condition.kind !== 'comparison')
    )
      return undefined;
    clauses.push({ condition, arm });
  }
  if (!clauses.some((x) => typeof x.condition !== 'boolean')) return undefined;
  const arrays = inputs.filter((x) => x.array);
  if (arrays.length === 0) return undefined;

  const names = new Map<Value, string>();
  const declarations: string[] = [];
  const inputNames = new Map<string, string>();
  for (const input of inputs) {
    const name = BaseCompiler.tempVar(target);
    names.set(input, name);
    inputNames.set(
      (input.expr as Expression & { symbol: string }).symbol,
      name
    );
    declarations.push(
      `const ${name} = ${BaseCompiler.compile(input.expr, target)};`
    );
  }
  // The fallback is compiled under its own CSE instance: a temporary it binds
  // (an array-valued intermediate such as the neighbour sum of a stencil) is
  // declared inside the guarded branch, so it runs only when the guard takes
  // that branch and never before the fast path, while the branch still
  // evaluates a repeated subexpression once. Its symbol reads use the
  // already-captured inputs.
  const fallbackTarget: CompileTarget<Expression> = {
    ...target,
    boundVars: new Set([...(target.boundVars ?? []), ...inputNames.keys()]),
    var: (id) => inputNames.get(id) ?? target.var(id),
  };
  const original = BaseCompiler.withCseLocalInstance(fallbackTarget, () =>
    fallback(fallbackTarget)
  );
  const length = BaseCompiler.tempVar(target);
  const index = BaseCompiler.tempVar(target);
  const out = BaseCompiler.tempVar(target);
  const statements: string[] = [];
  const shifts: string[] = [];
  const code = (value: Value): string => {
    const known = names.get(value);
    if (known)
      return value.kind === 'input' && value.array
        ? `${known}[${index}]`
        : known;
    if (value.kind === 'literal')
      return BaseCompiler.compile(value.expr, target);
    const operands = value.args.map(code);
    const op = (value.expr as Expression & { operator: string }).operator;
    let rhs: string;
    if (value.kind === 'rotate') {
      const shift = BaseCompiler.tempVar(target);
      const position = BaseCompiler.tempVar(target);
      const expr = value.expr as Expression & {
        ops: ReadonlyArray<Expression>;
      };
      const amount = expr.ops.length === 1 ? 1 : Math.round(expr.ops[1].re!);
      const signed = op === 'RotateRight' ? -amount : amount;
      shifts.push(
        `const ${shift} = ((${signed} % ${length}) + ${length}) % ${length};`
      );
      statements.push(
        `let ${position} = ${index} + ${shift}; if (${position} >= ${length}) ${position} -= ${length};`
      );
      rhs = `${names.get(value.args[0])}[${position}]`;
    } else if (value.kind === 'comparison') {
      if (op === 'Equal' || op === 'NotEqual') {
        const equality = `(Math.abs(${operands[0]} - ${operands[1]}) <= ${value.expr.engine.tolerance})`;
        rhs = op === 'Equal' ? equality : `!${equality}`;
      } else {
        const operator = {
          Less: '<',
          LessEqual: '<=',
          Greater: '>',
          GreaterEqual: '>=',
        }[op]!;
        rhs = `(${operands[0]} ${operator} ${operands[1]})`;
      }
    } else {
      switch (op) {
        case 'Add':
          rhs = `(${operands.join(' + ')})`;
          break;
        case 'Multiply':
          rhs = `(${operands.join(' * ')})`;
          break;
        case 'Subtract':
          rhs = `(${operands[0]} - ${operands[1]})`;
          break;
        case 'Divide':
          rhs = `(${operands[0]} / ${operands[1]})`;
          break;
        case 'Negate':
          // The operand is parenthesized: a negative literal compiles to
          // `-2`, and `--2` is a decrement, not a negation.
          rhs = `(-(${operands[0]}))`;
          break;
        case 'Power': {
          const n = value.args[1].expr.re;
          const x = operands[0];
          rhs =
            n === 2
              ? `Math.pow(${x}, 2)`
              : n === 3
                ? `(${x} * ${x} * ${x})`
                : n === 4
                  ? `((${x} * ${x}) * (${x} * ${x}))`
                  : `((${x} * ${x}) * (${x} * ${x}) * ${x})`;
          break;
        }
        case 'Square':
          rhs = `(${operands[0]} * ${operands[0]})`;
          break;
        case 'Abs':
          rhs = `Math.abs(${operands[0]})`;
          break;
        case 'Floor':
          rhs = `Math.floor(${operands[0]})`;
          break;
        default:
          throw new Error('Unexpected numeric fusion operator');
      }
    }
    const name = BaseCompiler.tempVar(target);
    names.set(value, name);
    statements.push(`const ${name} = ${rhs};`);
    return name;
  };
  let selected = 'NaN';
  // Emission order follows the original clauses even though each admitted
  // operation is pure and total over the guarded numeric representation.
  const emitted = clauses.map(({ condition, arm }) => ({
    condition:
      typeof condition === 'boolean' ? String(condition) : code(condition),
    arm: code(arm),
  }));
  for (const { condition, arm } of emitted.reverse())
    selected = `${condition} === true ? ${arm} : ${condition} === false ? (${selected}) : NaN`;
  const scalarChecks = inputs
    .filter((x) => !x.array)
    .map((x) => `typeof ${names.get(x)} === "number"`);
  const guard = [
    `_SYS.numericSelectionInputs(${arrays.map((x) => names.get(x)).join(', ')})`,
    ...scalarChecks,
  ].join(' && ');
  return `(() => { ${declarations.join(' ')} if (!(${guard})) return ${original}; const ${length} = ${names.get(arrays[0])}.length; ${shifts.join(' ')} const ${out} = new Array(${length}); for (let ${index} = 0; ${index} < ${length}; ${index}++) { ${statements.join(' ')} ${out}[${index}] = ${selected}; } return ${out}; })()`;
}
