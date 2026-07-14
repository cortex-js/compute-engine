module.exports = {
  prettierPath: require.resolve('prettier-2'),
  verbose: false,
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 6, // Optimized for M3 (8-core: 4P + 4E) based on benchmarking
  collectCoverageFrom: ['src/**/*.ts', '!<rootDir>/node_modules/'],
  coverageReporters: ['lcov'],
  coverageDirectory: '../coverage',
  //   coverageThreshold: {
  //     global: {
  //       lines: 90,
  //       statements: 90,
  //     },
  //   },
  roots: [
    '<rootDir>/../test',
    //, '<rootDir>/../src'
  ],
  setupFilesAfterEnv: ['../test/jest-config.ts'],
  // The silent reporter prints only failure details — no per-test lines, but
  // also no final counts, so a full-suite run that fails can end with nothing
  // after the last failure block (and `jest | tail`/`| grep` pipes lose the
  // exit code too). The built-in `summary` reporter adds exactly one
  // unambiguous `Test Suites:/Tests:/Snapshots:` block at the end of every
  // run, pass or fail.
  reporters: ['jest-silent-reporter', 'summary'],
  transformIgnorePatterns: ['node_modules/(?!(complex-esm)/)'],
  // Source imports carry explicit `.js` extensions (nodenext-style) that
  // resolve to `.ts` files under bundler resolution. Strip the extension so
  // jest's resolver finds the TypeScript sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.(ts|js)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          allowJs: true,
          // TS 6: 'system' module is deprecated; tests run as ESM.
          module: 'esnext',
          // TS 6 dropped @types auto-discovery; the base tsconfig restricts
          // `types` to ["node"], so re-add jest for the test program.
          types: ['node', 'jest'],
        },
      },
    ],
  },
};
