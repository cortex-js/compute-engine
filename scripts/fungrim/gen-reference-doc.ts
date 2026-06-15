// Generate a user-facing markdown reference of the Fungrim identities the
// Compute Engine actually loads.
//
// WHAT IT DOES. Reads the compiled artifact
// (src/compute-engine/fungrim/fungrim-core-data.json) — the authoritative set
// of rules the engine loads — joins each rule back to its source corpus entry
// (data/fungrim/corpus/*.json) for the rich metadata, renders the formula and
// its conditions to LaTeX via the engine's own serializer, and emits a set of
// markdown pages: an index plus one page per mathematical area (so no single
// page carries all ~1380 formulas).
//
// Per identity it shows: the formula (LaTeX), the conditions/assumptions under
// which it holds, the named symbols involved (with their human descriptions
// from declarations.json), how the engine uses the rule (simplify / expand /
// solve), any literature references, and a permalink to the upstream Fungrim
// entry. Fungrim's own prose `Description(...)` text is NOT in our translated
// corpus (the grim2mathjson translator drops it); when a future re-translation
// adds a per-entry `description` field, the OPTION-B hook below renders it
// automatically with no further change.
//
// Output is deterministic (no wall-clock timestamp; provenance is the artifact
// manifest's upstream snapshot) so successive runs are diffable.
//
// Run:  npx tsx scripts/fungrim/gen-reference-doc.ts
//       npx tsx scripts/fungrim/gen-reference-doc.ts --check   (CI: fail if stale)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCorpus,
  createEngine,
  withEntryScope,
  type Entry,
  type Declarations,
} from './load';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORPUS_DIR = path.join(REPO, 'data/fungrim');
const ARTIFACT = path.join(
  REPO,
  'src/compute-engine/fungrim/fungrim-core-data.json'
);
const OVERRIDES = path.join(REPO, 'scripts/fungrim/curation-overrides.json');
const DOC_DIR = path.join(REPO, 'doc');

// Files this generator owns (index + per-area pages). Used to clean up stale
// pages on regenerate and to scope the --check comparison.
const FILE_PATTERN = /^98[a-z]?-reference-fungrim(-[a-z-]+)?\.md$/;
const INDEX_FILE = '98-reference-fungrim.md';
const INDEX_SLUG = '/compute-engine/reference/fungrim/';

const FUNGRIM_ENTRY = (id: string) => `https://fungrim.org/entry/${id}`;

// Mathematical areas. Each becomes one page (sub-lettered 98a..98z to control
// ordering); `topics` are corpus topic ids. EVERY covered topic must appear in
// exactly one area — an unmapped topic is reported (not silently dropped) and
// collected into a trailing "Other" page so new corpus topics never vanish.
const AREAS: { letter: string; slug: string; title: string; topics: string[] }[] =
  [
    {
      letter: 'a',
      slug: 'elementary',
      title: 'Elementary functions',
      topics: [
        'exp',
        'log',
        'powers',
        'sqrt',
        'sine',
        'atan',
        'sinc',
        'pi',
        'golden_ratio',
        'lambertw',
      ],
    },
    {
      letter: 'b',
      slug: 'complex',
      title: 'Complex numbers',
      topics: ['complex_parts', 'complex_plane', 'imaginary_unit'],
    },
    {
      letter: 'c',
      slug: 'gamma',
      title: 'Gamma and related functions',
      topics: ['gamma', 'digamma_function', 'beta_function', 'barnes_g', 'factorials'],
    },
    {
      letter: 'd',
      slug: 'orthogonal-polynomials',
      title: 'Orthogonal polynomials',
      topics: ['chebyshev', 'legendre_polynomial', 'gaussian_quadrature'],
    },
    {
      letter: 'e',
      slug: 'bessel-hypergeometric',
      title: 'Bessel and hypergeometric functions',
      topics: [
        'bessel',
        'airy',
        'coulomb_wave',
        'confluent_hypergeometric',
        'gauss_hypergeometric',
        'error_functions',
      ],
    },
    {
      letter: 'f',
      slug: 'elliptic-integrals',
      title: 'Elliptic integrals',
      topics: ['carlson_elliptic', 'legendre_elliptic', 'weierstrass_elliptic', 'agm'],
    },
    {
      letter: 'g',
      slug: 'modular-theta',
      title: 'Modular forms and theta functions',
      topics: ['jacobi_theta', 'dedekind_eta', 'eisenstein', 'modular_j', 'modular_lambda'],
    },
    {
      letter: 'h',
      slug: 'zeta',
      title: 'Zeta and L-functions',
      topics: ['riemann_zeta', 'hurwitz_zeta', 'multiple_zeta_values', 'dirichlet'],
    },
    {
      letter: 'i',
      slug: 'number-theory',
      title: 'Number theory',
      topics: ['gcd', 'totient', 'prime_numbers'],
    },
    {
      letter: 'j',
      slug: 'sequences',
      title: 'Combinatorial and integer sequences',
      topics: [
        'fibonacci',
        'bell_numbers',
        'bernoulli_numbers',
        'stirling_numbers',
        'integer_sequences',
        'partitions',
      ],
    },
  ];

type Usage = { purposes: Set<string>; targets: Set<string> };
type Resolved = { e: Entry; u: Usage | undefined };

/** Map each used bare entry id -> how the engine uses it. */
function loadUsage(): { usage: Map<string, Usage>; manifest: any } {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const usage = new Map<string, Usage>();
  for (const r of artifact.rules as { id: string; purpose: string; target: string }[]) {
    const bare = r.id.replace(/^fungrim:/, '').replace(/:solve$/, '');
    let u = usage.get(bare);
    if (!u) usage.set(bare, (u = { purposes: new Set(), targets: new Set() }));
    u.purposes.add(r.purpose);
    u.targets.add(r.target);
  }
  return { usage, manifest: artifact.manifest };
}

/** topic id -> human title, read from each corpus file's header. */
function loadTopicTitles(): Map<string, string> {
  const titles = new Map<string, string>();
  const dir = path.join(CORPUS_DIR, 'corpus');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (data.topic) titles.set(data.topic, data.title ?? data.topic);
  }
  return titles;
}

/** head name -> description, from both the shell and built-in audit tables. */
function loadHeadDescriptions(decl: Declarations): Map<string, string> {
  const out = new Map<string, string>();
  const harvest = (table: Record<string, any> | undefined) => {
    if (!table) return;
    for (const [name, rec] of Object.entries(table))
      if (rec && typeof rec.description === 'string' && rec.description.trim())
        out.set(name, rec.description.trim());
  };
  harvest(decl.declarations);
  harvest((decl as any).existing);
  return out;
}

/** Curated synthetic entries (not in the upstream corpus). */
function loadInjected(): Map<string, Entry> {
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
  const out = new Map<string, Entry>();
  for (const e of (overrides.inject ?? []) as Entry[]) out.set(e.id, e);
  return out;
}

/**
 * Render the upper half-plane membership `Element(x, HH)` as the explicit part
 * predicate `Im(x) > 0` — the form the engine actually guards on and that the
 * assumptions guide documents — rather than the orphan `\mathrm{HH}` glyph.
 * Only the 2-operand membership is rewritten; the 3-operand set-builder form
 * (`Element(τ, HH, …)` in the ModularLambdaFundamentalDomain definition) is
 * left untouched.
 */
function rewriteUpperHalfPlane(node: unknown): unknown {
  if (!Array.isArray(node)) return node;
  if (node.length === 3 && node[0] === 'Element' && node[2] === 'HH')
    return ['Greater', ['Imaginary', rewriteUpperHalfPlane(node[1])], 0];
  return node.map(rewriteUpperHalfPlane);
}

function mathjsonToLatex(
  ce: ReturnType<typeof createEngine>,
  e: Entry,
  node: unknown
): string | null {
  try {
    const latex = withEntryScope(ce, e, () =>
      ce.box(rewriteUpperHalfPlane(node) as any, { canonical: false }).latex
    );
    // The serializer emits literal newlines after `\\` row separators inside
    // matrix environments (e.g. `pmatrix`). A `$$…$$` (or inline `$…$`) block
    // must stay on a single physical line, otherwise the markdown/KaTeX
    // renderer splits the math span and the tail renders as raw LaTeX. Collapse
    // any embedded newline to a space — whitespace is token-equivalent in LaTeX,
    // so `\\ ` renders identically to `\\\n`.
    return latex.replace(/\s*\r?\n\s*/g, ' ');
  } catch {
    return null;
  }
}

/** Render the engine-usage sentence ("simplification", "expansion", "solving"). */
function usageSentence(u: Usage | undefined): string {
  if (!u) return '';
  const verbs: string[] = [];
  if (u.purposes.has('simplify')) verbs.push('simplification');
  if (u.purposes.has('expand')) verbs.push('expansion');
  if (u.targets.has('solve')) verbs.push('equation solving');
  if (verbs.length === 0) return '';
  const list =
    verbs.length === 1
      ? verbs[0]
      : verbs.slice(0, -1).join(', ') + ' and ' + verbs[verbs.length - 1];
  return `Used by the Compute Engine for ${list}.`;
}

/** Turn a reference (URL or citation string) into a markdown link. */
function renderReference(ref: string): string {
  const urlMatch = ref.match(/https?:\/\/[^\s)]+/);
  if (urlMatch && ref.trim() === urlMatch[0]) {
    try {
      const host = new URL(urlMatch[0]).host.replace(/^www\./, '');
      return `[${host}](${urlMatch[0]})`;
    } catch {
      return urlMatch[0];
    }
  }
  if (urlMatch) return ref.replace(urlMatch[0], `[${urlMatch[0]}](${urlMatch[0]})`);
  return ref;
}

function referencesOf(e: Entry): string[] {
  const r = e.references;
  if (!r) return [];
  if (Array.isArray(r)) return r.filter((x): x is string => typeof x === 'string');
  if (typeof r === 'string') return [r];
  return [];
}

const isHexId = (id: string) => /^[0-9a-f]{6}$/.test(id);
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Render one identity entry into `lines`. */
function renderEntry(
  lines: string[],
  ce: ReturnType<typeof createEngine>,
  headDesc: Map<string, string>,
  { e, u }: Resolved
): number {
  let boxFailures = 0;

  const latex = mathjsonToLatex(ce, e, e.formula);
  if (latex === null) {
    boxFailures++;
    lines.push('```json', JSON.stringify(e.formula), '```');
  } else {
    lines.push(`$$${latex}$$`);
  }
  lines.push('');

  // OPTION-B hook: render Fungrim's prose description once the corpus carries
  // it (dormant until a re-translation adds a per-entry `description` field).
  const desc = (e as any).description;
  if (typeof desc === 'string' && desc.trim()) {
    lines.push(desc.trim(), '');
  }

  const conds: string[] = [];
  if (e.assumptions) {
    const a = mathjsonToLatex(ce, e, e.assumptions);
    if (a) conds.push(`$${a}$`);
  }
  for (const alt of ((e as any).assumptionAlternatives ?? []) as unknown[]) {
    const a = mathjsonToLatex(ce, e, alt);
    if (a) conds.push(`$${a}$`);
  }
  if (conds.length === 1) lines.push(`**Holds when** ${conds[0]}.`);
  else if (conds.length > 1)
    lines.push(`**Holds when** ${conds.join(' &nbsp;_or_&nbsp; ')}.`);

  const syms = (e.heads ?? [])
    .filter((h) => headDesc.has(h))
    .map((h) => `**${h}** — ${headDesc.get(h)}`);
  if (syms.length) lines.push(`**Symbols:** ${syms.join('; ')}.`);

  const usageStr = usageSentence(u);
  if (usageStr) lines.push(usageStr);

  // Curated (non-hex) entries carry an internal provenance note in
  // `references`, not a citation — suppress it.
  const refs = isHexId(e.id) ? referencesOf(e) : [];
  if (refs.length === 1) lines.push(`**Reference:** ${renderReference(refs[0])}`);
  else if (refs.length > 1) {
    lines.push('**References:**');
    for (const r of refs) lines.push(`- ${renderReference(r)}`);
  }

  lines.push(
    isHexId(e.id)
      ? `[\`${e.id}\` · Fungrim entry ↗](${FUNGRIM_ENTRY(e.id)})`
      : `\`${e.id}\` · _curated identity (not in the upstream Fungrim corpus)_`
  );
  lines.push('', '---', '');
  return boxFailures;
}

/**
 * Generate (or, with `check`, verify) the user-facing Fungrim identity
 * reference: an index page plus one page per mathematical area, under `doc/`.
 * Returns a summary. Exported so the regen pipeline (apply-solve-templates.ts)
 * refreshes the doc automatically after it finalizes the artifact.
 */
export function generateReferenceDoc(
  opts: { check?: boolean } = {}
): {
  identities: number;
  areas: number;
  files: number;
  bytes: number;
  changed: boolean;
} {
  const check = opts.check ?? false;

  const { usage, manifest } = loadUsage();
  const corpus = loadCorpus(CORPUS_DIR);
  const topicTitles = loadTopicTitles();
  const headDesc = loadHeadDescriptions(corpus.declarations);
  const injected = loadInjected();
  const ce = createEngine(corpus.declarations);
  const byId = new Map(corpus.entries.map((e) => [e.id, e]));

  // Resolve every used id to a source entry (corpus or curated injection).
  const resolved: Resolved[] = [];
  let unresolved = 0;
  for (const id of usage.keys()) {
    const e = byId.get(id) ?? injected.get(id);
    if (!e) {
      unresolved++;
      continue;
    }
    resolved.push({ e, u: usage.get(id) });
  }

  // Group by topic.
  const byTopic = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const topic = r.e.topic ?? r.e.topics?.[0] ?? 'misc';
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic)!.push(r);
  }
  for (const list of byTopic.values()) list.sort((a, b) => a.e.id.localeCompare(b.e.id));

  // Map topics -> areas; collect any unmapped covered topic into "Other".
  const topicArea = new Map<string, string>();
  for (const a of AREAS) for (const t of a.topics) topicArea.set(t, a.slug);
  const areas = AREAS.map((a) => ({ ...a }));
  const orphanTopics: string[] = [];
  for (const topic of byTopic.keys())
    if (!topicArea.has(topic)) orphanTopics.push(topic);
  if (orphanTopics.length) {
    areas.push({
      letter: 'z',
      slug: 'other',
      title: 'Other special functions',
      topics: orphanTopics.sort(),
    });
  }

  const short = manifest?.upstream?.snapshotSha256
    ? String(manifest.upstream.snapshotSha256).slice(0, 12)
    : 'unknown';
  const translator = manifest?.upstream?.translator ?? 'unknown';
  const ruleCount = manifest?.counts?.rules ?? resolved.length;

  const provenanceBox =
    `:::info[Generated reference]\nThis page is generated from the compiled ` +
    `Fungrim artifact by \`scripts/fungrim/gen-reference-doc.ts\` (upstream ` +
    `snapshot \`${short}\`, translator \`${translator}\`). Do not edit it by ` +
    `hand. The corpus is MIT-licensed; see \`data/fungrim/LICENSE\`.\n:::`;

  const outputs = new Map<string, string>(); // filename -> content
  let boxFailures = 0;
  let renderedAreas = 0;

  // Per-area pages.
  const areaCounts = new Map<string, number>();
  for (const area of areas) {
    const areaTopics = area.topics
      .filter((t) => byTopic.has(t))
      .sort((x, y) =>
        (topicTitles.get(x) ?? x).localeCompare(topicTitles.get(y) ?? y)
      );
    const count = areaTopics.reduce((n, t) => n + byTopic.get(t)!.length, 0);
    areaCounts.set(area.slug, count);
    if (count === 0) continue;
    renderedAreas++;

    const lines: string[] = [];
    lines.push('---');
    lines.push(`title: Fungrim Identities — ${area.title}`);
    lines.push(`slug: /compute-engine/reference/fungrim-${area.slug}/`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${area.title}`);
    lines.push('');
    lines.push(
      `Part of the [Fungrim Identities](${INDEX_SLUG}) reference — ` +
        `**${count} identities** for ${area.title.toLowerCase()}.`
    );
    lines.push('');
    lines.push(provenanceBox);
    lines.push('');
    if (areaTopics.length > 1) {
      lines.push('## Contents');
      lines.push('');
      for (const t of areaTopics) {
        const title = topicTitles.get(t) ?? t;
        lines.push(`- [${title}](#${slugify(title)}) (${byTopic.get(t)!.length})`);
      }
      lines.push('');
    }
    for (const t of areaTopics) {
      lines.push(`## ${topicTitles.get(t) ?? t}`);
      lines.push('');
      for (const r of byTopic.get(t)!) boxFailures += renderEntry(lines, ce, headDesc, r);
    }
    outputs.set(
      `98${area.letter}-reference-fungrim-${area.slug}.md`,
      lines.join('\n').replace(/\n+$/, '\n')
    );
  }

  // Index page.
  {
    const lines: string[] = [];
    lines.push('---');
    lines.push('title: Fungrim Identities');
    lines.push(`slug: ${INDEX_SLUG}`);
    lines.push('---');
    lines.push('');
    lines.push('# Fungrim Identities');
    lines.push('');
    lines.push(
      'The Compute Engine ships a library of **special-function identities** ' +
        'derived from the [Fungrim](https://fungrim.org/) "Mathematical ' +
        'Functions Grimoire". These identities drive symbolic simplification, ' +
        'expansion, and equation solving for functions such as the elliptic ' +
        'integrals, Jacobi theta functions, Bessel functions, the Riemann zeta ' +
        'function, and many more.'
    );
    lines.push('');
    lines.push(
      `This reference catalogues the **${resolved.length} identities** behind ` +
        `the engine's **${ruleCount} Fungrim rules** (a few identities back both ` +
        'a simplification and a solving rule), organized into the areas below. ' +
        'Each identity shows the formula, the conditions under which it holds, ' +
        'the symbols it involves, how the engine uses it, and a link to the ' +
        'authoritative upstream Fungrim entry (whose page carries the full prose ' +
        'description, proof sketch, and references).'
    );
    lines.push('');
    lines.push(provenanceBox);
    lines.push('');
    lines.push('## Areas');
    lines.push('');
    for (const area of areas) {
      const count = areaCounts.get(area.slug) ?? 0;
      if (count === 0) continue;
      lines.push(
        `### [${area.title}](/compute-engine/reference/fungrim-${area.slug}/) (${count})`
      );
      const areaTopics = area.topics
        .filter((t) => byTopic.has(t))
        .sort((x, y) =>
          (topicTitles.get(x) ?? x).localeCompare(topicTitles.get(y) ?? y)
        );
      lines.push('');
      lines.push(
        areaTopics
          .map((t) => `${topicTitles.get(t) ?? t} (${byTopic.get(t)!.length})`)
          .join(' · ')
      );
      lines.push('');
    }
    outputs.set(INDEX_FILE, lines.join('\n').replace(/\n+$/, '\n'));
  }

  // Compare / write.
  const existing = fs
    .readdirSync(DOC_DIR)
    .filter((f) => FILE_PATTERN.test(f));
  const stale = existing.filter((f) => !outputs.has(f));
  let changed = stale.length > 0;
  for (const [f, content] of outputs) {
    const p = path.join(DOC_DIR, f);
    const current = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    if (current !== content) changed = true;
  }

  const totalBytes = [...outputs.values()].reduce((n, c) => n + c.length, 0);
  const summary = {
    identities: resolved.length,
    areas: renderedAreas,
    files: outputs.size,
    bytes: totalBytes,
    changed,
  };

  if (check) {
    if (changed) {
      const detail =
        stale.length > 0 ? ` (stale file(s): ${stale.join(', ')})` : '';
      console.error(
        `FAIL — the Fungrim identity reference under doc/ is stale${detail}.\n` +
          'Regenerate with: npx tsx scripts/fungrim/gen-reference-doc.ts'
      );
      process.exit(1);
    }
    console.log('OK — Fungrim identity reference is up to date.');
    return summary;
  }

  for (const [f, content] of outputs) fs.writeFileSync(path.join(DOC_DIR, f), content);
  for (const f of stale) fs.rmSync(path.join(DOC_DIR, f));

  console.log(
    `Wrote ${outputs.size} pages (1 index + ${renderedAreas} areas): ` +
      `${resolved.length} identities, ${(totalBytes / 1024).toFixed(0)} KB total.`
  );
  if (stale.length)
    console.log(`  removed ${stale.length} stale page(s): ${stale.join(', ')}`);
  if (orphanTopics.length)
    console.log(
      `  ${orphanTopics.length} unmapped topic(s) placed in "Other": ${orphanTopics.join(', ')}`
    );
  if (unresolved)
    console.log(`  ${unresolved} used id(s) had no source entry (skipped).`);
  if (boxFailures)
    console.log(`  ${boxFailures} formula(s) failed to render (shown as raw MathJSON).`);
  return summary;
}

// Run only as a script (not when imported by the regen pipeline or tests).
if (
  process.argv[1] !== undefined &&
  /gen-reference-doc\.(ts|js|mjs|cjs)$/.test(process.argv[1])
) {
  generateReferenceDoc({ check: process.argv.includes('--check') });
}
