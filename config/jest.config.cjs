module.exports = {
  prettierPath: require.resolve('prettier-2'),
  verbose: true,
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
  //   reporters: ['jest-silent-reporter'],
  transformIgnorePatterns: ['node_modules/(?!(complex-esm)/)'],
  transform: {
    '^.+\\.(ts|js)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          allowJs: true,
          module: 'system',
        },
      },
    ],
  },
};
