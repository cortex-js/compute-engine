#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'dist', 'esm-min', 'cli', 'epsil.js');
const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
).version;

if (!existsSync(CLI)) fail(`${CLI} not found. Run the production build first.`);
if ((statSync(CLI).mode & 0o111) === 0) fail('CLI bundle is not executable.');

expectRun(['--version'], { stdout: `${PACKAGE_VERSION}\n` });
expectRun(['-e', 'let x = 1/2\nx + 1'], { stdout: '3/2\n' });
expectRun(['--json', '-e', '1/2 + 1'], {
  stdout: '[\n  "Rational",\n  3,\n  2\n]\n',
});
expectRun([], { input: 'let x = 3\nx^2\n', stdout: '9\n' });

const tempDirectory = mkdtempSync(join(tmpdir(), 'epsil-cli-smoke-'));
try {
  const sourceFile = join(tempDirectory, 'program.epsil');
  writeFileSync(sourceFile, 'let radius = 3\nPi * radius^2\n');
  expectRun(['--epsil', sourceFile], { stdout: '9Pi\n' });
} finally {
  rmSync(tempDirectory, { recursive: true });
}

const syntaxError = run(['-e', '1 +']);
if (syntaxError.status !== 1)
  fail(`syntax error exited ${syntaxError.status}, expected 1`);
if (!syntaxError.stderr.includes('Unexpected symbol "+"'))
  fail(`syntax error diagnostic missing:\n${syntaxError.stderr}`);

// MCP server: the language card must ship beside the CLI bundle, and the
// stdio server must answer a handshake, a tool call, and a resource read.
if (!existsSync(join(dirname(CLI), 'for-agents.md')))
  fail('for-agents.md was not copied beside the CLI bundle.');

const mcp = run(
  ['mcp'],
  [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'evaluate', arguments: { source: '1/2 + 1' } },
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'epsil://docs/for-agents' },
    },
  ]
    .map((message) => `${JSON.stringify(message)}\n`)
    .join('')
);
if (mcp.status !== 0) fail(`mcp exited ${mcp.status}\nstderr:\n${mcp.stderr}`);
const responses = mcp.stdout
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line));
if (responses.length !== 3)
  fail(`mcp returned ${responses.length} responses, expected 3`);
if (responses[0].result?.serverInfo?.name !== 'epsil')
  fail(`mcp initialize mismatch:\n${mcp.stdout}`);
const evaluated = JSON.parse(responses[1].result?.content?.[0]?.text ?? '{}');
if (evaluated.value !== '3/2')
  fail(`mcp evaluate returned ${evaluated.value}, expected 3/2`);
if (!responses[2].result?.contents?.[0]?.text?.includes('Epsil'))
  fail(`mcp language card resource missing:\n${mcp.stdout}`);

// Native Streamable HTTP transport: start on a free loopback port and call
// the built bundle through the advertised /mcp endpoint.
const httpMcp = spawn(
  process.execPath,
  [CLI, 'mcp', '--transport', 'streamable-http', '--port', '0'],
  {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  }
);
try {
  const endpoint = await waitForHttpEndpoint(httpMcp);
  const initialized = await postMcp(endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {} },
  });
  if (initialized.result?.serverInfo?.name !== 'epsil')
    fail(`HTTP MCP initialize mismatch:\n${JSON.stringify(initialized)}`);

  const httpEvaluated = await postMcp(
    endpoint,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'evaluate', arguments: { source: '1/2 + 1' } },
    },
    { 'MCP-Protocol-Version': '2025-11-25' }
  );
  const httpPayload = JSON.parse(
    httpEvaluated.result?.content?.[0]?.text ?? '{}'
  );
  if (httpPayload.value !== '3/2')
    fail(`HTTP MCP evaluate returned ${httpPayload.value}, expected 3/2`);
} finally {
  if (httpMcp.exitCode === null) {
    const exited = new Promise((resolve) => httpMcp.once('exit', resolve));
    httpMcp.kill('SIGTERM');
    await exited;
  }
}

console.log('epsil-cli-smoke: PASSED');

function expectRun(args, expected) {
  const result = run(args, expected.input);
  if (result.status !== 0)
    fail(
      `${args.join(' ')} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  if (result.stdout !== expected.stdout)
    fail(
      `${args.join(' ')} stdout mismatch\nexpected:\n${expected.stdout}\nactual:\n${result.stdout}`
    );
  if (result.stderr !== '')
    fail(`${args.join(' ')} wrote stderr:\n${result.stderr}`);
}

function run(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    input,
    encoding: 'utf8',
  });
}

function waitForHttpEndpoint(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`HTTP MCP did not start:\n${stderr}`));
    }, 5_000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/listening on (http:\/\/\S+)/u);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`HTTP MCP exited ${code} before listening:\n${stderr}`));
    });
  });
}

async function postMcp(endpoint, message, headers = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(message),
  });
  if (!response.ok)
    fail(`HTTP MCP returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function fail(message) {
  console.error(`epsil-cli-smoke: FAILED — ${message}`);
  process.exit(1);
}
