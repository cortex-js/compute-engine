#!/usr/bin/env node
// Launcher for the Epsil CLI, which ships with @cortex-js/compute-engine.
//
// Phase 1 (this version): the currently published compute-engine predates the
// `epsil` binary, so this launcher prints installation guidance.
//
// Phase 2 (once a compute-engine release ships the `epsil` bin and the
// `./cli` package export): add `"@cortex-js/compute-engine": "^<version>"` to
// dependencies and replace the body of this file with:
//
//   import '@cortex-js/compute-engine/cli';
//
// Note that in a project that has @cortex-js/compute-engine installed,
// `npx epsil` resolves the package's own local bin and this launcher is never
// involved; it serves the global / uninstalled case.

console.error(`epsil: the Epsil CLI ships with the @cortex-js/compute-engine package.

To use it in a project:

    npm install @cortex-js/compute-engine
    npx epsil program.epsil

Epsil is a programming language for scientific computing built on the
Compute Engine. Documentation: https://cortexjs.io/epsil/

(This launcher package will forward to the CLI directly once the next
@cortex-js/compute-engine release ships the 'epsil' binary.)`);
process.exit(1);
