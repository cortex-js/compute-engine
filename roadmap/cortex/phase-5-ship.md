# Phase 5 — Ship

_Packaging, docs, and announcement. Mechanical once Phases 1–4 are done;
listed here so nothing is forgotten. Ship as **experimental**._

## Work items

1. **Build & packaging**
   - Add `cortex` to `TARGETS` in `scripts/build.sh` (the d.ts branch
     already exists at line ~93); add the esbuild bundle step to match the
     other entry points.
   - `package.json#exports`: add `./cortex` (types + esm + umd, same shape
     as `./latex-syntax`).
   - Verify the entry point re-exports the final API (`parseCortex`,
     `serializeCortex`, `executeCortex`, diagnostic types) and that
     `{{SDK_VERSION}}` substitution still applies.
   - Bundle-identity check: if `executeCortex` lands in the main bundle
     while parse/serialize live in `./cortex`, apply the cross-bundle
     lessons (no `instanceof` across bundles; string checks) and add a
     dist-level smoke test.
2. **Docs**
   - `src/cortex/docs/` is the source of truth during development; at ship
     time route through the normal `doc/` sync workflow (do not touch
     cortexjs.io directly). Frontmatter/permalinks already target
     `/cortex/…`.
   - Fill `naming.md` (language-review §2.10); add the "Future directions"
     non-goals section (§2.12); final grammar pass on `syntax.md`.
3. **Syntax highlighting**: validate `highlight-js-mode.js` against the
   final grammar (operators, `$…$` islands, verbatim symbols, extended
   strings); publish alongside; derive a CodeMirror grammar for Tycho if
   needed (Tycho-side).
4. **Tests/CI**: cortex suites already run in CI; add the dist smoke test
   (`import { parseCortex } from '@cortex-js/compute-engine/cortex'`
   against the packed build, like the benchmark harness does for CE
   releases).
5. **Announce**: CHANGELOG entry (first ever Cortex mention — say
   experimental, link docs); README section; note in ROADMAP.md pointing
   at [`STATUS_REPORT.md`](./STATUS_REPORT.md).

## Definition of done

- `npm pack` artifact: `/cortex` subpath imports and runs in both ESM and
  CJS consumers.
- Docs published; CHANGELOG shipped with the release that includes it.
