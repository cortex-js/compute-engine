import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { parseCortex } from '../../src/cortex/parse-cortex';

const DOCS_DIR = join(__dirname, '../../src/cortex/docs');
const DOC_FILES = readdirSync(DOCS_DIR)
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => join(DOCS_DIR, name));

type CortexBlock = {
  file: string;
  language: 'cortex' | 'cortex-live';
  line: number;
  source: string;
  expectsDiagnostics: boolean;
  expectedOutput?: string;
};

function extractCortexBlocks(file: string): CortexBlock[] {
  const markdown = readFileSync(file, 'utf8');
  const blocks: CortexBlock[] = [];
  const pattern = /```(cortex(?:-live)?)\n([\s\S]*?)\n```/g;

  for (const match of markdown.matchAll(pattern)) {
    const offset = match.index ?? 0;
    const prefix = markdown.slice(0, offset);
    const previousLine = prefix.trimEnd().split('\n').at(-1) ?? '';
    blocks.push({
      file,
      language: match[1] as CortexBlock['language'],
      line: prefix.split('\n').length,
      source: match[2],
      expectsDiagnostics:
        previousLine.trim() === '<!-- cortex-test: expect-diagnostics -->',
      expectedOutput: [...match[2].matchAll(/^\/\/ ➔ (.+)$/gm)].at(-1)?.[1],
    });
  }

  return blocks;
}

function displayBlock(block: CortexBlock): string {
  return `${basename(block.file)}:${block.line}`;
}

function routeKey(route: string): string {
  const withoutFragment = route.split('#', 1)[0];
  if (withoutFragment === '/') return withoutFragment;
  return withoutFragment.replace(/\/$/, '');
}

function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function normalizeOutput(output: string): string {
  return output.replace(/\s+/g, '').replace(/"(True|False)"/g, '$1');
}

describe('CORTEX DOCUMENTATION', () => {
  const blocks = DOC_FILES.flatMap(extractCortexBlocks);

  test('frontmatter slugs are unique and Cortex links resolve', () => {
    const routes = new Map<string, string>();

    for (const file of DOC_FILES) {
      const markdown = readFileSync(file, 'utf8');
      const slug = markdown.match(/^slug:\s*(\S+)\s*$/m)?.[1];
      expect(slug).toBeDefined();

      const key = routeKey(slug!);
      expect(routes.get(key)).toBeUndefined();
      routes.set(key, file);
    }

    const failures: string[] = [];
    const linkPattern =
      /(?:\]\(|<ReadMore\s+path=")(\/cortex\/[^)"\s]*)(?:\)|")/g;

    for (const file of DOC_FILES) {
      const markdown = readFileSync(file, 'utf8');
      for (const match of markdown.matchAll(linkPattern)) {
        const target = match[1];
        const [route, fragment] = target.split('#', 2);
        const targetFile = routes.get(routeKey(route));
        if (targetFile === undefined) {
          failures.push(`${basename(file)}: missing route ${route}`);
          continue;
        }

        if (fragment === undefined || fragment.length === 0) continue;
        const targetMarkdown = readFileSync(targetFile, 'utf8');
        const headings = [
          ...targetMarkdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gm),
        ].map((heading) => headingSlug(heading[1]));
        if (!headings.includes(fragment)) {
          failures.push(
            `${basename(file)}: missing anchor ${target} in ${basename(
              targetFile
            )}`
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test('all Cortex code fences parse unless marked as diagnostic examples', () => {
    const failures: string[] = [];

    for (const block of blocks) {
      const ce = new ComputeEngine();
      let diagnostics: ReturnType<typeof parseCortex>[1];
      try {
        [, diagnostics] = parseCortex(block.source, displayBlock(block), {
          parseLatex: (latex) => ce.parse(latex).json,
        });
      } catch (error) {
        if (block.expectsDiagnostics) continue;
        failures.push(`${displayBlock(block)}: ${String(error)}`);
        continue;
      }

      const errors = diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error'
      );
      if (block.expectsDiagnostics) {
        if (errors.length === 0)
          failures.push(`${displayBlock(block)}: expected a diagnostic`);
      } else if (errors.length > 0) {
        failures.push(
          `${displayBlock(block)}: ${errors
            .map((diagnostic) => JSON.stringify(diagnostic.message))
            .join(', ')}`
        );
      }
    }

    expect(failures).toEqual([]);
  });

  test('live blocks and complete examples execute independently', () => {
    const executable = blocks.filter(
      (block) =>
        block.language === 'cortex-live' ||
        basename(block.file) === 'examples.md'
    );
    const failures: string[] = [];

    for (const block of executable) {
      if (block.expectsDiagnostics) continue;
      const ce = new ComputeEngine();
      const result = executeCortex(ce, block.source, {
        url: displayBlock(block),
        parseLatex: (latex) => ce.parse(latex).json,
      });

      if (result.diagnostics.length > 0) {
        failures.push(
          `${displayBlock(block)}: ${result.diagnostics
            .map((diagnostic) => JSON.stringify(diagnostic.message))
            .join(', ')}`
        );
      }

      const expected = block.expectedOutput;
      if (
        expected === undefined ||
        expected.includes('≈') ||
        expected.includes('…')
      )
        continue;

      let actual = result.value.toString();
      if (actual.includes('...') && expected.trim().startsWith('[')) {
        actual = `[${[...result.value.each()]
          .map((item) => item.toString())
          .join(',')}]`;
      }

      if (normalizeOutput(actual) !== normalizeOutput(expected)) {
        failures.push(
          `${displayBlock(block)}: expected ${JSON.stringify(
            expected
          )}, received ${JSON.stringify(actual)}`
        );
      }
    }

    expect(failures).toEqual([]);
  });
});
