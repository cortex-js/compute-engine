// Generates `src/epsil/docs/search-symbols.json`: one record per documented
// definition of the standard library, for the symbol search of the
// documentation site. The site ranks these records before its full-text
// results, so a query for a name (`Sqrt`, `sqrt`), a LaTeX command (`\frac`)
// or a curated keyword (`antiderivative`) lands on the definition itself.
//
// The records come from the same `librarySections()` as the reference pages
// (`build-library-reference.ts`), so every `url` names the heading that page
// gives the definition. URLs are `/epsil/`-rooted like every link of these
// docs; the site's sync rewrites them.
//
// Run via `npm run doc` (scripts/doc.sh) or directly:
//   npx tsx scripts/build-search-symbols.ts

import { writeFileSync } from 'node:fs';

import { ComputeEngine } from '../src/compute-engine/index.js';
import { librarySections } from './library-docs-shared.js';

/** The anchor Docusaurus gives a heading (github-slugger): lower case, no
 * punctuation except `-` and `_`, each space a `-`. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The first sentence of a description, for a one-line summary. */
function summary(description: string[] | undefined): string | undefined {
  if (!description || description.length === 0) return undefined;
  const text = description.join(' ').replace(/\s+/g, ' ').trim();
  const first = text.split(/(?<=[.!?])\s/)[0];
  return first.length > 200 ? first.slice(0, 199).trimEnd() + '…' : first;
}

const engine = new ComputeEngine();

const triggers = new Map<string, string[]>();
for (const { name, triggers: t } of engine.latexSyntax?.getNamedTriggers?.() ??
  [])
  triggers.set(name, t);

type SearchSymbol = {
  /** The MathJSON name. */
  id: string;
  /** The Epsil spelling, when it differs from the MathJSON name. */
  epsil?: string;
  kind: string;
  /** The library: its page name and its title. */
  library: string;
  libraryTitle: string;
  summary?: string;
  keywords?: string[];
  /** The LaTeX commands that parse to this definition. */
  latex?: string[];
  /** The entry of the definition in the library reference. */
  url: string;
};

const symbols: SearchSymbol[] = [];
for (const section of librarySections(engine)) {
  for (const { entry } of section.rows) {
    const heading = entry.epsilName ?? entry.id;
    const record: SearchSymbol = {
      id: entry.id,
      kind: entry.kind,
      library: section.name,
      libraryTitle: section.title,
      url: `/epsil/reference/${section.name}/#${slug(heading)}`,
    };
    if (entry.epsilName !== undefined && entry.epsilName !== entry.id)
      record.epsil = entry.epsilName;
    const s = summary(entry.description);
    if (s) record.summary = s;
    if (entry.keywords?.length) record.keywords = entry.keywords;
    const t = triggers.get(entry.id);
    if (t?.length) record.latex = t;
    symbols.push(record);
  }
}

writeFileSync(
  new URL('../src/epsil/docs/search-symbols.json', import.meta.url),
  JSON.stringify(symbols, null, 0) + '\n'
);
console.log(`${symbols.length} search symbols`);
