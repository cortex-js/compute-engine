#!/usr/bin/env node
// @ts-nocheck

import * as esbuild from 'esbuild';

import pkg from '../package.json' with { type: 'json' };
const SDK_VERSION = pkg.version || 'v?.?.?';

// UMD wrapper
// (while iife works for `<script>` loading, sadly, some environemnts use
// `require()` which needs the UMD wrapper. See MathLive #1833)
const COMPUTE_ENGINE_UMD_OPTIONS = {
  banner: {
    js: `/** Compute Engine ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.ComputeEngine = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, ComputeEngine); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const MATH_JSON_UMD_OPTIONS = {
  banner: {
    js: `/** MathJSON ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.MathJson = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, MathJson); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const LATEX_SYNTAX_UMD_OPTIONS = {
  banner: {
    js: `/** LatexSyntax ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.LatexSyntax = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, LatexSyntax); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const INTERVAL_UMD_OPTIONS = {
  banner: {
    js: `/** Interval ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Interval = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, Interval); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const NUMERICS_UMD_OPTIONS = {
  banner: {
    js: `/** Numerics ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Numerics = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, Numerics); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const CORE_UMD_OPTIONS = {
  banner: {
    js: `/** ComputeEngineCore ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.ComputeEngineCore = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, ComputeEngineCore); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const COMPILE_UMD_OPTIONS = {
  banner: {
    js: `/** Compile ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Compile = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, Compile); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const IDENTITIES_UMD_OPTIONS = {
  banner: {
    js: `/** Identities ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Identities = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, Identities); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const INTEGRATION_RULES_UMD_OPTIONS = {
  banner: {
    js: `/** IntegrationRules ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.IntegrationRules = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, IntegrationRules); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const CORTEX_UMD_OPTIONS = {
  banner: {
    js: `/** Cortex ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/
    (function(global,factory){typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : typeof define === 'function' && define.amd ? define(['exports'],factory):(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Cortex = {}));})(this, (function (exports) { 'use strict';`,
  },
  footer: {
    js: `Object.assign(exports, Cortex); Object.defineProperty(exports, '__esModule', { value: true });}));`,
  },
};

const BUILD_OPTIONS = {
  banner: {
    js: `/** Compute Engine ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/`,
  },
  bundle: true,
  define: {
    ENV: JSON.stringify(process.env.BUILD),
    SDK_VERSION: JSON.stringify(SDK_VERSION),
    GIT_VERSION: JSON.stringify(process.env.GIT_VERSION || '?.?.?'),
  },
  loader: { '.ts': 'ts' },
  sourcemap: false,
  sourceRoot: '../src',
  sourcesContent: false,
  target: ['es2022'],
  resolveExtensions: ['.ts', '.js'],
};

// Minification settings shared by every `*-min` variant. Kept identical in
// effect to the previous per-call inline options.
const MIN_OPTIONS = {
  drop: ['debugger'],
  pure: ['console.assert', 'console.log'],
  minify: true,
};

// Entry table: source entry name → its UMD wrapper options + IIFE globalName.
// `esmViaSplit` entries (compute-engine + integration-rules + cortex) do NOT
// get a standalone single-entry ESM build — their ESM output comes from the
// shared code-splitting invocation below. Every entry still gets both UMD
// variants.
const ENTRIES = [
  {
    name: 'compute-engine',
    umd: COMPUTE_ENGINE_UMD_OPTIONS,
    globalName: 'ComputeEngine',
    esmViaSplit: true,
  },
  { name: 'math-json', umd: MATH_JSON_UMD_OPTIONS, globalName: 'MathJson' },
  {
    name: 'latex-syntax',
    umd: LATEX_SYNTAX_UMD_OPTIONS,
    globalName: 'LatexSyntax',
  },
  { name: 'interval', umd: INTERVAL_UMD_OPTIONS, globalName: 'Interval' },
  { name: 'numerics', umd: NUMERICS_UMD_OPTIONS, globalName: 'Numerics' },
  { name: 'core', umd: CORE_UMD_OPTIONS, globalName: 'ComputeEngineCore' },
  { name: 'compile', umd: COMPILE_UMD_OPTIONS, globalName: 'Compile' },
  { name: 'identities', umd: IDENTITIES_UMD_OPTIONS, globalName: 'Identities' },
  {
    name: 'integration-rules',
    umd: INTEGRATION_RULES_UMD_OPTIONS,
    globalName: 'IntegrationRules',
    esmViaSplit: true,
  },
  {
    name: 'cortex',
    umd: CORTEX_UMD_OPTIONS,
    globalName: 'Cortex',
    esmViaSplit: true,
  },
];

// The published layout puts the variant marker in the DIRECTORY, not the
// filename: `esm/<name>.js`, `esm-min/<name>.js`, `umd/<name>.cjs`,
// `umd-min/<name>.cjs`. Each ESM directory is self-contained (its own
// `chunks/`).
const builds = [];

// Build the library + the integration-rules plugin + the cortex language as
// ONE esbuild invocation per ESM variant with code splitting, so the shared
// engine core (BigDecimal, boxed expressions, numeric-value, latex-syntax, …)
// is emitted ONCE into a common chunk that `esm/compute-engine.js`,
// `esm/integration-rules.js` and `esm/cortex.js` import (and likewise under
// `esm-min/`). Without this, each bundle re-bundles the entire engine and its
// duplicate class definitions break cross-bundle `instanceof` checks (e.g. a
// host-created BigDecimal fails `instanceof BigDecimal` inside the plugin's
// statically-imported engine code, and `executeCortex(ce, …)` receives a
// host-created engine). Splitting is ESM-only; the UMD variants stay
// self-contained single files. The variant marker is the outdir
// (`dist/esm` vs `dist/esm-min`), so the entry/chunk names carry no suffix.
for (const [outdir, extra] of [
  ['./dist/esm', {}],
  ['./dist/esm-min', MIN_OPTIONS],
]) {
  builds.push(
    esbuild.build({
      ...BUILD_OPTIONS,
      ...extra,
      entryPoints: [
        './src/compute-engine.ts',
        './src/integration-rules.ts',
        './src/cortex.ts',
      ],
      outdir,
      format: 'esm',
      splitting: true,
      entryNames: '[name]',
      chunkNames: 'chunks/[name]-[hash]',
    })
  );
}

// Single-entry ESM builds for every entry NOT covered by the split builds.
for (const e of ENTRIES) {
  if (e.esmViaSplit) continue;
  builds.push(
    esbuild.build({
      ...BUILD_OPTIONS,
      entryPoints: [`./src/${e.name}.ts`],
      outfile: `./dist/esm/${e.name}.js`,
      format: 'esm',
    }),
    esbuild.build({
      ...BUILD_OPTIONS,
      ...MIN_OPTIONS,
      entryPoints: [`./src/${e.name}.ts`],
      outfile: `./dist/esm-min/${e.name}.js`,
      format: 'esm',
    })
  );
}

// Self-contained UMD (IIFE) builds for every entry, minified and not.
for (const e of ENTRIES) {
  builds.push(
    esbuild.build({
      ...BUILD_OPTIONS,
      entryPoints: [`./src/${e.name}.ts`],
      outfile: `./dist/umd/${e.name}.cjs`,
      format: 'iife',
      ...e.umd,
      globalName: e.globalName,
    }),
    esbuild.build({
      ...BUILD_OPTIONS,
      ...MIN_OPTIONS,
      entryPoints: [`./src/${e.name}.ts`],
      outfile: `./dist/umd-min/${e.name}.cjs`,
      format: 'iife',
      ...e.umd,
      globalName: e.globalName,
    })
  );
}

//
// Build all variants in parallel for maximum performance
//
await Promise.all(builds);
