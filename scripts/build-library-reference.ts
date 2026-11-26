// Generates `src/epsil/docs/reference/<category>.md` — one reference page
// per library category, with the FULL description of every definition —
// from the definitions themselves, through the same `describeName()` that
// `epsil doc <name>` prints and the editor shows as a hover. The one-page
// index (`library.md`, `build-library-docs.ts`) gives each definition one
// table row; these pages give each one a section.
//
// Each page has two parts:
//
// - A hand-written introduction, read from `reference/<category>.intro.md`
//   when that file exists (a category with no introduction gets one
//   sentence). The introduction is spliced in front of the generated
//   entries, so regenerating the page never overwrites prose. An
//   introduction file is not a page of its own: the documentation test
//   skips `*.intro.md` and tests its Epsil blocks through the generated page.
// - A generated entry per definition: the Epsil spelling as the heading
//   (the MathJSON name when the definition has no spelling), the MathJSON
//   name, the signature in the engine's type syntax (or the kind, type and
//   value of a constant), the documented parameters (`parameterList()`),
//   every paragraph of the description, and each
//   example from the definition's `examples` field as an executed
//   `// ➔`-annotated block (`library-docs-shared.ts` has the rules).
//
// Run via `npm run doc` (scripts/doc.sh) or directly:
//   npx tsx scripts/build-library-reference.ts

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { ComputeEngine } from '../src/compute-engine/index.js';
import type { DocEntry } from '../src/cli/doc.js';
import { signatureArms } from '../src/common/type/utils.js';
import {
  mergeParameterDocs,
  type ParameterDoc,
} from '../src/epsil/doc-tags.js';
import {
  assertBalancedBackticks,
  exampleBlock,
  librarySections,
  mdx,
  shape,
  type Row,
  type Section,
} from './library-docs-shared.js';

const engine = new ComputeEngine();
const sections = librarySections(engine);
const root = new URL('../src/epsil/docs/reference/', import.meta.url);

/** The heading of an entry: the Epsil spelling, or the MathJSON name when
 * the definition has none (`Add`, written `+`). */
function heading(entry: DocEntry): string {
  return entry.epsilName ?? entry.id;
}

/** The line under the heading: the MathJSON name when it differs from the
 * heading, then the signature or the constant's kind, type and value. */
function headline(entry: DocEntry): string {
  const parts: string[] = [];
  if (entry.epsilName !== undefined) parts.push(`MathJSON \`${entry.id}\``);
  parts.push(mdx(shape(entry), false));
  return parts.join(' · ');
}

/** One parameter of a signature: its name, or its position (from 0) when
 * it has none, with its documentation by name merged with the entry at its
 * position of a `parameters` list, as the editor merges them
 * (`parameterDocAt()` in `src/epsil/completion.ts`). */
type Slot = { label: string; named: boolean; doc: ParameterDoc | undefined };

/** The parameters of the arms of an operator's signature, each once: a
 * named parameter by its name, a parameter with no name by its position. A
 * rest parameter is the slot after the others, and documents every argument
 * from that position on (`arguments 2, …`). */
function parameterSlots(entry: DocEntry): Slot[] {
  const def = engine.lookupDefinition(entry.id);
  if (def === undefined || !('operator' in def)) return [];
  const type = def.operator.signature?.type;
  const arms = typeof type === 'object' ? signatureArms(type) : undefined;
  const slots = new Map<string, Slot>();
  for (const arm of arms ?? []) {
    const params = [
      ...(arm.args ?? []),
      ...(arm.optArgs ?? []),
      ...(arm.variadicArg ? [arm.variadicArg] : []),
    ];
    params.forEach((param, i) => {
      const key = param.name ?? `#${i}`;
      const rest = arm.variadicArg !== undefined && i === params.length - 1;
      if (slots.has(key)) return;
      const doc = mergeParameterDocs(
        param.name === undefined ? undefined : entry.parameters?.[param.name],
        entry.positionalParameters?.[i]
      );
      slots.set(key, {
        label:
          param.name ?? (rest ? `arguments ${i + 1}, …` : `argument ${i + 1}`),
        named: param.name !== undefined,
        doc: doc?.documentation || doc?.sample || doc?.keys ? doc : undefined,
      });
    });
  }
  return [...slots.values()];
}

/** The documented parameters of an entry, a list under its signature: the
 * name or the position of each, its description, its sample, and the keys
 * of an options dictionary. Empty when no parameter is documented. */
function parameterList(slots: readonly Slot[]): string[] {
  const lines: string[] = [];
  for (const { label, named, doc } of slots) {
    if (doc === undefined) continue;
    const name = named ? `\`${label}\`` : label;
    let line = `- ${name}`;
    if (doc.documentation) line += ` — ${mdx(doc.documentation, false)}`;
    if (doc.sample) line += ` Sample: \`${doc.sample}\`.`;
    lines.push(line);
    for (const key of doc.keys ?? []) {
      let keyLine = `  - \`${key.name}\``;
      if (key.type) keyLine += ` (\`${key.type}\`)`;
      if (key.documentation) keyLine += ` — ${mdx(key.documentation, false)}`;
      if (key.sample) keyLine += ` Sample: \`${key.sample}\`.`;
      if (key.default) keyLine += ` Default: \`${key.default}\`.`;
      lines.push(keyLine);
    }
  }
  return lines;
}

let undocumentedParameters = 0;
let parameterCount = 0;

function entrySection(row: Row, page: string, counts: number[]): string {
  const { entry } = row;
  const lines: string[] = [
    `### ${heading(entry)}`,
    '',
    assertBalancedBackticks(headline(entry), entry.id, page),
  ];
  const slots = parameterSlots(entry);
  const missing = slots.filter((s) => s.doc === undefined).length;
  counts[0] += slots.length;
  counts[1] += missing;
  const list = parameterList(slots);
  if (list.length > 0)
    lines.push(
      '',
      ...list.map((l) => assertBalancedBackticks(l, entry.id, page))
    );
  // `describeName()` gives the paragraphs: it joins the wrapped lines of a
  // library description (`libraryParagraphs()` in `src/epsil/doc-tags.ts`).
  for (const paragraph of entry.description ?? []) {
    lines.push(
      '',
      assertBalancedBackticks(mdx(paragraph, false), entry.id, page)
    );
  }
  if (entry.url !== undefined) lines.push('', `See ${entry.url}.`);
  for (const example of row.examples)
    lines.push('', exampleBlock(example, entry.id, page, engine));
  return lines.join('\n');
}

/** The introduction of a category: the hand-written file when there is
 * one, otherwise one sentence. */
function introduction(section: Section): string {
  const file = new URL(`${section.name}.intro.md`, root);
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  return `The ${section.rows.length} definitions of the ${section.title.toLowerCase()} library, each with its Epsil spelling, its MathJSON name, its signature and its full description.`;
}

let exampleCount = 0;
let missingExamples = 0;
const perCategory: string[] = [];

for (const section of sections) {
  const page = `reference/${section.name}.md`;
  const counts = [0, 0];
  const entries = section.rows.map((row) => entrySection(row, page, counts));
  parameterCount += counts[0];
  undocumentedParameters += counts[1];
  exampleCount += section.rows.reduce((n, r) => n + r.examples.length, 0);
  const withoutExamples = section.rows.filter(
    (r) => r.examples.length === 0
  ).length;
  missingExamples += withoutExamples;
  perCategory.push(
    `${section.name}: ${section.rows.length} definitions, ${withoutExamples} without an example, ${counts[1]} of ${counts[0]} parameters undocumented`
  );

  const description = `The ${section.title.toLowerCase()} library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description.`;
  // The slug is written `/epsil/`-rooted like every other page in this
  // directory (see `build-error-docs.ts` for why).
  const content = `---
title: ${section.title} Reference
sidebar_label: ${section.title}
slug: /epsil/reference/${section.name}/
description: "${description}"
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as \`epsil doc\` describes them;
# the introduction comes from ${section.name}.intro.md when that file exists.
# Regenerate with \`npm run doc\` (scripts/build-library-reference.ts).
---
# ${section.title}

${introduction(section)}

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

${entries.join('\n\n')}
`;
  writeFileSync(new URL(`${section.name}.md`, root), content);
}

const total = sections.reduce((n, s) => n + s.rows.length, 0);
console.log(
  `reference/: ${sections.length} pages, ${total} definitions, ${exampleCount} examples, ${missingExamples} definitions without an example, ${undocumentedParameters} of ${parameterCount} parameters undocumented, written to src/epsil/docs/reference/`
);
for (const line of perCategory) console.log(`  ${line}`);
