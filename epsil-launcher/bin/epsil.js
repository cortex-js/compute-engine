#!/usr/bin/env node
// Launcher for the Epsil CLI, which ships with @cortex-js/compute-engine.
//
// The CLI entry runs on import (it reads `process.argv` itself, skipping the
// first two entries, so being invoked through this bin changes nothing).
//
// Note that in a project that has @cortex-js/compute-engine installed,
// `npx epsil` resolves the package's own local bin and this launcher is never
// involved; it serves the global / uninstalled (`npx @cortex-js/epsil`) case.
import '@cortex-js/compute-engine/cli';
