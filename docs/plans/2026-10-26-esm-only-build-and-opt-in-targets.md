# ESM-only build, shared engine chunk, opt-in compilation targets

**Status: in progress (2026-10-26).** User decisions recorded below; the
implementation is in flight in a worktree. Remove this document when the
packaging change has shipped and `CHANGELOG.md` carries the entry.

## Decisions (user, 2026-10-26)

1. **The compiler stays in this repository and in this package.** Moving it to
   a sister project was assessed and rejected: the compiler reads 388 symbols
   from 96 engine modules, the engine calls it from eleven implicit sites (the
   `Map` auto-compile, `NIntegrate`, `ND`, `NLimit`, `NDSolve`, the solve-domain
   sieve, the stochastic-equality probe, `Reduce`, the nonlinear fit, the kernel
   pool), and 500 of 1,390 test files check that the interpreter and the
   compiler agree. A separate package would freeze about 150 internal helper
   signatures as a contract and require lockstep releases.
2. **The GPU targets (GLSL, WGSL) and the Python target become opt-in.** The
   JavaScript and `interval-js` targets stay registered on every engine: the
   implicit compile sites need JavaScript, and the solver's domain enumeration
   asks for an `interval-js` enclosure (`intervalFunction` in
   `boxed-expression/solve-domain.ts`). Measured on the 0.169.2 core bundle
   (5,178 KB minified): GPU 316 KB, Python 93 KB, interval-js 53 KB, JavaScript
   target and runtime 239 KB, shared compiler code 470 KB.
3. **Every published entry that contains the engine is built in one
   code-splitting invocation**, so `./core`, `./compile`, `./epsil`,
   `./integration-rules` and the full entry import one engine chunk. Before
   this change `core.js` and `compile.js` were single-entry builds, and a
   consumer that imported both loaded two engines (the cross-bundle
   `instanceof` failure that `scripts/build.mjs` already documents for the
   `integration-rules` plugin).
4. **The UMD builds are dropped** and the `require` export conditions with
   them. Node loads the ESM entries through `require()` since Node 22.12, so
   `engines.node` rises from `>=22.3.0` to `>=22.12.0`. Nothing in the docs,
   the tests or the sibling repositories (Tycho, MathLive, cortexjs.io) uses
   the script-tag global or the `.cjs` files. One CommonJS consumer is known
   (issue 292, a NestJS user); `require()` keeps working for them on Node
   22.12 and later.
5. **No dependency injection for `./compile`.** The duplication was a build
   entry-list problem, not a design problem. The injected interface would be
   about 150 engine-bound helper functions consumed by `base-compiler.ts`,
   not by the thin targets.

## What changes

### Build and packaging

- `scripts/build.mjs`: one ESM code-splitting invocation per variant for
  every entry except two. `runtime` (its smoke test asserts that it imports
  nothing) and `kernel-worker` (a host copies the file) keep their
  single-entry builds. `math-json`, `latex-syntax`, `interval` and `numerics`
  join the split too (review finding, 2026-10-26): `numerics` exports the
  `NumericValue` classes that the engine tests with `instanceof`, so a
  standalone copy reproduced the two-copies hazard. The UMD loop and its
  eleven banner/footer option blocks are removed.
- `package.json`: `/dist/umd-min` leaves `files`; every `require` condition is
  removed (Node falls through to `default`, the ESM file); `browser` and
  `unpkg` point at the ESM entry; `engines.node` is `>=22.12.0`.
- A consumer smoke test, `test/consumer/require-smoke.cjs`, loads the built
  entries with `require()` and checks that `core.js` and `compile.js` import a
  common chunk.

### Opt-in targets

- `engine-compilation-targets.ts` keeps a module-level table of default
  target factories, seeded with `javascript` and `interval-js`. The full
  entry (`src/compute-engine.ts`) adds `glsl`, `wgsl` and `python` to that
  table when it is imported. The table is one value for the whole program
  (the entries share the engine chunk) and a registry reads it on each
  lookup, so every engine of the program resolves the three targets once the
  full entry has loaded, whichever entry made the engine and in whichever
  order (review finding, 2026-10-26: the default engine that the free
  functions of `./core` cache must not be left without them). A program that
  loads `./core` alone has the two built-in targets.
- `ce.registerCompilationTarget(name, target)` becomes a public method. The
  compile guide and the Python guide have documented it under that name since
  before this change, but only the internal `_registerCompilationTarget`
  existed: a documented API that did not exist is a defect, fixed here.
- A `./core` consumer that wants a GPU or Python target imports it from
  `./compile` and registers it. An unregistered target name already fails
  with a message that lists the registered targets.

### Documentation

- `doc/13-guide-compile.md`: which targets are registered by which entry, and
  how to register the others.
- `ARCHITECTURE.md` "Packaging and entry points": ESM only, the shared chunk,
  the `./core` row.
- `CHANGELOG.md`: a breaking-change entry for the Node floor and the UMD
  removal, and a packaging entry for the shared chunk and the opt-in targets.

## Verification

- `npm run build production`, then compare bundle sizes with the 0.169.2
  numbers above; `compile.js` must shrink from 3.5 MB to the targets alone.
- `npm run test:js-runtime`, `npm run test:nodenext`, `npm run test:epsil-runtime`,
  `npm run test:epsil-cli`, and the new `require` smoke test.
- The compile test files that name `glsl`, `wgsl` or `python` targets, plus a
  new test that checks the registered target list of an engine from `./core`
  and from the full entry.
- `npm run typecheck`.
