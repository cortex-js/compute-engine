import { checkDeadline, isThenable } from '../../common/interruptible.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import { typeToString } from '../../common/type/serialize.js';
import { widenAll } from '../../common/type/subtype.js';
import type { EffectSet, Type } from '../../common/type/types.js';
import {
  effectSetToString,
  isEffectSubset,
  unionEffectSets,
} from '../../common/type/effects.js';
import type {
  BoxedValueDefinition,
  Expression,
  FunctionInterface,
  IComputeEngine,
  InspectableScope,
  Scope,
} from '../global-types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { operands, operator, symbol } from '../../math-json/utils.js';
import { LatexSyntax } from '../latex-syntax/latex-syntax.js';
import type { ParseLatexOptions } from '../latex-syntax/types.js';
import { tokenize } from '../latex-syntax/tokenizer.js';
import type { DiscardedComment } from '../latex-syntax/tokenizer.js';
import { signatureEffects } from '../../common/type/utils.js';
import { withArrowEffects } from '../boxed-expression/effects-inference.js';
import {
  preparedContractDeclaration,
  widenLocalType,
} from '../boxed-expression/boxed-value-definition.js';
import { sealPreparedNamespace } from '../boxed-expression/prepared-import-binding.js';
import { oneElementTypeOf } from '../boxed-expression/box.js';
import { draftReferences } from '../boxed-expression/abstract-boxed-expression.js';
import {
  preparedCalls,
  provisionalLiteral,
} from '../boxed-expression/provisional-application.js';
import { demandComponents } from './demand-components.js';
import { makePreparedValuePass } from './value-pass.js';
import { isLibraryDefinition } from '../boxed-expression/implicit-variable-rule.js';
import {
  isContinuationOperand,
  isDictionary,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterNames,
  optionalParameterTarget,
} from '../boxed-expression/function-literal.js';
import { isLibraryOperator } from '../library-shadowing.js';
import { declaredBinderNamesOf } from '../boxed-expression/binding-sites.js';

type Head = { name: string; params: readonly string[] };
type Role = 'function' | 'value';
type Recognition = { role: Role; head: Head };
type Source = { head: string; body: string };
export type DocumentSourceRow = {
  id: string;
  latex: string;
  formalTypes?: Readonly<Record<string, string>>;
  resultType?: string;
  valueType?: string;
  effects?: 'pure' | 'random';
};
export interface PreparedDocumentDefinition {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly params: readonly string[];
  readonly rawBody: MathJsonExpression;
  readonly body: Expression;
  readonly references: readonly string[];
  readonly fieldParameters?: readonly string[];
  /**
   * Advisory argument types of a function row, one entry per parameter: the
   * join of the static types of the arguments at that position in every call
   * of the function from the bodies of the revision's definition rows (value
   * rows and function rows that are not errors; a row that reads a field
   * axis gives no evidence) and from the formula rows. In a formula row, an
   * argument that reads a field axis (such as the plot axis `t`) or a field
   * value is open; a name that a binder above it binds is not a field read.
   * A binder's own limits count as bound too: in `Sum(1, Limits(t, 1,
   * h(t)))`, the `t` of the upper limit, which reads the axis, gives the
   * evidence of its declared input type. A formula row that calls a
   * function of the document is canonicalized only to read these types, in
   * a scope of its own that is then discarded: it gives no definition and
   * no row error, and a formula row that is not valid gives no evidence.
   * Another free name of a formula
   * row has the type of the input that the host declared with that name,
   * and is otherwise open. Each argument type is widened: a number becomes
   * `real`, or `number` when it may be complex, and a list, a set or a tuple
   * keeps its shape and its lengths (`[1, 2, 3]` gives `vector<real^3>`). The
   * join is the type join of the engine, so a point at one call and a list
   * of points at another give their union.
   *
   * An argument whose type is or has a part (an element, a field) that is
   * `unknown` or `any` gives no evidence at its position: the entry is then
   * the join of the other calls' argument types, and describes those calls
   * only. A host that declares such an entry as the formal type of the
   * parameter changes the function's contract. A call whose argument is
   * typed exactly `unknown` or `any` is still accepted by the static check,
   * but a call whose argument only has an open part can be refused: with
   * the formal `tuple<real, real>`, the argument `[q]` of type
   * `list<unknown>` is an error. A parameter passed on has the type that its
   * function infers for it, usually open: in `g(q) = d(q)`, `q` is
   * `collection<any> | tuple`, so the call `d(q)` gives no evidence.
   *
   * An entry is `undefined` when the function has no call, when no call has
   * an argument of a type that is not open at that position, when the type
   * of one call's argument at that position is `never` or an error, or, for
   * every entry, when one call has another number of arguments or a spread
   * argument. A call of a function from its own body is a call site too.
   * Every entry is `undefined` when the function's name is read as a value,
   * not called (`Map(L, d)`, `f(d)`). The operands of `Hold` and `Quote` are
   * not read. A parameter of a function literal with the function's name
   * shadows it; a local of a `Block` with that name does not, so a call of
   * such a local counts as a call of the function. The variable of a binder
   * with the function's name (`Sum(h, Limits(h, 1, 3))`) does not shadow it
   * either: it reads as the function used as a value, and every entry is
   * `undefined`.
   *
   * The field is advisory. It does not change the function's contract: no
   * call is refused, and no row is an error, because of it. A host may use
   * it to declare the inputs of a root compile or to classify a row. Code
   * that the host compiles with these types is correct only for calls whose
   * arguments have those types. An entry given back as the parameter's
   * `formalTypes` can change the function's meaning: a type that admits a
   * list (`list<real>`, a union with a list) binds a list argument whole,
   * where the untyped parameter maps the call over its elements
   * (`docs/BROADCAST-MODEL.md`). A scalar or tuple entry keeps the meaning.
   */
  readonly callSiteTypes?: readonly (string | undefined)[];
}

export interface PreparedDocumentValuePass {
  /** Run a synchronous read. Several calls share the same samples within
   * a redraw. Create a new pass after writing any inputs. A callback that
   * returns a promise or thenable is refused. */
  run<T>(evaluate: () => T): T;
  retain(name: string, view: Expression, result: Expression): void;
}

export interface PreparedDocumentRevision {
  /**
   * Scope for prepared reads and writes to declared input or writable row
   * values. Treat the binding map as read-only. Edit the source and prepare
   * a new revision to change definitions.
   */
  readonly scope: InspectableScope;
  /** The parsed entry of every input row, by row ID. A rejected row keeps
   * its parsed entry when it has one, and otherwise has its diagnostic.
   * `rowErrors` holds the diagnostic of each rejected row. */
  readonly rawRows: ReadonlyMap<string, MathJsonExpression>;
  readonly rowReferences: ReadonlyMap<string, readonly string[]>;
  /** The diagnostic of each rejected row, by row ID. A recursive component
   * in which every return arm of every function certainly calls a function
   * of the component (through arithmetic, a list, a tuple or such a call) is
   * rejected with `Recursive definition with no base case: <name>`; a call
   * under a conditional arm, a short-circuit, a binder or any other operator
   * may not run, and its arm is a base case. */
  readonly rowErrors: ReadonlyMap<string, Expression>;
  readonly definitions: readonly PreparedDocumentDefinition[];
  /** Start after input writes. Use this pass only for the current redraw. */
  createValuePass(names: ReadonlySet<string>): PreparedDocumentValuePass;
  collectionWriteError(name: string, value: Expression): string | undefined;
  /** Close revision operations and release its import lease. */
  dispose(): void;
}

type DraftRow = DocumentSourceRow & { role: 'formula' | Role };
export interface DocumentSyntax {
  split(source: string): Source | undefined;
  /** `raw`, when present, is the definition entry from the fast definition
   * path after `normalize()`. Its head is the parse candidate form and does
   * not go through `resolveApplication`: `f(x)` arrives as
   * `["InvisibleOperator", "f", ["Delimiter", "x"]]`. */
  recognize(
    row: DocumentSourceRow,
    names: ReadonlyMap<string, unknown>,
    raw?: MathJsonExpression
  ):
    | (Recognition & {
        body?: string;
        /** The row's entry in `rawRows` when the row is recognized without
         * `raw`. Without one, an accepted row's entry is the parse of the
         * whole row with the document's heads resolved (`f(x)` reads as the
         * application `["f", "x"]`), and a rejected row's entry is its
         * diagnostic. */
        rawEntry?: MathJsonExpression;
        bodyJson?: MathJsonExpression;
      })
    | undefined;
  normalize(raw: MathJsonExpression): MathJsonExpression;
  lowerBody?(
    body: MathJsonExpression,
    row: DocumentSourceRow
  ): MathJsonExpression;
  resolveApplication?: ParseLatexOptions['resolveApplication'];
  fieldAxes?: ReadonlySet<string>;
  /** Names in the import scope that take precedence over row declarations. */
  reservedImportNames?: ReadonlySet<string>;
  ownValueSubscripts?: 'real';
  /** The host treats a formal followed by parentheses as a factor unless
   * its written type is callable. */
  formalsAreFactors?: boolean;
}
function sameHead(
  expected: Recognition,
  actual: Recognition | undefined
): boolean {
  return (
    actual !== undefined &&
    actual.role === expected.role &&
    actual.head.name === expected.head.name &&
    actual.head.params.length === expected.head.params.length &&
    actual.head.params.every((name, i) => name === expected.head.params[i])
  );
}
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function lex(source: string, numberLexemes = new Map<string, string[]>()) {
  const inputText = new Map<number, string>();
  const tildes = new Set<number>();
  const comments: DiscardedComment[] = [];
  return {
    tokens: tokenize(source, [], comments, inputText, tildes),
    inputText,
    tildes,
    comments,
    numberLexemes,
  };
}
function hasRowBoundary(source: string): boolean {
  const directionalFence =
    /\\(left|right)(?![A-Za-z])\s*(?:\\(?:[A-Za-z]+|.)|.)?/y;
  let depth = 0,
    braces = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      directionalFence.lastIndex = i;
      const fence = directionalFence.exec(source);
      if (fence) {
        depth += fence[1] === 'left' ? 1 : -1;
        i += fence[0].length - 1;
      } else {
        if (
          depth === 0 &&
          /^\\(?:coloneqq?|colon=)(?![A-Za-z])/.test(source.slice(i))
        )
          return true;
        i++;
      }
      continue;
    }
    // Bare TeX braces can be transparent to the expression parser.
    // Keep their balance, but do not let them hide an ambiguous separator.
    if (c === '{') braces++;
    if (c === '}') braces--;
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    // A dotted member can change the assignment tree in the full parser.
    if (depth === 0 && c === '.' && /[A-Za-z\\]/.test(source[i + 1] ?? ''))
      return true;
    if (
      c === '%' ||
      braces < 0 ||
      depth < 0 ||
      (depth === 0 && (c === ',' || c === ';' || c === '='))
    )
      return true;
  }
  return depth !== 0 || braces !== 0;
}

type DefinitionRow = { row: DraftRow; head: Head };

/**
 * A proof of the outer list kind for a recursive component. Each return arm
 * must have a list-producing constructor. A recursive edge may supply a
 * spread operand only when it is a saturated, unshadowed call in the same
 * component. The component is checked under the resulting contracts once.
 */
function hasListReturn(
  expr: MathJsonExpression,
  arities: ReadonlyMap<string, number>,
  formals: ReadonlySet<string>,
  isBuiltin: (name: string) => boolean
): boolean {
  const terms: { expr: MathJsonExpression; allowComponentCall: boolean }[] = [
    { expr, allowComponentCall: false },
  ];
  while (terms.length > 0) {
    const term = terms.pop()!;
    const head = operator(term.expr);
    if (!head || formals.has(head)) return false;
    const args = operands(term.expr);
    if (
      term.allowComponentCall &&
      arities.get(head) === args.length &&
      args.every(
        (arg) => operator(arg) !== 'Spread' && operator(arg) !== 'Sequence'
      )
    )
      continue;
    if (!isBuiltin(head)) return false;
    if (head === 'List') {
      // A spread can make the whole list absent. A matrix layout can
      // canonicalize to a different constructor.
      if (
        args.some(
          (arg) => operator(arg) === 'Spread' || operator(arg) === 'Matrix'
        )
      )
        return false;
      continue;
    }
    if (head === 'ListJoin') {
      for (const arg of args)
        terms.push({ expr: arg, allowComponentCall: true });
      continue;
    }
    if (
      head === 'Which' &&
      args.length >= 2 &&
      args.length % 2 === 0 &&
      symbol(args[args.length - 2]) === 'True' &&
      !formals.has('True') &&
      isBuiltin('True')
    ) {
      for (let i = 1; i < args.length; i += 2)
        terms.push({ expr: args[i], allowComponentCall: false });
      continue;
    }
    return false;
  }
  return true;
}

/**
 * The operators that evaluate every operand whenever they are evaluated. A
 * call to a component member under one of them runs whenever its arm runs.
 */
const STRICT_OPERATORS = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Power',
  'Square',
  'Sqrt',
  'Root',
  'List',
  'Tuple',
]);

/**
 * The return arms of a canonical function body: the arms of a `Which` or an
 * `If`, followed into nested ones and into a `Block` of one expression, or
 * the body itself. `undefined` stands for the arm with no expression: a
 * `Which` with no `True` default, or an `If` with no else.
 */
function returnArms(body: Expression): (Expression | undefined)[] {
  const arms: (Expression | undefined)[] = [];
  const pending = [body];
  while (pending.length > 0) {
    const arm = pending.pop()!;
    // The canonical body of a function literal is a `Block`.
    if (isFunction(arm, 'Block') && arm.nops === 1) pending.push(arm.op1);
    else if (isFunction(arm, 'Which')) {
      const ops = arm.ops;
      for (let i = 1; i < ops.length; i += 2) pending.push(ops[i]);
      if (ops.length % 2 !== 0 || !isSymbol(ops[ops.length - 2], 'True'))
        arms.push(undefined);
    } else if (isFunction(arm, 'If')) {
      pending.push(...arm.ops.slice(1, 3));
      if (arm.nops < 3) arms.push(undefined);
    } else arms.push(arm);
  }
  return arms;
}

/**
 * The base arms of a parsed function body: its return arms, read as
 * `returnArms` reads a canonical body, that name no member of the recursive
 * component anywhere, as an operator or as a symbol. An arm with no
 * expression is not a base arm.
 */
function baseArms(
  body: MathJsonExpression,
  component: ReadonlySet<string>
): MathJsonExpression[] {
  const mentions = (expr: MathJsonExpression): boolean => {
    if (component.has(symbol(expr) ?? operator(expr))) return true;
    if (Array.isArray(expr) && typeof expr[0] !== 'string' && mentions(expr[0]))
      return true;
    return operands(expr).some(mentions);
  };
  const arms: MathJsonExpression[] = [];
  const pending = [body];
  while (pending.length > 0) {
    const arm = pending.pop()!;
    const head = operator(arm);
    const args = operands(arm);
    if (head === 'Block' && args.length === 1) pending.push(args[0]);
    else if (head === 'Which')
      for (let i = 1; i < args.length; i += 2) pending.push(args[i]);
    else if (head === 'If') pending.push(...args.slice(1, 3));
    else if (!mentions(arm)) arms.push(arm);
  }
  return arms;
}

/**
 * Whether evaluating `expr` certainly makes a call that `isCertainCall`
 * accepts. Only the operands of a strict operator are followed: a call under
 * any other operator, a conditional, a short-circuit or a binder may not run.
 * A strict operator name that the document or a formal shadows is not strict.
 */
function hasCertainCall(
  expr: Expression,
  shadowed: (name: string) => boolean,
  isCertainCall: (call: Expression & FunctionInterface) => boolean
): boolean {
  const pending = [expr];
  while (pending.length > 0) {
    const term = pending.pop()!;
    if (!isFunction(term)) continue;
    if (isCertainCall(term)) return true;
    const head = term.operator;
    if (
      !STRICT_OPERATORS.has(head) ||
      shadowed(head) ||
      !isLibraryOperator(term)
    )
      continue;
    // An `Add` or a `Multiply` with an ellipsis stays unevaluated.
    if (
      (head === 'Add' || head === 'Multiply') &&
      term.ops.some((op) => isContinuationOperand(op))
    )
      continue;
    pending.push(...term.ops);
  }
  return false;
}

/**
 * Whether the parameter `name` is read in `body`, and every read of it is an
 * operand of a library `Join` or `ListJoin`. Such a parameter is inferred as
 * `collection<any>`, the signature that a join validates its operands
 * against, but a join also takes a scalar operand as one element:
 * `ListJoin([1, 2], 7)` is `[1, 2, 7]`. A read in another position
 * (`ListJoin([1, 2], y) + y`) keeps the inferred type.
 */
function isJoinOperandOnly(body: Expression, name: string): boolean {
  let read = false;
  const visit = (expr: Expression): boolean => {
    if (!isFunction(expr)) return true;
    const join =
      (expr.operator === 'Join' || expr.operator === 'ListJoin') &&
      isLibraryOperator(expr);
    for (const op of expr.ops) {
      if (isSymbol(op, name)) {
        if (!join) return false;
        read = true;
      } else if (!visit(op)) return false;
    }
    return true;
  };
  return visit(body) && read;
}

/**
 * The names of `axes` that a read of the macro `name` in the raw expression
 * `expr` reads. The macro expands at the read, so its operands resolve
 * there: an axis that a `Block` around the read declares, in a `Declare`
 * statement before the statement that holds the read, is the local. Any other
 * binding (a later `Declare`, an `Assign`, a binder) keeps the axis, and so
 * does a read that the walk does not find.
 */
function macroAxesRead(
  expr: Expression,
  name: string,
  axes: readonly string[]
): Set<string> {
  const read = new Set<string>();
  let found = false;
  const visit = (e: Expression, locals: ReadonlySet<string>) => {
    if (isSymbol(e)) {
      if (e.symbol !== name) return;
      found = true;
      for (const axis of axes) if (!locals.has(axis)) read.add(axis);
      return;
    }
    if (isDictionary(e)) {
      for (const value of e.values) visit(value, locals);
      return;
    }
    if (!isFunction(e)) return;
    if (e.operator === name) visit(e.engine.symbol(name), locals);
    if (e.operator !== 'Block') {
      for (const op of e.ops) visit(op, locals);
      return;
    }
    const inner = new Set(locals);
    for (const statement of e.ops) {
      visit(statement, inner);
      if (statement.operator === 'Declare' && isFunction(statement)) {
        const local = statement.ops[0];
        if (local !== undefined && isSymbol(local)) inner.add(local.symbol);
      }
    }
  };
  visit(expr, new Set());
  return found ? read : new Set(axes);
}

/**
 * The type of the parameter `name` of the function literal `body` that a row
 * with no stated type for it gets from its inferred type `slot`. A parameter
 * read only as an operand of a join is any value
 * (`isJoinOperandOnly()`); with no stated result, a tuple that index reads
 * made is the indexed collection of its components (`oneElementTypeOf()`).
 */
function openSlot(
  body: Expression,
  name: string,
  slot: Type,
  row: DraftRow
): Type {
  if (
    typeToString(slot) === 'collection<any>' &&
    isFunction(body) &&
    isJoinOperandOnly(body.ops[0], name)
  )
    return 'any';
  return row.resultType === undefined ? oneElementTypeOf(slot) : slot;
}

/**
 * The type of an argument at a call site, widened as `callSiteTypes`
 * documents: a literal or a ranged number becomes `real`, or `number` when
 * it may be complex, a string or a boolean value becomes its kind, and a
 * list, a set or a tuple keeps its shape and its lengths.
 */
function widenArgumentType(ce: IComputeEngine, t: Type): Type {
  if (typeof t === 'object') {
    if (t.kind === 'list' || t.kind === 'set')
      return { ...t, elements: widenArgumentType(ce, t.elements) };
    if (t.kind === 'tuple')
      return {
        ...t,
        elements: t.elements.map((e) => ({
          ...e,
          type: widenArgumentType(ce, e.type),
        })),
      };
    // The widened arms are joined again: `tuple<real, real, integer> |
    // tuple<integer, real, real>` is `tuple<real, real, real>`.
    if (t.kind === 'union')
      return widenAll(t.types.map((x) => widenArgumentType(ce, x))) as Type;
  }
  const bt = ce.type(t);
  if (bt.matches('real')) return 'real';
  if (bt.matches('number')) return 'number';
  if (bt.matches('string') || bt.matches('character')) return 'string';
  if (bt.matches('boolean')) return 'boolean';
  return t;
}

/**
 * Whether `t` is `unknown` or `any`, or has such a part: an element, a
 * member, a field or a signature slot. A transparent alias counts as open,
 * since it can name such a type; a nominal reference does not.
 */
function hasOpenPart(t: Type): boolean {
  if (typeof t === 'string') return t === 'unknown' || t === 'any';
  switch (t.kind) {
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return hasOpenPart(t.elements);
    case 'dictionary':
      return hasOpenPart(t.values);
    case 'tuple':
      return t.elements.some((e) => hasOpenPart(e.type));
    case 'record':
    case 'object':
      return Object.values(t.elements).some(hasOpenPart);
    case 'union':
    case 'intersection':
      return t.types.some(hasOpenPart);
    case 'negation':
      return hasOpenPart(t.type);
    case 'reference':
      return t.alias === true;
    case 'signature':
      return (
        hasOpenPart(t.result) ||
        [
          ...(t.args ?? []),
          ...(t.optArgs ?? []),
          ...(t.variadicArg ? [t.variadicArg] : []),
        ].some((e) => hasOpenPart(e.type))
      );
    default:
      return false;
  }
}

/** The argument types of the calls of each function, by position. `null`
 * marks a position, or a whole function, with no usable evidence. */
type CallSiteEvidence = Map<string, (Type[] | null)[] | null>;

function emptyCallSiteEvidence(
  arities: ReadonlyMap<string, number>
): CallSiteEvidence {
  return new Map(
    [...arities].map(([name, arity]) => [
      name,
      Array.from({ length: arity }, () => []),
    ])
  );
}

/** Add the evidence of `from` to `into`. */
function mergeCallSiteEvidence(
  into: CallSiteEvidence,
  from: CallSiteEvidence
): void {
  for (const [name, slots] of from) {
    const target = into.get(name);
    if (target === null) continue;
    if (slots === null || target === undefined) {
      into.set(name, slots);
      continue;
    }
    slots.forEach((types, i) => {
      if (types === null) target[i] = null;
      else target[i]?.push(...types);
    });
  }
}

/**
 * The names that `expr` binds in its operands: the variables of a binder
 * (`declaredBinderNamesOf`: the index of a `Sum`, the parameters of a
 * `Function`) and the locals that a library `Block` declares.
 */
function boundNames(ce: IComputeEngine, expr: Expression): readonly string[] {
  if (!isFunction(expr)) return [];
  const names = declaredBinderNamesOf(ce, expr.operator, expr.ops);
  if (expr.operator !== 'Block' || !isLibraryOperator(expr)) return names;
  const locals = expr.ops.flatMap((op) =>
    isFunction(op, 'Declare') && isSymbol(op.op1) ? [op.op1.symbol] : []
  );
  return locals.length === 0 ? names : [...names, ...locals];
}

/**
 * Add to `evidence` the argument types of the calls of the functions in
 * `arities`, from one walk over the canonical `bodies`. The walk reads the
 * types before it returns, so a body boxed in a scope of its own is read
 * before the scope is disposed. A call of a function under a `Function`
 * literal one of whose parameters has the function's name is not a call of
 * it. A function whose name is read as a value (`Map(L, d)`, `f(d)`) has no
 * evidence. The operands of `Hold` and `Quote` are not walked. An argument
 * that `isOpen` accepts is open, as an argument of an open type; `bound`
 * holds the names that a binder around the argument binds (`boundNames`).
 */
function readCallSites(
  ce: IComputeEngine,
  bodies: readonly Expression[],
  arities: ReadonlyMap<string, number>,
  evidence: CallSiteEvidence,
  isOpen?: (arg: Expression, bound: ReadonlySet<string>) => boolean
): void {
  const pending: {
    expr: Expression;
    shadowed: ReadonlySet<string>;
    bound: ReadonlySet<string>;
  }[] = bodies.map((expr) => ({
    expr,
    shadowed: new Set<string>(),
    bound: new Set<string>(),
  }));
  while (pending.length > 0) {
    const { expr, shadowed, bound } = pending.pop()!;
    if (isDictionary(expr)) {
      for (const value of expr.values)
        pending.push({ expr: value, shadowed, bound });
      continue;
    }
    if (isSymbol(expr)) {
      // A function read as a value can be called with any argument.
      if (arities.has(expr.symbol) && !shadowed.has(expr.symbol))
        evidence.set(expr.symbol, null);
      continue;
    }
    if (!isFunction(expr)) continue;
    const library = isLibraryOperator(expr);
    if (library && (expr.operator === 'Hold' || expr.operator === 'Quote'))
      continue;
    let inner = shadowed;
    let operands = expr.ops;
    if (library && expr.operator === 'Function') {
      // The parameters are bindings, not reads.
      operands = expr.ops.slice(0, 1);
      const params = expr.ops
        .slice(1)
        .flatMap((op) =>
          functionLiteralParameterNames(optionalParameterTarget(op))
        );
      if (params.some((name) => arities.has(name)))
        inner = new Set([...shadowed, ...params]);
    }
    const slots = shadowed.has(expr.operator)
      ? undefined
      : evidence.get(expr.operator);
    if (slots === null) {
      // The function already has a call with no usable argument list.
    } else if (slots !== undefined) {
      if (
        expr.nops !== slots.length ||
        expr.ops.some(
          (arg) => arg.operator === 'Spread' || arg.operator === 'Sequence'
        )
      )
        evidence.set(expr.operator, null);
      else
        expr.ops.forEach((arg, i) => {
          const types = slots[i];
          if (types === null) return;
          const type = arg.type.type;
          if (type === 'never' || arg.type.matches('error')) slots[i] = null;
          // An open argument gives no evidence at its position.
          else if (!hasOpenPart(type) && !isOpen?.(arg, bound))
            types.push(widenArgumentType(ce, type));
        });
    }
    const names = isOpen === undefined ? [] : boundNames(ce, expr);
    const innerBound =
      names.length === 0 ? bound : new Set([...bound, ...names]);
    for (const op of operands)
      pending.push({ expr: op, shadowed: inner, bound: innerBound });
  }
}

/** The `callSiteTypes` of each function in `arities`, from `evidence`. */
function callSiteTypes(
  ce: IComputeEngine,
  arities: ReadonlyMap<string, number>,
  evidence: CallSiteEvidence
): Map<string, (string | undefined)[]> {
  const result = new Map<string, (string | undefined)[]>();
  for (const [name, arity] of arities) {
    const slots = evidence.get(name)!;
    result.set(
      name,
      Array.from({ length: arity }, (_, i) => {
        const types = slots?.[i];
        if (!types || types.length === 0) return undefined;
        return ce.type(widenAll(types) as Type).toString();
      })
    );
  }
  return result;
}

export function prepareDocument(
  ce: IComputeEngine,
  parent: Scope,
  input: readonly DocumentSourceRow[],
  syntax: DocumentSyntax,
  writableNames?: ReadonlySet<string>,
  releaseImports?: () => void
): PreparedDocumentRevision {
  const ids = new Set<string>();
  const rows: DraftRow[] = input.map((row) => {
    if (ids.has(row.id))
      throw new Error('Duplicate Document row ID: ' + row.id);
    ids.add(row.id);
    return { ...row, role: 'formula' };
  });
  const writableSlots =
    writableNames === undefined ? undefined : new Set(writableNames);
  const parseOptions = ce.latexOptions;
  const instance = ce.latexSyntax;
  if (!(instance instanceof LatexSyntax))
    throw new Error('Document needs the CE LaTeX parser');
  const latex = instance;
  const scope = ce.createScope({}, parent);
  const callPhase = { preparing: true };
  try {
    return ce._inScope(scope, () => {
      const numberLexemes = new Map<string, string[]>();
      const sources = new Map(rows.map((row) => [row.id, row.latex]));
      const declarations = new Map<string, DefinitionRow>();
      // A cursor returns the body, or the message of a row-content failure.
      const cursors = new Map<
        string,
        () => MathJsonExpression | { failure: string }
      >();
      const parsed = new Map<string, MathJsonExpression>();
      const rawRows = new Map<string, MathJsonExpression>();
      const unparsedEntries: DraftRow[] = [];
      const bodies = new Map<string, ReturnType<typeof ce.box>>();
      const fieldParameters = new Map<string, readonly string[]>();
      const rowReferences = new Map<string, readonly string[]>();
      const rowErrors = new Map<string, Expression>();
      // The document values that a row asked for as indexed bases and that
      // were rejected or still being prepared. The parser can absorb the
      // subscript of such a base into a name, so the row's references need
      // not show these edges. An unfinished base is an initialization cycle.
      const indexedBases = new Map<string, Set<string>>();

      function rowOptions(
        row: DraftRow,
        inBody: () => boolean,
        formals: () => readonly string[]
      ) {
        return {
          ...parseOptions,
          resolveApplication: syntax.resolveApplication,
          _prepareIndexedBase: (name: string) => {
            if (!inBody() || formals().includes(name)) return;
            const declaration = declarations.get(name);
            if (declaration?.row.role !== 'value') return;
            // With this document dialect, an atomic subscript in the base's
            // own initializer is a name. Explicit indexing still reads the base.
            if (
              syntax.ownValueSubscripts !== undefined &&
              declaration.row === row
            )
              return;
            graph.prepare(name);
            // A finished, valid base adds no edge: under `ownValueSubscripts`
            // the joined name can be a document variable of its own.
            if (bodies.has(name) && !rowErrors.has(declaration.row.id)) return;
            let bases = indexedBases.get(row.id);
            if (bases === undefined)
              indexedBases.set(row.id, (bases = new Set()));
            bases.add(name);
          },
          resolveSymbol: (name: string) => {
            if (inBody() && formals().includes(name))
              return { type: row.formalTypes?.[name] ?? 'unknown' };
            const declaration = declarations.get(name);
            if (!inBody() || declaration === undefined || bodies.has(name))
              return (
                ce._resolveSymbolFromScope(name) ??
                parseOptions.resolveSymbol?.(name)
              );
            return {
              type: declaration.row.role === 'function' ? 'function' : 'value',
            };
          },
          isLibraryFunction: (name: string) =>
            !formals().includes(name) && ce._isLibraryFunction(name),
        };
      }

      for (const row of rows) {
        checkDeadline(ce._deadlineFrame);
        const proposed = syntax.split(row.latex);
        if (proposed === undefined) continue;
        let recognized: Recognition | undefined;
        if (
          proposed.body &&
          !hasRowBoundary(proposed.head) &&
          !hasRowBoundary(proposed.body)
        ) {
          let active = false;
          let params: readonly string[] = [];
          const state = latex._startDefinitionRow(
            lex(row.latex, numberLexemes),
            rowOptions(
              row,
              () => active,
              () => params
            )
          );
          if (state !== undefined) {
            const initial = syntax.recognize(
              row,
              declarations,
              syntax.normalize([state.operator, state.head, 0])
            );
            if (initial !== undefined) {
              recognized = initial;
              params = initial.head.params;
              cursors.set(row.id, () => {
                active = true;
                const body = state.finish(
                  new Map(
                    params.map((param) => [
                      param,
                      row.formalTypes?.[param] ?? 'unknown',
                    ])
                  ),
                  syntax.formalsAreFactors
                );
                if (body === null)
                  return { failure: 'Incomplete definition body' };
                const entry = syntax.normalize([
                  state.operator,
                  state.head,
                  body,
                ]);
                // The confirming call sees the declarations of later rows,
                // so the text of another row can change the host's answer.
                const confirmed = syntax.recognize(row, declarations, entry);
                rawRows.set(row.id, entry);
                if (!sameHead(initial, confirmed))
                  return { failure: 'Definition head changed' };
                return syntax.normalize(body);
              });
            }
          }
        } else {
          const fallback = syntax.recognize(row, declarations);
          if (fallback !== undefined) {
            recognized = fallback;
            const body = fallback.body ?? proposed.body;
            sources.set(row.id, body);
            // Without an entry from the host, the row's own parse is its
            // entry, made once the document is prepared.
            if (fallback.rawEntry !== undefined)
              rawRows.set(row.id, fallback.rawEntry);
            else unparsedEntries.push(row);
            if (fallback.bodyJson !== undefined)
              parsed.set(
                row.id,
                syntax.lowerBody?.(fallback.bodyJson, row) ?? fallback.bodyJson
              );
            // As on the definition path, a blank body is incomplete. The
            // declaration is rejected when its component settles.
            else if (body.trim() === '')
              parsed.set(row.id, ce.error('Incomplete definition body').json);
          }
        }
        if (recognized === undefined) continue;
        const head = recognized.head;
        if (
          declarations.has(head.name) ||
          syntax.reservedImportNames?.has(head.name)
        ) {
          const diagnostic = ce.error(['variable-redeclaration', head.name]);
          rowErrors.set(row.id, diagnostic);
          // Keep the first binding. The rejected row still occupies its own
          // position in the prepared result.
          cursors.delete(row.id);
          rawRows.set(row.id, diagnostic.json);
          parsed.set(row.id, diagnostic.json);
          continue;
        }
        row.role = recognized.role;
        declarations.set(head.name, { row, head });
      }

      function readRow(row: DraftRow, params: readonly string[] = []) {
        checkDeadline(ce._deadlineFrame);
        if (parsed.has(row.id)) return parsed.get(row.id)!;
        const source = sources.get(row.id)!;
        const resume = cursors.get(row.id);
        cursors.delete(row.id);
        let raw: MathJsonExpression;
        if (resume !== undefined) {
          const body = resume();
          if (typeof body === 'object' && body !== null && 'failure' in body) {
            // The declaration is rejected when its component settles.
            const diagnostic = ce.error(body.failure);
            if (!rawRows.has(row.id)) rawRows.set(row.id, diagnostic.json);
            parsed.set(row.id, diagnostic.json);
            return diagnostic.json;
          }
          raw = body;
        } else {
          const options = {
            ...rowOptions(
              row,
              () => true,
              () => params
            ),
            _preparedTokens: lex(source, numberLexemes),
          };
          const parsedSource = latex.parse(source, options);
          invariant(parsedSource !== null, 'Empty formula: ' + row.id);
          raw = syntax.normalize(parsedSource);
        }
        raw = syntax.lowerBody?.(raw, row) ?? raw;
        if (row.role === 'formula') rawRows.set(row.id, raw);
        parsed.set(row.id, raw);
        return raw;
      }

      // An accepted head shadows the inherited axis of the same spelling.
      const fieldAxes = new Set(
        [...(syntax.fieldAxes ?? [])].filter((name) => !declarations.has(name))
      );
      const references = new Map<string, readonly string[]>();
      const names = {
        values: new Set([
          ...declarations.keys(),
          ...(writableSlots ?? []),
          ...fieldAxes,
        ]),
        callables: new Set(
          [...declarations]
            .filter(([, item]) => item.row.role === 'function')
            .map(([name]) => name)
        ),
      };
      function rawReferences(expression: MathJsonExpression) {
        return draftReferences(ce.box(expression, { form: 'raw' }), names);
      }

      function formals(
        parameters: readonly string[],
        row: DraftRow,
        fixed: boolean,
        guessed?: ReadonlyArray<string | undefined>
      ) {
        return parameters.map((param, i): MathJsonExpression => {
          const type =
            row.formalTypes?.[param] ??
            guessed?.[i] ??
            (fixed ? 'unknown' : undefined);
          return type === undefined
            ? param
            : ['Typed', param, "'" + type + "'"];
        });
      }

      function installClosedType(
        name: string,
        type: string | ReturnType<typeof ce.type>,
        statedEffects: boolean
      ) {
        const definition = {
          type,
          effectsDeclared: statedEffects,
          [preparedContractDeclaration]: true as const,
        };
        ce._declareSymbolValue(name, definition, scope);
        const binding = scope.bindings.get(name);
        invariant(
          binding && 'value' in binding,
          'Expected a value binding: ' + name
        );
        return binding;
      }
      function rejectComponent(
        group: readonly string[],
        failed: string,
        invalid: Expression
      ) {
        const error =
          invalid.errors[0] ?? ce.error('invalid-document-definition');
        for (const name of group) {
          const { row, head } = declarations.get(name)!;
          const diagnostic =
            name === failed
              ? error
              : ce.error(['invalid-document-dependency', failed]);
          // A recursive component may have unpublished signature slots.
          // Keep its names in this scope so readers cannot see outer bindings.
          scope.bindings.delete(name);
          if (row.role === 'function') {
            const parameters = head.params.map(() => 'unknown');
            ce.declare(name, {
              signature: '(' + parameters.join(', ') + ') -> error',
              evaluate: () => diagnostic,
            });
          } else {
            ce.declare(name, { type: 'error', value: diagnostic });
          }
          rowErrors.set(row.id, diagnostic);
          if (!rawRows.has(row.id)) rawRows.set(row.id, diagnostic.json);
          bodies.set(name, diagnostic);
        }
      }
      function withIndexedBases(row: DraftRow, refs: readonly string[]) {
        const bases = indexedBases.get(row.id);
        return bases === undefined ? refs : [...new Set([...refs, ...bases])];
      }
      const graph = demandComponents(
        (name) => {
          const { row, head } = declarations.get(name)!;
          const rhs = readRow(row, head.params);
          const expression: MathJsonExpression =
            row.role === 'function' ? ['Function', rhs, ...head.params] : rhs;
          const refs = rawReferences(expression);
          if (row.role === 'value' && syntax.ownValueSubscripts !== undefined) {
            const prefix = name + '_';
            for (const reference of refs) {
              if (
                !reference.startsWith(prefix) ||
                reference.length === prefix.length
              )
                continue;
              if (
                declarations.has(reference) ||
                ce.lookupDefinition(reference) !== undefined
              )
                continue;
              installClosedType(reference, syntax.ownValueSubscripts, false);
            }
          }
          const all = withIndexedBases(row, refs);
          references.set(name, all);
          return all.filter((ref) => declarations.has(ref));
        },
        function settle(
          group: readonly string[],
          cyclic: boolean,
          guesses?: ReadonlyMap<string, Type>,
          parameterGuesses?: ReadonlyMap<
            string,
            ReadonlyArray<string | undefined>
          >,
          round = 0,
          assumedEffects: EffectSet = []
        ): void {
          for (const name of group) {
            const invalid = references.get(name)!.find((ref) => {
              const declaration = declarations.get(ref);
              return (
                declaration !== undefined && rowErrors.has(declaration.row.id)
              );
            });
            if (invalid !== undefined)
              return rejectComponent(
                group,
                name,
                ce.error(['invalid-document-dependency', invalid])
              );
          }
          const first = declarations.get(group[0])!;
          const groupHasValue = group.some(
            (name) => declarations.get(name)!.row.role === 'value'
          );
          if (cyclic && groupHasValue) {
            const diagnostic = ce.error(
              'Value initialization cycle: ' + group.join(', ')
            );
            return rejectComponent(group, group[0], diagnostic);
          }
          if (groupHasValue) {
            const axes = new Set<string>();
            if (fieldAxes.size > 0 && !writableSlots?.has(group[0])) {
              let raw: Expression | undefined;
              for (const ref of references.get(group[0])!) {
                if (fieldAxes.has(ref)) axes.add(ref);
                const binding = scope.bindings.get(ref);
                const macro =
                  binding !== undefined && 'value' in binding
                    ? binding.value.macro
                    : undefined;
                if (!Array.isArray(macro)) continue;
                const operands: string[] = [];
                for (const operand of macro.slice(1))
                  if (typeof operand === 'string' && fieldAxes.has(operand))
                    operands.push(operand);
                if (operands.length === 0) continue;
                raw ??= ce.box(parsed.get(first.row.id)!, { form: 'raw' });
                for (const axis of macroAxesRead(raw, ref, operands))
                  axes.add(axis);
              }
            }
            if (axes.size > 0) {
              const name = group[0];
              const body = parsed.get(first.row.id)!;
              const parameters = [...fieldAxes].filter((axis) =>
                axes.has(axis)
              );
              const helper = ce.temporaryName(
                'cePreparedField',
                names.values,
                names.callables
              );
              const literal = ce.box([
                'Function',
                body,
                ...parameters.map((axis): MathJsonExpression => [
                  'Typed',
                  axis,
                  "'real'",
                ]),
              ]);
              if (!literal.isValid)
                return rejectComponent(group, name, literal);
              const field = literal.type.type;
              if (
                first.row.valueType !== undefined &&
                typeof field === 'object' &&
                field.kind === 'signature' &&
                !ce.type(field.result).matches(first.row.valueType)
              )
                return rejectComponent(
                  group,
                  name,
                  ce.error(
                    name + ': initializer does not match ' + first.row.valueType
                  )
                );
              const helperBinding = installClosedType(
                helper,
                literal.type,
                true
              );
              preparedCalls.set(helperBinding.value, null);
              ce.assign(helper, literal);
              ce.declare(name, { macro: [helper, ...parameters] });
              fieldParameters.set(name, parameters);
              bodies.set(name, ce.box(body, { form: 'raw' }));
              return;
            }
            const expr = ce.box(parsed.get(first.row.id)!);
            if (!expr.isValid) return rejectComponent(group, group[0], expr);
            // This is the checked type of a formula result. It can contain
            // Missing even though host-written binding annotations cannot.
            const writable = writableSlots?.has(group[0]) === true;
            const type =
              first.row.valueType ??
              (writable ? widenLocalType(ce, expr.type.type) : expr.type);
            if (
              first.row.valueType !== undefined &&
              !expr.type.matches(first.row.valueType)
            )
              return rejectComponent(
                group,
                group[0],
                ce.error(
                  group[0] +
                    ': initializer does not match ' +
                    first.row.valueType
                )
              );
            const definition = {
              type,
              inferred: !writable,
              value: expr,
              [preparedContractDeclaration]: true as const,
            };
            ce._declareSymbolValue(group[0], definition, scope);
            bodies.set(group[0], expr);
            return;
          }
          let inferListResult = false;
          if (
            cyclic &&
            group.every(
              (name) => declarations.get(name)!.row.resultType === undefined
            )
          ) {
            const arities = new Map(
              group.map((name) => [
                name,
                declarations.get(name)!.head.params.length,
              ])
            );
            const isBuiltin = (name: string) =>
              !declarations.has(name) &&
              isLibraryDefinition(ce, name, ce.lookupDefinition(name));
            inferListResult = group.every((name) => {
              const { row, head } = declarations.get(name)!;
              return hasListReturn(
                parsed.get(row.id)!,
                arities,
                new Set(head.params),
                isBuiltin
              );
            });
          }
          // A cyclic member with no stated result is first checked against
          // a guessed result: the join of the types of its base arms, the
          // return arms that name no member of the component, widened as a
          // local is (`widenLocalType`: a numeric type becomes `number`, a
          // list loses its lengths). A guess that is or has a part that is
          // `unknown` or `any` (`list<unknown>` from a base arm `[]`) is not
          // made. The strict check of the bodies below then confirms the
          // guesses inductively. When any check refuses the guessed
          // component, it is settled again as if there were no guesses
          // (`unknown`, or `list<any>` for a list recursion), so a guess
          // never refuses a call in the component, or a member, that is
          // accepted without it. A later row can still be refused when a
          // type it states is disjoint from a confirmed result, but only
          // when the program is already ill-typed.
          if (cyclic && guesses === undefined) {
            const component = new Set(group);
            const guessed = new Map<string, Type>();
            for (const name of group) {
              const { row, head } = declarations.get(name)!;
              if (row.resultType !== undefined) continue;
              const arms = baseArms(parsed.get(row.id)!, component).map(
                (arm) =>
                  ce.box([
                    'Function',
                    arm,
                    ...formals(
                      head.params,
                      row,
                      true,
                      parameterGuesses?.get(name)
                    ),
                  ]).type.type
              );
              if (
                arms.length === 0 ||
                arms.some(
                  (sig) => typeof sig !== 'object' || sig.kind !== 'signature'
                )
              )
                continue;
              const joined = widenAll(
                arms.map((sig) => (sig as { result: Type }).result)
              );
              const guess = widenLocalType(ce, joined as Type);
              if (hasOpenPart(guess) || ce.type(guess).matches('error'))
                continue;
              guessed.set(name, guess);
            }
            if (guessed.size > 0)
              return settle(
                group,
                cyclic,
                guessed,
                parameterGuesses,
                round,
                assumedEffects
              );
          }
          const reject = (failed: string, invalid: Expression) => {
            if (guesses === undefined || guesses.size === 0)
              return rejectComponent(group, failed, invalid);
            // A raw delete, as `rejectComponent` does: the scope being
            // prepared is not a counted frame, so no holder count is kept,
            // and `undeclare` would send engine-wide redefine events.
            for (const name of group) scope.bindings.delete(name);
            return settle(
              group,
              cyclic,
              new Map(),
              parameterGuesses,
              round,
              assumedEffects
            );
          };
          // Each round of the parameter retry below changes the provisional
          // type of at least one parameter.
          const parameterRounds =
            2 *
            group.reduce(
              (count, name) =>
                count + declarations.get(name)!.head.params.length,
              0
            );
          const checked = group.map(
            (
              name
            ): {
              name: string;
              contract?: BoxedType;
              binding?: ReturnType<typeof installClosedType>;
              body?: Expression;
            } => ({ name })
          );
          for (const member of checked) {
            const { name } = member;
            const { row, head } = declarations.get(name)!;
            const typed =
              row.resultType !== undefined &&
              head.params.every((param) => row.formalTypes?.[param]);
            if (!cyclic && !typed) continue;
            const parameters = head.params.map(
              (param, i) =>
                row.formalTypes?.[param] ??
                parameterGuesses?.get(name)?.[i] ??
                'unknown'
            );
            // A cyclic row with no stated effect is first assumed to have
            // the effects `assumedEffects` (none at first): its calls of the
            // rows of the component take them, and the check of each body
            // below widens them until they hold the body's effects. No
            // effect is written `pure`, as for a typed row that is not
            // cyclic: an unlabeled contract would skip the conformance check
            // of its effects.
            const effects =
              row.effects ??
              (cyclic ? effectSetToString(assumedEffects) : 'any');
            const signature =
              '(' +
              parameters.join(', ') +
              ') ' +
              effects +
              ' -> ' +
              (row.resultType ??
                (guesses?.has(name)
                  ? typeToString(guesses.get(name)!)
                  : inferListResult
                    ? 'list<any>'
                    : 'unknown'));
            member.contract = ce.type(signature);
            if (cyclic) {
              const binding = installClosedType(name, member.contract, true);
              preparedCalls.set(binding.value, null);
              member.binding = binding;
            }
          }
          for (const member of checked) {
            const { name } = member;
            let { contract } = member;
            const { row, head } = declarations.get(name)!;
            const rhs = parsed.get(row.id)!;
            const parameters = formals(
              head.params,
              row,
              contract !== undefined,
              parameterGuesses?.get(name)
            );
            let body = ce.box(['Function', rhs, ...parameters]);
            if (!body.isValid) return reject(name, body);
            // Read-only position evidence can guide a stable input contract
            // without committing the draft to a specific tuple width.
            // A parameter read only as an operand of a join is any value: the
            // join takes a scalar operand as one element.
            const inferred = body.type.type;
            if (
              contract === undefined &&
              typeof inferred === 'object' &&
              inferred.kind === 'signature'
            ) {
              let changed = false;
              const normalized = parameters.map(
                (parameter, i): MathJsonExpression => {
                  const slot = inferred.args?.[i]?.type;
                  if (typeof parameter !== 'string' || slot === undefined)
                    return parameter;
                  const open = openSlot(body, parameter, slot, row);
                  if (open === slot) return parameter;
                  changed = true;
                  return ['Typed', parameter, "'" + typeToString(open) + "'"];
                }
              );
              if (changed) {
                body = ce.box(['Function', rhs, ...normalized]);
                if (!body.isValid) return reject(name, body);
              }
            }
            const actual = body.type;
            // A stated result type or effect is checked even when some
            // formals are unannotated: the inferred signature, with its
            // parameter names, fills the rest of the contract. A stated
            // result is a promise, refused only when disjoint from the
            // inferred result.
            let partial = false;
            const sig = actual.type;
            // The effects of a cyclic row are the least set that holds the
            // effects of its body when each call of the component has them:
            // a recursion whose body has no effect is `pure`, and its
            // applications are kept (CE-1709). A body with effects outside
            // the assumed set settles the component again with their union;
            // the set only grows, up to `any`.
            if (
              cyclic &&
              row.effects === undefined &&
              typeof sig === 'object' &&
              sig.kind === 'signature' &&
              !isEffectSubset(signatureEffects(sig), assumedEffects)
            ) {
              for (const other of group) scope.bindings.delete(other);
              return settle(
                group,
                cyclic,
                guesses,
                parameterGuesses,
                round,
                unionEffectSets(assumedEffects, signatureEffects(sig)) ?? 'any'
              );
            }
            if (
              contract === undefined &&
              (row.resultType !== undefined || row.effects !== undefined) &&
              typeof sig === 'object' &&
              sig.kind === 'signature'
            ) {
              const mismatch = (stated: BoxedType) =>
                ce.error(
                  name +
                    ': ' +
                    String(actual) +
                    ' does not match ' +
                    String(stated)
                );
              const effects =
                row.effects === undefined
                  ? sig.effects
                  : (signatureEffects(
                      ce.type('() ' + row.effects + ' -> any').type
                    ) ?? []);
              if (row.effects !== undefined) {
                const stated = ce.type(withArrowEffects(sig, effects ?? []));
                if (!actual.matches(stated))
                  return reject(name, mismatch(stated));
              }
              const result =
                row.resultType === undefined
                  ? sig.result
                  : ce.type(row.resultType).type;
              contract = ce.type({
                ...sig,
                args: sig.args?.map((arg, i) => {
                  const stated = row.formalTypes?.[head.params[i]];
                  return stated === undefined
                    ? arg
                    : { ...arg, type: ce.type(stated).type };
                }),
                result,
                ...(row.effects === undefined ? {} : { effects }),
              });
              if (
                row.resultType !== undefined &&
                ce.type(sig.result).isDisjointFrom(result)
              )
                return reject(name, mismatch(contract));
              partial = true;
            }
            if (contract !== undefined && !partial) {
              // The parameters and effects must match the contract. A stated
              // result is a promise, refused only when disjoint from the
              // inferred result, as for a partly annotated row. The derived
              // result of a cyclic row without one is checked strictly.
              const refuses = (expected: Type) =>
                row.resultType !== undefined &&
                typeof sig === 'object' &&
                sig.kind === 'signature' &&
                typeof expected === 'object' &&
                expected.kind === 'signature'
                  ? !actual.matches(
                      ce.type({ ...expected, result: sig.result })
                    ) || ce.type(sig.result).isDisjointFrom(expected.result)
                  : !actual.matches(ce.type(expected));
              const stated = contract.type;
              let refused = refuses(stated);
              // A parameter of a cyclic row with no stated type has a
              // provisional type in the contract (`unknown` first), which
              // the body can narrow (`collection<any> | tuple` from
              // `PointX(q)`). The contract cannot keep `unknown` then: a
              // call broadcasts a list argument over an `unknown`
              // parameter, though the body takes the list whole. When the
              // body matches the contract with its inferred types in place
              // of the provisional ones, the component is settled again
              // with the inferred types, opened as for a row that is not
              // cyclic (`openSlot()`), as its provisional types, until the
              // opened types are the provisional ones. A component that
              // does not settle within `parameterRounds` is refused.
              if (
                refused &&
                cyclic &&
                typeof sig === 'object' &&
                sig.kind === 'signature' &&
                typeof stated === 'object' &&
                stated.kind === 'signature' &&
                isFunction(body)
              ) {
                const current = parameterGuesses?.get(name);
                let changed = false;
                const next = head.params.map((param, i) => {
                  if (row.formalTypes?.[param] !== undefined) return undefined;
                  const slot = sig.args?.[i]?.type;
                  const guess =
                    slot === undefined
                      ? (current?.[i] ?? 'unknown')
                      : typeToString(openSlot(body, param, slot, row));
                  if (guess !== (current?.[i] ?? 'unknown')) changed = true;
                  return guess;
                });
                const inferred = {
                  ...stated,
                  args: stated.args?.map((arg, i) => {
                    const slot = sig.args?.[i]?.type;
                    return next[i] === undefined || slot === undefined
                      ? arg
                      : { ...arg, type: slot };
                  }),
                };
                if (!refuses(inferred)) {
                  if (!changed) refused = false;
                  else if (round < parameterRounds) {
                    for (const other of group) scope.bindings.delete(other);
                    return settle(
                      group,
                      cyclic,
                      guesses,
                      new Map(parameterGuesses).set(name, next),
                      round + 1,
                      assumedEffects
                    );
                  }
                }
              }
              if (refused)
                return reject(
                  name,
                  ce.error(
                    name +
                      ': ' +
                      String(actual) +
                      ' does not match ' +
                      String(contract)
                  )
                );
            }
            if (member.binding === undefined) {
              const closed =
                contract === undefined
                  ? actual
                  : row.effects === undefined
                    ? ce.type(
                        withArrowEffects(
                          contract.type,
                          signatureEffects(actual.type) ?? []
                        )
                      )
                    : contract;
              const binding = installClosedType(name, closed, true);
              preparedCalls.set(binding.value, null);
              member.binding = binding;
            }
            const provisional = provisionalLiteral(body);
            if (provisional !== undefined && provisional.heads.size > 0)
              return reject(
                name,
                ce.error(
                  name +
                    ': provisional heads ' +
                    [...provisional.heads].join(', ')
                )
              );
            member.body = body;
          }
          // A recursion with no base case never returns a value: refuse it
          // here rather than let each call exceed the recursion limit.
          if (cyclic) {
            const isCertainCall = (call: Expression & FunctionInterface) => {
              const callee = declarations.get(call.operator);
              if (callee === undefined || !group.includes(call.operator))
                return false;
              const { row, head } = callee;
              return (
                head.params.length === call.nops &&
                call.ops.every((arg, i) => {
                  if (arg.operator === 'Spread' || arg.operator === 'Sequence')
                    return false;
                  const stated = row.formalTypes?.[head.params[i]];
                  return stated === undefined || arg.type.matches(stated);
                })
              );
            };
            const hasBaseArm = checked.some(({ name, body }) => {
              const params = declarations.get(name)!.head.params;
              const shadowed = (head: string) =>
                params.includes(head) || declarations.has(head);
              const formalCall = (call: Expression & FunctionInterface) =>
                !params.includes(call.operator) && isCertainCall(call);
              return returnArms(
                isFunction(body, 'Function') ? body.op1 : body!
              ).some(
                (arm) =>
                  arm === undefined ||
                  !hasCertainCall(arm, shadowed, formalCall)
              );
            });
            if (!hasBaseArm)
              return reject(
                group[0],
                ce.error('Recursive definition with no base case: ' + group[0])
              );
          }
          // No callable receives its body until every body in the group is checked.
          for (const { name, binding, body } of checked) {
            invariant(
              binding !== undefined && body !== undefined,
              'Unchecked callable: ' + name
            );
            ce.assign(name, body);
            invariant(
              scope.bindings.get(name) === binding,
              'Binding changed: ' + name
            );
            if (!cyclic && declarations.get(name)!.row.resultType === undefined)
              preparedCalls.set(binding.value, callPhase);
            bodies.set(name, body);
          }
        }
      );
      for (const name of declarations.keys()) graph.prepare(name);
      for (const row of rows) {
        if (row.role !== 'formula') continue;
        const raw = readRow(row);
        rowReferences.set(row.id, withIndexedBases(row, rawReferences(raw)));
      }
      for (const [name, { row }] of declarations)
        rowReferences.set(row.id, references.get(name)!);
      for (const row of unparsedEntries) {
        if (rawRows.has(row.id)) continue;
        const entry = latex.parse(
          row.latex,
          rowOptions(
            row,
            () => false,
            () => []
          )
        );
        rawRows.set(row.id, syntax.normalize(entry ?? 'Nothing'));
      }
      invariant(
        parsed.size === rows.length &&
          rawRows.size === rows.length &&
          rowReferences.size === rows.length &&
          bodies.size === declarations.size &&
          cursors.size === 0,
        'Document preparation lost a row'
      );
      const arities = new Map(
        [...declarations]
          .filter(([, { row }]) => row.role === 'function')
          .map(([name, { head }]) => [name, head.params.length])
      );
      const evidence = emptyCallSiteEvidence(arities);
      readCallSites(
        ce,
        [...declarations]
          .filter(
            ([name, { row }]) =>
              !rowErrors.has(row.id) && !fieldParameters.has(name)
          )
          .map(([name]) => bodies.get(name)!),
        arities,
        evidence
      );
      // A formula row that calls a function of the document is boxed only
      // to read the types of its arguments, in a scope of its own: a free
      // name, or a name that the row declares, is declared there, not in the
      // revision or in another row. A row that does not box, or is not
      // valid, gives no evidence. An argument that reads a field axis or a
      // field value is open: its value depends on the point of the field. A
      // name that a binder around it binds (`\sum_{t=1}^{3}`) is not a read.
      const readsField = (
        expr: Expression,
        bound: ReadonlySet<string>
      ): boolean => {
        if (isSymbol(expr))
          return (
            !bound.has(expr.symbol) &&
            (fieldAxes.has(expr.symbol) || fieldParameters.has(expr.symbol))
          );
        if (isDictionary(expr))
          return expr.values.some((value) => readsField(value, bound));
        if (!isFunction(expr)) return false;
        if (!bound.has(expr.operator) && fieldParameters.has(expr.operator))
          return true;
        const names = boundNames(ce, expr);
        const inner =
          names.length === 0 ? bound : new Set([...bound, ...names]);
        return expr.ops.some((op) => readsField(op, inner));
      };
      for (const row of rows) {
        if (
          row.role !== 'formula' ||
          !rowReferences.get(row.id)!.some((ref) => names.callables.has(ref))
        )
          continue;
        checkDeadline(ce._deadlineFrame);
        const probe = ce.createScope({}, scope);
        try {
          ce._inScope(probe, () => {
            const expr = ce.box(parsed.get(row.id)!);
            if (!expr.isValid) return;
            // A row adds its evidence only when its walk finishes.
            const read = emptyCallSiteEvidence(arities);
            readCallSites(ce, [expr], arities, read, readsField);
            mergeCallSiteEvidence(evidence, read);
          });
        } catch (error) {
          // This advisory step must not make prepare throw: a defect of the
          // box only leaves an entry out, and `withRootRepair` resets the
          // boxing state.
          if (error instanceof Error && error.name === 'CancellationError')
            throw error;
        } finally {
          probe.dispose();
        }
      }
      const callSites = callSiteTypes(ce, arities, evidence);
      const preparedDefinitions: PreparedDocumentDefinition[] = [
        ...declarations,
      ].map(([name, item]) => ({
        id: item.row.id,
        name,
        role: item.row.role as Role,
        params: [...item.head.params],
        rawBody: parsed.get(item.row.id)!,
        body: bodies.get(name)!,
        references: references.get(name)!,
        ...(fieldParameters.has(name)
          ? { fieldParameters: fieldParameters.get(name)! }
          : {}),
        ...(item.row.role === 'function'
          ? { callSiteTypes: callSites.get(name)! }
          : {}),
      }));
      function isWritableRow(name: string): boolean {
        const row = declarations.get(name)?.row;
        return (
          row?.role === 'value' &&
          writableSlots?.has(name) === true &&
          !rowErrors.has(row.id) &&
          !fieldParameters.has(name)
        );
      }
      checkDeadline(ce._deadlineFrame);
      sealPreparedNamespace(scope, isWritableRow);
      let disposed = false;
      return {
        scope,
        rawRows,
        rowReferences,
        rowErrors,
        definitions: preparedDefinitions,
        /** Read selected value rows after the caller has finished input writes.
         * Run and consume results synchronously before the next input change. */
        createValuePass(names: ReadonlySet<string>) {
          if (disposed) throw new Error('Document revision is disposed');
          const owned = new Map<BoxedValueDefinition, Expression>();
          for (const row of preparedDefinitions) {
            if (
              row.role !== 'value' ||
              !names.has(row.name) ||
              row.fieldParameters !== undefined ||
              rowErrors.has(row.id)
            )
              continue;
            const binding = scope.bindings.get(row.name);
            if (binding !== undefined && 'value' in binding)
              owned.set(binding.value, row.body);
          }
          const pass = makePreparedValuePass(ce, owned);
          return {
            run<T>(evaluate: () => T): T {
              if (disposed) throw new Error('Document revision is disposed');
              return pass.run(() => {
                const result = evaluate();
                if (!isThenable(result)) return result;
                void Promise.resolve(result).catch(() => {});
                throw new TypeError(
                  'Document value pass reads must be synchronous'
                );
              });
            },
            retain(name: string, view: Expression, result: Expression): void {
              if (disposed) throw new Error('Document revision is disposed');
              const binding = scope.bindings.get(name);
              if (binding !== undefined && 'value' in binding)
                pass.retain(binding.value, view, result);
            },
          };
        },
        collectionWriteError(
          name: string,
          value: Expression
        ): string | undefined {
          if (disposed) throw new Error('Document revision is disposed');
          const binding = scope.bindings.get(name);
          if (rowErrors.has(declarations.get(name)?.row.id ?? ''))
            return name + ' has an invalid initializer';
          if (
            !isWritableRow(name) ||
            binding === undefined ||
            !('value' in binding)
          )
            return name + ' has no prepared writable slot';
          const contract = binding.value.declaredType;
          if (
            value.engine !== ce ||
            !value.isValid ||
            !value.type.matches(contract)
          )
            return name + ' expects ' + contract.toString();
          return undefined;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          rawRows.clear();
          rowReferences.clear();
          rowErrors.clear();
          preparedDefinitions.length = 0;
          declarations.clear();
          try {
            scope.dispose();
          } finally {
            releaseImports?.();
          }
        },
      };
    });
  } catch (error) {
    scope.dispose();
    throw error;
  } finally {
    callPhase.preparing = false;
  }
}
