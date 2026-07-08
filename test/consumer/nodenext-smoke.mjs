#!/usr/bin/env node
// nodenext consumer smoke test (issue #318).
//
// Builds a throwaway consumer package that imports from every entry point
// declared in the compute-engine `exports` map, then type-checks it with the
// REPO's own TypeScript using `module`/`moduleResolution: nodenext` and
// `skipLibCheck: false`. This is the strict configuration that surfaces
// extensionless relative specifiers in the published declarations as TS2834
// errors (or collapses every imported type to `any`).
//
// The consumer also contains an "any-collapse" guard: a `@ts-expect-error`
// that only holds if `ComputeEngine.parse()` keeps its real return type. If
// the declarations degrade to `any`, the expected error vanishes and tsc
// reports an unused '@ts-expect-error', so the test fails either way.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const PKG_NAME = '@cortex-js/compute-engine';

// Require a built dist — the declarations are what we are exercising.
const entryDts = join(REPO_ROOT, 'dist', 'types', 'compute-engine.d.ts');
if (!existsSync(entryDts)) {
  console.error(
    `nodenext-smoke: ${entryDts} not found. Run \`npm run build\` first.`
  );
  process.exit(1);
}

const tsc = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tsc)) {
  console.error(`nodenext-smoke: TypeScript not found at ${tsc}.`);
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'ce-nodenext-'));
try {
  writeFileSync(
    join(tmpDir, 'package.json'),
    JSON.stringify({ type: 'module', name: 'ce-nodenext-consumer' }, null, 2)
  );

  writeFileSync(
    join(tmpDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
        },
      },
      null,
      2
    )
  );

  // Import at least one real symbol from every `exports` entry point.
  const indexTs = `import { ComputeEngine, BigDecimal, version as ceVersion } from '${PKG_NAME}';
import * as mathjson from '${PKG_NAME}/math-json';
import * as latex from '${PKG_NAME}/latex-syntax';
import * as interval from '${PKG_NAME}/interval';
import * as numerics from '${PKG_NAME}/numerics';
import * as core from '${PKG_NAME}/core';
import * as compile from '${PKG_NAME}/compile';
import * as identities from '${PKG_NAME}/identities';
import * as integrationRules from '${PKG_NAME}/integration-rules';

// Touch a real symbol from each entry so tsc actually resolves the types
// instead of silently treating the module as \`any\`.
const touched: unknown[] = [
  ceVersion,
  mathjson.version,
  mathjson.isSymbolObject,
  latex.LatexSyntax,
  latex.parse,
  interval.ok,
  interval.point,
  numerics.NumericValue,
  core.simplify,
  compile.compile,
  identities.loadIdentities,
  integrationRules.loadIntegrationRules,
];
void touched;

// Any-collapse guard: if the declarations resolve to their real types,
// \`parse()\` returns a BoxedExpression (not assignable to number) and the
// error below is expected. If they collapse to \`any\`, the error disappears
// and tsc flags the unused directive instead.
const ce = new ComputeEngine();
// @ts-expect-error — parse() returns BoxedExpression, not number
const n: number = ce.parse('1');
void n;

// Augmentation guards: these members exist only through \`declare module\`
// merging (types-engine.d.ts and big-decimal/transcendentals.d.ts). If a
// rewritten augmentation specifier resolved to the wrong module, the merge
// would silently stop applying and these lines would no longer type-check.
const viaEngine = ce.parse('1').engine.parse('2');
void viaEngine;
const root: BigDecimal = new BigDecimal(2).sqrt();
void root;
`;
  writeFileSync(join(tmpDir, 'index.ts'), indexTs);

  // Symlink the repo as an installed dependency.
  const scopeDir = join(tmpDir, 'node_modules', '@cortex-js');
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(REPO_ROOT, join(scopeDir, 'compute-engine'), 'dir');

  const result = spawnSync(process.execPath, [tsc, '-p', tmpDir], {
    encoding: 'utf8',
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) {
    console.error('nodenext-smoke: FAILED — tsc reported errors:\n');
    console.error(output || '(no output)');
    process.exit(1);
  }

  console.log('nodenext-smoke: PASSED — declarations resolve under nodenext.');
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
