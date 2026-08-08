// Debug adapter (DAP) for Epsil — Tiers 1+2 of VSCODE_EPSIL_ROADMAP.md.
//
// Two threads:
//  - THIS file (main thread): the DAP endpoint. It owns no engine — it
//    translates protocol requests into commands for the debuggee worker and
//    forwards the worker's events.
//  - debug-worker.ts (worker thread): the debuggee. It embeds the engine,
//    executes the program, and pauses by BLOCKING synchronously — between
//    top-level statements and, via the engine's debug statement hook, before
//    every source-mapped statement inside function bodies, loop bodies and
//    `if` branches. While paused it services inspection commands from its
//    pause loop, so variables and watches run against the live paused scope.
//
// The command channel is a MessagePort the worker polls SYNCHRONOUSLY
// (`receiveMessageOnPort`) plus a shared Int32 futex: the main thread posts
// a command, flips the flag, and `Atomics.notify`s; the worker wakes from
// `Atomics.wait` even while blocked mid-evaluation. Worker → main replies
// ride ordinary `postMessage`, which delivers fine from a blocked worker.
//
// Limits: a statement that fires no pause points (a single long-running
// pure computation) cannot be paused — only terminated, or bounded with the
// `statementTimeLimit` launch option. Note that the per-statement time limit
// keeps running while paused at a breakpoint inside that statement, so avoid
// combining a tight limit with body breakpoints.

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MessageChannel, Worker } from 'node:worker_threads';

import {
  Breakpoint,
  DebugSession,
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
  GLOBALS_REF,
  LOCALS_REF,
  type BreakpointSpec,
  type FrameInfo,
  type WorkerCommand,
  type WorkerConfig,
  type WorkerEvent,
} from './debug-protocol.js';

const THREAD_ID = 1;
/** Deadline for a worker inspection reply — the worker only services
 * commands while paused, so a reply not arriving promptly means it is off
 * running (or wedged); fail the request rather than hang the client. */
const REPLY_TIMEOUT_MS = 3_000;

interface EpsilLaunchArguments extends DebugProtocol.LaunchRequestArguments {
  /** Path of the Epsil source file to run. */
  program: string;
  /** Stop before the first statement. */
  stopOnEntry?: boolean;
  /** Per-statement evaluation deadline in ms (0 = none). */
  statementTimeLimit?: number;
  /** Set by VS Code for "Run Without Debugging": breakpoints are ignored. */
  noDebug?: boolean;
}

export class EpsilDebugSession extends DebugSession {
  private worker: Worker | undefined;
  private commandPort: import('node:worker_threads').MessagePort | undefined;
  private ctrl: Int32Array | undefined;

  private programPath = '';
  private launchArgs: EpsilLaunchArguments | undefined;
  /** Lines a breakpoint can bind to (from the worker's AST walk). */
  private breakpointableLines: number[] = [];
  private paused = false;
  private lastStop: { line: number; frames: FrameInfo[] } | undefined;
  /** Last configuration sent, for re-applying on restart. */
  private lastBreakpoints: BreakpointSpec[] = [];
  private lastErrorValuesFilter = false;

  private nextRequestId = 1;
  private pendingReplies = new Map<
    number,
    { resolve: (event: WorkerEvent) => void; timer: NodeJS.Timeout }
  >();

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
      supportsSteppingGranularity: false,
      supportsConditionalBreakpoints: true,
      supportsLogPoints: true,
      supportsRestartRequest: true,
      exceptionBreakpointFilters: [
        {
          filter: 'error-values',
          label: 'Error Values',
          description:
            'Pause when a statement evaluates to an error value ' +
            '(Epsil reports runtime problems as values, not exceptions).',
          default: false,
        },
      ],
    };
    this.sendResponse(response);
    // InitializedEvent is deferred to launchRequest: breakpoints can only be
    // verified once the worker has parsed the program.
  }

  protected override launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: EpsilLaunchArguments
  ): void {
    this.launchArgs = args;
    this.programPath = args.program;
    this.startWorker(
      // First 'ready': answer the launch and open the configuration phase.
      () => {
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
      },
      // Parse failure before 'ready': the launch must still be answered for
      // the session to shut down cleanly.
      () => this.sendResponse(response)
    );
  }

  /** Spawn the debuggee worker. `onReady`/`onEarlyExit` fire once. */
  private startWorker(
    onReady: () => void,
    onEarlyExit: () => void,
    onError?: (message: string) => void
  ): void {
    const args = this.launchArgs!;

    let sourceText: string;
    try {
      sourceText = readFileSync(args.program, 'utf8');
    } catch (error) {
      (onError ?? ((m: string) => this.output(`${m}\n`, 'stderr')))(
        `Cannot read '${args.program}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      onEarlyExit();
      this.sendEvent(new TerminatedEvent());
      return;
    }

    const controlBuffer = new SharedArrayBuffer(4);
    this.ctrl = new Int32Array(controlBuffer);
    const channel = new MessageChannel();
    this.commandPort = channel.port1;

    const config: WorkerConfig = {
      program: args.program,
      sourceText,
      stopOnEntry: args.stopOnEntry === true,
      statementTimeLimit: args.statementTimeLimit ?? 0,
      noDebug: args.noDebug === true,
      controlBuffer,
      commandPort: channel.port2,
    };

    const worker = new Worker(join(__dirname, 'debug-worker.js'), {
      workerData: config,
      transferList: [channel.port2],
    });
    this.worker = worker;

    let launched = false;
    worker.on('message', (event: WorkerEvent) => {
      if (event.type === 'ready') {
        this.breakpointableLines = event.breakpointableLines;
        if (!launched) {
          launched = true;
          onReady();
        }
        return;
      }
      this.onWorkerEvent(event);
      if (event.type === 'terminated' && !launched) {
        launched = true;
        onEarlyExit();
      }
    });
    worker.on('error', (error) => {
      this.output(`debuggee error: ${error.message}\n`, 'stderr');
      this.sendEvent(new TerminatedEvent());
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = undefined;
    });
  }

  protected override configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse
  ): void {
    this.sendResponse(response);
    this.postCommand({ type: 'start' });
  }

  protected override disconnectRequest(
    response: DebugProtocol.DisconnectResponse
  ): void {
    void this.worker?.terminate();
    this.sendResponse(response);
    setTimeout(() => process.exit(0), 100);
  }

  protected override terminateRequest(
    response: DebugProtocol.TerminateResponse
  ): void {
    this.postCommand({ type: 'terminate' });
    this.sendResponse(response);
    // If the worker is wedged in a computation with no pause points, the
    // command never lands: hard-kill after a grace period.
    const worker = this.worker;
    setTimeout(() => {
      if (worker !== undefined && this.worker === worker) {
        void worker.terminate();
        this.sendEvent(new TerminatedEvent());
      }
    }, 2_000);
  }

  // ── Worker events ──────────────────────────────────────────────────────

  private onWorkerEvent(event: WorkerEvent): void {
    switch (event.type) {
      case 'output': {
        this.output(event.text, event.category, event.line);
        break;
      }
      case 'stopped': {
        this.paused = true;
        this.lastStop = { line: event.line, frames: event.frames };
        this.sendEvent(new StoppedEvent(event.reason, THREAD_ID));
        break;
      }
      case 'terminated': {
        this.sendEvent(new TerminatedEvent());
        break;
      }
      case 'variables-reply':
      case 'evaluate-reply': {
        const pending = this.pendingReplies.get(event.id);
        if (pending !== undefined) {
          this.pendingReplies.delete(event.id);
          clearTimeout(pending.timer);
          pending.resolve(event);
        }
        break;
      }
    }
  }

  // ── Commands to the worker ─────────────────────────────────────────────

  private postCommand(command: WorkerCommand): void {
    if (this.commandPort === undefined || this.ctrl === undefined) return;
    this.commandPort.postMessage(command);
    Atomics.store(this.ctrl, 0, 1);
    Atomics.notify(this.ctrl, 0);
  }

  /** Post a command that expects a reply (only serviced while paused). */
  private request(
    command: WorkerCommand & { id: number }
  ): Promise<WorkerEvent | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(command.id);
        resolve(undefined);
      }, REPLY_TIMEOUT_MS);
      this.pendingReplies.set(command.id, { resolve, timer });
      this.postCommand(command);
    });
  }

  private resume(command: WorkerCommand): void {
    this.paused = false;
    this.lastStop = undefined;
    this.postCommand(command);
  }

  // ── Breakpoints ────────────────────────────────────────────────────────

  protected override setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): void {
    const specs = new Map<number, BreakpointSpec>();
    const breakpoints = (args.breakpoints ?? []).map((requested) => {
      const line = this.convertClientLineToDebugger(requested.line);
      // Bind to the first statement line at or after the requested line —
      // the standard "next valid location" convention.
      const target = this.breakpointableLines.find((l) => l >= line);
      if (target === undefined)
        return new Breakpoint(false, this.convertDebuggerLineToClient(line));
      specs.set(target, {
        line: target,
        condition: requested.condition,
        logMessage: requested.logMessage,
      });
      return new Breakpoint(true, this.convertDebuggerLineToClient(target));
    });
    this.lastBreakpoints = [...specs.values()];
    this.postCommand({ type: 'breakpoints', breakpoints: this.lastBreakpoints });
    response.body = { breakpoints };
    this.sendResponse(response);
  }

  protected override setExceptionBreakPointsRequest(
    response: DebugProtocol.SetExceptionBreakpointsResponse,
    args: DebugProtocol.SetExceptionBreakpointsArguments
  ): void {
    this.lastErrorValuesFilter = (args.filters ?? []).includes('error-values');
    this.postCommand({
      type: 'exception-filters',
      errorValues: this.lastErrorValuesFilter,
    });
    this.sendResponse(response);
  }

  protected override restartRequest(
    response: DebugProtocol.RestartResponse
  ): void {
    const previous = this.worker;
    this.worker = undefined; // detach: its late events must not interleave
    void previous?.terminate();
    this.paused = false;
    this.lastStop = undefined;
    this.pendingReplies.forEach((p) => clearTimeout(p.timer));
    this.pendingReplies.clear();

    // Fresh worker, same launch config; re-apply the cached breakpoints and
    // exception filters, then start (VS Code does not re-run the
    // configuration phase on a restart).
    this.startWorker(
      () => {
        this.postCommand({
          type: 'breakpoints',
          breakpoints: this.lastBreakpoints,
        });
        this.postCommand({
          type: 'exception-filters',
          errorValues: this.lastErrorValuesFilter,
        });
        this.postCommand({ type: 'start' });
      },
      () => {}
    );
    this.sendResponse(response);
  }

  // ── Execution control ──────────────────────────────────────────────────

  protected override continueRequest(
    response: DebugProtocol.ContinueResponse
  ): void {
    this.sendResponse(response);
    this.resume({ type: 'continue' });
  }

  protected override nextRequest(response: DebugProtocol.NextResponse): void {
    this.sendResponse(response);
    this.resume({ type: 'step', mode: 'over' });
  }

  protected override stepInRequest(
    response: DebugProtocol.StepInResponse
  ): void {
    this.sendResponse(response);
    this.resume({ type: 'step', mode: 'in' });
  }

  protected override stepOutRequest(
    response: DebugProtocol.StepOutResponse
  ): void {
    this.sendResponse(response);
    this.resume({ type: 'step', mode: 'out' });
  }

  protected override pauseRequest(
    response: DebugProtocol.PauseResponse
  ): void {
    this.postCommand({ type: 'pause' });
    this.sendResponse(response);
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
    const frames = this.lastStop?.frames ?? [];
    response.body = {
      stackFrames: frames.map(
        (frame, i) =>
          new StackFrame(
            i + 1,
            frame.name,
            new Source(basename(this.programPath), this.programPath),
            frame.line > 0
              ? this.convertDebuggerLineToClient(frame.line)
              : undefined,
            1
          )
      ),
      totalFrames: frames.length,
    };
    this.sendResponse(response);
  }

  protected override scopesRequest(
    response: DebugProtocol.ScopesResponse
  ): void {
    // Locals: bindings above the run's baseline scope — the paused body's
    // parameters and locals (empty at a top-level pause). Globals: the
    // session's own declarations.
    response.body = {
      scopes: [
        new Scope('Locals', LOCALS_REF, false),
        new Scope('Globals', GLOBALS_REF, false),
      ],
    };
    this.sendResponse(response);
  }

  protected override async variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): Promise<void> {
    response.body = { variables: [] };
    if (this.paused) {
      const reply = await this.request({
        type: 'variables',
        id: this.nextRequestId++,
        ref: args.variablesReference,
      });
      if (reply?.type === 'variables-reply') {
        response.body.variables = reply.variables.map((v) => ({
          name: v.name,
          value: v.value,
          type: v.type,
          variablesReference: v.ref === 0 ? 0 : v.ref,
        }));
      }
    }
    this.sendResponse(response);
  }

  protected override async evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): Promise<void> {
    if (!this.paused) {
      this.sendErrorResponse(response, {
        id: 1002,
        format: 'Only available while paused.',
      });
      return;
    }
    const context =
      args.context === 'hover' || args.context === 'watch'
        ? args.context
        : ('repl' as const);
    const reply = await this.request({
      type: 'evaluate',
      id: this.nextRequestId++,
      expression: args.expression,
      context,
    });
    if (reply?.type !== 'evaluate-reply' || !reply.ok) {
      this.sendErrorResponse(response, {
        id: 1003,
        format:
          reply?.type === 'evaluate-reply' && reply.result !== ''
            ? reply.result
            : 'not available',
      });
      return;
    }
    response.body = { result: reply.result, variablesReference: reply.ref };
    this.sendResponse(response);
  }

  // ── Output ─────────────────────────────────────────────────────────────

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
}

// Stdio DAP session: VS Code launches this bundle with `node` and speaks the
// protocol over stdin/stdout (see `contributes.debuggers` in package.json).
const session = new EpsilDebugSession();
process.on('SIGTERM', () => process.exit(0));
session.start(process.stdin, process.stdout);
