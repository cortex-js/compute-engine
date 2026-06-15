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
  reporters: ['jest-silent-reporter'],
  transformIgnorePatterns: ['node_modules/(?!(complex-esm)/)'],
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
