// Node-only fs wrapper around the shippable Rubi rule compiler
// (src/compute-engine/rubi/compile.ts). Walks a corpus directory, reads the
// translated rule JSON, and compiles it in document/rule order. Used by the
// benchmark/triage tooling; the shippable `loadIntegrationRules` loader uses
// the bundled corpus + `compileRuleDocs` directly (no fs).

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ComputeEngine } from '../../src/compute-engine/global-types';
import type { RubiRuleDoc } from '../../src/compute-engine/rubi/types';
import {
  compileRuleDocs,
  type CompileResult,
} from '../../src/compute-engine/rubi/compile';

export {
  compileRule,
  compileRuleDocs,
  type CompiledRule,
  type CompileResult,
} from '../../src/compute-engine/rubi/compile';

/** Read all corpus rule-docs under a section directory in dispatch-priority
 * order (sorted, recursive). This single walk defines rule priority for BOTH
 * the benchmark (`compileSection`) and the shipped bundle
 * (`bundle-corpus.ts`); keeping it in one place prevents the two from drifting
 * (a divergence would silently change rule precedence). */
export function readCorpusDocs(corpusDir: string): RubiRuleDoc[] {
  const docs: RubiRuleDoc[] = [];
  (function walk(dir: string): void {
    for (const e of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json'))
        docs.push(JSON.parse(fs.readFileSync(p, 'utf8')) as RubiRuleDoc);
    }
  })(corpusDir);
  return docs;
}

/** Load and compile all corpus files under a section directory, in order. */
export function compileSection(
  ce: ComputeEngine,
  corpusDir: string
): CompileResult {
  return compileRuleDocs(ce, readCorpusDocs(corpusDir));
}
