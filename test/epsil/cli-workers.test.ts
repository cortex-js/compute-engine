import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import {
  CliUsageError,
  parseCliArguments,
  parseMcpArguments,
} from '../../src/cli/arguments';
import { main, type CliIo } from '../../src/cli/main';
import { runRepl } from '../../src/cli/repl';
import { makeEpsilSession } from '../../src/cli/session';
import { createKernelPool, defaultPoolSize } from '../../src/compute-engine';

// The `--workers <n>` option of the `epsil` command, the REPL and the MCP
// server (ROADMAP CE-314.1, design section 5.7 of
// docs/plans/2026-10-20-worker-kernel-pool.md). With a value above zero, the
// engine gets a kernel pool of that size (`ce.workers`) and each program runs
// through `executeEpsilAsync`, so that a `findFit` with a global search scans
// on the workers. Without the option, a program runs through `executeEpsil`
// as before. The workers are Node `worker_threads` running the worker entry
// from source through the tsx loader; at most two, as the shared box caps
// test workers.

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

/** A worker factory that counts the workers it created and terminated. */
function countingFactory(): {
  createWorker: NonNullable<CliIo['createWorker']>;
  created: () => number;
  terminated: () => number;
} {
  let created = 0;
  let terminated = 0;
  return {
    createWorker: () => {
      created++;
      const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
      return {
        postMessage: (m: unknown, t?: ArrayBuffer[]) => w.postMessage(m, t),
        terminate: () => {
          terminated++;
          return w.terminate();
        },
        on: (event, handler) => w.on(event, handler),
      };
    },
    created: () => created,
    terminated: () => terminated,
  };
}

function makeIo(
  createWorker?: CliIo['createWorker'],
  lines: string[] = []
): { io: CliIo; stdout: () => string; stderr: () => string } {
  let out = '';
  let err = '';
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
    createWorker,
  };
  return { io, stdout: () => out, stderr: () => err };
}

/** A fit of `a cos(b x + c) + d x + e` to 200 rows with a global search
 * over `b` and `c`: the pool takes its scan (the same fit as in
 * test/compute-engine/ce-424-425-findfit-async.test.ts). The program's
 * value is the route of the fit and its parameters. */
function fitProgram(): string {
  const n = 200;
  const xs = Array.from({ length: n }, (_, i) => (10 * i) / (n - 1));
  const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.1 * x + Math.E);
  const data = xs.map((x, i) => `(${x}, ${ys[i]})`).join(', ');
  return [
    `let data = [${data}]`,
    'let r = findFit(data, a * cos(b * x + c) + d * x + 2.718281828459045, [a, b, c, d], [x], {"global" -> {"b" -> [0.3, 120], "c" -> [0, 6.28]}})',
    '[r.route, r.parameters]',
  ].join('\n');
}

describe('the --workers option: arguments', () => {
  test('parses a pool size; the default is no pool', () => {
    expect(parseCliArguments([], {}).workers).toBe(0);
    expect(parseCliArguments(['--workers', '3'], {}).workers).toBe(3);
    expect(parseCliArguments(['--workers', '0'], {}).workers).toBe(0);
    expect(parseMcpArguments([]).workers).toBe(0);
    expect(parseMcpArguments(['--workers', '2']).workers).toBe(2);
  });

  test('"auto" gives the default pool size, from 1 to 8', () => {
    const size = defaultPoolSize();
    expect(size).toBeGreaterThanOrEqual(1);
    expect(size).toBeLessThanOrEqual(8);
    expect(parseCliArguments(['--workers', 'auto'], {}).workers).toBe(size);
    expect(parseMcpArguments(['--workers', 'auto']).workers).toBe(size);
    // A pool, so the options that do not run asynchronously are refused.
    expect(() =>
      parseCliArguments(['--workers', 'auto', '--compile', '-e', '1'], {})
    ).toThrow(CliUsageError);
    // The name is case-sensitive, as the other option values are.
    expect(() => parseCliArguments(['--workers', 'AUTO'], {})).toThrow(
      CliUsageError
    );
  });

  test('rejects a value that is not a non-negative integer', () => {
    for (const value of ['-1', '1.5', 'many', ''])
      expect(() => parseCliArguments(['--workers', value], {})).toThrow(
        CliUsageError
      );
    expect(() => parseMcpArguments(['--workers', 'x'])).toThrow(CliUsageError);
  });

  test('refuses a value above 256, with a message that names the limit', () => {
    expect(parseCliArguments(['--workers', '256'], {}).workers).toBe(256);
    expect(() => parseCliArguments(['--workers', '257'], {})).toThrow(
      /at most 256/
    );
    expect(() => parseMcpArguments(['--workers', '100000'])).toThrow(
      /at most 256/
    );
  });

  test('is refused where no program runs asynchronously', () => {
    // A compiled program and a LaTeX expression do not take the
    // asynchronous route, so the pool would not be used.
    expect(() =>
      parseCliArguments(['--workers', '2', '--compile', '-e', '1'], {})
    ).toThrow(CliUsageError);
    expect(() =>
      parseCliArguments(['--workers', '2', '--from', 'latex', '-e', '1'], {})
    ).toThrow(CliUsageError);
    // Zero is the same as no option.
    expect(
      parseCliArguments(['--workers', '0', '--compile', '-e', '1'], {}).compile
    ).toBe(true);
  });

  test('a host with no worker factory refuses a pool', async () => {
    const { io, stdout, stderr } = makeIo(undefined);
    expect(await main(['--workers', '2', '-e', '1 + 2'], io)).toBe(1);
    expect(stdout()).toBe('');
    expect(stderr()).toMatch(/--workers option needs worker threads/);
    // Without the option, the same host runs the program.
    const other = makeIo(undefined);
    expect(await main(['-e', '1 + 2'], other.io)).toBe(0);
    expect(other.stdout()).toBe('3\n');
  });
});

describe('the --workers option: the epsil command', () => {
  test('a program with no asynchronous work starts no worker', async () => {
    const factory = countingFactory();
    const { io, stdout, stderr } = makeIo(factory.createWorker);
    expect(await main(['--workers', '2', '-e', 'let x = 1/2\nx + 1'], io)).toBe(
      0
    );
    expect(stderr()).toBe('');
    expect(stdout()).toBe('3/2\n');
    // The pool creates its workers for its first batch only.
    expect(factory.created()).toBe(0);
  });

  test('a fit scans on the pool, with the values of the calling thread', async () => {
    const source = fitProgram();
    // Without the option, the program runs on the synchronous route: the
    // record of the fit has no `route`.
    const plain = makeIo();
    // No time limit: the synchronous scan takes seconds on a loaded machine.
    expect(await main(['--time-limit', '0', '-e', source], plain.io)).toBe(0);
    expect(plain.stdout()).toMatch(/^\["Missing",/);

    const factory = countingFactory();
    const pooled = makeIo(factory.createWorker);
    expect(
      await main(
        ['--workers', '2', '--time-limit', '0', '-e', source],
        pooled.io
      )
    ).toBe(0);
    expect(pooled.stderr()).toBe('');
    expect(pooled.stdout()).toMatch(/^\["pool",/);
    // The parameters are the parameters of the synchronous route.
    expect(pooled.stdout().replace('"pool"', '')).toBe(
      plain.stdout().replace('"Missing"', '')
    );
    expect(factory.created()).toBeGreaterThan(0);
    expect(factory.created()).toBeLessThanOrEqual(2);
    // The pool is closed when the program ends, so that the process can
    // exit.
    expect(factory.terminated()).toBe(factory.created());
  }, 60_000);

  test('the time limit applies to the whole asynchronous program', async () => {
    const factory = countingFactory();
    const { io, stderr } = makeIo(factory.createWorker);
    const status = await main(
      [
        '--workers',
        '1',
        '--time-limit',
        '100',
        '-e',
        'let c = 0\nwhile c >= 0 { c = c + 1 }',
      ],
      io
    );
    expect(status).toBe(1);
    expect(stderr()).toMatch(/timeout|time limit|Timeout/i);
  }, 30_000);
});

describe('the --workers option: the REPL', () => {
  test('entries run asynchronously, in order, and share their declarations', async () => {
    const factory = countingFactory();
    const pool = createKernelPool({ create: factory.createWorker, size: 1 });
    const session = makeEpsilSession(0, pool);
    expect(session.engine.workers).toBe(pool);
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => (text += String(chunk)));
    const exited = runRepl(session, {
      color: false,
      outputMode: 'value',
      historyPath: '',
      input,
      output,
    });
    // Two entries written at once: the second waits for the first.
    input.write('let a = 20\n');
    input.write('a + 1\n');
    for (let i = 0; i < 200 && !text.includes('21'); i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(text).toContain('21');
    // `.clear` (a reset) gives the new engine the same pool.
    input.write('.clear\n');
    expect(session.engine.workers).toBe(pool);
    input.write('.exit\n');
    expect(await exited).toBe(0);
    pool.dispose();
  }, 30_000);

  test('a .clear written after a .load waits for the file to run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'epsil-repl-'));
    const file = join(dir, 'defs.epsil');
    writeFileSync(file, 'let b = 5\nb');
    const factory = countingFactory();
    const pool = createKernelPool({ create: factory.createWorker, size: 1 });
    const session = makeEpsilSession(0, pool);
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => (text += String(chunk)));
    const exited = runRepl(session, {
      color: false,
      outputMode: 'value',
      historyPath: '',
      input,
      output,
    });
    // The three lines arrive together. The file runs in the engine before
    // the reset, so the entry after the reset does not see `b`.
    input.write(`.load ${file}\n.clear\nb + 100\n`);
    for (let i = 0; i < 200 && !/b \+ 100|undeclared|error/.test(text); i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    // Close the REPL and the pool before the assertions, so that a failed
    // assertion does not leave a worker thread that keeps jest running.
    input.write('.exit\n');
    const exitCode = await exited;
    pool.dispose();
    rmSync(dir, { recursive: true, force: true });
    expect(exitCode).toBe(0);
    expect(text).not.toContain('105');
  }, 30_000);

  test('the check for incomplete input waits for the previous program', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'epsil-repl-'));
    const file = join(dir, 'fit.epsil');
    writeFileSync(file, `let a = 20\n${fitProgram()}`);
    const factory = countingFactory();
    const pool = createKernelPool({ create: factory.createWorker, size: 1 });
    const session = makeEpsilSession(0, pool);
    // Record a parse that happens while a program is running.
    let running = 0;
    let parsedWhileRunning = false;
    const evaluateAsync = session.evaluateAsync.bind(session);
    const parse = session.parse.bind(session);
    session.evaluateAsync = async (source, url) => {
      running++;
      try {
        return await evaluateAsync(source, url);
      } finally {
        running--;
      }
    };
    session.parse = (source, url) => {
      if (running > 0) parsedWhileRunning = true;
      return parse(source, url);
    };
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => (text += String(chunk)));
    const exited = runRepl(session, {
      color: false,
      outputMode: 'value',
      historyPath: '',
      input,
      output,
    });
    // The file runs a fit on the pool. While it runs, an entry arrives that
    // is incomplete on its first line: the REPL asks for the next line, then
    // runs the whole entry after the file.
    input.write(`.load ${file}\n`);
    for (let i = 0; i < 200 && running === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    input.write('a +\n');
    input.write('1\n');
    for (let i = 0; i < 400 && !text.includes('21'); i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    // Close the REPL and the pool before the assertions, so that a failed
    // assertion does not leave a worker thread that keeps jest running.
    input.write('.exit\n');
    const exitCode = await exited;
    pool.dispose();
    rmSync(dir, { recursive: true, force: true });
    expect(exitCode).toBe(0);
    expect(text).toContain('21');
    expect(parsedWhileRunning).toBe(false);
  }, 30_000);
});

describe('the --workers option: Ctrl-C in the REPL', () => {
  test('stops the entry that runs; the session and the next entries stay', async () => {
    const factory = countingFactory();
    const pool = createKernelPool({ create: factory.createWorker, size: 1 });
    const session = makeEpsilSession(0, pool);
    let running = 0;
    const evaluateAsync = session.evaluateAsync.bind(session);
    session.evaluateAsync = async (source, url, signal) => {
      running++;
      try {
        return await evaluateAsync(source, url, signal);
      } finally {
        running--;
      }
    };
    const interrupts = new EventEmitter();
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => (text += String(chunk)));
    const exited = runRepl(session, {
      color: false,
      outputMode: 'value',
      historyPath: '',
      input,
      output,
      interrupts,
    });
    const waitFor = async (done: () => boolean, ms = 25, count = 400) => {
      for (let i = 0; i < count && !done(); i++)
        await new Promise((resolve) => setTimeout(resolve, ms));
    };
    input.write('let keep = 7\n');
    await waitFor(() => text.includes('7'));
    // Without an entry that runs, the REPL does not listen to the event.
    expect(interrupts.listenerCount('SIGINT')).toBe(0);
    // An interpreted fit with a global search: seconds of work, which gives
    // the event loop a turn every few milliseconds. The entry after it is
    // written at the same time, so it waits for the fit.
    const xs = [1, 3.22, 5.27, 10.49, 7.12];
    const ys = [4.3, 1.18, 0.01, 1.48, 3.44];
    const data = xs.map((x, i) => `(${x}, ${ys[i]})`).join(', ');
    input.write(
      `findFit([${data}], a * cos(b * x + c) + d * logGamma(x + c), [a, b, c, d], [x], {"global" -> {"b" -> [0.1, 6], "c" -> [0, 6.28]}})\n` +
        'keep + 1\n'
    );
    await waitFor(() => running > 0, 5);
    const t0 = Date.now();
    interrupts.emit('SIGINT');
    await waitFor(() => text.includes('8'));
    const elapsed = Date.now() - t0;
    const listeners = interrupts.listenerCount('SIGINT');
    // Close the REPL and the pool before the assertions, so that a failed
    // assertion does not leave a worker thread that keeps jest running.
    input.write('.exit\n');
    const exitCode = await exited;
    pool.dispose();
    expect(exitCode).toBe(0);
    expect(text).toContain('error: the entry was interrupted (Ctrl-C)');
    // The entry that waited ran, with the declaration of the session.
    expect(text).toMatch(/interrupted \(Ctrl-C\)\n[\s\S]*8/);
    expect(elapsed).toBeLessThan(2000);
    expect(listeners).toBe(0);
    expect(factory.terminated()).toBe(factory.created());
  }, 30_000);

  /** A REPL in a fake terminal, with a pool that starts no worker and an
   * `evaluateAsync` that runs until the test calls `release()`. The entry
   * does not read its abort signal, as an entry that does long work. */
  function fakeTerminalRepl() {
    const pool = createKernelPool({
      create: () => {
        throw new Error('no worker in this test');
      },
      size: 1,
    });
    const session = makeEpsilSession(0, pool);
    let running = 0;
    let release: () => void = () => {};
    session.evaluateAsync = async (source) => {
      running++;
      try {
        await new Promise<void>((resolve) => (release = resolve));
        return {
          diagnostics: [],
          source,
          value: session.engine.box(1),
          elapsedMs: 0,
        };
      } finally {
        running--;
      }
    };
    // The raw-mode calls, and whether each one came after the REPL closed.
    const rawModeCalls: { raw: boolean; afterClose: boolean }[] = [];
    let closed = false;
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      isRaw: false,
      setRawMode(raw: boolean) {
        rawModeCalls.push({ raw, afterClose: closed });
        input.isRaw = raw;
        return input;
      },
    });
    const output = Object.assign(new PassThrough(), {
      isTTY: true,
      columns: 80,
    });
    let text = '';
    output.on('data', (chunk) => (text += String(chunk)));
    const interrupts = new EventEmitter();
    const exited = runRepl(session, {
      color: false,
      outputMode: 'value',
      historyPath: '',
      input,
      output,
      interrupts,
    }).then((code) => {
      closed = true;
      return code;
    });
    let exitedYet = false;
    void exited.then(() => (exitedYet = true));
    return {
      pool,
      input,
      interrupts,
      exited,
      rawModeCalls,
      text: () => text,
      running: () => running,
      release: () => release(),
      exitedYet: () => exitedYet,
    };
  }

  const waitFor = async (done: () => boolean, ms = 5, count = 400) => {
    for (let i = 0; i < count && !done(); i++)
      await new Promise((resolve) => setTimeout(resolve, ms));
  };

  test('a .exit typed during a pooled .load waits for the file; raw mode is not turned on after the close', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'epsil-repl-'));
    const file = join(dir, 'slow.epsil');
    writeFileSync(file, '1');
    const repl = fakeTerminalRepl();
    expect(repl.input.isRaw).toBe(true);
    repl.input.write(`.load ${file}\r`);
    await waitFor(() => repl.running() > 0);
    // Raw mode is off while the file runs, so that Ctrl-C is a signal.
    expect(repl.input.isRaw).toBe(false);
    repl.input.write('.exit\r');
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The input is paused during the load: the `.exit` is not read yet.
    const exitedDuringLoad = repl.exitedYet();
    repl.release();
    const exitCode = await repl.exited;
    repl.pool.dispose();
    rmSync(dir, { recursive: true, force: true });
    expect(exitedDuringLoad).toBe(false);
    expect(exitCode).toBe(0);
    expect(repl.input.isRaw).toBe(false);
    expect(repl.rawModeCalls.filter((c) => c.afterClose)).toEqual([]);
  }, 30_000);

  test('the first Ctrl-C removes the listener, so a second Ctrl-C gets the default action of the process', async () => {
    const repl = fakeTerminalRepl();
    repl.input.write('1 + 1\r');
    await waitFor(() => repl.running() > 0);
    expect(repl.interrupts.listenerCount('SIGINT')).toBe(1);
    // The first Ctrl-C aborts the entry, which does not stop at once (it
    // waits for `release`). The listener is removed at once: with no
    // listener, a second SIGINT ends the process, even when long work keeps
    // the event loop from running a listener.
    repl.interrupts.emit('SIGINT');
    expect(repl.interrupts.listenerCount('SIGINT')).toBe(0);
    expect(repl.exitedYet()).toBe(false);
    // This entry does not read the signal, so it ends with its value when it
    // is released. The REPL then shows the prompt and reads input again.
    repl.release();
    await waitFor(() => repl.running() === 0 && repl.input.isRaw === true);
    expect(repl.input.isRaw).toBe(true);
    repl.input.write('.exit\r');
    const exitCode = await repl.exited;
    repl.pool.dispose();
    expect(exitCode).toBe(0);
    expect(repl.interrupts.listenerCount('SIGINT')).toBe(0);
  }, 30_000);
});

describe('the --workers option: the MCP server', () => {
  test('the evaluate tool scans a fit on the pool, and the pool is closed at the end', async () => {
    const factory = countingFactory();
    const requests = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'evaluate',
          arguments: { source: fitProgram(), timeLimit: 0 },
        },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'evaluate', arguments: { source: 'let k = 4\nk^2' } },
      },
    ];
    const { io, stdout, stderr } = makeIo(
      factory.createWorker,
      requests.map((r) => `${JSON.stringify(r)}\n`)
    );
    expect(await main(['mcp', '--workers', '2'], io)).toBe(0);
    expect(stderr()).toBe('');
    const responses = stdout()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    const payload = (id: number) =>
      JSON.parse(responses.find((r) => r.id === id).result.content[0].text);
    expect(payload(2).ok).toBe(true);
    expect(payload(2).value).toMatch(/^\["pool",/);
    expect(payload(3).value).toBe('16');
    expect(factory.created()).toBeGreaterThan(0);
    expect(factory.terminated()).toBe(factory.created());
  }, 60_000);
});
