import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import typescript from 'rollup-plugin-typescript2';
import { eslint } from 'rollup-plugin-eslint';
import pkg from '../package.json';
import path from 'path';
const { exec } = require('child_process');
import chalk from 'chalk';
import commonjs from '@rollup/plugin-commonjs';

process.env.BUILD = process.env.BUILD || 'development';
const PRODUCTION = process.env.BUILD === 'production';
const BUILD_DIR = 'dist/';
const SDK_VERSION = pkg.version || 'v?.?.?';

const TYPESCRIPT_OPTIONS = {
  clean: PRODUCTION,
  tsconfigOverride: {
    compilerOptions: {
      declaration: false,
    },
  },
};

const TERSER_OPTIONS = {
  compress: {
    drop_console: true,
    drop_debugger: true,
    ecma: 8, // Use "5" to support older browsers
    module: true,
    warnings: true,
    passes: 4,
    global_defs: {
      ENV: JSON.stringify(process.env.BUILD),
      SDK_VERSION: SDK_VERSION,
      GIT_VERSION: process.env.GIT_VERSION || '?.?.?',
    },
  },
};

function normalizePath(id) {
  return path.relative(process.cwd(), id).split(path.sep).join('/');
}

function timestamp() {
  const now = new Date();
  return chalk.green(
    `${now.getHours()}:${('0' + now.getMinutes()).slice(-2)}:${(
      '0' + now.getSeconds()
    ).slice(-2)}`
  );
}

// Rollup plugin to display build progress and launch server
function buildProgress() {
  return {
    name: 'rollup.config.js',
    transform(_code, id) {
      const file = normalizePath(id);
      if (file.includes(':')) {
        return;
      }

      if (
        process.stdout.isTTY &&
        typeof process.stdout.clearLine === 'function'
      ) {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(
          chalk.green(' ●') + '  Building ' + chalk.grey(file)
        );
      } else {
        console.log(chalk.grey(file));
      }
    },
    buildEnd() {
      if (process.env.BUILD === 'watch' || process.env.BUILD === 'watching') {
        if (
          process.stdout.isTTY &&
          typeof process.stdout.clearLine === 'function'
        ) {
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
          process.stdout.write(
            timestamp() +
              (process.env.BUILD === 'watching'
                ? ' Build updated'
                : ' Build done')
          );
        }
      } else {
        if (
          process.stdout.isTTY &&
          typeof process.stdout.clearLine === 'function'
        ) {
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
        }
      }
      if (process.env.BUILD === 'watch') {
        process.env.BUILD = 'watching';
        if (
          process.stdout.isTTY &&
          typeof process.stdout.clearLine === 'function'
        ) {
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
        }
        console.log(chalk.green(' ✔') + '  Build complete ');
        console.log(' 🚀 Launching server');
        exec(
          "npx http-server . -s -c-1 --cors='*' -o /test/compute-engine.html",
          (error, stdout, stderr) => {
            if (error) {
              console.error(`http-server error: ${error}`);
              return;
            }
            console.log(stdout);
            console.error(stderr);
          }
        );
      }
    },
  };
}
const ROLLUP = [
  {
    input: 'src/math-json.ts',
    output: [
      {
        format: 'es',
        file: BUILD_DIR + 'math-json.esm.js',
        sourcemap: !PRODUCTION,
        exports: 'named',
      },
      {
        file: BUILD_DIR + 'math-json.js',
        format: 'umd',
        sourcemap: !PRODUCTION,
        exports: 'named',
        name: 'MathJson', // Required for UMD
      },
    ],
    plugins: [
      buildProgress(),
      resolve({
        browser: true,
        // preferBuiltins: true,
      }),
      commonjs(),
      typescript(TYPESCRIPT_OPTIONS),
    ],
    watch: {
      clearScreen: true,
      exclude: 'node_modules/**',
      include: ['src/**'],
    },
  },
  {
    input: 'src/compute-engine.ts',
    output: [
      {
        format: 'es',
        file: BUILD_DIR + 'compute-engine.esm.js',
        sourcemap: !PRODUCTION,
        exports: 'named',
      },
      {
        file: BUILD_DIR + 'compute-engine.js',
        format: 'umd',
        sourcemap: !PRODUCTION,
        exports: 'named',
        name: 'ComputeEngine', // Required for UMD
      },
    ],
    plugins: [
      buildProgress(),
      resolve({
        browser: true,
        // preferBuiltins: true,
      }),
      commonjs(),
      typescript(TYPESCRIPT_OPTIONS),
    ],
    watch: {
      clearScreen: true,
      exclude: 'node_modules/**',
      include: ['src/**'],
    },
  },
];

if (PRODUCTION) {
  ROLLUP.push({
    input: 'src/math-json.ts',
    output: [
      {
        format: 'es',
        file: BUILD_DIR + 'math-json.min.esm.js',
        sourcemap: false,
        exports: 'named',
      },
      ,
      {
        file: BUILD_DIR + 'math-json.min.js',
        format: 'umd',
        sourcemap: false,
        exports: 'named',
        name: 'MathJson', // Required for UMD
      },
    ],
    plugins: [
      buildProgress(),
      eslint(),
      resolve({
        browser: true,
      }),
      commonjs(),
      typescript(TYPESCRIPT_OPTIONS),
      terser(TERSER_OPTIONS),
    ],
  });
  ROLLUP.push({
    input: 'src/compute-engine.ts',
    output: [
      {
        format: 'es',
        file: BUILD_DIR + 'compute-engine.min.esm.js',
        sourcemap: false,
        exports: 'named',
      },
      ,
      {
        file: BUILD_DIR + 'compute-engine.min.js',
        format: 'umd',
        sourcemap: false,
        exports: 'named',
        name: 'ComputeEngine', // Required for UMD
      },
    ],
    plugins: [
      buildProgress(),
      eslint(),
      resolve({
        browser: true,
      }),
      commonjs(),
      typescript(TYPESCRIPT_OPTIONS),
      terser(TERSER_OPTIONS),
    ],
  });
}

export default ROLLUP;
