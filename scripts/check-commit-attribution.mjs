#!/usr/bin/env node
// Commit-message step (`.husky/commit-msg`). It refuses a commit message that
// credits an AI tool: the project's commit history credits people only, so a
// message has no "Co-Authored-By: Claude ..." line, no other trailer that
// names a tool, and no "Generated with Claude Code" line.
//
// A trailer for a person is accepted, for example the line that credits an
// external contributor whose pull request the commit is based on:
// `Co-authored-by: <login> <<id>+<login>@users.noreply.github.com>`.
//
// How a trailer is judged. A trailer is a line whose key ends in "-by"
// ("Co-authored-by", "Assisted-by", "Signed-off-by", ...), written at the
// start of the line as git writes it; an indented line that follows a
// trailer continues its value. Then:
// - a value with an `<email>` is judged by the email alone, because every
//   trailer that a tool writes carries the tool's own address. The email is
//   refused when it is a tool's exact address, the GitHub noreply address of
//   the Copilot agent, or a bot login that names a tool. A person whose name
//   or login is "Claude" or "Devin", or who works at a tool's company, is
//   accepted.
// - a value with no email is refused when it starts with the name of a tool
//   or of its vendor ("Claude 3.5 Sonnet", "OpenAI Codex", "Gemini CLI").
//
// The whole message file is checked, because no line can be ignored safely:
// git keeps `#` lines and a scissors line when the message comes from `-m`
// or `-F` or uses `--cleanup=verbatim`. The diff that `git commit -v` adds
// below its scissors line is not a problem: each of its lines starts with
// `+`, `-`, a space or a diff header, so none is a trailer at the start of a
// line or the footer.
//
// The check is local: `git commit --no-verify`, `HUSKY=0`, or a clone where
// `npm install` did not set up the hooks skip it.
//
// Usage: node scripts/check-commit-attribution.mjs <commit message file>
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A trailer: a key that ends in "-by", at the start of the line. Git accepts
// spaces before the colon.
const TRAILER = /^([A-Za-z][\w-]*-by)\s*:\s*(.*)$/i;

// The email of a trailer value: the text between `<` and `>`.
const EMAIL = /<([^<>]*)>/g;

// The exact addresses that AI tools write in their trailers.
const TOOL_ADDRESSES = new Set([
  'noreply@anthropic.com',
  'noreply@openai.com',
  'cursoragent@cursor.com',
  'noreply@aider.chat',
]);

// The GitHub noreply address of the Copilot agent:
// `<id>+Copilot@users.noreply.github.com`.
const COPILOT_NOREPLY = /^\d+\+copilot@users\.noreply\.github\.com$/i;

// A bot login that names an AI tool, such as `copilot-swe-agent[bot]`,
// `chatgpt-codex-connector[bot]` or `devin-ai-integration[bot]`.
const TOOL_BOT =
  /(claude|anthropic|copilot|codex|chatgpt|openai|gemini|devin|cursor|aider)[\w-]*\[bot\]/i;

// A value with no email that starts with the name of a tool or its vendor.
const TOOL_NAME =
  /^(claude|anthropic|openai|codex|chatgpt|gpt-?\d[\w.-]*|(github\s+)?copilot|gemini|google\s+gemini|cursor|aider|devin)\b/i;

// The footer that Claude Code writes, as a line of its own:
// `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
// Only a `#` or an emoji may come before the words, so a sentence that
// quotes the phrase, or an added line of a diff, is accepted.
const GENERATED_WITH =
  /^(#\s*)?(\p{Extended_Pictographic}\uFE0F?\s*)?generated with \[?claude code/iu;

// A value can name several people, each with an email: every email is
// checked.
function isToolValue(value) {
  const addresses = [...value.matchAll(EMAIL)].map((m) =>
    m[1].trim().toLowerCase()
  );
  if (addresses.length === 0) return TOOL_NAME.test(value.trim());
  return (
    TOOL_BOT.test(value) ||
    addresses.some(
      (address) => TOOL_ADDRESSES.has(address) || COPILOT_NOREPLY.test(address)
    )
  );
}

/**
 * Return the lines of a commit message that credit an AI tool. A trailer
 * whose value continues on indented lines is returned as its first line.
 *
 * @param {string} message The text of the commit message file.
 * @returns {string[]} The lines to remove; empty when the message is clean.
 */
export function attributionLines(message) {
  const lines = message.split(/\r?\n/);
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (GENERATED_WITH.test(line)) {
      bad.push(line);
      continue;
    }
    const trailer = TRAILER.exec(line);
    if (!trailer) continue;
    let value = trailer[2];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
      i += 1;
      value += ' ' + lines[i].trim();
    }
    if (isToolValue(value)) bad.push(line);
  }
  return bad;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('check-commit-attribution: no commit message file given');
    process.exit(1);
  }
  const bad = attributionLines(readFileSync(file, 'utf8'));
  if (bad.length > 0) {
    console.error(
      'check-commit-attribution: the commit message credits an AI tool. ' +
        'Remove these lines:'
    );
    for (const line of bad) console.error(`  ${line}`);
    process.exit(1);
  }
}

// Run only when this file is the program, not when a test imports it. The
// paths are compared after symlinks are resolved: Node resolves them in
// `import.meta.url` but not in `process.argv[1]`.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  main();
