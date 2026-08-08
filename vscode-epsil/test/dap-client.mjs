// Minimal DAP client for driving the Epsil debug adapter over stdio,
// exactly as VS Code does. Shared by the scenarios in dap.test.mjs.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADAPTER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'debug-adapter.js'
);

export class DapClient {
  constructor() {
    this.child = spawn('node', [ADAPTER], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.seq = 1;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.eventWaiters = [];
    this.events = [];
    /** All output events, in order: {category, output, line?}. */
    this.outputs = [];

    this.child.stdout.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const length = Number(
          /Content-Length: (\d+)/.exec(this.buffer.slice(0, headerEnd).toString())?.[1]
        );
        if (this.buffer.length < headerEnd + 4 + length) return;
        const msg = JSON.parse(
          this.buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString()
        );
        this.buffer = this.buffer.slice(headerEnd + 4 + length);
        if (msg.type === 'response') {
          this.pending.get(msg.request_seq)?.(msg);
          this.pending.delete(msg.request_seq);
        } else if (msg.type === 'event') {
          if (msg.event === 'output') this.outputs.push(msg.body);
          const record = { event: msg.event, body: msg.body, consumed: false };
          const i = this.eventWaiters.findIndex((w) => w.event === msg.event);
          if (i >= 0) {
            record.consumed = true;
            this.eventWaiters.splice(i, 1)[0].resolve(record);
          } else this.events.push(record);
        }
      }
    });
  }

  send(command, args) {
    const msg = { seq: this.seq++, type: 'request', command, arguments: args ?? {} };
    const json = JSON.stringify(msg);
    this.child.stdin.write(
      `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`
    );
    return new Promise((resolve, reject) => {
      this.pending.set(msg.seq, resolve);
      setTimeout(() => reject(new Error(`timeout: ${command}`)), 15000);
    });
  }

  waitEvent(event) {
    const got = this.events.find((e) => e.event === event && !e.consumed);
    if (got) {
      got.consumed = true;
      return Promise.resolve(got);
    }
    return new Promise((resolve, reject) => {
      this.eventWaiters.push({ event, resolve });
      setTimeout(() => reject(new Error(`timeout: event ${event}`)), 15000);
    });
  }

  /** initialize → launch → (initialized). Returns the initialize response. */
  async start(program, launchArgs = {}) {
    const init = await this.send('initialize', {
      adapterID: 'epsil',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
    });
    const launchPromise = this.send('launch', { program, ...launchArgs });
    await this.waitEvent('initialized');
    await launchPromise;
    return init;
  }

  /** Current stack as ["name@line", …]. */
  async frames() {
    const stack = await this.send('stackTrace', { threadId: 1 });
    return stack.body.stackFrames.map((f) => `${f.name}@${f.line}`);
  }

  /** Variables of the top frame, merged across the Locals and Globals
   * scopes (locals win), as {name: {value, type, variablesReference}}. */
  async variables() {
    const stack = await this.send('stackTrace', { threadId: 1 });
    const scopes = await this.send('scopes', {
      frameId: stack.body.stackFrames[0].id,
    });
    const merged = {};
    // Reverse order so the Locals scope (listed first) overwrites Globals.
    for (const scope of [...scopes.body.scopes].reverse()) {
      const vars = await this.send('variables', {
        variablesReference: scope.variablesReference,
      });
      for (const v of vars.body.variables) merged[v.name] = v;
    }
    return merged;
  }

  /** Variables of one named scope only. */
  async scopeVariables(name) {
    const stack = await this.send('stackTrace', { threadId: 1 });
    const scopes = await this.send('scopes', {
      frameId: stack.body.stackFrames[0].id,
    });
    const scope = scopes.body.scopes.find((s) => s.name === name);
    if (!scope) return {};
    const vars = await this.send('variables', {
      variablesReference: scope.variablesReference,
    });
    return Object.fromEntries(vars.body.variables.map((v) => [v.name, v]));
  }

  kill() {
    this.child.kill();
  }
}
