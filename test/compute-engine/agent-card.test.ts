import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as computeEngine from '../../src/compute-engine';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

/**
 * The Compute Engine card for AI agents (`src/compute-engine/docs/
 * for-agents.md`) promises that every `js` block runs and every `// ➔`
 * result is verified. This test holds it to that.
 *
 * The blocks run in order against one shared engine `ce`, as a reader
 * following the page would: the `const ce = new ComputeEngine()` of the
 * setup block is that engine. `import` lines are dropped, and every export of
 * the package is in scope instead. A line ending in `// ➔ <result>` must be
 * an expression statement: its value is displayed — an expression by its
 * `toString()`, anything else as JSON — and compared with `<result>`.
 */

const CARD = join(__dirname, '../../src/compute-engine/docs/for-agents.md');

type Block = { line: number; source: string };

function extractBlocks(markdown: string): Block[] {
  return [...markdown.matchAll(/```js\n([\s\S]*?)\n```/g)].map((match) => ({
    line: markdown.slice(0, match.index).split('\n').length,
    source: match[1],
  }));
}

function display(value: unknown): string {
  if (computeEngine.isExpression(value)) return value.toString();
  return JSON.stringify(value);
}

type Check = { line: number; expected: string; actual: string };

function instrument(block: Block): string {
  return block.source
    .split('\n')
    .map((text, i) => {
      if (/^\s*import\b/.test(text)) return '';
      if (/^\s*const ce = new ComputeEngine\(\);\s*$/.test(text)) return '';
      const check = text.match(/^(\s*)(.+?);?\s*\/\/ ➔ (.*)$/);
      if (check === null) return text;
      const [, indent, expression, expected] = check;
      return `${indent}__check((${expression}), ${JSON.stringify(
        expected.trim()
      )}, ${block.line + 1 + i});`;
    })
    .join('\n');
}

describe('COMPUTE ENGINE CARD FOR AGENTS', () => {
  const blocks = extractBlocks(readFileSync(CARD, 'utf8'));
  const scope: Record<string, unknown> = {
    ...computeEngine,
    executeEpsil,
    ce: new ComputeEngine(),
  };
  const names = Object.keys(scope);

  test('has code blocks', () => {
    expect(blocks.length).toBeGreaterThan(10);
  });

  for (const block of blocks) {
    test(`block at line ${block.line}`, () => {
      const checks: Check[] = [];
      const run = new Function('__check', ...names, instrument(block)) as (
        ...args: unknown[]
      ) => void;
      run(
        (value: unknown, expected: string, line: number) =>
          checks.push({ line, expected, actual: display(value) }),
        ...names.map((name) => scope[name])
      );
      // Every `// ➔` line ran: none was skipped by a return or an exception
      // caught inside the block.
      expect(checks).toHaveLength(block.source.match(/\/\/ ➔ /g)?.length ?? 0);
      for (const check of checks)
        expect({ line: check.line, result: check.actual }).toEqual({
          line: check.line,
          result: check.expected,
        });
    });
  }
});
