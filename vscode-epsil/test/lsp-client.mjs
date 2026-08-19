// Minimal LSP client for driving the Epsil language server over stdio,
// exactly as VS Code does. Shared by the scenarios in lsp.test.mjs.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'server.js'
);

export class LspClient {
  /**
   * @param capabilities client capabilities to advertise. The default set is
   * what VS Code sends; a scenario overrides it to exercise a fallback (a
   * client without `relatedInformation`, say).
   */
  constructor(capabilities = {
    textDocument: {
      publishDiagnostics: {
        relatedInformation: true,
        codeDescriptionSupport: true,
      },
    },
  }) {
    this.child = spawn('node', [SERVER, '--stdio'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.id = 1;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    /** Diagnostics published per URI, latest wins. */
    this.diagnostics = new Map();
    this.diagnosticWaiters = [];
    this.capabilities = capabilities;

    this.child.stdout.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const length = Number(
          /Content-Length: (\d+)/.exec(
            this.buffer.slice(0, headerEnd).toString()
          )?.[1]
        );
        if (this.buffer.length < headerEnd + 4 + length) return;
        const msg = JSON.parse(
          this.buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString()
        );
        this.buffer = this.buffer.slice(headerEnd + 4 + length);
        this.#dispatch(msg);
      }
    });
  }

  #dispatch(msg) {
    if (msg.method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = msg.params;
      this.diagnostics.set(uri, diagnostics);
      for (const waiter of this.diagnosticWaiters.splice(0))
        waiter(diagnostics);
      return;
    }
    // The server may ask the client for configuration; answer with the
    // default (diagnostics enabled) so it does not stall.
    if (msg.method === 'workspace/configuration') {
      this.#write({
        jsonrpc: '2.0',
        id: msg.id,
        result: msg.params.items.map(() => true),
      });
      return;
    }
    const entry = this.pending.get(msg.id);
    if (entry !== undefined) {
      this.pending.delete(msg.id);
      entry.resolve(
        entry.raw ? { result: msg.result, error: msg.error } : msg.result
      );
    }
  }

  #write(msg) {
    const body = JSON.stringify(msg);
    this.child.stdin.write(
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
    );
  }

  notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  request(method, params) {
    const id = this.id++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, raw: false });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Like `request`, but resolves `{result, error}` so a scenario can assert
   * on a server-side refusal (a rename conflict, say) instead of losing it. */
  requestRaw(method, params) {
    const id = this.id++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, raw: true });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize() {
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: this.capabilities,
    });
    this.notify('initialized', {});
    return result;
  }

  /** Open a document and resolve once the server publishes for it. */
  async open(uri, text) {
    const published = new Promise((resolve) =>
      this.diagnosticWaiters.push(resolve)
    );
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'epsil', version: 1, text },
    });
    return published;
  }

  /** The hover at a 0-based line/character, or `null`. */
  hover(uri, line, character) {
    return this.request('textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    });
  }

  kill() {
    this.child.kill();
  }
}
