import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** The agent-facing cards served as resources by `epsil mcp`: the Epsil
 * language card, and the card for code that uses the Compute Engine's
 * JavaScript API. */
export type AgentCard = 'epsil' | 'compute-engine';

export interface CliIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  env: NodeJS.ProcessEnv;
  /** Return the text of an agent-facing card, served as a resource by
   * `epsil mcp`. The installed CLI resolves it relative to its own bundle
   * (`import.meta` — unavailable in modules jest compiles, so the loader is
   * injected here rather than defined in `mcp.ts`). */
  loadCard?: (card: AgentCard) => Promise<string>;
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
