import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { parseMcpArguments, CliUsageError } from '../../src/cli/arguments';
import { main, type CliIo } from '../../src/cli/main';
import { createMcpHttpServer } from '../../src/cli/mcp';

/** Run `epsil mcp` over a scripted stdin and return the JSON responses. */
async function runServer(
  requests: unknown[],
  options?: { loadCard?: () => Promise<string>; raw?: string[] }
): Promise<any[]> {
  let out = '';
  let err = '';
  const lines =
    options?.raw ?? requests.map((request) => `${JSON.stringify(request)}\n`);
  const io: CliIo = {
    stdin: {
      isTTY: false,
      setEncoding() {},
      async *[Symbol.asyncIterator]() {
        yield* lines;
      },
    } as unknown as NodeJS.ReadStream,
    stdout: {
      isTTY: false,
      write: (s: string) => ((out += s), true),
    } as unknown as NodeJS.WriteStream,
    stderr: {
      isTTY: false,
      write: (s: string) => ((err += s), true),
    } as unknown as NodeJS.WriteStream,
    env: {},
    loadCard: options?.loadCard,
  };
  expect(await main(['mcp'], io)).toBe(0);
  expect(err).toBe('');
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function request(id: number, method: string, params?: unknown) {
  return { jsonrpc: '2.0', id, method, params };
}

function callTool(id: number, name: string, args: unknown) {
  return request(id, 'tools/call', { name, arguments: args });
}

async function startHttpServer(
  extraArgs: string[] = []
): Promise<{ server: Server; endpoint: string }> {
  const options = parseMcpArguments([
    '--transport',
    'streamable-http',
    '--port',
    '0',
    ...extraArgs,
  ]);
  const server = createMcpHttpServer(
    options,
    async () => '# Epsil card fixture'
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    endpoint: `http://${options.host}:${address.port}${options.path}`,
  };
}

async function stopHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function postMcp(
  endpoint: string,
  message: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(message),
  });
}

/** The payload of a tool result: parsed from its JSON text content. */
function payload(response: any): any {
  expect(response.error).toBeUndefined();
  expect(response.result.content).toHaveLength(1);
  expect(response.result.content[0].type).toBe('text');
  return JSON.parse(response.result.content[0].text);
}

describe('MCP server protocol', () => {
  test('initializes with tool and resource capabilities', async () => {
    const [response] = await runServer([
      request(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      }),
    ]);
    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe('2025-06-18');
    expect(response.result.serverInfo.name).toBe('epsil');
    expect(response.result.capabilities).toEqual({
      tools: {},
      resources: {},
    });
    expect(response.result.instructions).toContain('epsil://docs/for-agents');
  });

  test('falls back to its newest protocol version', async () => {
    const [response] = await runServer([
      request(1, 'initialize', { protocolVersion: '1999-01-01' }),
    ]);
    expect(response.result.protocolVersion).toBe('2025-11-25');
  });

  test('lists the five tools', async () => {
    const [response] = await runServer([request(1, 'tools/list')]);
    expect(response.result.tools.map((x: any) => x.name)).toEqual([
      'evaluate',
      'check',
      'doc',
      'parse',
      'serialize',
    ]);
    for (const tool of response.result.tools) {
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  test('answers ping, ignores notifications, rejects unknown methods', async () => {
    const responses = await runServer([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      request(1, 'ping'),
      request(2, 'bogus/method'),
    ]);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(responses[1].error.code).toBe(-32601);
  });

  test('reports malformed JSON as a parse error', async () => {
    const responses = await runServer([], { raw: ['this is not json\n'] });
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      id: null,
      error: { code: -32700 },
    });
  });

  test('splits messages across chunk boundaries', async () => {
    const line = `${JSON.stringify(request(1, 'ping'))}\n`;
    const responses = await runServer([], {
      raw: [line.slice(0, 10), line.slice(10)],
    });
    expect(responses[0].result).toEqual({});
  });
});

describe('MCP server tools', () => {
  test('evaluate returns the value in every form', async () => {
    const [response] = await runServer([
      callTool(1, 'evaluate', { source: '1/2 + 1' }),
    ]);
    const result = payload(response);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('3/2');
    expect(result.epsil).toBe('3 / 2');
    expect(result.mathjson).toEqual(['Rational', 3, 2]);
    expect(result.diagnostics).toEqual([]);
  });

  test('evaluate reports diagnostics for a broken program', async () => {
    const [response] = await runServer([
      callTool(1, 'evaluate', { source: '1 +' }),
    ]);
    const result = payload(response);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].severity).toBe('error');
  });

  test('evaluate calls are independent sessions', async () => {
    const responses = await runServer([
      callTool(1, 'evaluate', { source: 'let x = 5\nx' }),
      callTool(2, 'evaluate', { source: 'x' }),
    ]);
    expect(payload(responses[0]).value).toBe('5');
    // A fresh session: `x` from the previous call did not persist.
    expect(payload(responses[1]).value).toBe('x');
  });

  test('evaluate captures print output instead of writing the transport stream', async () => {
    // The stdio transport carries JSON-RPC on stdout, so `print` must land
    // in the tool result's `output` lines, never on the real console.
    const logged: unknown[][] = [];
    const spy = jest
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    try {
      const [response] = await runServer([
        callTool(1, 'evaluate', { source: 'print("hi", 6 * 7)\n1' }),
      ]);
      const result = payload(response);
      expect(result.ok).toBe(true);
      expect(result.output).toEqual(['hi 42']);
      expect(logged).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test('evaluate keeps input() symbolic instead of reading the transport stream', async () => {
    // Reading stdin would consume (or block on) protocol bytes, so the
    // interactive-input backends are hidden during evaluation and the call
    // stays unevaluated.
    const [response] = await runServer([
      callTool(1, 'evaluate', { source: 'input("Who? ")' }),
    ]);
    const result = payload(response);
    expect(result.ok).toBe(true);
    expect(result.value).toContain('Input');
  });

  test('evaluate validates its arguments as a tool error', async () => {
    const [response] = await runServer([callTool(1, 'evaluate', {})]);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain('source');
  });

  test('check reports diagnostics without evaluating', async () => {
    const responses = await runServer([
      callTool(1, 'check', { source: 'a+ b' }),
      callTool(2, 'check', { source: '1 +' }),
    ]);
    const warned = payload(responses[0]);
    expect(warned.ok).toBe(true);
    expect(warned.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'asymmetric-operator-whitespace',
      fixits: [{ start: 1, end: 2, value: ' + ' }],
    });
    expect(payload(responses[1]).ok).toBe(false);
  });

  test('check reports canonicalization-time type errors', async () => {
    const [response] = await runServer([
      callTool(1, 'check', { source: 'let x = 5\nx + "a"' }),
    ]);
    const result = payload(response);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'static-type-error',
      line: 2,
    });
    expect(result.diagnostics[0].message).toContain('expected `number`');
  });

  test('doc looks up a symbol by name', async () => {
    const [response] = await runServer([callTool(1, 'doc', { query: 'Sin' })]);
    const result = payload(response);
    expect(result.query).toBe('Sin');
    expect(result.matches[0].id).toBe('Sin');
    expect(result.matches[0].kind).toBe('function');
  });

  test('parse returns clean MathJSON without evaluating', async () => {
    const [response] = await runServer([
      callTool(1, 'parse', { source: '1 + 2' }),
    ]);
    const result = payload(response);
    expect(result.ok).toBe(true);
    expect(result.mathjson).toEqual(['Add', 1, 2]);
  });

  test('serialize converts MathJSON to Epsil source', async () => {
    const [response] = await runServer([
      callTool(1, 'serialize', { mathjson: ['Add', 'x', 1] }),
    ]);
    expect(payload(response).epsil).toBe('x + 1');
  });

  test('rejects an unknown tool as a protocol error', async () => {
    const [response] = await runServer([callTool(1, 'bogus', {})]);
    expect(response.error.code).toBe(-32602);
  });
});

describe('MCP server resources', () => {
  test('lists and reads the language card', async () => {
    const loadCard = async () => '# Epsil card fixture';
    const responses = await runServer(
      [
        request(1, 'resources/list'),
        request(2, 'resources/read', { uri: 'epsil://docs/for-agents' }),
        request(3, 'resources/read', { uri: 'epsil://bogus' }),
      ],
      { loadCard }
    );
    expect(responses[0].result.resources).toHaveLength(1);
    expect(responses[0].result.resources[0]).toMatchObject({
      uri: 'epsil://docs/for-agents',
      mimeType: 'text/markdown',
    });
    expect(responses[1].result.contents[0].text).toBe('# Epsil card fixture');
    expect(responses[2].error.code).toBe(-32002);
  });

  test('serves the real card from a repository checkout', async () => {
    // No loadCard injected: the default reads from the working directory.
    const [response] = await runServer([
      request(1, 'resources/read', { uri: 'epsil://docs/for-agents' }),
    ]);
    expect(response.result.contents[0].text).toContain('Epsil');
  });
});

describe('MCP Streamable HTTP transport', () => {
  test('initializes, lists tools, evaluates and reads resources', async () => {
    const { server, endpoint } = await startHttpServer();
    try {
      const initialized = await postMcp(
        endpoint,
        request(1, 'initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'http-test', version: '0' },
        })
      );
      expect(initialized.status).toBe(200);
      expect(initialized.headers.get('content-type')).toContain(
        'application/json'
      );
      expect((await initialized.json()) as any).toMatchObject({
        id: 1,
        result: {
          protocolVersion: '2025-11-25',
          serverInfo: { name: 'epsil' },
        },
      });

      const listed = await postMcp(endpoint, request(2, 'tools/list'), {
        'MCP-Protocol-Version': '2025-11-25',
      });
      expect(listed.status).toBe(200);
      expect(
        ((await listed.json()) as any).result.tools.map((x: any) => x.name)
      ).toEqual(['evaluate', 'check', 'doc', 'parse', 'serialize']);

      const evaluated = await postMcp(
        endpoint,
        callTool(3, 'evaluate', { source: '1/2 + 1' }),
        { 'MCP-Protocol-Version': '2025-11-25' }
      );
      expect(payload(await evaluated.json())).toMatchObject({
        ok: true,
        value: '3/2',
      });

      const resource = await postMcp(
        endpoint,
        request(4, 'resources/read', {
          uri: 'epsil://docs/for-agents',
        }),
        { 'MCP-Protocol-Version': '2025-11-25' }
      );
      expect((await resource.json()) as any).toMatchObject({
        result: {
          contents: [{ text: '# Epsil card fixture' }],
        },
      });
    } finally {
      await stopHttpServer(server);
    }
  });

  test('returns 202 for accepted notifications', async () => {
    const { server, endpoint } = await startHttpServer();
    try {
      const response = await postMcp(endpoint, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
      expect(response.status).toBe(202);
      expect(await response.text()).toBe('');
    } finally {
      await stopHttpServer(server);
    }
  });

  test('enforces endpoint, method, media type and protocol headers', async () => {
    const { server, endpoint } = await startHttpServer();
    try {
      expect((await fetch(`${endpoint}/wrong`)).status).toBe(404);
      expect((await fetch(endpoint)).status).toBe(405);

      const wrongContentType = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'accept': 'application/json, text/event-stream',
          'content-type': 'text/plain',
        },
        body: '{}',
      });
      expect(wrongContentType.status).toBe(415);

      const wrongAccept = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(wrongAccept.status).toBe(406);

      const wrongVersion = await postMcp(endpoint, request(1, 'ping'), {
        'MCP-Protocol-Version': '1999-01-01',
      });
      expect(wrongVersion.status).toBe(400);

      const tooLarge = await postMcp(
        endpoint,
        callTool(2, 'evaluate', { source: 'x'.repeat(1024 * 1024) })
      );
      expect(tooLarge.status).toBe(413);
    } finally {
      await stopHttpServer(server);
    }
  });

  test('rejects unapproved browser origins and allows configured origins', async () => {
    const first = await startHttpServer();
    try {
      const rejected = await postMcp(first.endpoint, request(1, 'ping'), {
        origin: 'https://example.com',
      });
      expect(rejected.status).toBe(403);

      const local = await postMcp(first.endpoint, request(2, 'ping'), {
        origin: 'http://localhost:3000',
      });
      expect(local.status).toBe(200);
    } finally {
      await stopHttpServer(first.server);
    }

    const second = await startHttpServer([
      '--allow-origin',
      'https://example.com',
    ]);
    try {
      const allowed = await postMcp(second.endpoint, request(3, 'ping'), {
        origin: 'https://example.com',
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        'https://example.com'
      );

      const preflight = await fetch(second.endpoint, {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com' },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-methods')).toContain(
        'POST'
      );
    } finally {
      await stopHttpServer(second.server);
    }
  });

  test('reports malformed JSON as a JSON-RPC parse error', async () => {
    const { server, endpoint } = await startHttpServer();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'accept': 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: '{',
      });
      expect(response.status).toBe(400);
      expect((await response.json()) as any).toMatchObject({
        id: null,
        error: { code: -32700 },
      });
    } finally {
      await stopHttpServer(server);
    }
  });
});

describe('MCP server arguments', () => {
  test('parses stdio and Streamable HTTP options', () => {
    expect(parseMcpArguments([])).toEqual({
      timeLimit: 10_000,
      transport: 'stdio',
      host: '127.0.0.1',
      port: 8000,
      path: '/mcp',
      allowedOrigins: [],
    });
    expect(
      parseMcpArguments([
        '--transport',
        'streamable-http',
        '--time-limit',
        '250',
        '--host',
        'localhost',
        '--port',
        '3000',
        '--path',
        '/epsil',
        '--allow-origin',
        'https://chatgpt.com',
        '--allow-origin',
        'http://localhost:6274',
      ])
    ).toEqual({
      timeLimit: 250,
      transport: 'streamable-http',
      host: 'localhost',
      port: 3000,
      path: '/epsil',
      allowedOrigins: ['https://chatgpt.com', 'http://localhost:6274'],
    });
  });

  test('rejects invalid MCP server options', () => {
    expect(() => parseMcpArguments(['extra'])).toThrow(CliUsageError);
    expect(() => parseMcpArguments(['--time-limit', '-1'])).toThrow(
      CliUsageError
    );
    expect(() =>
      parseMcpArguments(['--transport', 'streamable-http', '--port', '65536'])
    ).toThrow(CliUsageError);
    expect(() =>
      parseMcpArguments(['--transport', 'streamable-http', '--path', 'mcp'])
    ).toThrow(CliUsageError);
    expect(() =>
      parseMcpArguments(['--transport', 'streamable-http', '--host', 'a/b'])
    ).toThrow(CliUsageError);
    expect(() =>
      parseMcpArguments([
        '--transport',
        'streamable-http',
        '--allow-origin',
        'https://example.com/path',
      ])
    ).toThrow(CliUsageError);
    expect(() => parseMcpArguments(['--port', '8000'])).toThrow(CliUsageError);
  });
});
