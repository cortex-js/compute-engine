// Generates `src/epsil/docs/errors.md` — the hosted reference behind the
// clickable error codes in the editor (https://epsil.dev/errors/#<code>) —
// from `ERROR_EXPLANATIONS`, the same registry `epsil doc <code>` prints.
// One source, three surfaces (CLI, site, editor), so none can drift.
//
// Run via `npm run doc` (scripts/doc.sh) or directly:
//   npx tsx scripts/build-error-docs.ts

import { writeFileSync } from 'node:fs';
import { ERROR_EXPLANATIONS } from '../src/epsil/error-explanations.js';

/**
 * Registry entries are plain text written for a terminal, with backtick code
 * spans. The site renders MDX, where a bare `<`, `>`, `{` or `}` outside a
 * code span is JSX syntax (an unescaped `<FunctionName>` breaks the build),
 * so those are entity-escaped everywhere except inside backtick spans.
 */
function mdx(prose: string): string {
  return prose
    .split(/(`[^`\n]*`)/)
    .map((run, i) =>
      // Odd indices are the captured code spans, kept verbatim.
      i % 2 === 1
        ? run
        : run
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('{', '&#123;')
            .replaceAll('}', '&#125;')
    )
    .join('');
}

const sections = Object.entries(ERROR_EXPLANATIONS).map(
  // Registry order is deliberate (related codes are grouped); keep it.
  ([code, explanation]) => `## \`${code}\`\n\n${mdx(explanation.trim())}`
);

// The slug is written `/epsil/`-rooted like every other page in this
// directory: the docs are authored for a section of mathlive.io, and
// cortexjs.io's `scripts/sync-epsil-docs.mjs` strips the prefix on the way
// into epsil.dev (so this lands at `/errors/`) while recording the old URL in
// its redirect table. Writing the post-move `/errors/` here instead would skip
// that rewrite and make the sync emit a mathlive.io/errors/ redirect stub.
const page = `---
title: Epsil Errors
sidebar_label: Errors
slug: /epsil/errors/
description: "Extended explanations for Epsil's diagnostic codes: what each error means, why the language works that way, and how to fix it."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. Source: src/epsil/error-explanations.ts;
# regenerate with \`npm run doc\` (scripts/build-error-docs.ts).
---
# Epsil Errors

Every Epsil diagnostic carries a stable, kebab-case code — \`static-type-error\`,
\`mapsto-arrow-expected\` — shown after the message in the editor and by
\`epsil check\`. The sections below are the extended explanations for the codes
that have more to say than their message already does; they are the same text
\`epsil doc <code>\` prints. In Visual Studio Code, clicking a
diagnostic's code opens its section on this page.

${sections.join('\n\n')}
`;

writeFileSync(new URL('../src/epsil/docs/errors.md', import.meta.url), page);
console.log(
  `errors.md: ${sections.length} documented codes written to src/epsil/docs/errors.md`
);
