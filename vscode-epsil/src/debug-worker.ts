// Debuggee worker for the Epsil debugger.
//
// Runs the program (engine included — this bundle embeds it from repo
// source) on a worker thread so it can PAUSE SYNCHRONOUSLY: a pause point
// blocks inside `Atomics.wait`, while the DAP adapter on the main thread
// keeps serving the protocol. While blocked, the worker still services
// inspection commands (variables, watches, stack) by polling its command
// port with `receiveMessageOnPort` from the pause loop — the engine is live,
// so watches and variable expansion run against the real paused scope.
//
// Pause points:
//  - between top-level statements (the executeEpsil-mirror loop below);
//  - before every source-mapped statement inside `Block` bodies — function
//    bodies, loop bodies, `if` branches — via the engine's debug statement
//    hook (`src/common/debug-hook.ts`), which this worker installs.
//
// A statement with no hook fires (a pure computation) cannot be paused —
// only terminated, or bounded with `statementTimeLimit`.

import { parentPort, workerData, receiveMessageOnPort } from 'node:worker_threads';
import { basename } from 'node:path';

import {
  ComputeEngine,
  executeEpsil,
  parseEpsil,
  serializeEpsil,
} from '../../src/epsil.js';
import {
  isFunction,
  isSymbol,
  type BoxedDefinition,
  type BoxedExpression,
} from '../../src/compute-engine.js';
import {
  setDebugStatementHook,
  setDebugStatementResultHook,
} from '../../src/common/debug-hook.js';
import { typeToString } from '../../src/common/type/serialize.js';
import type { MathJsonExpression } from '../../src/math-json/types.js';
import {
  operands,
  operator,
  stringValue,
  symbol,
} from '../../src/math-json/utils.js';
import { FatalParsingError } from '../../src/epsil/diagnostics.js';
import { formatDiagnostics } from '../../src/cli/format.js';

import {
  GLOBALS_REF,
  LOCALS_REF,
  type BreakpointSpec,
  type FrameInfo,
  type VariableInfo,
  type WorkerCommand,
  type WorkerConfig,
  type WorkerEvent,
} from './debug-protocol.js';

const INLINE_VALUE_MAX = 200;
const CONSOLE_VALUE_MAX = 10_000;

const config = workerData as WorkerConfig;
const ctrl = new Int32Array(config.controlBuffer);
const cmdPort = config.commandPort;

function post(event: WorkerEvent): void {
  parentPort!.postMessage(event);
}

/** Thrown to unwind evaluation on a terminate command. */
class TerminatedError extends Error {}

// ── Session state ─────────────────────────────────────────────────────────

const engine = new ComputeEngine();
const parseLatex = (latex: string): MathJsonExpression =>
  engine.parse(latex).json;

const sourceText = config.sourceText;
const lineStarts: number[] = [0];
for (let i = 0; i < sourceText.length; i++)
  if (sourceText.charCodeAt(i) === 10) lineStarts.push(i + 1);

function lineOfOffset(offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function offsetsOf(node: unknown): [number, number] | undefined {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
    : undefined;
}

interface StatementInfo {
  json: MathJsonExpression;
  line: number;
}

let statements: StatementInfo[] = [];

/** Baseline context depth: hook depths are measured relative to this. */
let baseDepth = 0;

// Debug state, mutated by commands.
const breakpoints = new Map<number, BreakpointSpec>();
/** Break when a statement evaluates to an `["Error", …]` value. */
let breakOnErrorValues = false;
let pauseRequested = false;
let started = false;
/** The scope current when the run started: bindings above it are locals of
 * the paused position; it and its ancestors (to the system scope) are the
 * session globals. */
let baselineScope: unknown;
/** Armed stepping: stop at the next pause point satisfying the mode. */
let stepMode: 'in' | 'over' | 'out' | 'top' | undefined;
let stepDepth = 0;
/** True while servicing an inspection command (suppresses the hook). */
let servicing = false;
/** Top-level statement index (for the bottom stack frame). */
let topIndex = 0;
/** Last hook statement seen per relative depth — the live call-stack
 * positions. `depth` is `contextStack.length - baseDepth` at fire time. */
let hookStack: Array<{ depth: number; line: number; offset: number }> = [];

/** Source span of every function literal, for naming stack frames: a paused
 * offset's innermost containing span names its frame. */
let functionSpans: Array<{ name: string; start: number; end: number }> = [];

// ── Variables (handles live only while paused) ────────────────────────────

let nextRef = LOCALS_REF + 1;
const handleTable = new Map<number, BoxedExpression>();

function resetHandles(): void {
  handleTable.clear();
  nextRef = LOCALS_REF + 1;
}

function referenceFor(expr: BoxedExpression): number {
  if (!isFunction(expr) || expr.nops === 0) return 0;
  const ref = nextRef++;
  handleTable.set(ref, expr);
  return ref;
}

function render(expr: BoxedExpression, maxLength: number): string {
  let text: string;
  try {
    text = serializeEpsil(expr.json);
  } catch {
    text = expr.toString();
  }
  if (maxLength <= INLINE_VALUE_MAX) text = text.replace(/\s+/g, ' ');
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`;
  return text;
}

/**
 * User bindings on the scope chain, innermost winning, split at the
 * baseline (the scope current when the run started):
 *  - `'locals'`: scopes ABOVE the baseline — the paused body's locals,
 *    parameters, loop variables. Empty at a top-level pause.
 *  - `'globals'`: the baseline scope up to — excluding — the system scope:
 *    the session's own declarations.
 *  - `'all'`: the whole chain (hover/watch name lookup).
 */
function collectBindings(
  kind: 'locals' | 'globals' | 'all'
): Array<[string, BoxedDefinition]> {
  const systemScope = engine.contextStack[0]?.lexicalScope;
  const seen = new Map<string, BoxedDefinition>();
  let scope: typeof systemScope | null =
    kind === 'globals'
      ? (baselineScope as typeof systemScope)
      : engine.context.lexicalScope;
  while (scope !== null && scope !== undefined && scope !== systemScope) {
    if (kind === 'locals' && scope === baselineScope) break;
    for (const [name, def] of scope.bindings)
      if (!seen.has(name)) seen.set(name, def);
    scope = scope.parent;
  }
  return [...seen].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The signature shown for a function binding.
 *
 * For a user-defined function the engine's arrow deliberately reports a
 * bare parameter as `unknown` unless the body PROVES it can never be a
 * scalar — scalar evidence is filtered out so the lambda auto-broadcast
 * lift stays available (`inferredCollectionParameterType`). For DISPLAY
 * that filter hides real information, so read the parameter BINDINGS in
 * the body scope instead: they carry everything body-usage inference
 * recorded (`c in digits` ⇒ `c: string`; `cs[i]` ⇒ the index union), and
 * the parameter names to boot. Display-only — the engine's arrow type is
 * untouched.
 */
function signatureDisplay(
  def: Extract<BoxedDefinition, { operator: unknown }>
): string {
  const opDef = def.operator;
  const fallback = String(opDef.signature ?? 'function');
  const lambda = opDef.lambda;
  if (lambda === undefined || lambda.parameters.length === 0) return fallback;

  const scope = lambda.body.localScope;
  const params = lambda.parameters.map(({ name, type }) => {
    if (type !== undefined) return `${name}: ${typeToString(type)}`;
    const binding = scope?.bindings.get(name);
    const bt =
      binding !== undefined && 'value' in binding
        ? binding.value.type
        : undefined;
    if (bt === undefined || bt.isUnknown) return name;
    return `${name}: ${bt.toString()}`;
  });

  const st = opDef.signature?.type;
  const result =
    st !== undefined && typeof st !== 'string' && st.kind === 'signature'
      ? st.result
      : undefined;
  if (result === undefined) return fallback;
  return `(${params.join(', ')}) -> ${typeToString(result)}`;
}

function definitionVariable(
  name: string,
  def: BoxedDefinition
): VariableInfo {
  if ('operator' in def)
    return { name, value: signatureDisplay(def), ref: 0 };
  const expr = def.value.value;
  return {
    name,
    value: expr === undefined ? '(unassigned)' : render(expr, INLINE_VALUE_MAX),
    type: def.value.type.toString(),
    ref: expr === undefined ? 0 : referenceFor(expr),
  };
}

function childVariables(expr: BoxedExpression): VariableInfo[] {
  if (!isFunction(expr)) return [];
  return expr.ops.map((op, i) => {
    if (
      isFunction(op) &&
      (op.operator === 'KeyValuePair' || op.operator === 'Tuple') &&
      op.nops === 2
    ) {
      const key = stringValue(op.op1.json);
      if (key !== null) {
        return {
          name: key,
          value: render(op.op2, INLINE_VALUE_MAX),
          ref: referenceFor(op.op2),
        };
      }
    }
    return {
      name: `[${i + 1}]`,
      value: render(op, INLINE_VALUE_MAX),
      ref: referenceFor(op),
    };
  });
}

// ── Command handling ──────────────────────────────────────────────────────

/** Set by a resume command while the pause loop is waiting. */
let resumeAction: 'continue' | 'step' | undefined;

function handleCommand(cmd: WorkerCommand): void {
  switch (cmd.type) {
    case 'start':
      started = true;
      break;
    case 'breakpoints':
      breakpoints.clear();
      for (const spec of cmd.breakpoints) breakpoints.set(spec.line, spec);
      break;
    case 'exception-filters':
      breakOnErrorValues = cmd.errorValues;
      break;
    case 'continue':
      stepMode = undefined;
      resumeAction = 'continue';
      break;
    case 'step':
      stepMode = cmd.mode;
      resumeAction = 'step';
      break;
    case 'pause':
      pauseRequested = true;
      break;
    case 'terminate':
      throw new TerminatedError();
    case 'variables': {
      const variables = withServicing(() => {
        if (cmd.ref === GLOBALS_REF || cmd.ref === LOCALS_REF)
          return collectBindings(
            cmd.ref === LOCALS_REF ? 'locals' : 'globals'
          ).map(([name, def]) => definitionVariable(name, def));
        const expr = handleTable.get(cmd.ref);
        return expr === undefined ? [] : childVariables(expr);
      });
      post({ type: 'variables-reply', id: cmd.id, variables });
      break;
    }
    case 'evaluate': {
      post({ type: 'evaluate-reply', id: cmd.id, ...doEvaluate(cmd) });
      break;
    }
  }
}

function withServicing<T>(body: () => T): T {
  const previous = servicing;
  servicing = true;
  try {
    return body();
  } finally {
    servicing = previous;
  }
}

function doEvaluate(cmd: {
  expression: string;
  context: 'repl' | 'watch' | 'hover';
}): { ok: boolean; result: string; ref: number } {
  return withServicing(() => {
    // Hovers must not run code: only a bare identifier, answered from the
    // scope bindings.
    if (cmd.context === 'hover') {
      const name = cmd.expression.trim();
      const def = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        ? collectBindings('all').find(([n]) => n === name)?.[1]
        : undefined;
      const expr =
        def !== undefined && 'value' in def ? def.value.value : undefined;
      if (expr === undefined) return { ok: false, result: '', ref: 0 };
      return {
        ok: true,
        result: render(expr, INLINE_VALUE_MAX),
        ref: referenceFor(expr),
      };
    }

    // Debug console and watches: full Epsil semantics in the live paused
    // scope (the REPL contract — side effects are on the author).
    try {
      const result = executeEpsil(engine, cmd.expression, {
        url: '(debug console)',
        parseLatex,
      });
      const errors = result.diagnostics.filter((x) => x.severity === 'error');
      if (errors.length > 0) {
        return {
          ok: false,
          result: formatDiagnostics(errors, cmd.expression, undefined, false),
          ref: 0,
        };
      }
      return {
        ok: true,
        result: render(result.value, INLINE_VALUE_MAX),
        ref: referenceFor(result.value),
      };
    } catch (error) {
      return {
        ok: false,
        result: error instanceof Error ? error.message : String(error),
        ref: 0,
      };
    }
  });
}

/** Drain any commands the main thread posted. Cheap when none are pending.
 * May throw `TerminatedError`. */
function drainCommands(): void {
  if (Atomics.exchange(ctrl, 0, 0) === 0) return;
  let msg: { message: WorkerCommand } | undefined;
  while ((msg = receiveMessageOnPort(cmdPort) as typeof msg) !== undefined)
    handleCommand(msg.message);
}

// ── Pausing ───────────────────────────────────────────────────────────────

/** The innermost function-literal span containing `offset`, or undefined. */
function enclosingFunctionName(offset: number): string | undefined {
  let best: { name: string; start: number; end: number } | undefined;
  for (const span of functionSpans) {
    if (offset < span.start || offset >= span.end) continue;
    if (best === undefined || span.end - span.start < best.end - best.start)
      best = span;
  }
  return best?.name;
}

/**
 * One frame per function ACTIVATION, plus the bottom `top level` frame.
 *
 * An activation is a context the engine pushed with the name `'call'`
 * (`function-utils.ts` — the three lambda-application scope pushes). Hook
 * entries are assigned to the nearest `'call'` context at or below their
 * own context index; unnamed contexts (nested blocks, loop scopes) group
 * into their enclosing activation. Each frame's position is its group's
 * DEEPEST entry (the statement that activation is currently executing), and
 * its display name comes from the source span of the enclosing function
 * literal — the engine has no user-facing name for a lambda.
 */
function currentFrames(pausedLine: number, atTopLevel: boolean): FrameInfo[] {
  const frames: FrameInfo[] = [];
  if (!atTopLevel) {
    // Activation boundary context indices (absolute), ascending.
    const callIndices: number[] = [];
    for (let i = baseDepth; i < engine.contextStack.length; i++)
      if (engine.contextStack[i]?.name === 'call') callIndices.push(i);

    // Deepest entry per activation (hookStack is depth-ascending; later
    // entries overwrite, leaving the deepest). Entries below every `'call'`
    // context belong to the top-level group (`-1`).
    const deepestOfGroup = new Map<
      number,
      { line: number; offset: number }
    >();
    for (const entry of hookStack) {
      const contextIndex = baseDepth + entry.depth - 1;
      let group = -1;
      for (const callIndex of callIndices)
        if (callIndex <= contextIndex) group = callIndex;
        else break;
      deepestOfGroup.set(group, entry);
    }

    // Innermost activation first.
    for (let i = callIndices.length - 1; i >= 0; i--) {
      const entry = deepestOfGroup.get(callIndices[i]);
      if (entry === undefined) continue;
      frames.push({
        name: enclosingFunctionName(entry.offset) ?? 'function',
        line: entry.line,
      });
    }

    // A paused position inside a top-level block (a loop body) shows on the
    // top-level frame.
    const topGroup = deepestOfGroup.get(-1);
    const topLine =
      topGroup?.line ??
      statements[Math.min(topIndex, statements.length - 1)]?.line;
    frames.push({ name: 'top level', line: topLine ?? 0 });
    return frames;
  }
  frames.push({ name: 'top level', line: pausedLine });
  return frames;
}

/** Block until a resume command. Runs the inspection service loop. */
function pauseAt(reason: string, line: number, atTopLevel: boolean): void {
  resetHandles();
  pauseRequested = false;
  resumeAction = undefined;
  post({ type: 'stopped', reason, line, frames: currentFrames(line, atTopLevel) });
  while (resumeAction === undefined) {
    // Wake instantly on a command (the main thread flips the flag and
    // notifies); the timeout is only a safety net.
    Atomics.wait(ctrl, 0, 0, 250);
    drainCommands(); // may set resumeAction or throw TerminatedError
  }
  if (resumeAction === 'step') stepDepth = currentRelativeDepth();
  resetHandles();
}

function currentRelativeDepth(): number {
  return Math.max(0, engine.contextStack.length - baseDepth);
}

// ── Breakpoint semantics (shared by hook and top-level checks) ────────────

/**
 * Resolve a hit breakpoint: a logpoint prints (never stops); a conditional
 * breakpoint evaluates its condition in the paused scope and stops only on
 * `True` (a condition that errors stops, conservatively, with a warning).
 */
function breakpointVerdict(bp: BreakpointSpec, line: number): 'stop' | 'skip' {
  if (bp.logMessage !== undefined) {
    emitLogpoint(bp.logMessage, line);
    return 'skip';
  }
  const condition = bp.condition?.trim();
  if (condition === undefined || condition === '') return 'stop';
  try {
    const result = withServicing(() =>
      executeEpsil(engine, condition, {
        url: '(breakpoint condition)',
        parseLatex,
      })
    );
    if (result.diagnostics.some((x) => x.severity === 'error')) {
      output(
        'stderr',
        `breakpoint condition "${condition}" has errors; stopping\n`,
        line
      );
      return 'stop';
    }
    return isSymbol(result.value) && result.value.symbol === 'True'
      ? 'stop'
      : 'skip';
  } catch (error) {
    output(
      'stderr',
      `breakpoint condition "${condition}" failed (${
        error instanceof Error ? error.message : String(error)
      }); stopping\n`,
      line
    );
    return 'stop';
  }
}

/** Print a logpoint message: `{expr}` parts evaluate in the live scope. */
function emitLogpoint(message: string, line: number): void {
  const text = message.replace(/\{([^{}]+)\}/g, (match, expression) => {
    try {
      const result = withServicing(() =>
        executeEpsil(engine, expression, {
          url: '(logpoint)',
          parseLatex,
        })
      );
      return render(result.value, INLINE_VALUE_MAX);
    } catch {
      return match;
    }
  });
  output('console', `${text}\n`, line);
}

// ── The statement hooks (body-level pause points) ─────────────────────────

/** One exception pause per error "wave": set when pausing on an error
 * value, cleared as soon as execution advances to another statement. */
let exceptionHandled = false;

/** The span of the last breakpoint stop. A statement STRICTLY nested inside
 * it on the SAME line does not re-stop (an `if` and its branch's return
 * value share a line; stopping on both reads as a double-stop) — while a
 * re-entry of the same statement (a loop iteration: identical span) does. */
let lastBreakpointStop:
  | { line: number; start: number; end: number }
  | undefined;

function suppressedByLastStop(line: number, start: number, end: number): boolean {
  return (
    lastBreakpointStop !== undefined &&
    line === lastBreakpointStop.line &&
    start > lastBreakpointStop.start &&
    end <= lastBreakpointStop.end
  );
}

function statementHook(raw: unknown): void {
  if (servicing) return;
  const stmt = raw as BoxedExpression;
  drainCommands();
  exceptionHandled = false;

  // A bare Block statement never stops: its own statements fire next (the
  // loop-lowering wrapper starts on the same line as its first statement —
  // stopping on both would double-stop every iteration).
  if (stmt.operator === 'Block') return;

  const offsets = stmt.sourceOffsets;
  if (offsets === undefined) return;
  const line = lineOfOffset(offsets[0]);
  const depth = currentRelativeDepth();

  // Maintain the live call-stack positions: one entry per nesting level.
  while (
    hookStack.length > 0 &&
    hookStack[hookStack.length - 1].depth >= depth
  )
    hookStack.pop();
  hookStack.push({ depth, line, offset: offsets[0] });

  let reason: string | undefined;
  if (pauseRequested) reason = 'pause';
  else if (config.noDebug) return;
  else {
    const bp = breakpoints.get(line);
    if (
      bp !== undefined &&
      !suppressedByLastStop(line, offsets[0], offsets[1]) &&
      breakpointVerdict(bp, line) === 'stop'
    ) {
      reason = 'breakpoint';
      lastBreakpointStop = { line, start: offsets[0], end: offsets[1] };
    } else if (stepMode === 'in') reason = 'step';
    else if (stepMode === 'over' && depth <= stepDepth) reason = 'step';
    else if (stepMode === 'out' && depth < stepDepth) reason = 'step';
  }
  if (reason === undefined) return;

  stepMode = undefined;
  pauseAt(reason, line, false);
}

/** Post-statement: pause when a statement evaluated to an error value and
 * the "Error Values" exception filter is on. */
function statementResultHook(rawStmt: unknown, rawResult: unknown): void {
  if (servicing || !breakOnErrorValues || config.noDebug) return;
  if (exceptionHandled) return;
  const result = rawResult as BoxedExpression;
  // Deep error check (`.errors` walks the value) — only paid when the user
  // enabled the Error Values filter; an error nested in a partial result
  // (`Add(x, Error(…))`) still pauses.
  if (result.errors.length === 0) return;
  const stmt = rawStmt as BoxedExpression;
  // A Block's error is its inner statement's, which already fired.
  if (stmt.operator === 'Block') return;
  const offsets = stmt.sourceOffsets;
  if (offsets === undefined) return;
  drainCommands();
  const line = lineOfOffset(offsets[0]);
  output('stderr', `${result.toString()}\n`, line);
  exceptionHandled = true;
  stepMode = undefined;
  pauseAt('exception', line, false);
}

// ── Program setup ─────────────────────────────────────────────────────────

/** Start lines of every statement a breakpoint can bind to: top-level
 * statements plus the operands of every `Block` in the raw AST (function
 * bodies, loop bodies, `if` branches). */
function collectBreakpointableLines(ast: MathJsonExpression): number[] {
  const lines = new Set<number>();
  const addStatement = (node: MathJsonExpression): void => {
    const offsets = offsetsOf(node);
    if (offsets !== undefined) lines.add(lineOfOffset(offsets[0]));
  };
  const walk = (node: MathJsonExpression): void => {
    if (operator(node) === 'Block')
      for (const stmt of operands(node)) addStatement(stmt);
    for (const op of operands(node)) walk(op);
  };
  for (const stmt of statements) {
    addStatement(stmt.json);
    walk(stmt.json);
  }
  return [...lines].sort((a, b) => a - b);
}

/** Record the source span of every `Function` literal, named from the
 * enclosing definition where there is one: `function f(…) {…}` and the
 * `f(x) = …` sugar (both `DefineFunction`), and `let g = (x) |-> …`
 * (a `Declare`/`Assign` whose value is a lambda — the name threads through
 * the value's `Dictionary`/`KeyValuePair` wrappers). Frames are named by
 * span containment — the engine has no user-facing name for a lambda at
 * application time. */
function collectFunctionSpans(): void {
  functionSpans = [];
  const walk = (node: MathJsonExpression, name: string | undefined): void => {
    const op = operator(node);
    if (op === 'Function') {
      const offsets = offsetsOf(node);
      if (offsets !== undefined)
        functionSpans.push({
          name: name ?? '(anonymous)',
          start: offsets[0],
          end: offsets[1],
        });
      for (const child of operands(node)) walk(child, undefined);
      return;
    }
    if (op === 'DefineFunction' || op === 'Declare' || op === 'Assign') {
      const ops = [...operands(node)];
      const definedName = symbol(ops[0]) ?? undefined;
      walk(ops[0], undefined);
      for (const child of ops.slice(1)) walk(child, definedName);
      return;
    }
    // The declared value sits inside `Dictionary`/`KeyValuePair` wrappers;
    // the name rides through them to a directly-assigned lambda.
    if (op === 'Dictionary' || op === 'KeyValuePair') {
      for (const child of operands(node)) walk(child, name);
      return;
    }
    for (const child of operands(node)) walk(child, undefined);
  };
  for (const stmt of statements) walk(stmt.json, undefined);
}

function output(
  category: 'stdout' | 'stderr' | 'console',
  text: string,
  line?: number
): void {
  post({ type: 'output', category, text, line });
}

// ── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  let ast: MathJsonExpression;
  try {
    const [parsed, diagnostics] = parseEpsil(sourceText, config.program, {
      parseLatex,
      typeNames: engine._typeResolver.names,
    });
    ast = parsed;
    if (diagnostics.length > 0) {
      output(
        'stderr',
        formatDiagnostics(diagnostics, sourceText, config.program, false) + '\n'
      );
    }
    // A mis-parsed program yields a guessed AST with unreliable line
    // mapping: like a compile error, it stops the launch.
    if (diagnostics.some((x) => x.severity === 'error')) {
      post({ type: 'terminated' });
      return;
    }
  } catch (error) {
    if (error instanceof FatalParsingError) {
      output('stderr', `error: ${error.message}\n`);
      post({ type: 'terminated' });
      return;
    }
    throw error;
  }

  const stmts = operator(ast) === 'Block' ? [...operands(ast)] : [ast];
  statements = stmts.map((stmt) => ({
    json: stmt,
    line: lineOfOffset((offsetsOf(stmt) ?? [0, 0])[0]),
  }));

  collectFunctionSpans();
  post({ type: 'ready', breakpointableLines: collectBreakpointableLines(ast) });

  // Wait for configuration (breakpoints) and the start command.
  try {
    while (!started) {
      Atomics.wait(ctrl, 0, 0, 250);
      drainCommands();
    }
    run();
  } catch (error) {
    if (!(error instanceof TerminatedError)) throw error;
  }
  post({ type: 'terminated' });
}

function run(): void {
  baseDepth = engine.contextStack.length;
  baselineScope = engine.context.lexicalScope;
  setDebugStatementHook(statementHook);
  setDebugStatementResultHook(statementResultHook);
  try {
    let lastValue: BoxedExpression | undefined;
    for (topIndex = 0; topIndex < statements.length; topIndex++) {
      const stmt = statements[topIndex];
      hookStack = [];
      exceptionHandled = false;
      drainCommands();

      // Top-level pause points (mirrors the Tier 1 loop).
      let reason: string | undefined;
      if (pauseRequested) reason = 'pause';
      else if (config.noDebug) reason = undefined;
      else if (topIndex === 0 && config.stopOnEntry) reason = 'entry';
      else if (
        breakpoints.has(stmt.line) &&
        (topIndex === 0 || statements[topIndex - 1].line !== stmt.line) &&
        breakpointVerdict(breakpoints.get(stmt.line)!, stmt.line) === 'stop'
      )
        reason = 'breakpoint';
      else if (stepMode !== undefined) reason = 'step';
      if (reason !== undefined) {
        stepMode = undefined;
        pauseAt(reason, stmt.line, true);
      }

      lastValue = executeTopLevel(stmt);
    }

    if (
      lastValue !== undefined &&
      !(isSymbol(lastValue) && lastValue.symbol === 'Nothing') &&
      lastValue.errors.length === 0
    )
      output('stdout', `${render(lastValue, CONSOLE_VALUE_MAX)}\n`);
  } finally {
    setDebugStatementHook(undefined);
    setDebugStatementResultHook(undefined);
  }
}

function executeTopLevel(stmt: StatementInfo): BoxedExpression {
  // Mirrors `executeEpsil`: runtime problems become `["Error", …]` values;
  // the try/catch is the backstop for the throwing paths (const
  // reassignment, cap breaches). A debugger terminate unwinds through here
  // and must NOT be converted to a value.
  let value: BoxedExpression;
  const run = () => engine.box(stmt.json).evaluate();
  try {
    const limit = config.statementTimeLimit;
    value =
      limit > 0
        ? engine.withTimeLimit({ ms: limit, label: 'epsil:debug' }, run)
        : run();
  } catch (error) {
    if (error instanceof TerminatedError) throw error;
    value = engine.box([
      'Error',
      { str: error instanceof Error ? error.message : String(error) },
    ]);
  }

  const errors = value.errors;
  if (errors.length > 0) {
    output(
      'stderr',
      `${basename(config.program)}:${stmt.line}: ${errors[0].toString()}\n`,
      stmt.line
    );
    // The exception filter also covers a top-level statement whose value is
    // an error — unless a body statement already paused for this wave.
    if (breakOnErrorValues && !config.noDebug && !exceptionHandled) {
      exceptionHandled = true;
      stepMode = undefined;
      pauseAt('exception', stmt.line, true);
    }
  }
  return value;
}

main();
