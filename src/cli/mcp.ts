import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { ComputeEngine, serializeEpsil, version } from '../epsil.js';
import type { BoxedExpression } from '../compute-engine.js';
import {
  isFunction,
  isString,
  isSymbol,
} from '../compute-engine/boxed-expression/type-guards.js';
import { explainErrorCode } from '../epsil/error-explanations.js';
import { isTimeoutCancellation } from '../common/interruptible.js';
import { compile } from '../compute-engine/compilation/compile-expression.js';
import type { CompileMode } from '../compute-engine/compilation/types.js';

import { CliUsageError, parseMcpArguments } from './arguments.js';
import { checkSource, effectSummaryToJson, parseSource } from './check.js';
import { lookupDoc } from './doc.js';
import { diagnosticToJson, formatValue, hasErrors } from './format.js';
import type { AgentCard, CliIo } from './io.js';
import { makeEpsilSession } from './session.js';
import type { EpsilSession, EvaluationResult, McpOptions } from './types.js';

/**
 * `epsil mcp` — a Model Context Protocol server over stdio or Streamable
 * HTTP, exposing the same operations as the CLI as tools (`evaluate`,
 * `check`, `doc`, `parse`, `serialize`), a `compile` tool that shows the code
 * a compilation target generates for an expression, and the agent-facing
 * cards as resources. It is implemented directly rather than through the MCP SDK
 * to keep the package dependency-free.
 *
 * `evaluate` and `parse` also accept a LaTeX expression (`format: "latex"`),
 * and `serialize` can write LaTeX: agents often hold a formula in LaTeX
 * already, and a single formula needs no Epsil program around it.
 *
 * Tool calls are stateless: each one runs against a fresh engine, so a
 * program must be self-contained. (A persistent session would also let one
 * call contaminate the next — e.g. boolean use retypes a symbol for the
 * engine's lifetime.)
 */

const CARD_URI = 'epsil://docs/for-agents';
const API_CARD_URI = 'epsil://docs/compute-engine-api';
const MAX_HTTP_BODY_BYTES = 1024 * 1024;

/** Newest first; `initialize` echoes the client's version when supported. */
const PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];
const STREAMABLE_HTTP_PROTOCOL_VERSIONS = new Set(
  PROTOCOL_VERSIONS.filter((x) => x !== '2024-11-05')
);

const INSTRUCTIONS = `Tools for Epsil, the programming language of the Compute Engine (https://cortexjs.io). Before writing Epsil source, read the language card resource (${CARD_URI}). Each "evaluate" call runs a complete, self-contained program in a fresh session; definitions do not persist between calls. Use "check" for fast syntax validation and "doc" to look up library functions. To compute a single formula you already have in LaTeX, pass it to "evaluate" with "format": "latex" instead of translating it; write Epsil for anything with several steps or definitions. Every "evaluate" result includes a "latex" form of the value, ready to display. Use "compile" to see the code a target (JavaScript, GLSL, WGSL, Python, interval JavaScript) generates for an expression, or why the target declines it. To write JavaScript or TypeScript code that uses the Compute Engine library (@cortex-js/compute-engine), read the API card resource (${API_CARD_URI}) first.`;

/** The targets the `compile` tool offers: the engine's built-in targets. */
const COMPILE_TARGETS = [
  'javascript',
  'glsl',
  'wgsl',
  'python',
  'interval-js',
] as const;

const COMPILE_MODES = ['auto', 'strict', 'complex'] as const;

const TOOLS = [
  {
    name: 'evaluate',
    description:
      'Evaluate a complete Epsil program and return its value (the value of the last statement) in display, Epsil, LaTeX and MathJSON forms, along with any diagnostics. Anything the program prints with `print` is returned as the `output` lines. With "format": "latex", the source is a single LaTeX expression (e.g. "\\int_0^1 x^2\\,dx") instead of a program. Each call runs in a fresh session: definitions do not persist between calls, so the program must be self-contained.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Epsil source code, or a LaTeX expression with "format": "latex"',
        },
        format: sourceFormatSchema(),
        timeLimit: {
          type: 'number',
          description:
            'Evaluation deadline in milliseconds; 0 disables it (default: 10000)',
        },
        fancySymbols: {
          type: 'boolean',
          description:
            'Write the `epsil` form with the Unicode notations (√x, x², ×, ⩽, …) instead of the ASCII spellings (default: false)',
        },
      },
      required: ['source'],
    },
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'check',
    description:
      'Parse and canonicalize an Epsil program and report diagnostics without evaluating it. This is the fast validation loop: it catches syntax, string and type-annotation errors, and the type errors detected at canonicalization time (e.g. "a" + 1), but not genuinely dynamic problems (an out-of-range index, a match with no matching case). With "effects": true, the result also lists the effects inferred for each top-level function definition (an empty list is pure; "declared" marks a contract the author wrote).',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Epsil source code' },
        effects: {
          type: 'boolean',
          description:
            'Also report the effects inferred for each top-level function definition',
        },
      },
      required: ['source'],
    },
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'doc',
    description:
      'Show documentation for a Compute Engine library symbol by exact name (e.g. "Sin"), or search the library by keywords (e.g. "greatest common divisor").',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol name or search keywords',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matches (default: 10)',
        },
      },
      required: ['query'],
    },
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'parse',
    description:
      'Parse an Epsil program, or a LaTeX expression with "format": "latex", into MathJSON without evaluating it. Returns the MathJSON expression and any diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Epsil source code, or a LaTeX expression with "format": "latex"',
        },
        format: sourceFormatSchema(),
      },
      required: ['source'],
    },
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'serialize',
    description:
      'Convert a MathJSON expression to Epsil source, or to LaTeX with "format": "latex".',
    inputSchema: {
      type: 'object',
      properties: {
        mathjson: {
          description: 'A MathJSON expression, e.g. ["Add", "x", 1]',
        },
        format: {
          type: 'string',
          enum: ['epsil', 'latex'],
          description:
            'The notation to write: "epsil" returns an `epsil` field, "latex" a `latex` field (default: "epsil")',
        },
        fancySymbols: {
          type: 'boolean',
          description:
            'For Epsil output, write the Unicode notations (√x, x², ×, ⩽, …) instead of the ASCII spellings (default: false)',
        },
      },
      required: ['mathjson'],
    },
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'compile',
    description:
      'Compile an Epsil program, or a LaTeX expression with "format": "latex", to the source code of a target, without running it. Returns `ok`, the generated `code`, the free symbols the code reads with their engine type and the type the target reads them as (`freeSymbolTypes`), and the arithmetic `mode` the code was compiled under. When the target declines the expression, `ok` is false and `error` and `diagnostic` say why (the decline is reported, never replaced by an interpreter fallback). Declare the type of a free symbol with "declarations" (e.g. {"z": "complex"}): an undeclared symbol has the type inferred from its uses.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Epsil source code, or a LaTeX expression with "format": "latex"',
        },
        format: sourceFormatSchema(),
        to: {
          type: 'string',
          enum: [...COMPILE_TARGETS],
          description: 'The compilation target (default: "javascript")',
        },
        mode: {
          type: 'string',
          enum: [...COMPILE_MODES],
          description:
            'The arithmetic discipline: "strict" (real kernel, a lane mismatch declines), "complex", or "auto" (strict, escalating to complex when needed). Omit it to use the default of the target: "auto" on "javascript" and "python", "strict" on "glsl", "wgsl" and "interval-js", which offer only "strict" (another mode declines with the code "unsupported-mode")',
        },
        timeLimit: {
          type: 'number',
          description:
            'Compilation deadline in milliseconds; 0 disables it (default: 10000)',
        },
        declarations: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Types of free symbols, declared before the source is parsed: a map from symbol name to type, e.g. {"z": "complex", "f": "(real) -> real", "L": "list<real>"}',
        },
      },
      required: ['source'],
    },
    annotations: readOnlyAnnotations(),
  },
];

const RESOURCES = [
  {
    card: 'epsil',
    uri: CARD_URI,
    name: 'epsil-language-card',
    title: 'Epsil language card',
    description:
      'A compact guide to the Epsil language for agents: syntax, semantics, idioms, common traps and a roster of the standard library. Read this before writing Epsil.',
    mimeType: 'text/markdown',
  },
  {
    card: 'compute-engine',
    uri: API_CARD_URI,
    name: 'compute-engine-api-card',
    title: 'Compute Engine API card',
    description:
      'A compact guide for agents writing JavaScript or TypeScript with the Compute Engine library: creating expressions, exact and numeric evaluation, symbolic operations, comparison, compilation and the common traps. Read this before writing code that uses @cortex-js/compute-engine.',
    mimeType: 'text/markdown',
  },
] as const;

function sourceFormatSchema(): Record<string, unknown> {
  return {
    type: 'string',
    enum: ['epsil', 'latex'],
    description:
      'The notation of `source`: an Epsil program or a single LaTeX expression (default: "epsil")',
  };
}

function readOnlyAnnotations(): Record<string, boolean> {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
}

/**
 * Evaluate an Epsil program with its console I/O captured. The stdio
 * transport carries JSON-RPC on standard output and input, so an evaluated
 * program's `print` writing to the real console would corrupt the outgoing
 * protocol stream, and an `input` reading standard input would consume — or
 * block on — protocol bytes. The session's engine therefore gets a `console`
 * handler of its own (`ce.effects`, the host capability registry): `log`
 * collects the printed lines, which are returned so the caller can report
 * them in the tool result, and `readLine` answers `undefined` — "this host
 * has no interactive input" — so `input()` stays an unevaluated symbolic
 * call. The handler belongs to this one engine: nothing global is changed, so
 * nothing needs to be restored and no other request can observe it.
 */
function evaluateWithConsoleCaptured(
  session: EpsilSession,
  source: string
): { result: EvaluationResult; output: string[] } {
  const output: string[] = [];
  session.engine.effects = {
    console: {
      log: (line) => {
        output.push(line);
      },
      readLine: () => undefined,
    },
  };
  return { result: session.evaluate(source), output };
}

/** A JSON-RPC protocol error (as opposed to a tool-execution failure,
 * which is reported as a result with `isError: true`). */
class McpError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

export async function runMcp(
  args: readonly string[],
  io: CliIo
): Promise<number> {
  let options;
  try {
    options = parseMcpArguments(args);
  } catch (error) {
    const message =
      error instanceof CliUsageError && error.message
        ? `${error.message}\n`
        : '';
    io.stderr.write(`${message}Try "epsil --help" for more information.\n`);
    return 2;
  }

  const server = new McpServer(options.timeLimit, io.loadCard);
  if (options.transport === 'streamable-http')
    return runMcpHttp(server, options, io);
  return runMcpStdio(server, io);
}

async function runMcpStdio(server: McpServer, io: CliIo): Promise<number> {
  const send = (message: unknown): void => {
    io.stdout.write(`${JSON.stringify(message)}\n`);
  };

  io.stdin.setEncoding('utf8');
  let buffer = '';
  for await (const chunk of io.stdin) {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;

      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        send({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        });
        continue;
      }
      // Messages are handled sequentially so responses keep request order.
      for (const response of await server.handle(message)) send(response);
    }
  }
  return 0;
}

async function runMcpHttp(
  mcp: McpServer,
  options: McpOptions,
  io: CliIo
): Promise<number> {
  const server = createMcpHttpServerForDispatcher(mcp, options);
  return new Promise((resolve) => {
    const handleListenError = (error: Error): void => {
      io.stderr.write(`epsil mcp: ${error.message}\n`);
      resolve(1);
    };
    server.once('error', handleListenError);
    server.listen(options.port, options.host, () => {
      server.off('error', handleListenError);
      const address = server.address() as AddressInfo | null;
      const port = address?.port ?? options.port;
      io.stderr.write(
        `Epsil MCP server listening on http://${displayHost(
          options.host
        )}:${port}${options.path}\n`
      );
      server.once('close', () => resolve(0));
    });
  });
}

/**
 * Create the native Streamable HTTP server. Exported for transport-level
 * tests; command-line callers normally use `runMcp()`.
 */
export function createMcpHttpServer(
  options: McpOptions,
  loadCard?: (card: AgentCard) => Promise<string>
): Server {
  return createMcpHttpServerForDispatcher(
    new McpServer(options.timeLimit, loadCard),
    options
  );
}

function createMcpHttpServerForDispatcher(
  mcp: McpServer,
  options: McpOptions
): Server {
  return createServer((request, response) => {
    void handleHttpRequest(mcp, options, request, response);
  });
}

async function handleHttpRequest(
  mcp: McpServer,
  options: McpOptions,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    if (requestPath(request) !== options.path) {
      sendHttpText(response, 404, 'Not Found');
      return;
    }

    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin, options)) {
      sendHttpText(response, 403, 'Forbidden: invalid Origin header');
      return;
    }
    if (origin !== undefined) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers':
          'Accept, Content-Type, MCP-Protocol-Version',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '600',
      });
      response.end();
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS');
      sendHttpText(response, 405, 'Method Not Allowed');
      return;
    }

    if (!hasJsonContentType(request.headers['content-type'])) {
      sendHttpText(response, 415, 'Content-Type must be application/json');
      return;
    }
    if (!acceptsMcpResponse(request.headers.accept)) {
      sendHttpText(
        response,
        406,
        'Accept must include application/json and text/event-stream'
      );
      return;
    }
    if (!hasSupportedProtocolVersion(request)) {
      sendHttpText(response, 400, 'Unsupported MCP-Protocol-Version');
      return;
    }

    const body = await readHttpBody(request);
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      sendHttpJson(response, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    const responses = await mcp.handle(message);
    if (responses.length === 0) {
      response.writeHead(202);
      response.end();
      return;
    }
    sendHttpJson(
      response,
      200,
      responses.length === 1 ? responses[0] : responses
    );
  } catch (error) {
    const status = error instanceof HttpTransportError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : 'Internal Server Error';
    sendHttpText(response, status, message);
  }
}

class HttpTransportError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

class McpServer {
  constructor(
    private timeLimit: number,
    private loadCard?: (card: AgentCard) => Promise<string>
  ) {}

  /** Handle one incoming message (or batch) and return the responses. */
  async handle(message: unknown): Promise<unknown[]> {
    if (Array.isArray(message)) {
      // JSON-RPC batch (pre-2025-06-18 clients): flatten the responses.
      const responses: unknown[] = [];
      for (const entry of message)
        responses.push(...(await this.handle(entry)));
      return responses;
    }

    if (typeof message !== 'object' || message === null)
      return [
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid request' },
        },
      ];

    const { id, method, params } = message as {
      id?: number | string | null;
      method?: unknown;
      params?: unknown;
    };

    // A message without a method is a response to a server-initiated
    // request; this server never sends any, so there is nothing to match.
    if (typeof method !== 'string') return [];

    // Notifications (no id) expect no response.
    if (id === undefined || id === null) return [];

    try {
      return [
        { jsonrpc: '2.0', id, result: await this.dispatch(method, params) },
      ];
    } catch (error) {
      const { code, message: text } =
        error instanceof McpError
          ? error
          : {
              code: -32603,
              message: error instanceof Error ? error.message : String(error),
            };
      return [{ jsonrpc: '2.0', id, error: { code, message: text } }];
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    const args = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'initialize': {
        const requested = args.protocolVersion;
        return {
          protocolVersion:
            typeof requested === 'string' &&
            PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'epsil', title: 'Epsil', version },
          instructions: INSTRUCTIONS,
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.callTool(args);
      case 'resources/list':
        return {
          resources: RESOURCES.map(({ card: _card, ...resource }) => resource),
        };
      case 'resources/templates/list':
        return { resourceTemplates: [] };
      case 'resources/read': {
        const resource = RESOURCES.find((x) => x.uri === args.uri);
        if (resource === undefined)
          throw new McpError(-32002, `Resource not found: ${args.uri}`);
        const text = await (this.loadCard ?? defaultLoadCard)(resource.card);
        return {
          contents: [{ uri: resource.uri, mimeType: 'text/markdown', text }],
        };
      }
      default:
        throw new McpError(-32601, `Method not found: ${method}`);
    }
  }

  private callTool(params: Record<string, unknown>): unknown {
    const name = params.name;
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    if (!TOOLS.some((tool) => tool.name === name))
      throw new McpError(-32602, `Unknown tool: ${name}`);

    // Argument and execution problems are tool results (`isError`), not
    // protocol errors, so the calling model can see and correct them.
    try {
      switch (name) {
        case 'evaluate':
          return this.evaluate(args);
        case 'check':
          return McpServer.check(args);
        case 'doc':
          return McpServer.doc(args);
        case 'parse':
          return McpServer.parse(args);
        case 'compile':
          return this.compile(args);
        default:
          return McpServer.serialize(args);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }

  private evaluate(args: Record<string, unknown>): unknown {
    const source = requireString(args, 'source');
    const timeLimit =
      args.timeLimit === undefined
        ? this.timeLimit
        : requireTimeLimit(args.timeLimit);

    const fancySymbols = optionalBoolean(args, 'fancySymbols');
    const format = optionalFormat(args);

    const session = makeEpsilSession(timeLimit);
    let result: EvaluationResult;
    let output: string[] = [];
    let diagnostics: unknown[];
    if (format === 'latex') {
      result = session.evaluateLatex(source);
      diagnostics = latexDiagnostics(result.value.errors);
    } else {
      ({ result, output } = evaluateWithConsoleCaptured(session, source));
      diagnostics = result.diagnostics.map((x) => diagnosticToJson(x, source));
    }
    const json = formatValue(result, 'json');
    return toolResult({
      ok: !hasErrors(result),
      // `value` is the human-facing rendering, but an MCP consumer is a
      // machine: a `Nothing` result stays spelled out here (the human mode
      // of `formatValue` suppresses it), so that '' keeps its one meaning —
      // "the source was empty".
      value: isSymbol(result.value, 'Nothing')
        ? 'Nothing'
        : formatValue(result, 'value'),
      epsil: formatValue(result, 'epsil', { fancySymbols }),
      latex: source.trim() === '' ? '' : result.value.latex,
      mathjson: json ? JSON.parse(json) : null,
      ...(output.length > 0 ? { output } : {}),
      diagnostics,
    });
  }

  private static check(args: Record<string, unknown>): unknown {
    const source = requireString(args, 'source');
    const wantEffects = optionalBoolean(args, 'effects');
    const { diagnostics, effects } = checkSource(source, undefined, {
      effects: wantEffects,
    });
    return toolResult({
      ok: !diagnostics.some((x) => x.severity === 'error'),
      diagnostics: diagnostics.map((x) => diagnosticToJson(x, source)),
      // `null` when the parse failed and nothing was analyzed.
      ...(effects === undefined
        ? {}
        : {
            effects:
              effects === null
                ? null
                : effects.map((x) => effectSummaryToJson(x, source)),
          }),
    });
  }

  private static doc(args: Record<string, unknown>): unknown {
    const query = requireString(args, 'query');
    // Diagnostic codes are doc-addressable, mirroring `epsil doc <code>`.
    const explanation = explainErrorCode(query);
    if (explanation !== undefined)
      return toolResult({ query, code: query.toLowerCase(), explanation });
    const limit =
      typeof args.limit === 'number' && Number.isInteger(args.limit)
        ? Math.min(Math.max(args.limit, 1), 100)
        : 10;
    const { entries } = lookupDoc(new ComputeEngine(), query, limit);
    return toolResult({ query, matches: entries });
  }

  private static parse(args: Record<string, unknown>): unknown {
    const source = requireString(args, 'source');
    if (optionalFormat(args) === 'latex') {
      // Non-canonical, like the Epsil path: the structure as written.
      const expr = new ComputeEngine().parse(source, { form: 'raw' });
      const diagnostics = latexDiagnostics(expr.errors);
      return toolResult({
        ok: diagnostics.length === 0,
        mathjson: expr.json,
        diagnostics,
      });
    }
    const { ast, diagnostics } = parseSource(source);
    // The raw AST is annotated with source offsets; a non-canonical box
    // round-trip normalizes it to plain MathJSON without resolving sugar.
    const mathjson =
      ast === null ? null : new ComputeEngine().box(ast, { form: 'raw' }).json;
    return toolResult({
      ok: !diagnostics.some((x) => x.severity === 'error'),
      mathjson,
      diagnostics: diagnostics.map((x) => diagnosticToJson(x, source)),
    });
  }

  /**
   * Compile the source on a fresh engine and report what the target
   * generates. Nothing is run. The engine's default `fallback` is kept, so a
   * decline is a result with `success: false` and a reason, which is what a
   * host sees on its own compile route; the tool reports `code` only for a
   * successful compile, because the code of a declined compile is an
   * interpreter call, not target code.
   */
  private compile(args: Record<string, unknown>): unknown {
    const source = requireString(args, 'source');
    const format = optionalFormat(args);
    const to = optionalEnum(args, 'to', COMPILE_TARGETS) ?? 'javascript';
    const mode: CompileMode | undefined = optionalEnum(
      args,
      'mode',
      COMPILE_MODES
    );
    const declarations = optionalDeclarations(args);
    const timeLimit =
      args.timeLimit === undefined
        ? this.timeLimit
        : requireTimeLimit(args.timeLimit);

    const ce = new ComputeEngine();
    // A declaration of a name the library already defines (`Pi`, `e`, `Sin`)
    // replaces the library definition for this call. That is allowed, since
    // a host can do the same, but the result says so: a caller that declares
    // every symbol it sees would otherwise get a compile that reads `Pi` as
    // an input, with nothing to show why.
    const warnings: string[] = [];
    for (const [name, type] of Object.entries(declarations)) {
      if (ce.lookupDefinition(name) !== undefined)
        warnings.push(
          `"${name}" is defined by the library; the declaration replaces that definition.`
        );
      try {
        ce.declare(name, type);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot declare "${name}" as "${type}": ${reason}`);
      }
    }
    const extra = warnings.length > 0 ? { warnings } : {};

    // Parsing and compiling run under the deadline, like `evaluate`: a large
    // expression can make a target work for a long time (an antiderivative
    // search, an unrolled comprehension), and one call must not block the
    // server for the other clients of an HTTP transport.
    const run = (): unknown => {
      // Parse first: a source with parse errors has no meaningful compilation.
      let expr: BoxedExpression;
      let diagnostics: unknown[];
      if (format === 'latex') {
        expr = ce.parse(source);
        diagnostics = latexDiagnostics(expr.errors);
      } else {
        const parsed = parseSource(source, undefined, ce);
        diagnostics = parsed.diagnostics.map((x) =>
          diagnosticToJson(x, source)
        );
        if (
          parsed.ast === null ||
          parsed.diagnostics.some((x) => x.severity === 'error')
        )
          return { ok: false, target: to, diagnostics, ...extra };
        expr = ce.box(parsed.ast);
      }
      if (diagnostics.length > 0)
        return { ok: false, target: to, diagnostics, ...extra };

      const result = compile(expr, { to, ...(mode ? { mode } : {}) });
      return {
        ok: result.success,
        target: to,
        ...(result.success ? { code: result.code } : {}),
        ...(result.mode === undefined ? {} : { mode: result.mode }),
        ...(result.freeSymbolTypes === undefined
          ? {}
          : { freeSymbolTypes: result.freeSymbolTypes }),
        ...(result.success
          ? {}
          : { error: result.error ?? 'Compilation failed' }),
        ...(result.diagnostic === undefined
          ? {}
          : { diagnostic: result.diagnostic }),
        ...(result.unsupported && result.unsupported.length > 0
          ? { unsupported: result.unsupported }
          : {}),
        diagnostics,
        ...extra,
      };
    };

    try {
      return toolResult(
        timeLimit > 0
          ? ce.withTimeLimit({ ms: timeLimit, label: 'epsil:compile' }, run)
          : run()
      );
    } catch (error) {
      if (!isTimeoutCancellation(error)) throw error;
      const message =
        error instanceof Error ? error.message : 'Timeout exceeded';
      return toolResult({
        ok: false,
        target: to,
        error: message,
        diagnostic: { code: 'timeout', message },
        diagnostics: [],
        ...extra,
      });
    }
  }

  private static serialize(args: Record<string, unknown>): unknown {
    if (args.mathjson === undefined)
      throw new Error('Expected a "mathjson" argument.');
    const fancySymbols = optionalBoolean(args, 'fancySymbols');
    if (optionalFormat(args) === 'latex') {
      // Boxed without canonicalization, so the LaTeX keeps the operand order
      // and structure of the input (as the Epsil serialization does).
      const expr = new ComputeEngine().box(
        args.mathjson as Parameters<ComputeEngine['box']>[0],
        { form: 'raw' }
      );
      return toolResult({ latex: expr.latex });
    }
    return toolResult({
      epsil: serializeEpsil(
        args.mathjson as Parameters<typeof serializeEpsil>[0],
        { fancySymbols }
      ),
    });
  }
}

/** A diagnostic for a LaTeX source, derived from an error expression: a
 * LaTeX parse error, a timeout, or an error of the evaluated value. The error
 * expressions do not carry source offsets, so unlike an Epsil diagnostic it
 * has no location: `latex` is the fragment the parser stopped at, when there
 * is one. */
interface LatexDiagnostic {
  severity: 'error';
  code: string;
  message: string;
  latex?: string;
}

function latexDiagnostics(
  errors: readonly BoxedExpression[]
): LatexDiagnostic[] {
  return errors.map((error) => {
    const [first, ...rest] = isFunction(error) ? error.ops : [];
    // A timeout is `["Error", message, "timeout"]`, the error value of a
    // deadline breach.
    if (isString(rest[0]) && rest[0].string === 'timeout')
      return {
        severity: 'error',
        code: 'timeout',
        message: isString(first) ? first.string : 'Timeout exceeded',
      };
    // The cause is a plain string code (`"unexpected-operator"`), or an
    // `["ErrorCode", code, ...details]` whose details name what the parser
    // saw, such as the name of an unknown environment.
    let code = 'error';
    const details: string[] = [];
    if (isString(first)) code = first.string;
    else if (isFunction(first, 'ErrorCode')) {
      const [head, ...tail] = first.ops;
      if (isString(head)) code = head.string;
      for (const x of tail) details.push(isString(x) ? x.string : x.toString());
    }
    const where = rest.find((x) => isFunction(x, 'LatexString'));
    const fragment =
      isFunction(where) && isString(where.op1) ? where.op1.string : undefined;
    const summary =
      details.length === 0 ? code : `${code} (${details.join(', ')})`;
    return {
      severity: 'error',
      code,
      message:
        fragment === undefined
          ? summary
          : `${summary}: ${JSON.stringify(fragment)}`,
      ...(fragment === undefined ? {} : { latex: fragment }),
    };
  });
}

/** The optional `format` argument of `evaluate`, `parse` and `serialize`. */
function optionalFormat(args: Record<string, unknown>): 'epsil' | 'latex' {
  const value = args.format;
  if (value === undefined) return 'epsil';
  if (value !== 'epsil' && value !== 'latex')
    throw new Error('Expected "format" to be "epsil" or "latex".');
  return value;
}

/** An optional boolean argument: `false` when absent, an error for any other
 * non-boolean value (a string `"true"` is refused, not coerced — the schema
 * declares the type, and a silent `false` would hide the caller's mistake).
 * Every optional boolean of the tool set goes through here, so the tools
 * answer a wrong type the same way. */
/** An optional string argument that must be one of `values`. */
function optionalEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error(
      `Expected "${key}" to be one of ${values.map((x) => `"${x}"`).join(', ')}.`
    );
  return value as T;
}

/** The optional `declarations` argument of `compile`: symbol name → type. */
function optionalDeclarations(
  args: Record<string, unknown>
): Record<string, string> {
  const value = args.declarations;
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(
      'Expected "declarations" to be an object that maps symbol names to types.'
    );
  for (const [name, type] of Object.entries(value))
    if (typeof type !== 'string')
      throw new Error(`Expected the type of "${name}" to be a string.`);
  return value as Record<string, string>;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean')
    throw new Error(`Expected a "${key}" boolean argument.`);
  return value;
}

function toolResult(payload: unknown): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string')
    throw new Error(`Expected a "${key}" string argument.`);
  return value;
}

function requireTimeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(
      'Expected "timeLimit" to be a non-negative integer (milliseconds).'
    );
  return value;
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

function isAllowedOrigin(
  origin: string | undefined,
  options: McpOptions
): boolean {
  if (origin === undefined) return true;
  if (options.allowedOrigins.includes(origin)) return true;
  if (!isLoopbackHost(options.host)) return false;

  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLoopbackHost(url.hostname)
    );
  } catch {
    return false;
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[(.*)\]$/u, '$1').toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
}

function hasJsonContentType(value: string | undefined): boolean {
  return value?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function acceptsMcpResponse(value: string | undefined): boolean {
  if (value === undefined) return false;
  const types = value
    .split(',')
    .map((x) => x.split(';', 1)[0].trim().toLowerCase());
  return (
    types.includes('application/json') && types.includes('text/event-stream')
  );
}

function hasSupportedProtocolVersion(request: IncomingMessage): boolean {
  const value = request.headers['mcp-protocol-version'];
  if (value === undefined) return true;
  return (
    typeof value === 'string' && STREAMABLE_HTTP_PROTOCOL_VERSIONS.has(value)
  );
}

async function readHttpBody(request: IncomingMessage): Promise<string> {
  const declaredLength = request.headers['content-length'];
  if (
    declaredLength !== undefined &&
    (/^\d+$/u.test(declaredLength) === false ||
      Number(declaredLength) > MAX_HTTP_BODY_BYTES)
  )
    throw new HttpTransportError(
      413,
      `Request body exceeds ${MAX_HTTP_BODY_BYTES} bytes`
    );

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_HTTP_BODY_BYTES)
      throw new HttpTransportError(
        413,
        `Request body exceeds ${MAX_HTTP_BODY_BYTES} bytes`
      );
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendHttpJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  if (response.headersSent || response.destroyed) return;
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Cache-Control': 'no-cache, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}

function sendHttpText(
  response: ServerResponse,
  status: number,
  text: string
): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}

function displayHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** Locate a card when the caller did not supply a loader (the installed CLI
 * resolves it relative to its own bundle; see `epsil.ts`). This fallback
 * covers running from a checkout of the repository. */
async function defaultLoadCard(card: AgentCard): Promise<string> {
  try {
    return await readFile(`src/${card}/docs/for-agents.md`, 'utf8');
  } catch {
    throw new McpError(-32002, `Resource not available: the ${card} card`);
  }
}
