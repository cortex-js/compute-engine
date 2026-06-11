// Rubi → MathJSON corpus translator — CLI entry point (Phase R1,
// docs/rubi/RUBI.md §5).
//
// Usage (from the repo root):
//   npx tsx scripts/rubi/translate.ts \
//       [--rubi <path>]      # default: $RUBI_HOME or ~/dev/rubi/Rubi-4.17.3.0
//       [--section "1 Algebraic functions/1.1 Binomial products/1.1.1 Linear"]
//       [--out data/rubi]
//
// Reads Rubi/IntegrationRules/**/*.m, extracts rules (extract-rules.ts),
// and writes:
//   <out>/corpus/<source-path>.json   one file per source file, rule order
//                                     preserved (= Rubi priority)
//   <out>/skipped.json                per-rule extraction failures
//   <out>/MANIFEST.json               provenance + counts
//
// The corpus is engine-independent: WL pattern atoms are kept as
// ["Blank", name(, head)] / ["BlankOptional", name] nodes and Rubi
// utility heads (Simp, Rt, ExpandIntegrand, …) are kept verbatim; the
// CE-specific compilation (optional-variant expansion, predicate mapping,
// dispatch bucketing) is a separate later stage, following the Fungrim
// corpus/compile split.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { extractRules } from './extract-rules';

const RUBI_VERSION = '4.17.3.0';
const RUBI_REPO = 'https://github.com/RuleBasedIntegration/Rubi';

function listRuleFiles(root: string, subdir = ''): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, subdir), {
    withFileTypes: true,
  })) {
    const rel = path.join(subdir, entry.name);
    if (entry.isDirectory()) result.push(...listRuleFiles(root, rel));
    else if (entry.name.endsWith('.m')) result.push(rel);
  }
  return result.sort();
}

function sha256Dir(root: string, files: string[]): string {
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(fs.readFileSync(path.join(root, f)));
  return h.digest('hex');
}

function main(): void {
  const argv = process.argv;
  let rubi =
    process.env.RUBI_HOME ??
    path.join(os.homedir(), `dev/rubi/Rubi-${RUBI_VERSION}`);
  let section = '';
  let out = 'data/rubi';
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rubi':
        rubi = argv[++i];
        break;
      case '--section':
        section = argv[++i];
        break;
      case '--out':
        out = argv[++i];
        break;
      default:
        console.error(`unknown option ${argv[i]}`);
        process.exit(2);
    }
  }

  const rulesRoot = path.join(rubi, 'Rubi/IntegrationRules');
  const files = listRuleFiles(rulesRoot, section);
  console.log(`translating ${files.length} rule files from ${rulesRoot}`);

  let totalRules = 0;
  let totalErrors = 0;
  const skipped: {
    file: string;
    index: number;
    error: string;
    source: string;
  }[] = [];
  const perFile: { file: string; rules: number; errors: number }[] = [];

  for (const file of files) {
    const { rules, errors } = extractRules(path.join(rulesRoot, file));
    totalRules += rules.length;
    totalErrors += errors.length;
    for (const e of errors) skipped.push({ file, ...e });
    perFile.push({ file, rules: rules.length, errors: errors.length });

    const target = path.join(out, 'corpus', file.replace(/\.m$/, '.json'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Compact, one rule per line: diffable per-rule, small on disk.
    fs.writeFileSync(
      target,
      `{"schemaVersion":1,"file":${JSON.stringify(file)},"rules":[\n` +
        rules.map((r) => JSON.stringify(r)).join(',\n') +
        '\n]}\n'
    );
  }

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, 'skipped.json'),
    JSON.stringify(skipped, null, 1)
  );

  const manifest = {
    schemaVersion: 1,
    generated: new Date().toISOString().slice(0, 10),
    generator: 'scripts/rubi/translate.ts',
    upstream: {
      name: 'Rubi',
      repository: RUBI_REPO,
      version: RUBI_VERSION,
      note: 'extracted from the release tarball; rule order within each file is Rubi’s match-priority order',
      pin: {
        sha256: sha256Dir(rulesRoot, files),
        method:
          'sha256 over the translated IntegrationRules/**/*.m files, sorted, concatenated',
        fileCount: files.length,
      },
      license: 'MIT, Copyright (c) 2018 Rule-based Integration Organization',
    },
    scope: section || '(all)',
    counts: {
      files: files.length,
      rules: totalRules,
      skipped: totalErrors,
    },
    files: perFile,
  };
  fs.writeFileSync(
    path.join(out, 'MANIFEST.json'),
    JSON.stringify(manifest, null, 1)
  );

  // License travels with the corpus (same convention as data/fungrim).
  const license = path.join(rubi, 'LICENSE');
  if (fs.existsSync(license))
    fs.copyFileSync(license, path.join(out, 'LICENSE'));

  console.log(
    `rules: ${totalRules}, skipped: ${totalErrors} (${(
      (100 * totalRules) /
      (totalRules + totalErrors || 1)
    ).toFixed(2)}% extracted)`
  );
  if (totalErrors > 0) {
    const byError = new Map<string, number>();
    for (const s of skipped)
      byError.set(
        s.error.slice(0, 80),
        (byError.get(s.error.slice(0, 80)) ?? 0) + 1
      );
    for (const [k, v] of [...byError.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${v}× ${k}`);
  }
  console.log(`corpus written to ${out}/`);
}

main();
