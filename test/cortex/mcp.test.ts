import { parseMcpArguments, CliUsageError } from '../../src/cli/arguments';
import { main, type CliIo } from '../../src/cli/main';

/** Run `cortex mcp` over a scripted stdin and return the JSON responses. */
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
    expect(response.result.serverInfo.name).toBe('cortex');
    expect(response.result.capabilities).toEqual({
      tools: {},
      resources: {},
    });
    expect(response.result.instructions).toContain('cortex://docs/for-agents');
  });

  test('falls back to its newest protocol version', async () => {
    const [response] = await runServer([
      request(1, 'initialize', { protocolVersion: '1999-01-01' }),
    ]);
    expect(response.result.protocolVersion).toBe('2025-06-18');
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
    expect(result.cortex).toBe('3 / 2');
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

  test('serialize converts MathJSON to Cortex source', async () => {
    const [response] = await runServer([
      callTool(1, 'serialize', { mathjson: ['Add', 'x', 1] }),
    ]);
    expect(payload(response).cortex).toBe('x + 1');
  });

  test('rejects an unknown tool as a protocol error', async () => {
    const [response] = await runServer([callTool(1, 'bogus', {})]);
    expect(response.error.code).toBe(-32602);
  });
});

describe('MCP server resources', () => {
  test('lists and reads the language card', async () => {
    const loadCard = async () => '# Cortex card fixture';
    const responses = await runServer(
      [
        request(1, 'resources/list'),
        request(2, 'resources/read', { uri: 'cortex://docs/for-agents' }),
        request(3, 'resources/read', { uri: 'cortex://bogus' }),
      ],
      { loadCard }
    );
    expect(responses[0].result.resources).toHaveLength(1);
    expect(responses[0].result.resources[0]).toMatchObject({
      uri: 'cortex://docs/for-agents',
      mimeType: 'text/markdown',
    });
    expect(responses[1].result.contents[0].text).toBe('# Cortex card fixture');
    expect(responses[2].error.code).toBe(-32002);
  });

  test('serves the real card from a repository checkout', async () => {
    // No loadCard injected: the default reads from the working directory.
    const [response] = await runServer([
      request(1, 'resources/read', { uri: 'cortex://docs/for-agents' }),
    ]);
    expect(response.result.contents[0].text).toContain('Cortex');
  });
});

describe('MCP server arguments', () => {
  test('parses the default time limit', () => {
    expect(parseMcpArguments([])).toEqual({ timeLimit: 10_000 });
    expect(parseMcpArguments(['--time-limit', '250'])).toEqual({
      timeLimit: 250,
    });
    expect(() => parseMcpArguments(['extra'])).toThrow(CliUsageError);
    expect(() => parseMcpArguments(['--time-limit', '-1'])).toThrow(
      CliUsageError
    );
  });
});
