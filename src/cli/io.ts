import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export interface CliIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  env: NodeJS.ProcessEnv;
  /** Return the agent-facing language card (`for-agents.md`), served as a
   * resource by `epsil mcp`. The installed CLI resolves it relative to its
   * own bundle (`import.meta` — unavailable in modules jest compiles, so
   * the loader is injected here rather than defined in `mcp.ts`). */
  loadCard?: () => Promise<string>;
}

export async function readSource(
  inline: string | undefined,
  file: string | undefined,
  io: CliIo
): Promise<{ source: string; url?: string }> {
  if (inline !== undefined) return { source: inline };
  if (file !== undefined && file !== '-') {
    return {
      source: await readFile(file, 'utf8'),
      url: pathToFileURL(file).href,
    };
  }

  let source = '';
  io.stdin.setEncoding('utf8');
  for await (const chunk of io.stdin) source += chunk;
  return { source };
}
