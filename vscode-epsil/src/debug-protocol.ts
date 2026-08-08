// Message protocol between the DAP adapter (main thread) and the debuggee
// worker (debug-worker.ts). See debug-adapter.ts for the architecture note.

/** Initial payload handed to the worker via `workerData`. */
export interface WorkerConfig {
  program: string;
  sourceText: string;
  stopOnEntry: boolean;
  statementTimeLimit: number;
  noDebug: boolean;
  /** Int32Array(1) view: slot 0 is the command-pending flag / wake futex. */
  controlBuffer: SharedArrayBuffer;
  /** The worker polls this synchronously (`receiveMessageOnPort`) — both
   * from its pause loop and at every statement boundary while running. */
  commandPort: import('node:worker_threads').MessagePort;
}

export interface BreakpointSpec {
  line: number;
  /** Stop only when this Epsil expression evaluates to True (evaluation
   * errors stop, conservatively). */
  condition?: string;
  /** A logpoint: print this message — `{expr}` parts evaluate in the paused
   * scope — and do NOT stop. */
  logMessage?: string;
}

/** Commands: main → worker, via `commandPort` (+ futex notify). */
export type WorkerCommand =
  | { type: 'start' }
  | { type: 'breakpoints'; breakpoints: BreakpointSpec[] }
  | { type: 'exception-filters'; errorValues: boolean }
  | { type: 'continue' }
  | { type: 'step'; mode: 'in' | 'over' | 'out' | 'top' }
  | { type: 'pause' }
  | { type: 'terminate' }
  | { type: 'variables'; id: number; ref: number }
  | {
      type: 'evaluate';
      id: number;
      expression: string;
      context: 'repl' | 'watch' | 'hover';
    };

export interface FrameInfo {
  name: string;
  /** 1-based; 0 = unknown. */
  line: number;
}

export interface VariableInfo {
  name: string;
  value: string;
  type?: string;
  /** Worker-side handle for expansion; 0 = leaf. */
  ref: number;
}

/** Worker-side scope references (fixed; child refs are allocated ≥ 3). */
export const GLOBALS_REF = 1;
export const LOCALS_REF = 2;

/** Events and command replies: worker → main, via `parentPort`. */
export type WorkerEvent =
  | { type: 'ready'; breakpointableLines: number[] }
  | {
      type: 'output';
      category: 'stdout' | 'stderr' | 'console';
      text: string;
      line?: number;
    }
  | { type: 'stopped'; reason: string; line: number; frames: FrameInfo[] }
  | { type: 'terminated' }
  | { type: 'variables-reply'; id: number; variables: VariableInfo[] }
  | {
      type: 'evaluate-reply';
      id: number;
      ok: boolean;
      result: string;
      ref: number;
    };
