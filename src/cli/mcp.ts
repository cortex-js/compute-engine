import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { ComputeEngine, serializeCortex, version } from '../cortex.js';

import { CliUsageError, parseMcpArguments } from './arguments.js';
import { checkSource, parseSource } from './check.js';
import { lookupDoc } from './doc.js';
import { diagnosticToJson, formatValue, hasErrors } from './format.js';
import type { CliIo } from './io.js';
import { makeCortexSession } from './session.js';
import type { McpOptions } from './types.js';

/**
 * `cortex mcp` — a Model Context Protocol server over stdio or Streamable
 * HTTP, exposing the same operations as the CLI as tools (`evaluate`,
 * `check`, `doc`, `parse`, `serialize`) and the agent-facing language card
 * as a resource. It is implemented directly rather than through the MCP SDK
 * to keep the package dependency-free.
 *
 * Tool calls are stateless: each one runs against a fresh engine, so a
 * program must be self-contained. (A persistent session would also let one
 * call contaminate the next — e.g. boolean use retypes a symbol for the
 * engine's lifetime.)
 */

const CARD_URI = 'cortex://docs/for-agents';
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

const INSTRUCTIONS = `Tools for Cortex, the programming language of the Compute Engine (https://cortexjs.io). Before writing Cortex source, read the language card resource (${CARD_URI}). Each "evaluate" call runs a complete, self-contained program in a fresh session; definitions do not persist between calls. Use "check" for fast syntax validation and "doc" to look up library functions.`;

const TOOLS = [
  {
    name: 'evaluate',
    description:
      'Evaluate a complete Cortex program and return its value (the value of the last statement) in display, Cortex and MathJSON forms, along with any diagnostics. Each call runs in a fresh session: definitions do not persist between calls, so the program must be self-contained.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Cortex source code' },
        timeLimit: {
          type: 'number',
          description:
            'Evaluation deadline in milliseconds; 0 disables it (default: 10000)',
        },
      },
      required: ['source'],
    },
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'check',
    description:
      'Parse and canonicalize a Cortex program and report diagnostics without evaluating it. This is the fast validation loop: it catches syntax, string and type-annotation errors, and the type errors detected at canonicalization time (e.g. "a" + 1), but not genuinely dynamic problems (an out-of-range index, a match with no matching case).',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Cortex source code' },
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
      'Parse a Cortex program into MathJSON without evaluating it. Returns the MathJSON expression and any diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Cortex source code' },
      },
      required: ['source'],
    },
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'serialize',
    description: 'Convert a MathJSON expression to Cortex source.',
    inputSchema: {
      type: 'object',
      properties: {
        mathjson: {
          description: 'A MathJSON expression, e.g. ["Add", "x", 1]',
        },
      },
      required: ['mathjson'],
    },
    annotations: readOnlyAnnotations(),
  },
];

const CARD_RESOURCE = {
  uri: CARD_URI,
  name: 'cortex-language-card',
  title: 'Cortex language card',
  description:
    'A compact guide to the Cortex language for agents: syntax, semantics, idioms, common traps and a roster of the standard library. Read this before writing Cortex.',
  mimeType: 'text/markdown',
};

function readOnlyAnnotations(): Record<string, boolean> {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
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
    io.stderr.write(`${message}Try "cortex --help" for more information.\n`);
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
      io.stderr.write(`cortex mcp: ${error.message}\n`);
      resolve(1);
    };
    server.once('error', handleListenError);
    server.listen(options.port, options.host, () => {
      server.off('error', handleListenError);
      const address = server.address() as AddressInfo | null;
      const port = address?.port ?? options.port;
      io.stderr.write(
        `Cortex MCP server listening on http://${displayHost(
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
  loadCard?: () => Promise<string>
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
    private loadCard?: () => Promise<string>
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
          serverInfo: { name: 'cortex', title: 'Cortex', version },
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
        return { resources: [CARD_RESOURCE] };
      case 'resources/templates/list':
        return { resourceTemplates: [] };
      case 'resources/read': {
        if (args.uri !== CARD_URI)
          throw new McpError(-32002, `Resource not found: ${args.uri}`);
        const text = await (this.loadCard ?? defaultLoadCard)();
        return {
          contents: [{ uri: CARD_URI, mimeType: 'text/markdown', text }],
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

    const result = makeCortexSession(timeLimit).evaluate(source);
    const json = formatValue(result, 'json');
    return toolResult({
      ok: !hasErrors(result),
      value: formatValue(result, 'value'),
      cortex: formatValue(result, 'cortex'),
      mathjson: json ? JSON.parse(json) : null,
      diagnostics: result.diagnostics.map((x) => diagnosticToJson(x, source)),
    });
  }

  private static check(args: Record<string, unknown>): unknown {
    const source = requireString(args, 'source');
    const { diagnostics } = checkSource(source);
    return toolResult({
      ok: !diagnostics.some((x) => x.severity === 'error'),
      diagnostics: diagnostics.map((x) => diagnosticToJson(x, source)),
    });
  }

  private static doc(args: Record<string, unknown>): unknown {
    const query = requireString(args, 'query');
    const limit =
      typeof args.limit === 'number' && Number.isInteger(args.limit)
        ? Math.min(Math.max(args.limit, 1), 100)
        : 10;
    const { entries } = lookupDoc(new ComputeEngine(), query, limit);
    return toolResult({ query, matches: entries });
  }

  private static parse(args: Record<string, unknown>): unknown {
    const source = requireString(args, 'source');
    const { ast, diagnostics } = parseSource(source);
    // The raw AST is annotated with source offsets; a non-canonical box
    // round-trip normalizes it to plain MathJSON without resolving sugar.
    const mathjson =
      ast === null
        ? null
        : new ComputeEngine().box(ast, { canonical: false }).json;
    return toolResult({
      ok: !diagnostics.some((x) => x.severity === 'error'),
      mathjson,
      diagnostics: diagnostics.map((x) => diagnosticToJson(x, source)),
    });
  }

  private static serialize(args: Record<string, unknown>): unknown {
    if (args.mathjson === undefined)
      throw new Error('Expected a "mathjson" argument.');
    return toolResult({
      cortex: serializeCortex(
        args.mathjson as Parameters<typeof serializeCortex>[0]
      ),
    });
  }
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

/** Locate the language card when the caller did not supply a loader (the
 * installed CLI resolves it relative to its own bundle; see `cortex.ts`).
 * This fallback covers running from a checkout of the repository. */
async function defaultLoadCard(): Promise<string> {
  try {
    return await readFile('src/cortex/docs/for-agents.md', 'utf8');
  } catch {
    throw new McpError(-32002, `Resource not available: ${CARD_URI}`);
  }
}
