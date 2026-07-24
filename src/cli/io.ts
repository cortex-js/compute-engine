import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export interface CliIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  env: NodeJS.ProcessEnv;
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
