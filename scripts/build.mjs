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

//
// Build all variants in parallel for maximum performance
//
await Promise.all([
  // Build the library (non-minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/compute-engine.ts'],
    outfile: './dist/compute-engine.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/compute-engine.ts'],
    outfile: './dist/compute-engine.umd.cjs',
    format: 'iife',
    ...COMPUTE_ENGINE_UMD_OPTIONS,
    globalName: 'ComputeEngine',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/math-json.ts'],
    outfile: './dist/math-json.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/math-json.ts'],
    outfile: './dist/math-json.umd.cjs',
    format: 'iife',
    ...MATH_JSON_UMD_OPTIONS,
    globalName: 'MathJson',
  }),

  // Build the minified library
  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/compute-engine.ts'],
    outfile: './dist/compute-engine.min.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/compute-engine.ts'],
    outfile: './dist/compute-engine.min.umd.cjs',
    format: 'iife',
    ...COMPUTE_ENGINE_UMD_OPTIONS,
    globalName: 'ComputeEngine',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/math-json.ts'],
    outfile: './dist/math-json.min.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/math-json.ts'],
    outfile: './dist/math-json.min.umd.cjs',
    format: 'iife',
    ...MATH_JSON_UMD_OPTIONS,
    globalName: 'MathJson',
  }),

  // latex-syntax (non-minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/latex-syntax.ts'],
    outfile: './dist/latex-syntax.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/latex-syntax.ts'],
    outfile: './dist/latex-syntax.umd.cjs',
    format: 'iife',
    ...LATEX_SYNTAX_UMD_OPTIONS,
    globalName: 'LatexSyntax',
  }),

  // latex-syntax (minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/latex-syntax.ts'],
    outfile: './dist/latex-syntax.min.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/latex-syntax.ts'],
    outfile: './dist/latex-syntax.min.umd.cjs',
    format: 'iife',
    ...LATEX_SYNTAX_UMD_OPTIONS,
    globalName: 'LatexSyntax',
  }),

  // interval (non-minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/interval.ts'],
    outfile: './dist/interval.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/interval.ts'],
    outfile: './dist/interval.umd.cjs',
    format: 'iife',
    ...INTERVAL_UMD_OPTIONS,
    globalName: 'Interval',
  }),

  // interval (minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/interval.ts'],
    outfile: './dist/interval.min.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/interval.ts'],
    outfile: './dist/interval.min.umd.cjs',
    format: 'iife',
    ...INTERVAL_UMD_OPTIONS,
    globalName: 'Interval',
  }),

  // numerics (non-minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/numerics.ts'],
    outfile: './dist/numerics.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/numerics.ts'],
    outfile: './dist/numerics.umd.cjs',
    format: 'iife',
    ...NUMERICS_UMD_OPTIONS,
    globalName: 'Numerics',
  }),

  // numerics (minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/numerics.ts'],
    outfile: './dist/numerics.min.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/numerics.ts'],
    outfile: './dist/numerics.min.umd.cjs',
    format: 'iife',
    ...NUMERICS_UMD_OPTIONS,
    globalName: 'Numerics',
  }),

  // core (non-minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/core.ts'],
    outfile: './dist/core.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/core.ts'],
    outfile: './dist/core.umd.cjs',
    format: 'iife',
    ...CORE_UMD_OPTIONS,
    globalName: 'ComputeEngineCore',
  }),

  // core (minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/core.ts'],
    outfile: './dist/core.min.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/core.ts'],
    outfile: './dist/core.min.umd.cjs',
    format: 'iife',
    ...CORE_UMD_OPTIONS,
    globalName: 'ComputeEngineCore',
  }),

  // compile (non-minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/compile.ts'],
    outfile: './dist/compile.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    entryPoints: ['./src/compile.ts'],
    outfile: './dist/compile.umd.cjs',
    format: 'iife',
    ...COMPILE_UMD_OPTIONS,
    globalName: 'Compile',
  }),

  // compile (minified)
  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/compile.ts'],
    outfile: './dist/compile.min.esm.js',
    format: 'esm',
  }),

  esbuild.build({
    ...BUILD_OPTIONS,
    drop: ['debugger'],
    pure: ['console.assert', 'console.log'],
    minify: true,
    entryPoints: ['./src/compile.ts'],
    outfile: './dist/compile.min.umd.cjs',
    format: 'iife',
    ...COMPILE_UMD_OPTIONS,
    globalName: 'Compile',
  }),
]);
