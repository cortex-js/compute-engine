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
  GPU_COMPARE_WGSL,
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
 * - a conditional ARM, which both languages lower to an EXPRESSION (a `?:`
 *   ternary in GLSL, `select(…)` in WGSL) — `((0.0 < t) ? (return t) : …)`;
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
 * Fail closed when `code`, produced by an **expression-only** route, is
 * not a single expression of the target language.
 *
 * `compileToSource()` answers with a bare expression string, and each
 * `compileShader()` body statement is spliced into an assignment RHS
 * (`<variable> = <code>;`). Neither position accepts a statement, and neither
 * GLSL nor WGSL has an expression-level block or immediately-invoked function
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
 * statement — an assignment (WGSL only) or a declaration (both languages).
 *
 * `gpuAssertExpressionOnly` scans the emitted source for the two signals a
 * statement leaves there — a newline and a `return` token — but these two
 * shapes leave neither. Both are single-line emissions:
 *
 * - `Assign(s, x)` emits `s = x` on both targets. The languages then diverge.
 *   In GLSL assignment is an OPERATOR, so `fragColor = s = x;` is valid source
 *   and the emission is honest. In WGSL assignment is a STATEMENT, so the same
 *   emission produces `output.fragColor = s = input.x;` — source no WGSL
 *   compiler accepts, behind a reported success.
 * - A root `Declare(s, 'number', x)` emits `float s` / `var s: f32` on BOTH
 *   targets — a declaration is a statement in both languages, and the emission
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
  // GLSL assignment is an operator, so only WGSL declines an assignment body.
  if (head === 'Assign') {
    if (language !== 'wgsl') return;
    throw new Error(
      `Could not compile ${compileSubject(subject)}: this route emits a single WGSL EXPRESSION, but the body is ` +
        `an assignment. WGSL assignment is a STATEMENT (unlike GLSL, where it ` +
        `is an operator), so the emitted \`… = <target> = <value>\` is not ` +
        `valid source. Compile a statement body with compile() instead — that ` +
        `route emits a function body.`
    );
  }
  throw new Error(
    `Could not compile ${compileSubject(subject)}: this route emits a single ${lang} EXPRESSION, but the body ` +
      `is a declaration. A declaration is a STATEMENT in ${lang}, so the ` +
      `emitted \`${language === 'wgsl' ? 'var s: f32' : 'float s'}\`-shaped ` +
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
    // not read here. A selection whose clauses draw takes the statement form
    // only on WGSL (`gpuArmIsCostlyForSelect`); on GLSL such an arm keeps
    // the ternary, which declines the hoisted temporary in a conditional
    // arm.
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
  if (gpuWritesOutside(evaluated, new Set(args))) return undefined;
  const isWGSL = target.language === 'wgsl';
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
      ? gpuVecType(2, isWGSL)
      : gpuTypeOfValue(a, isWGSL)
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
  // condition is evaluated unconditionally and carries no guard.
  const capture = (
    f: () => string,
    lazy: boolean
  ): { code: string; stmts: string[] } => {
    const before = sink.stmts.length;
    if (lazy) statementCaptureSinks.add(sink);
    let code: string;
    try {
      code = f();
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
    ? `${gpuVec2(target)}(${gpuNaN(target)})`
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
    isWGSL ? `var ${tv}: ${type};` : `${type} ${tv};`,
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
 * The operators whose shader lowering is a helper with a loop or a long
 * series (`_gpu_hurwitz_zeta`, `_gpu_lerch_phi`, `_gpu_besselJ`, …).
 */
const GPU_COSTLY_HELPER_HEADS = new Set([
  'Zeta',
  'HurwitzZeta',
  'LerchPhi',
  'PolyLog',
  'PolyGamma',
  'Digamma',
  'Trigamma',
  'BesselJ',
  'FresnelC',
  'FresnelS',
  'GCD',
  'LCM',
  'Mandelbrot',
  'Julia',
]);

/**
 * Is a WGSL conditional arm better written as a branch of an `if`
 * statement than as an operand of `select`?
 *
 * WGSL has no `?:` operator, and `select(f, t, c)` is a function call: it
 * computes both `f` and `t`, whichever one `c` selects. For an arm that calls
 * a user function, or an operator whose lowering is a helper with a loop
 * (`GPU_COSTLY_HELPER_HEADS`), that is the cost of the arm on every
 * invocation, where the interpreter and GLSL's `?:` compute only the arm that
 * is taken. Tycho measured `{x<0 : g(x), 0}` with
 * `g(x) = Σ_{i=1}^{300} cos(ix)`: 2.27 ms on WebGL2, 5.05 ms on WebGPU with
 * `select`, 2.36 ms with an `if`. So such an arm takes the statement form of
 * the conditional (`compileGPUStatementSelection`), as an arm that needs
 * statements already does. GLSL keeps the ternary. CE-513 (Tycho row 458).
 *
 * An arm that draws a random value takes the statement form too: `select`
 * would draw in the arm that is not taken, which shifts every later draw
 * (`gpuAssertNoEagerDraw`). Where the statement form is refused, that check
 * declines the selection (Tycho row 466).
 *
 * A symbol with a value is read through its value, as the shader targets
 * inline it (see `gpuNeedsStatements`).
 */
export function gpuArmIsCostlyForSelect(
  e: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (target.language !== 'wgsl') return false;
  const seen = new Set<Expression>();
  const expanding = new Set<string>();
  const walk = (x: Expression): boolean => {
    if (isSymbol(x)) {
      const name = x.symbol;
      if (expanding.has(name)) return false;
      const value = x.engine._getSymbolValue(name);
      if (value === undefined) return false;
      expanding.add(name);
      const found = walk(value);
      expanding.delete(name);
      return found;
    }
    if (!isFunction(x) || seen.has(x)) return false;
    seen.add(x);
    if (GPU_COSTLY_HELPER_HEADS.has(x.operator)) return true;
    // A draw: the head itself is impure (its operands are not the cause).
    if (
      BaseCompiler.foldValueImpure(x) &&
      !x.ops.some((op) => BaseCompiler.foldValueImpure(op))
    )
      return true;
    // A call of a user function (`g := x ↦ …`, or a symbol whose value is a
    // function), which the shader targets emit as a separate `_fn_…`
    // function.
    const def = x.engine.lookupDefinition(x.operator);
    if (
      isValueDef(def) ||
      (isOperatorDef(def) && def.operator.isUserFunctionDefinition)
    )
      return true;
    return x.ops.some(walk);
  };
  return walk(e);
}

/**
 * Compile a **conditionally-evaluated** operand of a GPU conditional — an
 * `If`/`When`/`Which`/`Match` arm, or a `Which` condition past the first —
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
 *
 * (WGSL's `select` is a function, so both operands ARE evaluated there — but
 * the emission is shared and the counter-ordering hazard is the same, so the
 * guard is not language-gated.)
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
 * GLSL has the ternary operator; WGSL does not and uses
 * `select(false_value, true_value, condition)` instead.
 *
 * A conditional that chooses between one and zero is the boolean itself: both
 * languages convert a `bool` to a float with the scalar constructor
 * (`float(b)` in GLSL, `f32(b)` in WGSL), and both specify that conversion as
 * `true → 1.0` and `false → 0.0`. The cast needs no branch.
 */
export function gpuConditional(
  cond: string,
  whenTrue: string,
  whenFalse: string,
  target?: CompileTarget<Expression>
): string {
  const isWGSL = target?.language === 'wgsl';
  if (whenTrue === '1.0' && whenFalse === '0.0')
    return `${isWGSL ? 'f32' : 'float'}(${cond})`;
  if (isWGSL) return `select(${whenFalse}, ${whenTrue}, ${cond})`;
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
 * a list of five or more scalars: GLSL's ternary and WGSL's `select` take
 * scalars and vectors, and neither language selects between arrays. Only
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
        `and a selection (a GLSL ternary, a WGSL \`select\`) chooses between ` +
        `scalars or vectors only.`
    );
  }
}

/**
 * Fail closed on WGSL when an arm of a selection draws a random value.
 */
export function gpuAssertNoEagerDraw(
  head: string,
  lazyOperands: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  // WGSL has no `?:` operator, and `select(f, t, c)` is a function call that
  // computes both `f` and `t`. A random draw (`_gpu_rnd_draw`) in an arm that
  // is not taken still advances the runtime counter of the random stream, so
  // every later draw in the shader takes a different value than in the
  // interpreter, which evaluates only the taken arm. GLSL's `?:` evaluates
  // only the selected arm. An arm that draws, directly or through the value
  // of a symbol (`BaseCompiler.foldValueImpure`), fails closed on WGSL; the
  // caller then falls back to interpretation.
  if (target.language !== 'wgsl') return;
  // A branch with a `Return` fails closed with the message of the `Return`
  // gates (`gpuAssertReturnPlacement`), which says more.
  const containsReturn = (e: Expression): boolean =>
    isFunction(e) &&
    e.operator !== 'Function' &&
    (e.operator === 'Return' || e.ops.some(containsReturn));
  if (lazyOperands.some(containsReturn)) return;
  if (lazyOperands.some((e) => BaseCompiler.foldValueImpure(e)))
    throw gpuDrawOrderError(
      `Could not compile \`${head}\`: a branch draws a random value, and the ` +
        `WGSL selection \`select(…)\` computes every branch, so a branch ` +
        `that is not taken would still advance the random stream and shift ` +
        `every later draw in the shader.`
    );
}

/**
 * Fail closed on WGSL when an operand of a selection (`If`, `When`, `Which`)
 * assigns a variable. The selection lowers to `select(…)`, a function call,
 * so its operands are expressions, and a WGSL assignment is a statement:
 * `If(x > 0, t ≔ 1, t ≔ 2)` gave `select(t = 2.0, t = 1.0, 0.0 < x)`, which
 * no WGSL compiler accepts (and `select` evaluates both operands). GLSL
 * keeps its ternary, where an assignment is an expression and only the
 * selected arm runs. An assignment inside a function literal is the body
 * of that function, not an operand of the selection. Called where the
 * selection is written as `select(…)`: the statement form
 * (`compileGPUStatementSelection`) writes a block arm that assigns its own
 * locals as statements, which is valid. A selection in statement position
 * (a statement of a block that is not its value, a loop body) does not
 * reach this function: the block statement dispatcher writes it as an `if`
 * statement (`BaseCompiler.shaderSelectionStatement`).
 */
export function gpuAssertNoAssignmentOperand(
  head: string,
  operands: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  if (target.language !== 'wgsl') return;
  // A block operand is not examined: it has no expression form, and it
  // fails closed with its own message where it is compiled. A selection
  // with a `Return` in a branch fails closed with the message of the
  // `Return` gates (`gpuAssertReturnPlacement`), which says more.
  const contains =
    (head: string) =>
    (e: Expression): boolean =>
      isFunction(e) &&
      e.operator !== 'Function' &&
      e.operator !== 'Block' &&
      (e.operator === head || e.ops.some(contains(head)));
  if (operands.some(contains('Return'))) return;
  if (operands.some(contains('Assign')))
    throw new Error(
      `Could not compile \`${head}\`: a branch assigns a variable, and the ` +
        `WGSL selection \`select(…)\` takes expressions, where an assignment ` +
        `is a statement in WGSL. Such a selection compiles as an \`if\` ` +
        `statement only where its value is discarded: a statement of a ` +
        `block that is not the block's value, or a loop body.`
    );
}

function gpuSelectionDecline(reason: string): never {
  throw new Error(`Could not compile \`Which\`: ${reason}`);
}

/**
 * True when a value arm of a selection (`If`, `Which`, the statement form of
 * both) is complex. A complex value lowers to a `vec2` of (re, im) and a real
 * value to a `float`, and neither a GLSL ternary nor a WGSL `select` accepts
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
 * True when `value` is a written absence: the symbol `Missing` or
 * `Undefined`, or a real NaN literal. On a shader target each of them is a
 * NaN, and as an arm of a selection it takes the shape of the other arms
 * (`gpuAbsentArm`). A bound name or a key of the caller's `vars` spelled
 * `Missing` is a variable and keeps its meaning, as in
 * `BaseCompiler._compileInner`.
 */
function gpuIsWrittenAbsence(
  value: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (isSymbol(value, 'Missing') || isSymbol(value, 'Undefined'))
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
 * spelling of that value, the same value the else-less `If(c, (x, y))` and
 * `When((x, y), c)` give when no arm is selected.
 */
function gpuAbsentArm(
  arms: ReadonlyArray<Expression>,
  complex: boolean,
  target: CompileTarget<Expression>
): string {
  if (complex) return `${gpuVec2(target)}(${gpuNaN(target)})`;
  const shapeRef =
    arms.find((a) => !gpuIsWrittenAbsence(a, target) && gpuComponentCount(a)) ??
    null;
  return gpuNaNFor(shapeRef, target);
}

/**
 * The code of one value arm of a selection. In a complex selection
 * (`gpuSelectionIsComplex`) a real scalar arm is lifted to `vec2(v, 0.0)`;
 * an arm that is not a scalar (a point, a list), or a scalar whose type
 * cannot be a number (a boolean: `vec2f(true, 0.0)` is not valid WGSL), has
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
  // GLSL ternary and a WGSL `select` need both operands of one type, so a
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
  return `${gpuVec2(target)}(${code}, 0.0)`;
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
  n: 2 | 3 | 4,
  target: CompileTarget<Expression>
): string {
  if (masks.length === 1) return masks[0];
  if (target.language === 'wgsl') return `(${masks.join(' & ')})`;
  // GLSL has no componentwise `&&`: convert to 0/1 floats, multiply, and let
  // the `bvecN` constructor read nonzero back as `true`.
  const f = gpuFVec(n, target);
  return `${gpuBVec(n, target)}(${masks.map((m) => `${f}(${m})`).join(' * ')})`;
}

/** Disjoin boolean-vector masks componentwise. */
function gpuMaskOr(
  masks: ReadonlyArray<string>,
  n: 2 | 3 | 4,
  target: CompileTarget<Expression>
): string {
  if (masks.length === 1) return masks[0];
  if (target.language === 'wgsl') return `(${masks.join(' | ')})`;
  const f = gpuFVec(n, target);
  return `${gpuBVec(n, target)}(${masks.map((m) => `${f}(${m})`).join(' + ')})`;
}

/**
 * Emit a `bvecN` / `vecN<bool>` mask for one `Which` condition.
 *
 * Boolean vectors — NOT float masks: a float `mix(a, b, t)` computes
 * `a·(1−t) + b·t`, so a NaN in the unselected operand poisons the result
 * (`mix(NaN, x, 1.0)` is NaN). The `genBType` `mix` / WGSL `select` overloads
 * are true per-component SELECTION and are therefore NaN-safe.
 */
function gpuSelectionMask(
  c: Expression,
  n: 2 | 3 | 4,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const bvec = gpuBVec(n, target);
  const fvec = gpuFVec(n, target);

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
    const cmp =
      target.language === 'wgsl' ? GPU_COMPARE_WGSL[h] : GPU_COMPARE_GLSL[h];
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
      masks.push(
        target.language === 'wgsl'
          ? `((${codes[i]}) ${cmp} (${codes[i + 1]}))`
          : `${cmp}(${codes[i]}, ${codes[i + 1]})`
      );
    }
    return gpuMaskAnd(masks, n, target);
  }

  if (h === 'And' || h === 'Or' || h === 'Not') {
    const masks = ops.map((op) => gpuSelectionMask(op, n, compile, target));
    if (h === 'Not') {
      if (masks.length !== 1)
        throw new Error('Could not compile `Not`: expected one argument');
      return target.language === 'wgsl'
        ? `(!(${masks[0]}))`
        : `not(${masks[0]})`;
    }
    return h === 'And'
      ? gpuMaskAnd(masks, n, target)
      : gpuMaskOr(masks, n, target);
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
 * boolean vector (`bvecN` / `vecN<bool>`), and the clauses are folded
 * right-to-left with GLSL `mix` / WGSL `select` — first match wins (R1), with
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
  const fvec = gpuFVec(width, target);

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
    acc =
      target.language === 'wgsl'
        ? `select(${acc}, ${code}, ${mask})`
        : `mix(${acc}, ${code}, ${mask})`;
  }
  return acc;
}
