// Generates `src/epsil/docs/library.md` — the categorized index of the
// standard library — from the definitions themselves: the same
// `describeName()` that `epsil doc <name>` prints and the editor shows as a
// hover, over the same library list the engine loads. One source, so the
// page cannot drift from what the engine actually defines.
//
// Each definition contributes one table row (name, signature or type, the
// first sentence of its description). The full description and the
// executed examples of every definition are on the per-category pages that
// `build-library-reference.ts` generates; each category heading here links
// to its page. This page carried the examples too until 2026-09-27, when
// the examples of the core and collections libraries made it several
// thousand lines long. The helpers the two generators share are in
// `library-docs-shared.ts`.
//
// Run via `npm run doc` (scripts/doc.sh) or directly:
//   npx tsx scripts/build-library-docs.ts

import { writeFileSync } from 'node:fs';

import { ComputeEngine } from '../src/compute-engine/index.js';
import {
  assertBalancedBackticks,
  headingSlug,
  librarySections,
  mdx,
  shape,
  summary,
  type Section,
} from './library-docs-shared.js';

const PAGE = 'library.md';
const engine = new ComputeEngine();
const sections = librarySections(engine);
const anchor = (s: Section): string => headingSlug(s.title);

const contents = sections
  .map(
    (s) =>
      `- [${s.title}](#${anchor(s)}) — ${s.rows.length} definitions · [full reference](/epsil/reference/${s.name}/)`
  )
  .join('\n');

const body = sections
  .map((s) => {
    const table = [
      '| Epsil | MathJSON | Signature | Summary |',
      '|:------|:---------|:----------|:--------|',
      ...s.rows.map(
        (r) =>
          `| ${r.entry.epsilName === undefined ? '—' : `\`${r.entry.epsilName}\``} | \`${r.entry.id}\` | ${assertBalancedBackticks(mdx(shape(r.entry)), r.entry.id, PAGE)} | ${assertBalancedBackticks(mdx(summary(r.entry)), r.entry.id, PAGE)} |`
      ),
    ].join('\n');
    return `## ${s.title}\n\nThe [${s.title} reference](/epsil/reference/${s.name}/) has the full description and the examples of each definition.\n\n${table}`;
  })
  .join('\n\n');

const total = sections.reduce((n, s) => n + s.rows.length, 0);

// The slug is written `/epsil/`-rooted like every other page in this
// directory (see `build-error-docs.ts` for why).
const page = `---
title: Epsil Standard Library
sidebar_label: Standard Library
slug: /epsil/library/
description: "Every function and constant of the Epsil standard library, by category, with signatures and summaries, linked to the per-category reference pages."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. Source: the library definitions
# (src/compute-engine/library/) as \`epsil doc\` describes them; regenerate
# with \`npm run doc\` (scripts/build-library-docs.ts).
---
# Epsil Standard Library

The ${total} functions and constants of the standard library, by category.
Each row gives a name, its signature (for a function) or its kind and type
(for a constant or variable), and the first sentence of its description —
the same description \`epsil doc <name>\` prints in full and the editor
shows as a hover. The full description and the executed examples of every
definition are on the category's reference page, linked from each heading.

To search the library by concept rather than by name, use
\`epsil doc <keywords>\` (see the [CLI](/epsil/cli/)); the
[guide for agents](/epsil/for-agents/) lists the names most often needed.

${contents}

${body}
`;

writeFileSync(new URL('../src/epsil/docs/library.md', import.meta.url), page);
console.log(
  `library.md: ${total} definitions in ${sections.length} categories written to src/epsil/docs/library.md`
);
