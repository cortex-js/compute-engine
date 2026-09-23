module.exports = {
  prettierPath: require.resolve('prettier-2'),
  verbose: false,
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Twelve workers on the 18-core development machine (Apple M5 Max, 6 + 12
  // cores with no efficiency cores). Measured full-suite times: 163 s with
  // 6 workers, 88 s with 12, 84 s with 16, 89 s with 18. More than 12 workers
  // gives almost nothing, because the slowest test files take 45–52 s alone
  // and 75–83 s under contention, and they set the minimum run time. Twelve
  // also leaves 6 cores for the other sessions that share the machine.
  // A continuous-integration runner has 4 cores: six workers there made
  // tests with a time limit run about eight times slower than alone and
  // fail. `CI` is set by GitHub Actions; `'100%'` is one worker per core.
  maxWorkers: process.env.CI ? '100%' : 12,
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
