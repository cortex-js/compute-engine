#!/usr/bin/env node
// Pre-commit step that runs before lint-staged (`.husky/pre-commit`).
//
// Why. For a file that has both staged and unstaged changes ("partly
// staged"), lint-staged saves the unstaged changes as a patch with no context
// lines (`git diff --unified=0`), runs the tasks on the staged content, and
// then applies the patch again with `git apply --unidiff-zero`. A hunk that
// only inserts lines has no old line to match, so git places it by its line
// number alone. When `prettier --write` changed the number of lines above it,
// the insertion lands at the wrong line, and lint-staged reports success.
// This is true of lint-staged 16.4.0 to 17.6.0 (`lib/gitWorkflow.js`).
//
// What this step does. It refuses the commit when the staged content of a
// partly staged file is not already formatted by Prettier. When the step
// passes, Prettier changes no partly staged file, so no line moves, and the
// patch goes back to the lines it came from. Fully staged files are not
// checked: lint-staged has no unstaged patch to apply to them, and it formats
// them as before.
//
// Only the globs of the lint-staged configuration whose command runs
// `prettier` are used. A new lint-staged task that rewrites files needs the
// same protection.
//
// Usage: node scripts/check-partly-staged-formatted.mjs [--config <file.json>]
// Without --config, it reads the "lint-staged" key of the package.json at the
// root of the repository; it does not read `.lintstagedrc*`,
// `lint-staged.config.*` or nested configuration files, and it fails when
// that key is missing or runs no prettier task. Exit 0: nothing to fix.
// Exit 1: the commit is refused, with the reason and the files.
//
// Reproduction and the options that were compared:
// docs/scratch/2026-10-31-lint-staged-misplaced-hunks/PROPOSAL.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// Resolve picomatch and Prettier from this repository's node_modules, wherever
// the command runs.
const require = createRequire(import.meta.url);
const picomatch = require('picomatch');
const prettier = require('prettier');

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

const top = git(['rev-parse', '--show-toplevel']).trim();

const i = process.argv.indexOf('--config');
const config =
  i > 0
    ? JSON.parse(readFileSync(process.argv[i + 1], 'utf8'))
    : JSON.parse(readFileSync(path.join(top, 'package.json'), 'utf8'))[
        'lint-staged'
      ];

const fail = (lines) => {
  console.error(lines.join('\n'));
  process.exit(1);
};

// With no configuration to read, or no glob that runs Prettier, the check
// would protect nothing: fail, so that a move of the lint-staged
// configuration (to `.lintstagedrc`, for example) does not turn the check off
// without a message.
if (config === undefined || config === null || typeof config !== 'object') {
  fail([
    'check-partly-staged-formatted: no "lint-staged" configuration found in',
    'package.json. Update the script to read the configuration where it is now.',
  ]);
}

// The picomatch options of lint-staged (`lib/matchFiles.js`), so that the
// same files match. A glob without a slash matches a file name in any
// directory.
//
// The check formats with the Prettier configuration files only. A command
// such as `prettier --write --print-width 120` would format differently, so
// any prettier command other than a plain `prettier --write` (with or without
// a directory before `prettier`) makes the check fail, and the script must be
// updated to apply those options.
const isPrettier = (c) =>
  typeof c === 'string' && /(^|[\s/])prettier\b/.test(c);
const unsupported = Object.values(config)
  .flat()
  .filter(
    (c) =>
      isPrettier(c) &&
      !/^(\S*\/)?prettier --write$/.test(c.trim().replace(/\s+/g, ' '))
  );
if (unsupported.length > 0) {
  fail([
    'check-partly-staged-formatted: these lint-staged commands run prettier',
    'with options that the check does not apply. Update the script.',
    ...unsupported.map((c) => `  ${c}`),
  ]);
}
const matchers = Object.entries(config)
  .filter(([, cmd]) => [cmd].flat().some(isPrettier))
  .map(([glob]) =>
    picomatch(glob, {
      dot: true,
      matchBase: !glob.includes('/'),
      posixSlashes: true,
      strictBrackets: true,
    })
  );
if (matchers.length === 0) {
  fail([
    'check-partly-staged-formatted: no glob of the lint-staged configuration',
    'runs prettier. Update the script to match the configuration.',
  ]);
}

// `git status --porcelain=v1 -z` prints "XY path" per entry. For a rename or
// a copy, in either column, the entry is "XY new-path NUL old-path". Split
// the output as lint-staged does (`getUnstagedFiles()` in
// `lib/gitWorkflow.js`): at each NUL that is followed by a new "XY " status
// or by the end. Then keep the new path. Paths are relative to the root of
// the repository.
const partly = [];
for (const entry of git(['-C', top, 'status', '--porcelain=v1', '-z']).split(
  /\x00(?=[ AMDRCU?!]{2} |$)/
)) {
  if (entry.length < 4) continue;
  const [x, y] = entry;
  const inIndex = x !== ' ' && x !== '?' && x !== 'D';
  const inTree = y !== ' ' && y !== '?';
  if (inIndex && inTree) partly.push(entry.slice(3).split('\0')[0]);
}

// lint-staged hides the unstaged changes of EVERY partly staged file before
// Prettier runs, configuration files included. If a Prettier configuration
// or ignore file is partly staged, Prettier then runs with its staged
// content, while this script reads the working-tree content, and the two
// checks can disagree. Refuse such a commit. For package.json, which is often
// partly staged, refuse only when its "prettier" key differs between the
// index and the working tree. The names are those that Prettier 3.9 searches
// for (`CONFIG_FILES` in `node_modules/prettier/index.mjs`: `.prettierrc`,
// `.prettierrc.<ext>` with extensions such as `json5` and `toml`,
// `prettier.config.<ext>`, `package.yaml`, `package.json`), plus the ignore
// files and `.editorconfig`. Any extension is accepted, so that a name that a
// later Prettier adds is also refused.
const CONFIG_FILE =
  /(^|\/)(\.prettierignore|\.gitignore|\.editorconfig|package\.yaml|\.prettierrc(\.[^./]+)?|prettier\.config\.[^./]+)$/;
const prettierKey = (text) => {
  try {
    return JSON.stringify(JSON.parse(text).prettier ?? null);
  } catch {
    return undefined; // Not JSON: treat it as different.
  }
};
const configs = partly.filter((file) => {
  if (CONFIG_FILE.test(file)) return true;
  if (!/(^|\/)package\.json$/.test(file)) return false;
  const staged = prettierKey(git(['-C', top, 'show', `:${file}`]));
  const working = prettierKey(readFileSync(path.join(top, file), 'utf8'));
  return staged === undefined || staged !== working;
});
if (configs.length > 0) {
  fail([
    'Commit refused. These Prettier configuration or ignore files have staged',
    'and unstaged changes. lint-staged would format with their staged content,',
    'which this check cannot see. Stage the whole file, or commit it apart.',
    ...configs.map((f) => `  ${f}`),
  ]);
}

const bad = [];
for (const file of partly) {
  if (!matchers.some((m) => m(file))) continue;
  const abs = path.join(top, file);
  // The Prettier command line skips the files of .gitignore and
  // .prettierignore, and files with no parser: skip them here too.
  const info = await prettier.getFileInfo(abs, {
    ignorePath: [
      path.join(top, '.gitignore'),
      path.join(top, '.prettierignore'),
    ],
  });
  if (info.ignored || !info.inferredParser) continue;
  const staged = git(['-C', top, 'show', `:${file}`]);
  const options =
    (await prettier.resolveConfig(abs, { editorconfig: true })) ?? {};
  let formatted;
  try {
    formatted = await prettier.format(staged, { ...options, filepath: abs });
  } catch (e) {
    bad.push(
      `${file} (Prettier cannot parse the staged content: ${String(e.message).split('\n')[0]})`
    );
    continue;
  }
  if (formatted !== staged) bad.push(file);
}

if (bad.length > 0) {
  fail([
    'Commit refused. These files have staged and unstaged changes, and',
    'Prettier would change their staged content. lint-staged would then',
    'restore the unstaged changes at the wrong lines, with no error.',
    'Format the file and stage your hunks again, or stage the whole file.',
    ...bad.map((f) => `  ${f}`),
  ]);
}
