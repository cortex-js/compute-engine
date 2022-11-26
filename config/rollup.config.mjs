import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import typescript from 'rollup-plugin-typescript2';
import pkg from '../package.json' assert { type: 'json' };
import path from 'path';
import chalk from 'chalk';
import commonjs from '@rollup/plugin-commonjs';

process.env.BUILD = process.env.BUILD ?? 'development';
const PRODUCTION = process.env.BUILD.toLowerCase() === 'production';
const BUILD_DIR = 'dist/';
const SDK_VERSION = pkg.version ?? 'v?.?.?';

const targets = process.env.TARGETS
  ? process.env.TARGETS.split(' ')
  : ['math-json', 'cortex', 'compute-engine'];

const TYPESCRIPT_OPTIONS = {
  clean: PRODUCTION,
  tsconfigOverride: {
    compilerOptions: {
      declaration: false,
    },
  },
};

// Options to target "vintage" environments, for example environments that
// don't support optional chaining.
// This is mostly an issue with toolchains, not so much target environments.
// For example Webpack 4 doesn't support optional chaining, even though it
// targets environments that do.
const TYPESCRIPT_VINTAGE_OPTIONS = {
  clean: true,
  tsconfigOverride: {
    compilerOptions: {
      declaration: false,
      target: 'es2017',
    },
  },
};

function preamble(moduleName) {
  return `/** ${moduleName} ${SDK_VERSION} ${
    process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
  }*/`;
}

const TERSER_OPTIONS = {
  ecma: 2020, // Use "5" to support older browsers
  compress: {
    drop_console: true,
    drop_debugger: true,
    global_defs: {
      ENV: JSON.stringify(process.env.BUILD),
      SDK_VERSION: SDK_VERSION,
      GIT_VERSION: process.env.GIT_VERSION ?? '?.?.?',
    },
    module: true,
    passes: 3,
    unsafe: true,
    // unsafe_arrows: true,
    // unsafe_comps: true,
    // unsafe_methods: true,
    // unsafe_proto: true,
    // unsafe_undefined: true,
    warnings: true,
  },
  format: {
    ascii_only: true,
    comments: false,
  },
};

function normalizePath(id) {
  return path.relative(process.cwd(), id).split(path.sep).join('/');
}

function clearLine() {
  if (process.stdout.isTTY && typeof process.stdout.clearLine === 'function') {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
  }
}

//
// Rollup plugin to display build progress
//
function buildProgress() {
  return {
    name: 'rollup.config.js',
    transform(_code, id) {
      const file = normalizePath(id);
      if (file.includes(':')) return;

      clearLine();
      if (process.stdout.isTTY) {
        process.stdout.write(
          chalk.green(' 羽') + '  Building ' + chalk.grey(file)
        );
      } else {
        console.log(chalk.grey(file));
      }
    },
    buildEnd() {
      clearLine();
    },
  };
}

//
// The build targets.
//
// We have three build targets:
// - MathJSON (the library to parse/serialize MathJSON)
// - ComputeEngine (includes MathJSON)
// - Cortex (the language, includes ComputeEngine)
//
const ROLLUP = [];
export default ROLLUP;

if (targets.includes('math-json')) {
  ROLLUP.push({
    input: 'src/math-json.ts',
    output: [
      {
        format: 'es',
        file: BUILD_DIR + 'math-json.esm.js',
        sourcemap: !PRODUCTION,
        exports: 'named',
        banner: preamble('MathJSON'),
      },
    ],
    plugins: [
      buildProgress(),
      resolve({ browser: true }),
      commonjs(),
      typescript({
        clean: PRODUCTION,
        tsconfigOverride: {
          compilerOptions: {
            declaration: false,
          },
          include: ['src/math-json/*'],
        },
      }),
    ],
  });
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
      ],
      plugins: [
        buildProgress(),
        resolve({ browser: true }),
        commonjs(),
        typescript({
          clean: PRODUCTION,
          tsconfigOverride: {
            compilerOptions: {
              declaration: false,
            },
            include: ['src/math-json/*'],
          },
        }),
        terser({
          ...TERSER_OPTIONS,
          format: { ...TERSER_OPTIONS.format, preamble: preamble('MathJSON') },
        }),
      ],
    });

    ROLLUP.push({
      input: 'src/math-json.ts',
      output: [
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
        resolve({ browser: true }),
        commonjs(),
        typescript({
          clean: PRODUCTION,
          tsconfigOverride: {
            compilerOptions: {
              declaration: false,
              target: 'es2017',
            },
            include: ['src/math-json/*'],
          },
        }),
        terser({
          ...TERSER_OPTIONS,
          ecma: 2017,
          format: { ...TERSER_OPTIONS.format, preamble: preamble('MathJSON') },
        }),
      ],
    });
  }
}

if (targets.includes('compute-engine')) {
  ROLLUP.push({
    input: 'src/compute-engine.ts',
    output: [
      {
        format: 'es',
        file: BUILD_DIR + 'compute-engine.esm.js',
        sourcemap: !PRODUCTION,
        exports: 'named',
        banner: preamble('CortexJS Compute Engine'),
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
  });
  if (PRODUCTION) {
    ROLLUP.push({
      input: 'src/compute-engine.ts',
      output: [
        {
          format: 'es',
          file: BUILD_DIR + 'compute-engine.min.esm.js',
          sourcemap: false,
          exports: 'named',
        },
      ],
      plugins: [
        buildProgress(),
        resolve({
          browser: true,
        }),
        commonjs(),
        typescript(TYPESCRIPT_OPTIONS),
        terser({
          ...TERSER_OPTIONS,
          format: {
            ...TERSER_OPTIONS.format,
            preamble: preamble('CortexJS Compute Engine'),
          },
        }),
      ],
    });

    ROLLUP.push({
      input: 'src/compute-engine.ts',
      output: [
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
        resolve({
          browser: true,
        }),
        commonjs(),
        typescript(TYPESCRIPT_OPTIONS),
        terser({
          ...TERSER_OPTIONS,
          ecma: 2020,
          format: {
            ...TERSER_OPTIONS.format,
            preamble: preamble('CortexJS Compute Engine'),
          },
        }),
      ],
    });
  }
}

if (targets.includes('cortex')) {
  ROLLUP.push({
    input: 'src/cortex.ts',
    output: [
      {
        format: 'es',
        file: BUILD_DIR + 'cortex.esm.js',
        sourcemap: !PRODUCTION,
        exports: 'named',
        banner: preamble('Cortex'),
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
  });

  if (PRODUCTION) {
    ROLLUP.push({
      input: 'src/cortex.ts',
      output: [
        {
          format: 'es',
          file: BUILD_DIR + 'cortex.min.esm.js',
          sourcemap: false,
          exports: 'named',
        },
      ],
      plugins: [
        buildProgress(),
        resolve({ browser: true }),
        commonjs(),
        typescript(TYPESCRIPT_OPTIONS),
        terser({
          ...TERSER_OPTIONS,
          format: { ...TERSER_OPTIONS.format, preamble: preamble('Cortex') },
        }),
      ],
    });

    ROLLUP.push({
      input: 'src/cortex.ts',
      output: [
        {
          file: BUILD_DIR + 'cortex.min.js',
          format: 'umd',
          sourcemap: false,
          exports: 'named',
          name: 'cortex', // Required for UMD
        },
      ],
      plugins: [
        buildProgress(),
        resolve({ browser: true }),
        commonjs(),
        typescript(TYPESCRIPT_OPTIONS),
        terser({
          ...TERSER_OPTIONS,
          ecma: 2020,
          format: { ...TERSER_OPTIONS.format, preamble: preamble('Cortex') },
        }),
      ],
    });
  }
}
