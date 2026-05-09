'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  moduleNameMapper: {
    // Redirect electron to our manual mock (not available in plain Node.js)
    '^electron$': '<rootDir>/__mocks__/electron.js',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/main/store.js', 'src/main/database.js', 'src/main/wsServer.js'],
  testTimeout: 5000,
};
