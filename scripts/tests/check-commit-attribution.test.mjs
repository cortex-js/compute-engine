// Tests of scripts/check-commit-attribution.mjs: which commit-message lines
// are refused as an AI attribution, and which are accepted as the credit of a
// person or as ordinary text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { attributionLines } from '../check-commit-attribution.mjs';

const script = fileURLToPath(
  new URL('../check-commit-attribution.mjs', import.meta.url)
);

const refused = [
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  'Co-authored-by: Claude <noreply@anthropic.com>',
  'Co-authored-by : Claude Code',
  '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  'Generated with Claude Code',
  'Co-authored-by: copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>',
  'Co-authored-by: chatgpt-codex-connector[bot] <1+chatgpt-codex-connector[bot]@users.noreply.github.com>',
  'Co-authored-by: Cursor Agent <cursoragent@cursor.com>',
  'Co-authored-by: aider (gpt-4o) <noreply@aider.chat>',
  'Assisted-by: Claude',
  'Generated-by: Codex',
  'Signed-off-by: Claude <noreply@anthropic.com>',
  'Co-authored-by: Gemini 2.5 Pro',
  'Co-authored-by: devin-ai-integration[bot] <2+devin-ai-integration[bot]@users.noreply.github.com>',
  '# Generated with Claude Code',
  'Co-authored-by: Claude 3.5 Sonnet',
  'Co-authored-by: OpenAI Codex',
  'Co-authored-by: Gemini CLI',
  'Generated-by: GPT-4o',
  'Assisted-by: GPT-4o-mini',
  'Co-authored-by: Jane <jane@example.com>, Claude <noreply@anthropic.com>',
];

const accepted = [
  'Co-authored-by: enumeratio <314378874+enumeratio@users.noreply.github.com>',
  'Co-authored-by: Claude Dupont <claude.dupont@example.fr>',
  'Co-authored-by: Claudette Lee <claudette@example.com>',
  'Co-authored-by: codexdev <123+codexdev@users.noreply.github.com>',
  'Signed-off-by: Arno Gourdol <arno@example.com>',
  'The hook refuses a "Generated with Claude Code" line.',
  'Claude Code is a tool; this sentence is not a trailer.',
  '# Please enter the commit message for your changes.',
  'Co-authored-by: devin <123+devin@users.noreply.github.com>',
  'Co-authored-by: Devin <devin@example.com>',
  'Co-authored-by: claude <124+claude@users.noreply.github.com>',
  'Co-authored-by: Cursor <9+cursor@users.noreply.github.com>',
  'Co-authored-by: Jane Doe <jane@anthropic.com>',
  '+Co-authored-by: Claude <noreply@anthropic.com>',
  '+Generated with Claude Code',
];

for (const line of refused) {
  test(`refuses: ${line}`, () => {
    assert.deepEqual(attributionLines(`fix: x\n\n${line}\n`), [line]);
  });
}

for (const line of accepted) {
  test(`accepts: ${line}`, () => {
    assert.deepEqual(attributionLines(`fix: x\n\n${line}\n`), []);
  });
}

test('accepts the diff below the scissors line of `git commit -v`', () => {
  const message = [
    'fix: x',
    '',
    '# ------------------------ >8 ------------------------',
    '# Do not modify or remove the line above.',
    'diff --git a/x.md b/x.md',
    '@@ -1,2 +1,3 @@',
    ' Context line.',
    ' Co-authored-by: Claude <noreply@anthropic.com>',
    '+Generated with Claude Code',
    '-Co-authored-by: Claude <noreply@anthropic.com>',
  ].join('\n');
  assert.deepEqual(attributionLines(message), []);
});

test('checks the lines after a scissors line that git keeps', () => {
  // With `-F` or `--cleanup=verbatim`, git keeps the scissors line and the
  // text after it, so a trailer there must be refused.
  const line = 'Co-authored-by: Claude <noreply@anthropic.com>';
  const message = `fix: x\n\n# ------------------------ >8 ------------------------\n${line}\n`;
  assert.deepEqual(attributionLines(message), [line]);
});

test('reads a trailer value that continues on an indented line', () => {
  const message =
    'fix: x\n\nCo-authored-by:\n Claude <noreply@anthropic.com>\n';
  assert.deepEqual(attributionLines(message), ['Co-authored-by:']);
});

test('reads a message with CRLF line ends', () => {
  const line = 'Co-authored-by: Claude <noreply@anthropic.com>';
  assert.deepEqual(attributionLines(`fix: x\r\n\r\n${line}\r\n`), [line]);
});

test('the command exits 1 on an attribution line and 0 on a clean message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commit-attribution-'));
  try {
    const bad = join(dir, 'bad.txt');
    const good = join(dir, 'good.txt');
    writeFileSync(
      bad,
      'fix: x\n\nCo-authored-by: Claude <noreply@anthropic.com>\n'
    );
    writeFileSync(good, 'fix: x\n\nA clean body.\n');
    const run = (file) =>
      spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    const refusedRun = run(bad);
    assert.equal(refusedRun.status, 1);
    assert.match(refusedRun.stderr, /credits an AI tool/);
    assert.equal(run(good).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
