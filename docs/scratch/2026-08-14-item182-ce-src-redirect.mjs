/**
 * Tycho item 182 tooling: run a Tycho-repo harness against CE SOURCE.
 *
 * Node resolve hook that redirects `@cortex-js/compute-engine` (and /epsil)
 * imports to this repo's source tree, so Tycho's document harnesses run on
 * instrumentable source with real names in CPU profiles — no npm link, no
 * node_modules mutation.
 *
 * Usage (from dev/tycho, with the global tsx install):
 *
 *   node --import ~/.nvm/versions/node/v22.13.1/lib/node_modules/tsx/dist/loader.mjs \
 *        --import /Users/arno/dev/compute-engine/docs/scratch/2026-08-14-item182-ce-src-redirect.mjs \
 *        docs/scratch/d21-lizeq-head-extract.mts
 *
 * The tsx loader must be registered FIRST (this hook rewrites the specifier
 * to a .ts path that tsx then compiles). Pre-fix this reproduced
 * lizeqlnn5e's span#2 at ~10.4 s against source; after the item-182 fix
 * (the dependency-precise collection-facet memo, 2026-08-14) the same span
 * runs in ~31 ms and the whole 17-cell document evaluates in ~2.9 s (see
 * the "Tycho item 182" row in ROADMAP.md). Optionally add `--cpu-prof`
 * for an attributed profile.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
  new URL(`data:text/javascript,
export async function resolve(specifier, context, next) {
  if (specifier === '@cortex-js/compute-engine')
    return next(${JSON.stringify(pathToFileURL('/Users/arno/dev/compute-engine/src/compute-engine.ts').href)}, context);
  if (specifier === '@cortex-js/compute-engine/epsil')
    return next(${JSON.stringify(pathToFileURL('/Users/arno/dev/compute-engine/src/epsil.ts').href)}, context);
  return next(specifier, context);
}
`)
);
