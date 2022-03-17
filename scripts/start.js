#!/usr/bin/env node
// eslint-disable-next-line import/no-extraneous-dependencies
const { build } = require('estrella');
// eslint-disable-next-line import/no-extraneous-dependencies
const open = require('open');

let server = null;

const buildOptions = {
  // debug: true,
  // define: { DEBUG: false },
  format: 'esm',
  bundle: true,
  plugins: [],
  loader: {
    '.ts': 'ts',
  },
  watch: true,
  cwd: '.', // Required so that the tsc error message include a path relative to the project root
  debug: true,
  sourcemap: true,
  tslint: {
    mode: 'on',
    format: 'full',
  },
  silent: false,
  quiet: true,
  clear: false,
};

build({
  entry: './src/compute-engine.ts',
  outfile: './dist/compute-engine.esm.js',
  ...buildOptions,
  onEnd: (_config, buildResult, _ctx) => {
    if (server === null && buildResult.errors.length === 0) {
      const url = `http://localhost:8080/test/compute-engine.html`;

      console.log(` 🚀 Server ready:\u001b[1;35m ${url}\u001b[0m`);

      // eslint-disable-next-line import/no-extraneous-dependencies
      server = require('serve-http').createServer({
        host: 'localhost',
        port: 8080,
        pubdir: '.',
        quiet: true,
        defaultMimeType: 'text/javascript',
        // livereload: { disable: true },
      });
      open(url);
    }
  },
});
