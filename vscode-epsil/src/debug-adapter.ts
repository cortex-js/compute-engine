// Debug adapter (DAP) for Epsil — Tier 1 of VSCODE_EPSIL_ROADMAP.md.
//
// Adapter and debuggee share this one process: the adapter mirrors
// `executeEpsil`'s statement loop (parse → box+evaluate each top-level
// statement in the engine's current scope) under DAP control, pausing between
// statements. Statement granularity is the Tier 1 contract: breakpoints bind
// to top-level statement lines, "step" runs one statement, and control flow
// *inside* a statement (a `while` body, a function call) runs to completion —
// stepping into it is Tier 2 (needs engine hooks; see the roadmap).
//
// The event loop is shared between DAP traffic and evaluation, so the loop
// yields (`setImmediate`) before each statement: pause/terminate/evaluate
// requests are serviced at statement boundaries. A single runaway statement
// cannot be paused — only terminated (process kill) or bounded up front with
// the `statementTimeLimit` launch option.
//
// Like the language server, the engine is bundled from repo source (see
// build.mjs); everything lives in one bundle, so `instanceof` is safe here.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  Breakpoint,
  DebugSession,
  Handles,
  InitializedEvent,
  OutputEvent,
  Scope,
  Source,
  StackFrame,
  StoppedEvent,
  TerminatedEvent,
  Thread,
} from '@vscode/debugadapter';
import type { DebugProtocol } from '@vscode/debugprotocol';

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
import { typeToString } from '../../src/common/type/serialize.js';
import type { MathJsonExpression } from '../../src/math-json/types.js';
import { operands, operator, stringValue } from '../../src/math-json/utils.js';
import { FatalParsingError } from '../../src/epsil/diagnostics.js';
import { formatDiagnostics } from '../../src/cli/format.js';

const THREAD_ID = 1;

/** Cap for a value rendered inline (Variables pane, hover, watch). */
const INLINE_VALUE_MAX = 200;
/** Cap for a value printed to the debug console. */
const CONSOLE_VALUE_MAX = 10_000;

interface EpsilLaunchArguments extends DebugProtocol.LaunchRequestArguments {
  /** Path of the Epsil source file to run. */
  program: string;
  /** Stop before the first statement. */
  stopOnEntry?: boolean;
  /** Per-statement evaluation deadline in ms (0 = none). The only guard
   * against a statement that never returns — pause cannot interrupt one. */
  statementTimeLimit?: number;
  /** Set by VS Code for "Run Without Debugging": breakpoints are ignored. */
  noDebug?: boolean;
}

interface StatementInfo {
  json: MathJsonExpression;
  /** 1-based source line of the statement's first character. */
  line: number;
}

/** What a `variablesReference` handle resolves to. */
type VariableContainer =
  | { kind: 'globals' }
  | { kind: 'expr'; expr: BoxedExpression };

export class EpsilDebugSession extends DebugSession {
  private engine!: ComputeEngine;
  private parseLatex!: (latex: string) => MathJsonExpression;

  private launchArgs: EpsilLaunchArguments | undefined;
  private programPath = '';
  private sourceText = '';
  private statements: StatementInfo[] = [];

  /** Index of the next statement to execute. */
  private index = 0;
  /** Value of the last executed statement (the program result at the end). */
  private lastValue: BoxedExpression | undefined;

  /** Verified breakpoint lines (1-based, statement-start lines). */
  private breakpointLines = new Set<number>();
  private running = false;
  private pauseRequested = false;
  private terminated = false;

  private variableHandles = new Handles<VariableContainer>();

  constructor() {
    super();
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  // ── DAP lifecycle ──────────────────────────────────────────────────────

  protected override initializeRequest(
    response: DebugProtocol.InitializeResponse
  ): void {
    response.body = {
      supportsConfigurationDoneRequest: true,
      supportsTerminateRequest: true,
      supportsEvaluateForHovers: true,
    };
    this.sendResponse(response);
    // InitializedEvent is deliberately deferred to launchRequest: breakpoints
    // can only be verified against the parsed statement list.
  }

  protected override launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: EpsilLaunchArguments
  ): void {
    this.launchArgs = args;
    this.programPath = args.program;

    try {
      this.sourceText = readFileSync(args.program, 'utf8');
    } catch (error) {
      this.sendErrorResponse(response, {
        id: 1001,
        format: `Cannot read '${args.program}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    this.engine = new ComputeEngine();
    this.parseLatex = (latex) => this.engine.parse(latex).json;

    let ast: MathJsonExpression;
    try {
      const [parsed, diagnostics] = parseEpsil(
        this.sourceText,
        this.programPath,
        {
          parseLatex: this.parseLatex,
          typeNames: this.engine._typeResolver.names,
        }
      );
      ast = parsed;
      if (diagnostics.length > 0) {
        this.output(
          formatDiagnostics(diagnostics, this.sourceText, this.programPath, false) +
            '\n',
          'stderr'
        );
      }
      // A mis-parsed program yields a guessed AST with unreliable line
      // mapping: like a compile error, it stops the launch. (The language
      // server shows the same diagnostics inline.)
      if (diagnostics.some((x) => x.severity === 'error')) {
        this.sendResponse(response);
        this.sendEvent(new TerminatedEvent());
        return;
      }
    } catch (error) {
      if (error instanceof FatalParsingError) {
        this.output(`error: ${error.message}\n`, 'stderr');
        this.sendResponse(response);
        this.sendEvent(new TerminatedEvent());
        return;
      }
      throw error;
    }

    // Unwrap the program wrapper (same rule as `executeEpsil`): a top-level
    // `Block` is unambiguously the multi-statement wrapper.
    const statements =
      operator(ast) === 'Block' ? [...operands(ast)] : [ast];
    this.statements = statements.map((stmt) => ({
      json: stmt,
      line: this.lineOfOffset(this.offsetsOf(stmt)[0]),
    }));

    this.sendResponse(response);
    // Ready for breakpoint configuration; execution starts at
    // configurationDone.
    this.sendEvent(new InitializedEvent());
  }

  protected override configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse
  ): void {
    this.sendResponse(response);
    if (this.statements.length === 0) return this.finish();
    if (this.launchArgs?.stopOnEntry && !this.launchArgs.noDebug)
      return this.reportStopped('entry');
    if (this.shouldBreakAt(0)) return this.reportStopped('breakpoint');
    void this.resume(false);
  }

  protected override disconnectRequest(
    response: DebugProtocol.DisconnectResponse
  ): void {
    this.terminated = true;
    this.sendResponse(response);
    // The host closes our stdio after this; exit deterministically anyway.
    setTimeout(() => process.exit(0), 100);
  }

  protected override terminateRequest(
    response: DebugProtocol.TerminateResponse
  ): void {
    this.terminated = true;
    this.sendResponse(response);
    // If the run loop is live it emits TerminatedEvent at the next statement
    // boundary; when stopped, emit it now.
    if (!this.running) this.sendEvent(new TerminatedEvent());
  }

  // ── Breakpoints ────────────────────────────────────────────────────────

  protected override setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): void {
    this.breakpointLines.clear();
    const breakpoints = (args.breakpoints ?? []).map((requested) => {
      const line = this.convertClientLineToDebugger(requested.line);
      // Bind to the first statement at or after the requested line — the
      // standard "next valid location" convention.
      const target = this.statements.find((s) => s.line >= line);
      if (target === undefined)
        return new Breakpoint(false, this.convertDebuggerLineToClient(line));
      this.breakpointLines.add(target.line);
      return new Breakpoint(
        true,
        this.convertDebuggerLineToClient(target.line)
      );
    });
    response.body = { breakpoints };
    this.sendResponse(response);
  }

  // ── Execution control ──────────────────────────────────────────────────

  protected override continueRequest(
    response: DebugProtocol.ContinueResponse
  ): void {
    this.sendResponse(response);
    if (!this.running) void this.resume(false);
  }

  protected override nextRequest(
    response: DebugProtocol.NextResponse
  ): void {
    this.sendResponse(response);
    if (!this.running) void this.resume(true);
  }

  // Tier 1 has nothing to step into or out of — both act like "next". (The
  // capabilities can't decline these: DAP treats stepIn/stepOut as core.)
  protected override stepInRequest(
    response: DebugProtocol.StepInResponse
  ): void {
    this.sendResponse(response);
    if (!this.running) void this.resume(true);
  }

  protected override stepOutRequest(
    response: DebugProtocol.StepOutResponse
  ): void {
    this.sendResponse(response);
    if (!this.running) void this.resume(true);
  }

  protected override pauseRequest(
    response: DebugProtocol.PauseResponse
  ): void {
    this.pauseRequested = true;
    this.sendResponse(response);
  }

  /**
   * The run loop. Executes statements until a stop condition (step done,
   * breakpoint, pause, termination) or the end of the program. Yields to the
   * event loop before each statement so queued DAP requests are serviced.
   */
  private async resume(stepOne: boolean): Promise<void> {
    this.running = true;
    try {
      while (!this.terminated && this.index < this.statements.length) {
        await this.executeStatement(this.statements[this.index]);
        this.index++;
        if (this.terminated) break;
        if (this.index >= this.statements.length) break;
        if (stepOne) return this.reportStopped('step');
        if (this.pauseRequested) {
          this.pauseRequested = false;
          return this.reportStopped('pause');
        }
        if (!this.launchArgs?.noDebug && this.shouldBreakAt(this.index))
          return this.reportStopped('breakpoint');
      }
      if (this.terminated) this.sendEvent(new TerminatedEvent());
      else this.finish();
    } finally {
      this.running = false;
    }
  }

  /** Break at statement `index`? True when its line has a breakpoint and the
   * statement is the first of that line (several `;`-separated statements on
   * one line stop once, not once per statement). */
  private shouldBreakAt(index: number): boolean {
    const line = this.statements[index].line;
    if (!this.breakpointLines.has(line)) return false;
    return index === 0 || this.statements[index - 1].line !== line;
  }

  private async executeStatement(stmt: StatementInfo): Promise<void> {
    // Service pending DAP traffic (pause, terminate, evaluate, breakpoints).
    await new Promise((resolve) => setImmediate(resolve));
    if (this.terminated) return;

    // Mirrors `executeEpsil`: runtime problems become `["Error", …]` values;
    // the try/catch is the backstop for the throwing paths (const
    // reassignment, cap breaches).
    let value: BoxedExpression;
    const run = () => this.engine.box(stmt.json).evaluate();
    try {
      const limit = this.launchArgs?.statementTimeLimit ?? 0;
      value =
        limit > 0
          ? this.engine.withTimeLimit({ ms: limit, label: 'epsil:debug' }, run)
          : run();
    } catch (error) {
      value = this.engine.box([
        'Error',
        { str: error instanceof Error ? error.message : String(error) },
      ]);
    }
    this.lastValue = value;

    const errors = value.errors;
    if (errors.length > 0) {
      this.output(
        `${basename(this.programPath)}:${stmt.line}: ${errors[0].toString()}\n`,
        'stderr',
        stmt.line
      );
    }
  }

  /** Program ran to completion: print the result (the last statement's
   * value — Epsil's output convention) and terminate. */
  private finish(): void {
    const value = this.lastValue;
    if (
      value !== undefined &&
      !(isSymbol(value) && value.symbol === 'Nothing') &&
      value.errors.length === 0
    ) {
      this.output(`${this.render(value, CONSOLE_VALUE_MAX)}\n`, 'stdout');
    }
    this.sendEvent(new TerminatedEvent());
  }

  private reportStopped(reason: string): void {
    this.variableHandles.reset();
    this.sendEvent(new StoppedEvent(reason, THREAD_ID));
  }

  // ── Inspection ─────────────────────────────────────────────────────────

  protected override threadsRequest(
    response: DebugProtocol.ThreadsResponse
  ): void {
    response.body = { threads: [new Thread(THREAD_ID, 'main')] };
    this.sendResponse(response);
  }

  protected override stackTraceRequest(
    response: DebugProtocol.StackTraceResponse
  ): void {
    // One frame — Tier 1 stops only between top-level statements. The frame
    // points at the next statement to execute (or the last one at the end).
    const current =
      this.statements[Math.min(this.index, this.statements.length - 1)];
    const frame = new StackFrame(
      1,
      'top level',
      new Source(basename(this.programPath), this.programPath),
      this.convertDebuggerLineToClient(current?.line ?? 1),
      1
    );
    response.body = { stackFrames: [frame], totalFrames: 1 };
    this.sendResponse(response);
  }

  protected override scopesRequest(
    response: DebugProtocol.ScopesResponse
  ): void {
    response.body = {
      scopes: [
        new Scope(
          'Variables',
          this.variableHandles.create({ kind: 'globals' }),
          false
        ),
      ],
    };
    this.sendResponse(response);
  }

  protected override variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    const container = this.variableHandles.get(args.variablesReference);
    response.body = { variables: [] };
    if (container?.kind === 'globals') {
      response.body.variables = this.collectBindings().map(([name, def]) =>
        this.definitionVariable(name, def)
      );
    } else if (container?.kind === 'expr') {
      response.body.variables = this.childVariables(container.expr);
    }
    this.sendResponse(response);
  }

  protected override evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    if (this.engine === undefined) {
      this.sendErrorResponse(response, {
        id: 1002,
        format: 'The Epsil session has not started yet.',
      });
      return;
    }

    // Hovers must not run code: an expression hover could call a function.
    // Only a bare identifier — answered from the scope bindings, no
    // evaluation — is safe.
    if (args.context === 'hover') {
      const name = args.expression.trim();
      const def = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        ? this.collectBindings().find(([n]) => n === name)?.[1]
        : undefined;
      const expr = def !== undefined && 'value' in def ? def.value.value : undefined;
      if (expr === undefined) {
        this.sendErrorResponse(
          response,
          { id: 1003, format: 'not available' },
          undefined,
          undefined,
          undefined // no telemetry, no UI: hover errors are silent
        );
        return;
      }
      response.body = {
        result: this.render(expr, INLINE_VALUE_MAX),
        variablesReference: this.referenceFor(expr),
      };
      this.sendResponse(response);
      return;
    }

    // Debug-console and watch input evaluates with full Epsil semantics in
    // the live session scope (exactly the REPL contract — declarations and
    // assignments take effect; a watch with a side effect is on the author).
    const result = executeEpsil(this.engine, args.expression, {
      url: '(debug console)',
      parseLatex: this.parseLatex,
    });

    const errors = result.diagnostics.filter((x) => x.severity === 'error');
    if (errors.length > 0) {
      this.sendErrorResponse(response, {
        id: 1004,
        format: formatDiagnostics(errors, args.expression, undefined, false),
      });
      return;
    }
    if (args.context === 'repl' && result.diagnostics.length > 0) {
      this.output(
        formatDiagnostics(
          result.diagnostics,
          args.expression,
          undefined,
          false
        ) + '\n',
        'stderr'
      );
    }

    response.body = {
      result: this.render(result.value, INLINE_VALUE_MAX),
      variablesReference: this.referenceFor(result.value),
    };
    this.sendResponse(response);
  }

  // ── Variables helpers ──────────────────────────────────────────────────

  /**
   * The user's bindings: every name declared in the scope chain from the
   * engine's current scope up to — excluding — the system (builtin) scope,
   * innermost declaration winning. At a statement boundary the current scope
   * is the global session scope, so this is exactly what the user declared.
   */
  private collectBindings(): Array<[string, BoxedDefinition]> {
    const systemScope = this.engine.contextStack[0]?.lexicalScope;
    const seen = new Map<string, BoxedDefinition>();
    let scope: (typeof systemScope) | null = this.engine.context.lexicalScope;
    while (scope !== null && scope !== undefined && scope !== systemScope) {
      for (const [name, def] of scope.bindings)
        if (!seen.has(name)) seen.set(name, def);
      scope = scope.parent;
    }
    return [...seen].sort(([a], [b]) => a.localeCompare(b));
  }

  private definitionVariable(
    name: string,
    def: BoxedDefinition
  ): DebugProtocol.Variable {
    if ('operator' in def) {
      return {
        name,
        value: this.signatureDisplay(def),
        variablesReference: 0,
      };
    }
    const expr = def.value.value;
    return {
      name,
      value: expr === undefined ? '(unassigned)' : this.render(expr, INLINE_VALUE_MAX),
      type: def.value.type.toString(),
      variablesReference: expr === undefined ? 0 : this.referenceFor(expr),
    };
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
  private signatureDisplay(
    def: Extract<BoxedDefinition, { operator: unknown }>
  ): string {
    const opDef = def.operator;
    const fallback = String(opDef.signature ?? 'function');
    const lambda = opDef.lambda;
    if (lambda === undefined || lambda.parameters.length === 0) return fallback;

    const scope = lambda.body.localScope;
    const params = lambda.parameters.map(({ name, type }) => {
      // An annotated parameter shows its declared type.
      if (type !== undefined) return `${name}: ${typeToString(type)}`;
      // A bare parameter shows the binding evidence, when there is any.
      const binding = scope?.bindings.get(name);
      const bt =
        binding !== undefined && 'value' in binding
          ? binding.value.type
          : undefined;
      if (bt === undefined || bt.isUnknown) return name;
      return `${name}: ${bt.toString()}`;
    });

    // The result slot comes from the engine's own arrow.
    const st = opDef.signature?.type;
    const result =
      st !== undefined && typeof st !== 'string' && st.kind === 'signature'
        ? st.result
        : undefined;
    if (result === undefined) return fallback;
    return `(${params.join(', ')}) -> ${typeToString(result)}`;
  }

  /** Children of a structured value: its operands, labeled with Epsil's
   * 1-based indices (dictionary entries labeled by key). */
  private childVariables(expr: BoxedExpression): DebugProtocol.Variable[] {
    if (!isFunction(expr)) return [];
    return expr.ops.map((op, i) => {
      // A dictionary operand is a key → value pair: label with the key.
      if (
        isFunction(op) &&
        (op.operator === 'KeyValuePair' || op.operator === 'Tuple') &&
        op.nops === 2
      ) {
        const key = stringValue(op.op1.json);
        if (key !== null) {
          const valueExpr = op.op2;
          return {
            name: key,
            value: this.render(valueExpr, INLINE_VALUE_MAX),
            variablesReference: this.referenceFor(valueExpr),
          };
        }
      }
      return {
        name: `[${i + 1}]`,
        value: this.render(op, INLINE_VALUE_MAX),
        variablesReference: this.referenceFor(op),
      };
    });
  }

  /** A `variablesReference` for an expandable value (has operands), or 0. */
  private referenceFor(expr: BoxedExpression): number {
    if (!isFunction(expr) || expr.nops === 0) return 0;
    return this.variableHandles.create({ kind: 'expr', expr });
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  private render(expr: BoxedExpression, maxLength: number): string {
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

  private output(
    text: string,
    category: 'stdout' | 'stderr' | 'console',
    line?: number
  ): void {
    const event: DebugProtocol.OutputEvent = new OutputEvent(text, category);
    if (line !== undefined) {
      event.body.source = new Source(
        basename(this.programPath),
        this.programPath
      );
      event.body.line = this.convertDebuggerLineToClient(line);
    }
    this.sendEvent(event);
  }

  // ── Source positions ───────────────────────────────────────────────────

  private offsetsOf(stmt: MathJsonExpression): [number, number] {
    return (
      (typeof stmt === 'object' && stmt !== null && !Array.isArray(stmt)
        ? (stmt as { sourceOffsets?: [number, number] }).sourceOffsets
        : undefined) ?? [0, this.sourceText.length]
    );
  }

  /** 1-based line of a character offset. */
  private lineOfOffset(offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < this.sourceText.length; i++)
      if (this.sourceText.charCodeAt(i) === 10) line++;
    return line;
  }
}

// Stdio DAP session: VS Code launches this bundle with `node` and speaks the
// protocol over stdin/stdout (see `contributes.debuggers` in package.json).
const session = new EpsilDebugSession();
process.on('SIGTERM', () => process.exit(0));
session.start(process.stdin, process.stdout);
