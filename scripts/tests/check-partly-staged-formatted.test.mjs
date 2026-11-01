// Tests of scripts/check-partly-staged-formatted.mjs. Each test makes a new
// git repository in a temporary directory and runs the script there with the
// Prettier and lint-staged installed in this repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, 'scripts', 'check-partly-staged-formatted.mjs');
const lintStaged = join(
  root,
  'node_modules',
  'lint-staged',
  'bin',
  'lint-staged.js'
);

// The environment of every child process, without the git variables that
// select a repository or an index. When the tests run inside a git hook,
// GIT_DIR or GIT_INDEX_FILE would make the git commands below act on the
// real repository instead of the temporary one.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      ![
        'GIT_DIR',
        'GIT_INDEX_FILE',
        'GIT_WORK_TREE',
        'GIT_COMMON_DIR',
        'GIT_OBJECT_DIRECTORY',
        'GIT_PREFIX',
      ].includes(k)
  )
);

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function write(dir, file, text) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}

// A repository whose package.json has a lint-staged configuration like this
// repository's: `prettier --write` on src/**/*.ts.
function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ce-partly-staged-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  sh(dir, 'git', ['init', '-q', '.']);
  sh(dir, 'git', ['config', 'user.email', 'test@example.invalid']);
  sh(dir, 'git', ['config', 'user.name', 'test']);
  write(
    dir,
    'package.json',
    JSON.stringify({
      'prettier': { singleQuote: true },
      'lint-staged': { 'src/**/*.ts': 'prettier --write' },
    })
  );
  return dir;
}

function commit(dir, files) {
  for (const [f, text] of Object.entries(files)) write(dir, f, text);
  sh(dir, 'git', ['add', '.']);
  sh(dir, 'git', ['commit', '-q', '-m', 'base']);
}

// Stage `staged` for the file, then leave `working` in the working tree.
function partlyStage(dir, file, staged, working) {
  write(dir, file, staged);
  sh(dir, 'git', ['add', file]);
  write(dir, file, working);
}

function check(dir) {
  return spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: 'utf8',
    env,
  });
}

const BASE =
  "import { a } from './x.js';\n\nexport const g = (x: number) => x;\n";
// Prettier joins this import into one line, so lines below it move up by 3.
const UNFORMATTED =
  "import {\n  a,\n  b,\n} from './x.js';\n\nexport const g = (x: number) => x;\n";
const FORMATTED =
  "import { a, b } from './x.js';\n\nexport const g = (x: number) => x;\n";

test('refuses a partly staged file whose staged content Prettier changes', (t) => {
  const dir = repo(t);
  commit(dir, { 'src/f.ts': BASE });
  const working = UNFORMATTED.replace('  b,\n', '  b,\n  c,\n');
  partlyStage(dir, 'src/f.ts', UNFORMATTED, working);
  const r = check(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /Commit refused/);
  assert.match(r.stderr, /^ {2}src\/f\.ts$/m);
  // The check changes neither the working tree nor the index.
  assert.equal(readFileSync(join(dir, 'src/f.ts'), 'utf8'), working);
  assert.equal(sh(dir, 'git', ['show', ':src/f.ts']), UNFORMATTED);
});

test('reports a partly staged file whose staged content does not parse', (t) => {
  const dir = repo(t);
  commit(dir, { 'src/f.ts': BASE });
  partlyStage(
    dir,
    'src/f.ts',
    'export const = ;\n',
    'export const = ;\n// x\n'
  );
  const r = check(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/f\.ts \(Prettier cannot parse/);
});

test('accepts a partly staged file whose staged content is formatted', (t) => {
  const dir = repo(t);
  commit(dir, { 'src/f.ts': BASE });
  partlyStage(dir, 'src/f.ts', FORMATTED, FORMATTED + 'export const h = 1;\n');
  const r = check(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('ignores fully staged files, files outside the globs, and ignored files', (t) => {
  const dir = repo(t);
  commit(dir, {
    'src/full.ts': BASE,
    'other/f.ts': BASE,
    'src/gen/f.ts': BASE,
    '.prettierignore': 'src/gen/\n',
  });
  // Fully staged: lint-staged formats it and has nothing to restore.
  write(dir, 'src/full.ts', UNFORMATTED);
  sh(dir, 'git', ['add', 'src/full.ts']);
  // Partly staged, but no prettier glob matches it.
  partlyStage(dir, 'other/f.ts', UNFORMATTED, UNFORMATTED + '// x\n');
  // Partly staged, but .prettierignore lists it.
  partlyStage(dir, 'src/gen/f.ts', UNFORMATTED, UNFORMATTED + '// x\n');
  const r = check(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('a partly staged file that passes the check comes back intact after lint-staged', (t) => {
  const dir = repo(t);
  commit(dir, { 'src/f.ts': BASE });
  // Staged: formatted. Unstaged: a pure insertion inside the import, the kind
  // of hunk that lint-staged places by line number alone.
  const working =
    "import {\n  a,\n  b,\n  e,\n} from './x.js';\n\nexport const g = (x: number) => x;\n";
  partlyStage(dir, 'src/f.ts', FORMATTED, working);
  assert.equal(check(dir).status, 0);
  const r = spawnSync(process.execPath, [lintStaged, '--quiet'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...env,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH}`,
    },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(join(dir, 'src/f.ts'), 'utf8'), working);
  assert.equal(sh(dir, 'git', ['show', ':src/f.ts']), FORMATTED);
});

test('fails for a prettier command with options, accepts a path before prettier', (t) => {
  const dir = repo(t);
  const config = (cmd) =>
    write(
      dir,
      'package.json',
      JSON.stringify({ 'lint-staged': { '*.ts': cmd } })
    );
  config(['prettier --write --print-width 120']);
  let r = check(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ {2}prettier --write --print-width 120$/m);
  config('node_modules/.bin/prettier  --write');
  r = check(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('refuses each kind of partly staged Prettier configuration file', (t) => {
  for (const name of [
    'src/sub/.prettierrc.json5',
    '.prettierrc',
    '.prettierrc.toml',
    'prettier.config.mjs',
    'package.yaml',
    '.editorconfig',
    '.gitignore',
  ]) {
    const dir = repo(t);
    commit(dir, { 'src/f.ts': BASE, [name]: '# a\n' });
    partlyStage(dir, name, '# b\n', '# c\n');
    const r = check(dir);
    assert.equal(r.status, 1, `${name}: ${r.stderr}`);
    assert.ok(r.stderr.includes(`\n  ${name}`), `${name}: ${r.stderr}`);
  }
});

test('refuses a partly staged Prettier ignore file', (t) => {
  const dir = repo(t);
  commit(dir, { 'src/f.ts': BASE, '.prettierignore': 'build/\n' });
  // The working tree ignores src/f.ts, the staged content does not: lint-staged
  // would format src/f.ts with the staged ignore file.
  partlyStage(
    dir,
    '.prettierignore',
    'build/\ndist/\n',
    'build/\ndist/\nsrc/\n'
  );
  partlyStage(dir, 'src/f.ts', UNFORMATTED, UNFORMATTED + '// x\n');
  const r = check(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /configuration or ignore files/);
  assert.match(r.stderr, /^ {2}\.prettierignore$/m);
});

test('package.json: refuses a change of the "prettier" key, accepts other changes', (t) => {
  const dir = repo(t);
  commit(dir, { 'src/f.ts': BASE });
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const text = (p) => JSON.stringify(p, null, 2) + '\n';
  // Another key differs between the index and the working tree: accepted.
  partlyStage(
    dir,
    'package.json',
    text({ ...pkg, version: '1.0.0' }),
    text({ ...pkg, version: '1.0.1' })
  );
  assert.equal(check(dir).status, 0, check(dir).stderr);
  // The "prettier" key differs: refused.
  write(
    dir,
    'package.json',
    text({ ...pkg, version: '1.0.1', prettier: { singleQuote: false } })
  );
  const r = check(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^ {2}package\.json$/m);
});

test('reads the new path of a staged rename and of a working-tree rename', (t) => {
  const dir = repo(t);
  commit(dir, { 'src/old.ts': BASE, 'src/old2.ts': BASE });
  // Staged rename with unstaged edits ("RM"), unformatted staged content.
  sh(dir, 'git', ['mv', 'src/old.ts', 'src/new.ts']);
  partlyStage(dir, 'src/new.ts', UNFORMATTED, UNFORMATTED + '// x\n');
  // Working-tree rename (" R"): a file moved on disk and recorded with
  // `git add -N`. Its old path must not be read as an entry of its own.
  write(dir, 'src/moved.ts', BASE);
  rmSync(join(dir, 'src/old2.ts'));
  sh(dir, 'git', ['add', '-N', 'src/moved.ts']);
  const status = sh(dir, 'git', ['status', '--porcelain=v1', '-z']);
  assert.match(status, /RM src\/new\.ts\0src\/old\.ts\0/);
  assert.match(status, / R src\/moved\.ts\0src\/old2\.ts\0/);
  const r = check(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^ {2}src\/new\.ts$/m);
  assert.doesNotMatch(r.stderr, /old|moved/);
});

test('fails when there is no lint-staged configuration or no prettier task', (t) => {
  const dir = repo(t);
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  let r = check(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no "lint-staged" configuration/);
  write(
    dir,
    'package.json',
    JSON.stringify({ 'lint-staged': { '*.ts': 'eslint' } })
  );
  r = check(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /runs prettier/);
});
