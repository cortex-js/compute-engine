#!/usr/bin/env node

import * as esbuild from 'esbuild';

// eslint-disable-next-line import/no-extraneous-dependencies
import open from 'open';

// Copy and watch the smoke test file
esbuild
  .context({
    entryPoints: ['./test/style.css', './test/compute-engine.html'],
    outdir: './dist',
    loader: {
      '.html': 'copy',
      '.css': 'copy',
    },
  })
  .then((ctx) => ctx.watch());

// Build and serve the library
esbuild
  .context({
    entryPoints: ['./src/compute-engine.ts'],
    outfile: './dist/compute-engine.esm.js',
    format: 'esm',
    bundle: true,
    loader: {
      '.ts': 'ts',
    },
    sourcemap: true,
    sourceRoot: '../src',
    sourcesContent: false,
  })
  .then((ctx) =>
    ctx
      .serve({ host: '127.0.0.1', port: 9029, servedir: '.' })
      .then(({ host, port }) => {
        if (host === '0.0.0.0' || host === '127.0.0.1') host = 'localhost';
        console.log(
          `\n 🚀 Server ready \u001b[1;35m http://${host}:${port}/dist/compute-engine.html/\u001b[0m`
        );
      })
  );

// let server = null;

// build({
//   entry: './src/compute-engine.ts',
//   outfile: './dist/compute-engine.esm.js',
//   format: 'esm',
//   bundle: true,
//   plugins: [],
//   loader: {
//     '.ts': 'ts',
//   },
//   watch: true,
//   cwd: '.', // Required so that the tsc error message include a path relative to the project root
//   debug: true,
//   sourcemap: true,
//   tslint: {
//     mode: 'on',
//     format: 'full',
//   },
//   silent: false,
//   quiet: true,
//   clear: false,
//   onEnd: (_config, buildResult, _ctx) => {
//     if (server === null && buildResult.errors.length === 0) {
//       const url = `http://localhost:8080/test/compute-engine.html`;

//       console.log(` 🚀 Server ready:\u001b[1;35m ${url}\u001b[0m`);

//       // eslint-disable-next-line import/no-extraneous-dependencies
//       server = require('serve-http').createServer({
//         host: 'localhost',
//         port: 8080,
//         pubdir: '.',
//         quiet: true,
//         defaultMimeType: 'text/javascript',
//         // livereload: { disable: true },
//       });
//       open(url);
//     }
//   },
// });
