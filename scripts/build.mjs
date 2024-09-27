#!/usr/bin/env node
// @ts-nocheck

import * as esbuild from 'esbuild';

import pkg from '../package.json' assert { type: 'json' };
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
  target: ['es2020'],
  resolveExtensions: ['.ts', '.js'],
};

//
// Build the library
//
esbuild.build({
  ...BUILD_OPTIONS,
  entryPoints: ['./src/compute-engine.ts'],
  outfile: './dist/compute-engine.esm.js',
  format: 'esm',
});

esbuild.build({
  ...BUILD_OPTIONS,
  entryPoints: ['./src/compute-engine.ts'],
  outfile: './dist/compute-engine.js',
  format: 'iife',
  ...COMPUTE_ENGINE_UMD_OPTIONS,
  globalName: 'ComputeEngine',
});

esbuild.build({
  ...BUILD_OPTIONS,
  entryPoints: ['./src/math-json.ts'],
  outfile: './dist/math-json.esm.js',
  format: 'esm',
});

esbuild.build({
  ...BUILD_OPTIONS,
  entryPoints: ['./src/math-json.ts'],
  outfile: './dist/math-json.js',
  format: 'iife',
  ...MATH_JSON_UMD_OPTIONS,
  globalName: 'MathJson',
});

//
// Build the minified library
//
esbuild.build({
  ...BUILD_OPTIONS,
  drop: ['debugger'],
  pure: ['console.assert', 'console.log'],
  minify: true,
  entryPoints: ['./src/compute-engine.ts'],
  outfile: './dist/compute-engine.min.esm.js',
  format: 'esm',
});

esbuild.build({
  ...BUILD_OPTIONS,
  drop: ['debugger'],
  pure: ['console.assert', 'console.log'],
  minify: true,
  entryPoints: ['./src/compute-engine.ts'],
  outfile: './dist/compute-engine.min.js',
  format: 'iife',
  ...COMPUTE_ENGINE_UMD_OPTIONS,
  globalName: 'ComputeEngine',
});

esbuild.build({
  ...BUILD_OPTIONS,
  drop: ['debugger'],
  pure: ['console.assert', 'console.log'],
  entryPoints: ['./src/math-json.ts'],
  outfile: './dist/math-json.min.esm.js',
  format: 'esm',
});

esbuild.build({
  ...BUILD_OPTIONS,
  drop: ['debugger'],
  pure: ['console.assert', 'console.log'],
  minify: true,
  entryPoints: ['./src/math-json.ts'],
  outfile: './dist/math-json.min.js',
  format: 'iife',
  ...MATH_JSON_UMD_OPTIONS,
  globalName: 'MathJson',
});
