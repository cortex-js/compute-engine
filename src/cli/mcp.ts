import { readFile } from 'node:fs/promises';

import { ComputeEngine, serializeCortex, version } from '../cortex.js';

import { CliUsageError, parseMcpArguments } from './arguments.js';
import { parseSource } from './check.js';
import { lookupDoc } from './doc.js';
import { diagnosticToJson, formatValue, hasErrors } from './format.js';
import type { CliIo } from './io.js';
import { makeCortexSession } from './session.js';

/**
 * `cortex mcp` — a Model Context Protocol server over stdio, exposing the
 * same operations as the CLI as tools (`evaluate`, `check`, `doc`, `parse`,
 * `serialize`) and the agent-facing language card as a resource. The
 * protocol is newline-delimited JSON-RPC 2.0; it is implemented directly
 * rather than through the MCP SDK to keep the package dependency-free.
 *
 * Tool calls are stateless: each one runs against a fresh engine, so a
 * program must be self-contained. (A persistent session would also let one
 * call contaminate the next — e.g. boolean use retypes a symbol for the
 * engine's lifetime.)
 */

const CARD_URI = 'cortex://docs/for-agents';

/** Newest first; `initialize` echoes the client's version when supported. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

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
  },
  {
    name: 'check',
    description:
      'Parse a Cortex program and report diagnostics without evaluating it. This is the fast validation loop: it catches syntax, string and type-annotation errors, but not runtime problems (unknown functions, type mismatches at call sites).',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Cortex source code' },
      },
      required: ['source'],
    },
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
    const { diagnostics } = parseSource(source);
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
