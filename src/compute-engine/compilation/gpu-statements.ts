// Statement-level lowering: selection, conditionals and match, and the checks
// on expression-only bodies.

import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget } from './types.js';
import { compileSubject } from './diagnostics.js';
import {
  BaseCompiler,
  statementBodyHead,
  type MatchStatementClause,
} from './base-compiler.js';
import { signatureEffects } from '../../common/type/utils.js';
import { couldMatch } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import {
  GPU_COMPARE_GLSL,
  conditionalGPUSinks,
  gpuBVec,
  gpuEvaluatedUnit,
  gpuFVec,
  gpuNaN,
  gpuType,
  gpuVec2,
  gpuVecType,
  statementCaptureSinks,
} from './gpu-emit.js';
import {
  gpuBindEveryDraw,
  gpuDrawCount,
  gpuDrawOrderError,
  gpuHoistKeepsCallerOrder,
  gpuInSelectionBranch,
  gpuOperandOnce,
} from './gpu-draw-order.js';
import { gpuComponentCount, gpuNaNFor, gpuOperandShape } from './gpu-shapes.js';
import { gpuTypeOfValue } from './gpu-declared-types.js';

/**
 * Fail closed when the compiled shader body `body` places a `return`
 * anywhere but at the start of a statement.
 *
 * `Return` is emitted by the base compiler as the bare statement `return <v>`,
 * which is correct only where a statement is expected. Three positions in a
 * shader body are NOT that, and each emitted source no driver accepts behind
 * `success: true`:
 *
 * - the block's VALUE (its last statement), which the caller return-prefixes —
 *   `return return s;`;
 * - a conditional ARM, which GLSL lowers to an EXPRESSION (a `?:`
 *   ternary) — `((0.0 < t) ? (return t) : …)`;
 * - a branch of a conditional nested in a loop body, for the same reason.
 *
 * Lowering an early return properly means restructuring the body into a result
 * flag and guarded statements, which is a feature, not a gate — so this refuses
 * the shapes it cannot emit and lets the interpreter evaluate them. The one
 * shape that IS valid, an early `Return` as a plain statement of the body, is
 * untouched: its `return` starts its line.
 *
 * `singleLine` bodies are EXPRESSIONS — the caller wraps them in
 * `return <body>;` — so a `return` anywhere in them is misplaced, including at
 * offset 0.
 *
 * A token scan, deliberately: it reads the source that is actually about to be
 * emitted, so it covers every shape (including ones no probe enumerated)
 * rather than mirroring the emitter's position rules. `return` is a reserved
 * word in both languages (`gpuCheckIdentifier`), so `\breturn\b` cannot match a
 * user identifier.
 */
export function gpuAssertReturnPlacement(
  subject: string,
  body: string,
  language: string
): void {
  if (!/\breturn\b/.test(body)) return;
  const lines = body.split('\n');
  const singleLine = lines.length === 1;
  for (const line of lines) {
    const start = line.length - line.trimStart().length;
    for (const m of line.matchAll(/\breturn\b/g)) {
      if (!singleLine && m.index === start) continue;
      throw new Error(
        `Could not compile ${compileSubject(subject)}: an early \`Return\` here has no ` +
          `${language.toUpperCase()} lowering — the emitted source would place ` +
          `a \`return\` where the language requires an expression ` +
          `(\`${line.trim()}\`). A shader function returns once, at the end of ` +
          `its body, so a \`Return\` inside a conditional — or one that IS the ` +
          `body's final value — cannot be emitted. Rewrite it as a conditional ` +
          `VALUE, or evaluate instead.`
      );
    }
  }
}

/**
 * The nodes of `body`, the body of a shader `Loop`, that can emit a jump as a
 * statement of that loop (`CompileTarget.shaderLoopJumps`).
 *
 * The search follows statement positions only: the statements of a `Block`,
 * and the branch of an `If` or a `Which` with one clause (`If(c, t)`,
 * `If(c, t, Nothing)`, `Which(c, t)`). It does not enter a nested `Loop`, which
 * owns its jumps and makes this set for its own body.
 *
 * A selection with a second clause is left out, so `If(c, Break(), n ≔ 1)`
 * declines and the interpreter runs it. When the first branch always leaves the
 * loop, a program can write the else branch as the statement after the `If`.
 * `Which(True, t)` is left out too: its branch always runs, so it is not a
 * condition.
 *
 * A `Break` with an operand is left out. The compiled `break` has no value, and
 * the interpreter evaluates the operand before it leaves the loop, so an effect
 * of `Break(f(k))` would be lost.
 */
export function gpuShaderLoopJumps(body: Expression): ReadonlySet<Expression> {
  const found = new Set<Expression>();
  const visit = (stmt: Expression): void => {
    if (!isFunction(stmt)) return;
    const h = stmt.operator;
    const ops = stmt.ops;
    if (h === 'Break' || h === 'Continue') {
      if (ops.length === 0) found.add(stmt);
    } else if (h === 'Block') {
      ops.forEach(visit);
    } else if (
      (h === 'If' &&
        (ops.length === 2 ||
          (ops.length === 3 && isSymbol(ops[2], 'Nothing')))) ||
      (h === 'Which' && ops.length === 2 && !isSymbol(ops[0], 'True'))
    ) {
      found.add(stmt);
      visit(ops[1]);
    }
  };
  visit(body);
  return found;
}

/**
 * Fail closed when `code`, produced by an **expression-only** route, is
 * not a single expression of the target language.
 *
 * `compileToSource()` answers with a bare expression string, and each
 * `compileShader()` body statement is spliced into an assignment RHS
 * (`<variable> = <code>;`). Neither position accepts a statement, and GLSL
 * has no expression-level block or immediately-invoked function
 * to wrap one in — so a body that lowers to a statement sequence (a `Block`
 * that returns early, a loop-form `Sum`/`Product`/`Loop` with no sink to hoist
 * into) or to a bare `return` has no honest emission here. Before this gate
 * both routes spliced the statements in verbatim, producing source no driver
 * accepts (`gl_FragColor = float s;\ns = x;\nreturn return s;;`).
 *
 * The shapes that DO reduce to an expression are untouched: a single-statement
 * `Block` already unwraps to its expression in the base compiler, so it never
 * reaches this check with a newline. On the `compileShader()` route, whose
 * body statements carry a hoist sink, a multi-statement `Block` whose value is
 * an expression and a loop-form `Sum` hoist their statements ahead of the
 * assignment and answer a temporary, so they never reach this check either.
 *
 * A token scan on the source about to be emitted, deliberately — the same
 * technique (and the same two signals) as `gpuAssertReturnPlacement` and
 * `BaseCompiler.compileValueOperand`'s `bareStatementBlocks` gate: a multi-line
 * emission is a statement sequence on these targets, and `return` is a reserved
 * word (`gpuCheckIdentifier`) so it cannot match a user identifier.
 *
 * The statement-capable route is `compile()`, which emits a function body — it
 * is what the message points at.
 */
export function gpuAssertExpressionOnly(
  subject: string,
  code: string,
  language: string
): void {
  const multiStatement = code.includes('\n');
  if (!multiStatement && !/\breturn\b/.test(code)) return;
  const lang = language.toUpperCase();
  const excerpt = (multiStatement ? code.split('\n')[0] : code).trim();
  throw new Error(
    `Could not compile ${compileSubject(subject)}: this route emits a single ${lang} EXPRESSION, but the body ` +
      `lowers to ${
        multiStatement ? 'a statement sequence' : 'a bare `return` statement'
      } (\`${excerpt}${multiStatement ? '…' : ''}\`). ${lang} has no ` +
      `expression-level block or immediately-invoked function to wrap ` +
      `statements in, so there is no valid emission for this position. ` +
      `Compile a statement body with compile() instead — that route emits a ` +
      `function body.`
  );
}

/**
 * Fail closed on an expression-only GPU route whose body is STRUCTURALLY a
 * declaration.
 *
 * `gpuAssertExpressionOnly` scans the emitted source for the two signals a
 * statement leaves there — a newline and a `return` token — but these two
 * shapes leave neither. Both are single-line emissions:
 *
 * - `Assign(s, x)` emits `s = x`. In GLSL assignment is an OPERATOR, so
 *   `fragColor = s = x;` is valid source and the emission is honest.
 * - A root `Declare(s, 'number', x)` emits `float s` — a declaration is a
 *   statement, and the emission
 *   silently DROPS the initializer `x` as well. Only the bare-`Declare` root
 *   shape reaches here; wrapped in a multi-statement `Block` the declaration is
 *   followed by more lines, which the emitted-source scan already declines.
 *
 * Structural, on the body BEFORE it is compiled (`statementBodyHead`),
 * deliberately: the emitted `=` is not distinguishable by a token scan from the
 * `=` of `==`/`<=`/`>=`/`!=` without re-deriving the emitter's precedence
 * rules, so there is no textual check that cannot false-positive on a
 * comparison.
 *
 * As everywhere in this class, the statement-capable route is `compile()`.
 */
export function gpuAssertExpressionBody(
  subject: string,
  expr: Expression,
  language: string
): void {
  const head = statementBodyHead(expr);
  if (head === undefined) return;
  const lang = language.toUpperCase();
  // GLSL assignment is an operator, so an assignment body is valid.
  if (head === 'Assign') return;
  throw new Error(
    `Could not compile ${compileSubject(subject)}: this route emits a single ${lang} EXPRESSION, but the body ` +
      `is a declaration. A declaration is a STATEMENT in ${lang}, so the ` +
      `emitted \`float s\`-shaped ` +
      `source is not valid in an expression position — and it carries no ` +
      `initializer, so the declared value would be silently DROPPED. Compile ` +
      `a statement body with compile() instead — that route emits a function ` +
      `body.`
  );
}

/**
 * Does compiling `e` on a shader target need STATEMENTS — a loop-form
 * `Sum`/`Product`, a `Block` or a `Loop` used as a value — which a ternary
 * arm cannot hold? A structural test over the subtree: a `Sum` whose bounds
 * let it unroll needs none and then takes the statement form of a
 * conditional (`compileGPUStatementSelection`) for nothing more than an
 * assignment, which is still correct. Exported for its test only.
 */
export function gpuNeedsStatements(e: Expression): boolean {
  // A boxed expression is a DAG: a node reached twice is visited once, or
  // a tower of shared operands unfolds exponentially.
  const seen = new Set<Expression>();
  const walk = (x: Expression): boolean => {
    if (seen.has(x)) return false;
    seen.add(x);
    // A symbol with a value is inlined by the shader targets: its value is
    // read as if written in place. (A name an enclosing binder rebinds is
    // read the same way; the worst case is a statement form taken for an
    // arm that needed none, which is still correct.)
    if (isSymbol(x)) {
      const value = x.engine._getSymbolValue(x.symbol);
      return value !== undefined && walk(value);
    }
    if (!isFunction(x)) return false;
    const h = x.operator;
    // Every `Sum`/`Product` is read as needing statements: a loop form
    // certainly does, and an unrolled one may still hoist a loop-invariant
    // declaration for a term that does not depend on the index. An impure
    // operand that a lowering binds to a temporary (the operand of `Cot`) is
    // not read here. A selection whose clauses draw keeps the ternary,
    // which declines the hoisted temporary in a conditional arm.
    if (h === 'Sum' || h === 'Product' || h === 'Block' || h === 'Loop')
      return true;
    return x.ops.some(walk);
  };
  return walk(e);
}

/**
 * Does the declared signature of `name` — an operator, or a symbol whose
 * value is a function — carry an effect that writes a binding: `scope` (a
 * write to an enclosing binding), `state` (a store), or `any` (unknown)?
 * The engine refuses to assign a function literal that writes outside
 * itself under a signature without the label, so the declared signature is
 * the record of what a call may write.
 */
function gpuSignatureWrites(node: Expression, name: string): boolean {
  const def = node.engine.lookupDefinition(name);
  const types: (Type | undefined)[] = [];
  if (isOperatorDef(def)) types.push(def.operator.signature?.type);
  else if (isValueDef(def))
    types.push(def.value.type?.type, def.value.value?.type?.type);
  return types.some((t) => {
    // `signatureEffects` is the engine's one reader of a signature's
    // effects: it also reads an overload set (an intersection of
    // signatures) and an extracted element (a union with `missing`).
    const effects = signatureEffects(t);
    return (
      effects === 'any' ||
      effects?.includes('scope') === true ||
      effects?.includes('state') === true
    );
  });
}

/**
 * Does the `Block` `node` write a binding it does not declare? Read as
 * `BaseCompiler.hasObservableEffect` reads a block: an `Assign` to a name
 * the block declared earlier is not a write and only its value is read; the
 * initializer of a `Declare` is read; any other statement is read whole.
 * Each value is read by `gpuWritesOutside`.
 */
function gpuBlockWritesOutside(
  node: Expression,
  inside: ReadonlySet<Expression>,
  reading: Set<string>
): boolean {
  if (!isFunction(node)) return false;
  const own = new Set<string>();
  return node.ops.some((stmt) => {
    if (isFunction(stmt, 'Declare')) {
      const declared = stmt.ops[0];
      if (isSymbol(declared)) own.add(declared.symbol);
      else if (
        isFunction(declared, 'Tuple') ||
        isFunction(declared, 'List') ||
        isFunction(declared, 'Delimiter') ||
        isFunction(declared, 'Sequence')
      )
        for (const leaf of declared.ops)
          if (isSymbol(leaf)) own.add(leaf.symbol);
      const init = BaseCompiler.declareValueOperand(stmt.ops);
      return init !== undefined && gpuWritesOutside(init, inside, reading);
    }
    if (isFunction(stmt, 'Assign')) {
      const name = stmt.ops[0];
      if (!isSymbol(name) || !own.has(name.symbol)) return true;
      return gpuWritesOutside(stmt.ops[1], inside, reading);
    }
    return gpuWritesOutside(stmt, inside, reading);
  });
}

/**
 * Does `node` write a binding anywhere outside the nodes in `inside` (and
 * their subtrees)? A write is an `Assign`, a `Declare` or an `Assume` at any
 * depth, or a call of a function whose signature declares a write effect
 * (`gpuSignatureWrites`, the head of an application or a function-valued
 * symbol operand), or a write in the value of a symbol, which the shader
 * inlines. A node pure through every inlined value (`foldValueImpure`)
 * writes nothing. A `Block` is read statement by statement
 * (`gpuBlockWritesOutside`), so its writes to its own locals do not count.
 * A random draw is not a write: the callers count the draws separately.
 */
function gpuWritesOutside(
  node: Expression,
  inside: ReadonlySet<Expression>,
  /** The symbols whose values are being read: a value that names its own
   * symbol is read once. */
  reading: Set<string> = new Set()
): boolean {
  if (inside.has(node)) return false;
  // A symbol's inlined value may hold anything; an impure one is refused
  // as a possible write (`foldValueImpure` looks through the value).
  if (isSymbol(node)) {
    if (gpuSignatureWrites(node, node.symbol)) return true;
    if (!BaseCompiler.foldValueImpure(node)) return false;
    if (reading.has(node.symbol)) return false;
    const value = node.engine._getSymbolValue(node.symbol);
    if (value === undefined) return true;
    reading.add(node.symbol);
    try {
      return gpuWritesOutside(value, inside, reading);
    } finally {
      reading.delete(node.symbol);
    }
  }
  if (!isFunction(node) || !BaseCompiler.foldValueImpure(node)) return false;
  if (node.operator === 'Block')
    return gpuBlockWritesOutside(node, inside, reading);
  const op = node.operator;
  if (op === 'Assign' || op === 'Declare' || op === 'Assume') return true;
  if (node.ops.some((x) => gpuWritesOutside(x, inside, reading))) return true;
  return gpuSignatureWrites(node, op);
}

/**
 * A `Which` (clauses in `Which` shape) as a STATEMENT — `if … else if … else`
 * storing the selected value in a temporary declared ahead of it — for a
 * selection whose arm, or condition past the first, needs statements a
 * ternary cannot hold (`gpuNeedsStatements`): the loop of a loop-form `Sum`
 * then runs INSIDE its branch, only when that branch is selected, which is
 * what the interpreter does and what the ternary form could not express
 * (`compileGPUConditionalArm` refuses to hoist the loop ahead of the
 * ternary, where it would run unconditionally). The Tycho code-generation
 * audit document `yac5cxfjm1` declined 14 records on this shape:
 * `f(x, N) := Which(1 ≤ N, Σ_{n=1}^{⌊N⌋} cos(…)/√N_m, True, 0)`.
 *
 * Each clause is compiled with its hoisted statements CAPTURED and placed in
 * its own branch, ahead of the assignment; a later condition's statements
 * sit in the `else` of the clause before it, so they run only when that
 * clause was not taken. The temporary needs one static shader type shared
 * by every arm. `undefined` — the ternary form then applies, and declines
 * as before — when the position has no statement sink, when the sink is a
 * ternary arm of an enclosing conditional (the guard of
 * `compileGPUConditionalArm`), when the arms have no one static type, and
 * when running the selection ahead of its statement position could be
 * observed (the gate below).
 */
export function compileGPUStatementSelection(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression, i: number) => string,
  target: CompileTarget<Expression>
): string | undefined {
  if (!BaseCompiler.canHoist(target) || conditionalGPUSinks.has(target.hoist!))
    return undefined;
  // Hoisted as one statement, the selection runs ahead of the whole
  // expression at its statement position (`hoist.unit`), so a sibling
  // written BEFORE the selection runs after it. Two things could observe
  // that order, and the gate refuses both: an effect inside the selection
  // that could change places with a sibling's (see the draw rule below) —
  // and a sibling that WRITES a binding, since the selection could read that
  // binding before the write, directly, through a symbol whose value is
  // inlined, or inside a function it calls. Where a read hides is not
  // examined; the writes are: an assignment anywhere in the unit outside
  // the selection's own clauses, and a call of a function whose signature
  // declares a write (`gpuWritesOutside`). The engine's effect labels are
  // not read on the unit as a whole: they mark a block's write to its own
  // local `scope` too, and such a block is no hazard. The unit is unknown
  // at a sink no statement position recorded; the gate then refuses too. Every
  // refusal keeps the ternary form, which declines the hoisting arm as it
  // did before (`ROADMAP.md`, "A statement hoisted on a shader target runs
  // ahead of an operand written before it"). `hasObservableEffect` reads a
  // block by the values it assigns to its own locals, so a block arm that
  // declares and assigns its own locals is not an effect.
  // A statement that is itself the store of its right side — `q := If(…)`,
  // `Declare(q, real, If(…))` — stores after that side is evaluated, so
  // only the evaluated side is examined for writes (`gpuEvaluatedUnit`).
  const evaluated = gpuEvaluatedUnit(target);
  if (evaluated === undefined) return undefined;
  // The one effect a clause may have is a random draw, and only when nothing
  // else in the statement draws: the hoisted selection then makes its draws
  // in the same order as the interpreter, since no draw of a sibling can
  // come between. Each clause may draw once only: a clause's own hoisted
  // statements run before the rest of the clause (and those of the first
  // condition before the `if`), so a second draw could change places with
  // the first (`Tuple(Random(), Cot(Random()))` binds the operand of `Cot`
  // first). A clause that writes a binding (`gpuWritesOutside`) is refused.
  // The rule is stricter than the order needs: a draw written after the
  // selection (`W + Random()`), a draw already bound ahead of it, and a
  // selection nested in a clause of another (which reads the outer clause's
  // draw as outside its own) are refused too. Such a statement is compiled
  // again with every draw bound to a temporary in the order of the
  // interpreter (`gpuRecompileWithBoundDraws`), and this rule is then
  // skipped.
  if (args.some(BaseCompiler.hasObservableEffect)) {
    if (args.some((a) => gpuWritesOutside(a, new Set()))) return undefined;
    // When every draw of the statement is bound to a temporary at the point
    // it is compiled (`gpuBindEveryDraw`), the draws of the siblings and of
    // the clauses run in the order they are compiled, which is the order of
    // the interpreter, so the counts below are not needed.
    if (gpuBindEveryDraw === undefined) {
      // A draw outside the selection is found by counting, not by identity:
      // the same node object can stand in a clause and in a sibling.
      const memo = new Map<Expression, number>();
      const own = args.map((a) => gpuDrawCount(a, memo));
      const inClauses = own.reduce((n, c) => n + c, 0);
      if (
        gpuDrawCount(evaluated, memo) !== inClauses ||
        own.some((c) => c > 1)
      ) {
        // The ternary form cannot hold a clause that needs statements, so
        // the statement is compiled again with every draw bound in order
        // (`gpuRecompileWithBoundDraws`), where this rule does not apply.
        if (args.some(gpuNeedsStatements))
          throw gpuDrawOrderError(
            'Could not compile the selection: a clause needs statements and ' +
              'draws a random value, and a draw of the rest of the statement ' +
              'could then change places with its draws.'
          );
        return undefined;
      }
    }
  }
  // The hoisted selection runs ahead of the rest of the statement, so caller
  // code in a clause must not move ahead of other code with an effect, nor a
  // draw in a clause ahead of caller code (`gpuHoistKeepsCallerOrder`).
  if (!gpuHoistKeepsCallerOrder(args, target)) return undefined;
  if (gpuWritesOutside(evaluated, new Set(args))) return undefined;
  const arms = args.filter((_, i) => i % 2 === 1);
  // In a complex selection the caller lifts each real scalar arm to a `vec2`
  // (`gpuSelectionArm`), so such an arm has the complex type here.
  const complex = gpuSelectionIsComplex('Which', args);
  // A written `Missing` (or `NaN`) arm has no type of its own here: the
  // caller compiles it as the NaN of the shape of the other arms
  // (`gpuAbsentArm`). It is set aside unless every arm is one.
  const typedArms = arms.some((a) => !gpuIsWrittenAbsence(a, target))
    ? arms.filter((a) => !gpuIsWrittenAbsence(a, target))
    : arms;
  const types = typedArms.map((a) =>
    complex && gpuOperandShape(a) === 'scalar'
      ? gpuVecType(2)
      : gpuTypeOfValue(a)
  );
  if (types.some((t) => t === undefined) || new Set(types).size !== 1)
    return undefined;
  const type = types[0]!;
  // A position no clause selects is the codomain's NaN; a temporary of an
  // integer or boolean type has none, so such a selection needs a `True`
  // default clause to take this form.
  if (
    !/^(float|vec[234]|f32|vec[234]f)$/.test(type) &&
    !isSymbol(args[args.length - 2], 'True')
  )
    return undefined;
  const sink = target.hoist!;
  // `lazy`: the clause is a lazily-evaluated operand of the selection (an
  // arm, a condition past the first), which the operand compiler hands to
  // `compileGPUConditionalArm`; the guard is skipped once for it. The first
  // condition is evaluated unconditionally and carries no guard. The
  // statements of a lazy clause are placed in its branch, so their order
  // check compares them with that clause only (`gpuInSelectionBranch`).
  const capture = (
    f: () => string,
    lazy: boolean
  ): { code: string; stmts: string[] } => {
    const before = sink.stmts.length;
    if (lazy) statementCaptureSinks.add(sink);
    let code: string;
    try {
      code = lazy ? gpuInSelectionBranch(sink, f) : f();
    } finally {
      statementCaptureSinks.delete(sink);
    }
    const stmts = sink.stmts
      .splice(before)
      .map((stmt) => stmt.replace(/;\s*$/, ''));
    return { code, stmts };
  };
  // A captured statement may span lines (a loop with its body); it stays
  // one element, indented line by line, so the terminator test below reads
  // its END, as the sink's own joiner does.
  const indent = (stmts: ReadonlyArray<string>): string[] =>
    stmts.map((stmt) => `  ${stmt.replace(/\n/g, '\n  ')}`);
  const terminated = (stmt: string): string =>
    /[;{}]\s*$/.test(stmt) ? stmt : `${stmt};`;
  const tv = BaseCompiler.tempVar(target);
  const shapeRef = arms.find((v) => gpuComponentCount(v)) ?? null;
  const noClause = complex
    ? `${gpuVec2()}(${gpuNaN(target)})`
    : gpuNaNFor(shapeRef, target);
  const build = (i: number): string[] => {
    if (i >= args.length) return [`${tv} = ${noClause}`];
    const cond = args[i];
    const val = args[i + 1];
    // `True` marks the default branch.
    if (isSymbol(cond, 'True')) {
      const arm = capture(() => compile(val, i + 1), true);
      return [...arm.stmts, `${tv} = ${arm.code}`];
    }
    // The condition first, as the ternary form compiles it: the first
    // condition is not lazy, so a subexpression it shares with the arm is
    // bound ahead of the selection and the arm reads the binding, where
    // the arm compiled first would emit the subexpression in full — for a
    // shared operand tower, once per occurrence.
    const c = capture(() => compile(cond, i), i > 0);
    const arm = capture(() => compile(val, i + 1), true);
    const armLines = [...arm.stmts, `${tv} = ${arm.code}`];
    return [
      ...c.stmts,
      `if (${c.code}) {`,
      ...indent(armLines),
      `} else {`,
      ...indent(build(i + 2)),
      `}`,
    ];
  };
  const lines = build(0);
  BaseCompiler.hoistStatement(
    target,
    `${type} ${tv};`,
    lines.map(terminated).join('\n')
  );
  return tv;
}

/**
 * A `Match` as a STATEMENT (`compileGPUStatementSelection`), for a match
 * whose case body or guard needs statements a ternary cannot hold
 * (`gpuNeedsStatements`): `Match(n, 1 -> Σ_{k=1}^{⌊t⌋} cos(kt), _ -> 0)`
 * runs the loop inside the branch of its case, only when the case is
 * selected, as the interpreter does. The ternary form declined it, because
 * the loop could only be hoisted ahead of the ternary, where it would run
 * for every case.
 *
 * The cases (`MatchStatementClause`, from `BaseCompiler.compileMatchTernary`)
 * are given to the statement form as `Which` clauses: the case test is the
 * condition and the case body the value, and an irrefutable last case is the
 * `True` clause. The statement form reads the clause EXPRESSIONS for its
 * requirements (no effect in a clause other than the draws the gate allows,
 * no write outside the clauses, one static type for every value); the
 * expression for a case test is its guard, or `False` for a case with no
 * guard, because a pattern is a constant with no effect. The clause CODE
 * comes from the functions of the case, so the comparisons with the subject
 * are those of the ternary form.
 *
 * `undefined`, and the ternary form, when no case needs statements, when the
 * subject has an effect (its evaluation would move ahead of the siblings of
 * the selection), when a case value is complex (the ternary form does not
 * lift a real case value to a `vec2`, and neither does this form), and in
 * every case where the statement form itself answers `undefined`. CE-274.
 */
export function compileGPUMatchStatement(
  subject: Expression,
  clauses: ReadonlyArray<MatchStatementClause>,
  target: CompileTarget<Expression>
): string | undefined {
  if (
    !clauses.some(
      (c) =>
        gpuNeedsStatements(c.body) ||
        (c.guard !== undefined && gpuNeedsStatements(c.guard))
    )
  )
    return undefined;
  if (BaseCompiler.hasObservableEffect(subject)) return undefined;
  const ce = subject.engine;
  // The statement form reads a condition that is the symbol `True` as the
  // default branch: it emits the value with no test and drops the clauses
  // after it. So only a case that always matches (no test) gets `True`. A
  // case that can fail gets its guard, which is read only for effects and
  // writes, or `False` when the guard is absent or is the symbol `True`.
  const whichArgs = clauses.flatMap((c) => [
    c.test === undefined
      ? ce.True
      : c.guard === undefined || isSymbol(c.guard, 'True')
        ? ce.False
        : c.guard,
    c.body,
  ]);
  if (gpuSelectionIsComplex('Which', whichArgs)) return undefined;
  // The clauses given to the statement form hold the guards, not the
  // comparisons of the subject with the patterns, but the hoisted `if`
  // statement computes those comparisons too. Caller code in a pin
  // (`vars: { Pi: 'nextValue()' }`) must keep its order with the rest of the
  // statement (`gpuHoistKeepsCallerOrder`).
  if (
    !gpuHoistKeepsCallerOrder(
      [...whichArgs, ...clauses.flatMap((c) => c.comparisons)],
      target
    )
  )
    return undefined;
  return compileGPUStatementSelection(
    whichArgs,
    (_, i) => {
      const clause = clauses[Math.floor(i / 2)];
      // An odd position is a case value. A position past the first is
      // evaluated only when the clauses before it did not match, so it is
      // compiled through `compileGPUConditionalArm`: the statement form
      // captures the statements of such a piece into its branch and lets the
      // guard of that function pass them once.
      if (i % 2 === 1)
        return compileGPUConditionalArm('Match', clause.compileBody, target);
      const test = clause.test!;
      return i === 0 ? test() : compileGPUConditionalArm('Match', test, target);
    },
    target
  );
}

/**
 * The pieces of a `Match` that its ternary form places behind a `select`:
 * none when the first case always matches (it has no test), else the body
 * and guard of every clause, and the comparison expressions of every clause
 * after the first (`MatchStatementClause.comparisons`: with
 * `vars: { Pi: 'nextValue()' }`, the pin of `MatchCase(Pin(Pi), 20)` would
 * call `nextValue()` also when an earlier case matches). The comparison of
 * the first clause is computed in every case. `clauses` stops at the first
 * case that always matches (`BaseCompiler.compileMatchTernary`), so the
 * cases after it are not included.
 */
export function gpuMatchSelectedPieces(
  clauses: ReadonlyArray<MatchStatementClause>
): Expression[] {
  if (clauses.length === 0 || clauses[0].test === undefined) return [];
  return clauses.flatMap((c, i) => [
    c.body,
    ...(c.guard === undefined ? [] : [c.guard]),
    ...(i === 0 ? [] : c.comparisons),
  ]);
}

/**
 * Can a statement be placed at the current position on a shader target? A
 * statement sink must exist (`canHoist`) and must not be a
 * conditionally-evaluated arm of a conditional (`conditionalGPUSinks`),
 * out of which a statement would run unconditionally. The captured branch
 * of a conditional's statement form has a sink that is not marked
 * conditional, so it answers yes.
 */
export function gpuCanPlaceStatement(
  target: CompileTarget<Expression>
): boolean {
  return (
    BaseCompiler.canHoist(target) && !conditionalGPUSinks.has(target.hoist!)
  );
}

/**
 * Does `e` — a conditional arm, or a later `Which` condition — repeat a
 * subexpression that a ternary would emit more than once? A boxed
 * expression is a DAG: a function node reached by two or more paths within
 * `e` is written once per path in a ternary arm, which has no statement
 * position to bind it, so a deeply shared node grows the emitted text
 * super-linearly. The statement form gives the arm a statement position
 * where the common-subexpression pass binds such a node once. A leaf (a
 * symbol or a number) is never worth binding; sharing only BETWEEN `e` and
 * something outside it is bound by that outer position already, so the walk
 * is seeded fresh for each arm and counts only sharing within `e`.
 */
export function gpuArmSharesWork(e: Expression): boolean {
  // A function node reached a second time is shared work. A symbol's value
  // is followed on the current path only (`expanding`), removed on the way
  // out, so a value cycle `a := b; b := a` terminates while two separate
  // references to one symbol still meet at its value's root in `seen`.
  const seen = new Set<Expression>();
  const expanding = new Set<string>();
  let shared = false;
  const walk = (x: Expression): void => {
    if (shared) return;
    // A symbol with a value is inlined by the shader targets, its value read
    // in place (as `gpuNeedsStatements` also reads it): two references inline
    // it twice, and sharing inside one inlined value repeats the same way.
    // Walking into the value lets the function-node check below see both. A
    // valueless symbol — a plot variable — is a leaf worth nothing.
    if (isSymbol(x)) {
      const name = x.symbol;
      if (expanding.has(name)) return;
      const value = x.engine._getSymbolValue(name);
      if (value === undefined) return;
      expanding.add(name);
      walk(value);
      expanding.delete(name);
      return;
    }
    if (!isFunction(x)) return;
    if (seen.has(x)) {
      shared = true;
      return;
    }
    seen.add(x);
    for (const op of x.ops) walk(op);
  };
  walk(e);
  return shared;
}

/**
 * Compile a **conditionally-evaluated** operand of a GPU conditional — an
 * `If`/`Which`/`Match` arm, or a `Which` condition past the first —
 * with hoisting forbidden.
 *
 * GLSL's `?:` short-circuits: an arm runs only when it is selected. A lowering
 * that hoists statements (the loop form of `Sum`/`Product`, Tycho item 110)
 * would move that work OUT of the conditional, where it runs unconditionally.
 * That is not merely a cost: `_gpu_rnd_draw(seed, inout uint n)` advances a
 * RUNTIME counter, so a loop stranded ahead of a ternary it never feeds shifts
 * the value of every later draw in the shader — a silent disagreement with the
 * interpreter, which evaluates only the taken branch. Fail closed; the
 * caller falls back to interpretation, exactly as it did before hoisting
 * existed.
 */
export function compileGPUConditionalArm(
  head: string,
  compiled: () => string,
  target: CompileTarget<Expression>
): string {
  const sink = BaseCompiler.canHoist(target) ? target.hoist : undefined;
  if (sink !== undefined && statementCaptureSinks.has(sink)) {
    statementCaptureSinks.delete(sink);
    return compiled();
  }
  const before = sink?.stmts.length ?? 0;
  const alreadyConditional =
    sink !== undefined && conditionalGPUSinks.has(sink);
  if (sink !== undefined) conditionalGPUSinks.add(sink);
  let code: string;
  try {
    code = compiled();
  } finally {
    if (sink !== undefined && !alreadyConditional)
      conditionalGPUSinks.delete(sink);
  }
  if (sink !== undefined && sink.stmts.length > before) {
    // Drop the escaped statements: the throw is recoverable (the engine-level
    // `compile()` catches it to build the interpreter fallback) and a caller
    // reusing the target must not inherit orphaned code.
    sink.stmts.length = before;
    // Marked for the second compilation (`gpuRecompileWithBoundDraws`): when
    // the statement is the binding of a draw, the selection then takes its
    // statement form (`gpuArmDrawsWhileBinding`), where the branch can hold
    // it.
    throw gpuDrawOrderError(
      `Could not compile \`${head}\`: a conditionally-evaluated branch contains a multi-statement ` +
        `construct (a loop-form Sum/Product, or an impure operand bound to a ` +
        `hoisted temporary). Hoisting it out of the branch would run it ` +
        `unconditionally — a shader conditional is an expression, not a ` +
        `statement — which changes the result whenever the branch draws ` +
        `from the random stream.`
    );
  }
  return code;
}

/**
 * Emit a conditional `cond ? whenTrue : whenFalse` for the target language.
 *
 * A conditional that chooses between one and zero is the boolean itself: GLSL
 * converts a `bool` to a float with the scalar constructor (`float(b)`), and
 * specifies that conversion as `true → 1.0` and `false → 0.0`. The cast needs
 * no branch.
 */
export function gpuConditional(
  cond: string,
  whenTrue: string,
  whenFalse: string
): string {
  if (whenTrue === '1.0' && whenFalse === '0.0') return `float(${cond})`;
  return `((${cond}) ? (${whenTrue}) : (${whenFalse}))`;
}

/** True when `expr` is a `Tuple` literal or is tuple-typed. */
function gpuIsTupleShaped(expr: Expression): boolean {
  if (isFunction(expr, 'Tuple')) return true;
  const t = gpuType(expr);
  return typeof t !== 'string' && t.kind === 'tuple';
}

/** Fail closed on a shape the element-wise selection cannot render. */
/**
 * Fail closed when a value arm of a selection is a WRITTEN list or
 * tuple that lowers to a shader ARRAY — a list of points (`vec2[2](…)`) or
 * a list of five or more scalars: GLSL's ternary takes scalars and vectors,
 * and does not select between arrays. Only
 * the written shapes are judged here, before any arm is compiled; every
 * other arm keeps the selection lowering's own, more specific gates.
 */
export function gpuAssertSelectableArms(
  head: string,
  values: ReadonlyArray<Expression | null | undefined>
): void {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (!isFunction(value, 'List') && !isFunction(value, 'Tuple')) continue;
    if (gpuOperandShape(value) !== 'array') continue;
    throw new Error(
      `Could not compile \`${head}\`: the value \`${value.toString()}\` lowers to a shader ARRAY, ` +
        `and a selection (a GLSL ternary) chooses between ` +
        `scalars or vectors only.`
    );
  }
}

function gpuSelectionDecline(reason: string): never {
  throw new Error(`Could not compile \`Which\`: ${reason}`);
}

/**
 * True when a value arm of a selection (`If`, `Which`, the statement form of
 * both) is complex. A complex value lowers to a `vec2` of (re, im) and a real
 * value to a `float`, and a GLSL ternary does not accept
 * a `vec2` arm beside a `float` arm. The real arms are then lifted to
 * `vec2(v, 0.0)` (`gpuSelectionArm`), so every arm has the type of the
 * complex selection.
 */
export function gpuSelectionIsComplex(
  operator: 'If' | 'Which',
  ops: ReadonlyArray<Expression>
): boolean {
  // Only the arms that `liveSelectionArms` keeps count, as in the shared shape
  // analysis (`isComplexValued` of the selection): an arm behind a condition
  // proved false is not emitted, so a dead complex arm must not put a real
  // selection on the complex lane.
  return BaseCompiler.liveSelectionArms({ operator, ops }).some((v) =>
    BaseCompiler.isComplexValued(v)
  );
}

/**
 * True when `value` is a written absence: the symbol `Missing`,
 * or a real NaN literal. On a shader target each of them is a
 * NaN, and as an arm of a selection it takes the shape of the other arms
 * (`gpuAbsentArm`). A bound name or a key of the caller's `vars` spelled
 * `Missing` is a variable and keeps its meaning, as in
 * `BaseCompiler._compileInner`.
 */
function gpuIsWrittenAbsence(
  value: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (isSymbol(value, 'Missing'))
    return (
      target.boundVars?.has(value.symbol) !== true &&
      target.varsKeys?.has(value.symbol) !== true
    );
  return isNumber(value) && Number.isNaN(value.re) && value.im === 0;
}

/**
 * The code of a written absence arm of a selection whose value arms are
 * `arms`: the NaN of the shape the other arms have. In a complex selection it
 * is `vec2(NaN)`; beside a point or a list of 2 to 4 numbers it is a `vecN`
 * NaN (`gpuNaNFor`); otherwise it is a scalar NaN. The interpreter gives
 * `Missing` (or `NaN`) there, and the NaN in each lane is the shader
 * spelling of that value, the same value the else-less `If(c, (x, y))` gives
 * when no arm is selected.
 */
function gpuAbsentArm(
  arms: ReadonlyArray<Expression>,
  complex: boolean,
  target: CompileTarget<Expression>
): string {
  if (complex) return `${gpuVec2()}(${gpuNaN(target)})`;
  const shapeRef =
    arms.find((a) => !gpuIsWrittenAbsence(a, target) && gpuComponentCount(a)) ??
    null;
  return gpuNaNFor(shapeRef, target);
}

/**
 * The code of one value arm of a selection. In a complex selection
 * (`gpuSelectionIsComplex`) a real scalar arm is lifted to `vec2(v, 0.0)`;
 * an arm that is not a scalar (a point, a list), or a scalar whose type
 * cannot be a number (a boolean: `vec2(true, 0.0)` is not a complex value), has
 * no complex form, and the selection fails closed.
 */
export function gpuSelectionArm(
  head: string,
  value: Expression,
  code: string,
  complex: boolean,
  target: CompileTarget<Expression>,
  arms?: ReadonlyArray<Expression>
): string {
  // A written absence arm takes the NaN of the shape of the other arms. A
  // GLSL ternary needs both operands of one type, so a
  // scalar NaN beside a `vec2` arm is not a valid shader.
  if (arms !== undefined && gpuIsWrittenAbsence(value, target))
    return gpuAbsentArm(arms, complex, target);
  if (!complex || BaseCompiler.isComplexValued(value)) return code;
  // An arm whose type is not known (an undeclared uniform `z`) is read as a
  // float, as it is in a selection with no complex arm, and is lifted. An
  // arm whose type cannot be a number (`True`, a comparison) is not.
  const scalar = gpuOperandShape(value) === 'scalar';
  if (!scalar || !couldMatch(value.type.type, 'number'))
    throw new Error(
      `Could not compile \`${head}\`: the value \`${value.toString()}\` is not a ` +
        `${scalar ? 'number' : 'scalar'}, and another value of the ` +
        `selection is complex.`
    );
  return `${gpuVec2()}(${code}, 0.0)`;
}

/**
 * Width (2–4) of a `Which` CONDITION lowered element-wise on a GPU target, or
 * `undefined` when the condition is a plain shader scalar. Throws (D6) for a
 * non-scalar condition with no static `vec2`–`vec4` shape — the case that used
 * to emit garbage such as `u_L == 3.0` behind `success: true`.
 */
function gpuSelectionConditionWidth(c: Expression): 2 | 3 | 4 | undefined {
  // `True` marks the default clause; `False` is a scalar (never-taken) mask.
  if (isSymbol(c, 'True') || isSymbol(c, 'False')) return undefined;

  if (isFunction(c, 'List')) {
    for (const cell of c.ops) {
      // A cell that is provably a SCALAR boolean lowers as its own scalar
      // condition inside the `bvecN`/`vecN<bool>` constructor — a literal
      // `True`/`False`, or a scalar comparison such as `x < 0`. Anything
      // else declines: the interpreter selects only when every cell
      // evaluates to a boolean, and a non-scalar cell has no single slot.
      if (isSymbol(cell, 'True') || isSymbol(cell, 'False')) continue;
      if (
        BaseCompiler.isBooleanValued(cell) &&
        !BaseCompiler.isComplexValued(cell) &&
        !BaseCompiler.isNonScalarShape(cell)
      )
        continue;
      gpuSelectionDecline(
        `a literal list condition needs provably boolean scalar cells ` +
          `(\`True\`/\`False\` or a scalar comparison); the cell ` +
          `\`${cell.toString()}\` is not one, and the interpreter only ` +
          `selects when every cell evaluates to a boolean.`
      );
    }
    const n = c.nops;
    if (n < 2 || n > 4)
      gpuSelectionDecline(
        `a ${n}-element list condition has no GPU vector lowering (only ` +
          `vec2–vec4 are shader values).`
      );
    return n as 2 | 3 | 4;
  }

  const h = c.operator;
  const ops: ReadonlyArray<Expression> = isFunction(c) ? c.ops : [];
  if (isRelationalOperator(h)) {
    let width: 2 | 3 | 4 | undefined = undefined;
    for (const op of ops) {
      // A complex value is ALSO lowered as a `vec2`, so it must be recognized
      // BEFORE the width or it masquerades as a 2-cell collection.
      if (BaseCompiler.isComplexValued(op))
        gpuSelectionDecline(
          `a complex-valued operand (\`${op.toString()}\`) in an element-wise ` +
            `condition is lowered as a \`vec2\` of (re, im), which has no cell ` +
            `meaning in a selection.`
        );
      if (gpuIsTupleShaped(op))
        gpuSelectionDecline(
          `a tuple operand (\`${op.toString()}\`) in an element-wise condition ` +
            `has no element-wise reading — the interpreter binds a tuple ` +
            `atomically.`
        );
      const w = gpuComponentCount(op);
      if (w === undefined) {
        if (BaseCompiler.isNonScalarShape(op))
          gpuSelectionDecline(
            `the condition operand \`${op.toString()}\` is not a shader scalar ` +
              `and has no static vec2–vec4 shape (an unknown-length list, a ` +
              `matrix, or a 5+-element list).`
          );
        continue;
      }
      if (width !== undefined && width !== w)
        gpuSelectionDecline(
          `an element-wise condition mixes vec${width} and vec${w} operands.`
        );
      width = w;
    }
    if (width === undefined) return undefined;
    if ((h === 'Equal' || h === 'NotEqual') && ops.length > 2)
      gpuSelectionDecline(
        `an n-ary \`${h}\` over a collection operand has no faithful ` +
          `element-wise lowering — the interpreter's n-ary form switches shape ` +
          `on how many operands are collections at run time, so no pairwise ` +
          `conjunction matches it.`
      );
    if (GPU_COMPARE_GLSL[h] === undefined)
      gpuSelectionDecline(
        `the relation \`${h}\` has no componentwise shader form.`
      );
    return width;
  }

  if (h === 'And' || h === 'Or' || h === 'Not') {
    let width: 2 | 3 | 4 | undefined = undefined;
    for (const op of ops) {
      const w = gpuSelectionConditionWidth(op);
      if (w === undefined) continue;
      if (width !== undefined && width !== w)
        gpuSelectionDecline(
          `an element-wise \`${h}\` mixes vec${width} and vec${w} operands.`
        );
      width = w;
    }
    return width;
  }

  // A complex-valued condition is a scalar-side value (its `vec2` is (re, im),
  // not two cells): left exactly as it is today.
  if (BaseCompiler.isComplexValued(c)) return undefined;
  // The RAW width, not `gpuComponentCount`: a mask is a `bvecN` / `vec<bool>`,
  // whose cells are booleans, so the shader-float element test that reading
  // applies would reject the very shape this slot exists for. The elements are
  // checked here instead, against `boolean` rather than against a float.
  const w = BaseCompiler.vectorComponentCount(c);
  if (w !== undefined) {
    // A value used DIRECTLY as a boolean-vector condition (e.g. a `vars`-mapped
    // `bvec` uniform). Anything else with a vector shape is a numeric vector,
    // which is not a condition.
    if (!c.type.matches('indexed_collection<boolean>'))
      gpuSelectionDecline(
        `the condition \`${c.toString()}\` is a collection of ` +
          `\`${c.type.toString()}\`, not of booleans.`
      );
    return w;
  }
  if (BaseCompiler.isNonScalarShape(c))
    gpuSelectionDecline(
      `the condition \`${c.toString()}\` is not a shader scalar and has no ` +
        `static vec2–vec4 shape.`
    );
  return undefined;
}

/** Conjoin boolean-vector masks componentwise. */
function gpuMaskAnd(
  masks: ReadonlyArray<string>,
  n: 2 | 3 | 4
): string {
  if (masks.length === 1) return masks[0];
  // GLSL has no componentwise `&&`: convert to 0/1 floats, multiply, and let
  // the `bvecN` constructor read nonzero back as `true`.
  const f = gpuFVec(n);
  return `${gpuBVec(n)}(${masks.map((m) => `${f}(${m})`).join(' * ')})`;
}

/** Disjoin boolean-vector masks componentwise. */
function gpuMaskOr(
  masks: ReadonlyArray<string>,
  n: 2 | 3 | 4
): string {
  if (masks.length === 1) return masks[0];
  const f = gpuFVec(n);
  return `${gpuBVec(n)}(${masks.map((m) => `${f}(${m})`).join(' + ')})`;
}

/**
 * Emit a `bvecN` / `vecN<bool>` mask for one `Which` condition.
 *
 * Boolean vectors — NOT float masks: a float `mix(a, b, t)` computes
 * `a·(1−t) + b·t`, so a NaN in the unselected operand poisons the result
 * (`mix(NaN, x, 1.0)` is NaN). The `genBType` `mix` overload
 * is a true per-component SELECTION and are therefore NaN-safe.
 */
function gpuSelectionMask(
  c: Expression,
  n: 2 | 3 | 4,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const bvec = gpuBVec(n);
  const fvec = gpuFVec(n);

  if (isSymbol(c, 'True')) return `${bvec}(true)`;
  if (isSymbol(c, 'False')) return `${bvec}(false)`;

  if (isFunction(c, 'List'))
    return `${bvec}(${c.ops
      .map((x) =>
        isSymbol(x, 'True')
          ? 'true'
          : isSymbol(x, 'False')
            ? 'false'
            : // A provably-boolean scalar cell (validated by
              // `gpuSelectionConditionWidth`) compiles as its own scalar
              // condition inside the constructor: `bvec2((x < 0.0), true)`.
              compile(x)
      )
      .join(', ')})`;

  const h = c.operator;
  const ops: ReadonlyArray<Expression> = isFunction(c) ? c.ops : [];
  if (isRelationalOperator(h)) {
    // `isRelationalOperator` covers the FULL inequality set (`Precedes`,
    // `Approx`, `Tilde`, …), not just the six componentwise comparators. A
    // scalar-operand relation skips the width pass's compare-form check, so
    // guard again at the emission site — indexing past the map would splice
    // the literal string `undefined` into the shader source.
    const cmp = GPU_COMPARE_GLSL[h];
    if (cmp === undefined)
      gpuSelectionDecline(
        `the relation \`${h}\` has no componentwise shader form.`
      );
    const operand = (op: Expression, once: boolean): string => {
      const code = once ? gpuOperandOnce(h, op, compile, target) : compile(op);
      return gpuComponentCount(op) === undefined ? `${fvec}(${code})` : code;
    };
    // A chained ordering `a < m < b` conjoins the successive pairwise masks,
    // splicing each MIDDLE operand (indices 1..n-2) into two of them. An
    // IMPURE (Random-family) operand must still be drawn exactly once —
    // `_gpu_rnd_draw` advances a runtime counter, so a repeated splice draws a
    // DIFFERENT value there AND shifts every later draw in the shader. Bind
    // those to a hoisted temporary (or decline where there is no statement
    // sink). Pure operands are safe to duplicate and stay inline.
    //
    // A hoisted temporary runs BEFORE the mask expression, so binding only the
    // middles would draw a middle ahead of an impure ENDPOINT left inline —
    // reversing the interpreter's argument order. Once a middle is bound, route
    // EVERY impure operand through `gpuOperandOnce`, in argument order (the
    // hoisted statements are emitted in that order).
    const impureMiddle = ops.some(
      (op, i) => i >= 1 && i <= ops.length - 2 && op.isPure === false
    );
    const codes = ops.map((op) =>
      operand(op, impureMiddle && op.isPure === false)
    );
    const masks: string[] = [];
    for (let i = 0; i < codes.length - 1; i++) {
      masks.push(`${cmp}(${codes[i]}, ${codes[i + 1]})`);
    }
    return gpuMaskAnd(masks, n);
  }

  if (h === 'And' || h === 'Or' || h === 'Not') {
    const masks = ops.map((op) => gpuSelectionMask(op, n, compile, target));
    if (h === 'Not') {
      if (masks.length !== 1)
        throw new Error('Could not compile `Not`: expected one argument');
      return `not(${masks[0]})`;
    }
    return h === 'And'
      ? gpuMaskAnd(masks, n)
      : gpuMaskOr(masks, n);
  }

  // A boolean-vector value used directly as the condition, or a scalar boolean
  // splat across the selection width. The RAW width again, for the reason
  // `gpuSelectionConditionWidth` states: this slot holds a `bvecN`, and that
  // width has already been admitted there as a collection of booleans.
  if (
    !BaseCompiler.isComplexValued(c) &&
    BaseCompiler.vectorComponentCount(c) !== undefined
  )
    return compile(c);
  return `${bvec}(${compile(c)})`;
}

/**
 * Lower a `Which`/`If` whose condition may be an indexed collection to the GPU
 * ELEMENT-WISE selection form (`np.select` semantics — R1–R4 of
 * `docs/BROADCAST-MODEL.md`). Clauses arrive in
 * `Which` shape (condition, arm, condition, arm, …); the base compiler
 * normalizes `If(c, t, f)` to `[c, t, True, f]`.
 *
 * Only STATICALLY SHAPED conditions lower: every non-scalar condition must have
 * a `vec2`–`vec4` shape, and all of them the same one. Each condition becomes a
 * boolean vector (`bvecN`), and the clauses are folded
 * right-to-left with GLSL `mix` — first match wins (R1), with
 * `vecN(NaN)` as the no-match value (R4). Returns `null` when every condition is
 * provably scalar, so the ordinary scalar `Which`/`If` emission is untouched;
 * throws (D6) on any shape the shader languages cannot render.
 *
 * Documented divergences from the interpreter (a shader cannot throw —
 * CO-P2-24, the same reason the `absence` capability at `createTarget` declares
 * no `isAbsent`):
 *
 * - R2: a shader evaluates EVERY condition and EVERY arm. This goes BEYOND
 *   what R2 licenses (R2 promises an arm is evaluated only if selection
 *   reaches it; it only permits computing unselected CELLS of a selected
 *   arm) — a genuine GPU-specific divergence, accepted because the domain is
 *   pure and total: no arm can throw, no draw count is observable, so only
 *   the cells selection keeps are visible in the result.
 * - R4′: an absent (NaN) condition cell follows IEEE comparison semantics
 *   rather than the interpreter's consumed error cell: the orderings and
 *   `equal` answer `false` (the position falls through to LATER clauses),
 *   but `notEqual` answers `true` for a NaN cell (the clause SELECTS it) and
 *   `Not` inverts. Absence is not detectable here — `isnan`, and under
 *   aggressive fast-math even the NaN-comparison results themselves, are
 *   unreliable (the same limitation that omits `absence.isAbsent`).
 * - A non-boolean condition VALUE at run time cannot throw; only statically
 *   visible non-boolean conditions are declined here.
 */
export function compileGPUSelection(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | null {
  let n: 2 | 3 | 4 | undefined = undefined;
  for (let i = 0; i < args.length; i += 2) {
    const w = gpuSelectionConditionWidth(args[i]);
    if (w === undefined) continue;
    if (n !== undefined && n !== w)
      gpuSelectionDecline(
        `the conditions of an element-wise selection mix vec${n} and vec${w}.`
      );
    n = w;
  }
  // Every condition is a scalar: leave the ordinary emission alone.
  if (n === undefined) return null;

  const width = n;
  const fvec = gpuFVec(width);

  const armCode = (arm: Expression): string => {
    if (BaseCompiler.isComplexValued(arm))
      gpuSelectionDecline(
        `an element-wise selection cannot have a complex-valued arm ` +
          `(\`${arm.toString()}\`) — a compiled complex value is a \`vec2\` of ` +
          `(re, im), which has no cell convention inside a selection.`
      );
    if (gpuIsTupleShaped(arm))
      gpuSelectionDecline(
        `an element-wise selection cannot have a tuple arm ` +
          `(\`${arm.toString()}\`) — a lifted point would be a list of points, ` +
          `which is not a GPU value.`
      );
    // A boolean arm has no GPU rendering: the selection's value operands are
    // one numeric vector type, and a `bvecN` (or a scalar `true`/`false`,
    // which is not even a float) spliced into `mix`/`select` is invalid
    // shader source. (The JS target returns boolean cells; a GPU consumer
    // should spell the mask numerically — 1 and 0 arms.)
    if (
      isSymbol(arm, 'True') ||
      isSymbol(arm, 'False') ||
      arm.type.matches('boolean') ||
      arm.type.matches('indexed_collection<boolean>')
    )
      gpuSelectionDecline(
        `an element-wise selection cannot have a boolean-valued arm ` +
          `(\`${arm.toString()}\`) — a GPU selection produces one numeric ` +
          `vector, and there is no boolean-cell convention. Use numeric arms ` +
          `(e.g. 1 and 0) instead.`
      );
    const w = gpuComponentCount(arm);
    if (w === width) return compile(arm);
    if (w === undefined && !BaseCompiler.isNonScalarShape(arm))
      return `${fvec}(${compile(arm)})`;
    gpuSelectionDecline(
      `the arm \`${arm.toString()}\` does not fit the vec${width} shape of the ` +
        `element-wise conditions (the interpreter answers ` +
        `\`incompatible-dimensions\`).`
    );
  };

  // First match wins: fold the clauses from LAST to FIRST over the no-match
  // vector, so an earlier clause's mask overrides a later one.
  let acc = `${fvec}(${gpuNaN(target)})`;
  for (let i = args.length - 2; i >= 0; i -= 2) {
    const code = armCode(args[i + 1]);
    // A `True` condition is the default clause: everything built for the later
    // (now unreachable) clauses is replaced.
    if (isSymbol(args[i], 'True')) {
      acc = code;
      continue;
    }
    const mask = gpuSelectionMask(args[i], width, compile, target);
    acc = `mix(${acc}, ${code}, ${mask})`;
  }
  return acc;
}
