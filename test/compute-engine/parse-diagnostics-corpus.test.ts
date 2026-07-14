import { readFileSync } from 'fs';
import { join } from 'path';
import { ComputeEngine } from '../../src/compute-engine';

/**
 * Corpus-scale gate for the parse-diagnostics bound-variable property.
 *
 * The property: for a *canonical* parse, every `undeclared-symbol` diagnostic
 * names a symbol that is either (a) **free** in the result, or (b) **absent**
 * from the result entirely (folded away, or consumed as notation — e.g. the
 * Leibniz differential `d`). A name that appears **only bound** usually means a
 * binder parselet is missing its `pruneUndeclared` wiring.
 *
 * `ce.parse` installs a defense-in-depth post-check (see `index.ts`) that is
 * DETECT-ONLY: it never drops diagnostics (dropping a canonicalization
 * name-reuse artifact would be a false negative — C-1), but it fires
 * `console.assert(false, '… bound-only "X" …')` when a name is bound-only in
 * the canonical result. This gate watches that signal two ways — spying on
 * `console.assert` AND inspecting the (retained) output — and fails on any
 * bound-only name whose input is not in the accepted skip-ledger below.
 *
 * Corpus: the MathNet parser regression corpus
 * (`docs/mathnet/parser-test-cases.json`, ~428 problem-statement fragments +
 * ~19 non-prose answer strings), the same corpus the MathNet CI gate uses. It
 * is the largest parseable LaTeX corpus checked into the repo.
 */

// Inputs where a name appears ONLY bound in the canonical result yet is a
// genuinely-free *source* reference. These are NOT wiring gaps: the diagnostic
// is CORRECTLY reported to the consumer (the post-check is detect-only and
// retains it — see C-1); the appearance of boundness is a canonicalization
// artifact. They are ledgered only to exempt them from the "no bound-only
// survivor" and assert-signal checks. Each corresponds to a REAL observed case
// (run the gate to reproduce). Do not pre-populate.
const SKIP_LEDGER: { input: string; reason: string }[] = [
  {
    input: 'm, n \\in \\mathbb{N}_{>1}',
    reason:
      'Restricted-set notation `\\mathbb{N}_{>1}` canonicalizes to a set-builder ' +
      '`{n ∈ ℕ | n>1}` that reuses the membership variable name `n`. In the ' +
      'canonical result `n` appears only bound, but the source `n` is a free ' +
      'reference and is correctly reported (detect-only). Not a parse-time ' +
      'binder, so no pruneUndeclared wiring applies.',
  },
  {
    input: 'x, y \\in \\mathbb{R}_{>0}',
    reason:
      'Same `\\mathbb{R}_{>0}` restricted-set-builder artifact: `y` appears only ' +
      'bound in the canonical form yet is a free source reference, correctly ' +
      'retained (detect-only). Not a wiring gap.',
  },
];

type Hit = { input: string; name: string };

function loadCorpus(): { input: string; category: string }[] {
  const corpusPath = join(
    __dirname,
    '..',
    '..',
    'docs',
    'mathnet',
    'parser-test-cases.json'
  );
  const c = JSON.parse(readFileSync(corpusPath, 'utf8'));
  const out: { input: string; category: string }[] = [];
  for (const f of c.fragments ?? [])
    if (typeof f.latex === 'string')
      out.push({ input: f.latex, category: f.category ?? 'fragment' });
  for (const u of c.unicodeAnswers ?? [])
    if (typeof u.input === 'string')
      out.push({ input: u.input, category: 'unicodeAnswer' });
  return out;
}

describe('parse-diagnostics corpus bound-variable gate', () => {
  jest.setTimeout(180000);

  const corpus = loadCorpus();
  const ledgerInputs = new Set(SKIP_LEDGER.map((e) => e.input));

  test('the corpus is non-trivially large', () => {
    expect(corpus.length).toBeGreaterThan(400);
  });

  test('no bound-variable false fire outside the skip-ledger', () => {
    const hits: Hit[] = [];
    const propertyViolations: { input: string; name: string; json: string }[] =
      [];

    const realAssert = console.assert;
    let current = '';
    // Spy: capture the bound-only signal fired by the ce.parse post-check.
    console.assert = ((cond: unknown, ...args: unknown[]): void => {
      if (cond) return;
      const msg = String(args[0] ?? '');
      const m = msg.match(/bound-only "([^"]+)"/);
      if (m) hits.push({ input: current, name: m[1] });
    }) as typeof console.assert;

    try {
      for (const { input } of corpus) {
        current = input;
        // Fresh engine per input: the engine narrows free-symbol types from
        // usage persistently, so a shared engine lets one fragment's inference
        // contaminate another's parse. Corpus fragments are independent inputs.
        const ce = new ComputeEngine();
        let e;
        try {
          e = ce.parse(input, { diagnostics: true });
        } catch {
          continue; // a parse throw is out of scope for this property
        }

        // Secondary invariant (output inspection): the post-check is
        // detect-only, so a bound-only diagnostic CAN survive in the output —
        // but only for a ledgered canonicalization artifact. Any bound-only
        // survivor for a NON-ledgered input signals an unwired binder.
        if (!e.isCanonical || ledgerInputs.has(input)) continue;
        let free: Set<string>;
        let symbols: Set<string>;
        try {
          free = new Set(e.freeVariables);
          symbols = new Set(e.symbols);
        } catch {
          continue;
        }
        for (const d of e.parseDiagnostics ?? []) {
          if (d.code !== 'undeclared-symbol') continue;
          const name = d.detail?.name;
          if (typeof name !== 'string') continue;
          if (symbols.has(name) && !free.has(name))
            propertyViolations.push({
              input,
              name,
              json: JSON.stringify(e.json).slice(0, 100),
            });
        }
      }
    } finally {
      console.assert = realAssert;
    }

    // batch-2 must fully filter its own output.
    expect(propertyViolations).toEqual([]);

    // Every bound-variable false fire must be a known, ledgered offender.
    const unexpected = hits.filter((h) => !ledgerInputs.has(h.input));
    if (unexpected.length > 0) {
      const summary = unexpected
        .map(
          (h) => `  ${JSON.stringify(h.input)} — bound-only name "${h.name}"`
        )
        .join('\n');
      throw new Error(
        `Bound-only name(s) in canonical result not in the skip-ledger:\n${summary}\n` +
          `If a binder parselet is missing pruneUndeclared wiring, fix it; if it is a ` +
          `canonicalization name-reuse artifact (correct diagnostic), add a ledger entry with a reason.`
      );
    }
  });

  test('every skip-ledger entry still reproduces a real bound-only signal', () => {
    // Guard against a stale ledger: an entry that no longer fires should be
    // removed. Each ledgered input must still trip the post-check assertion.
    for (const { input } of SKIP_LEDGER) {
      const hits: string[] = [];
      const realAssert = console.assert;
      console.assert = ((cond: unknown, ...args: unknown[]): void => {
        if (cond) return;
        const m = String(args[0] ?? '').match(/bound-only "([^"]+)"/);
        if (m) hits.push(m[1]);
      }) as typeof console.assert;
      try {
        new ComputeEngine().parse(input, { diagnostics: true });
      } catch {
        /* ignore */
      } finally {
        console.assert = realAssert;
      }
      expect(hits.length).toBeGreaterThan(0);
    }
  });
});
