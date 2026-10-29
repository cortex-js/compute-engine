// Make the existing config discoverable while preserving its relative paths.
module.exports = {
  ...require('./config/jest.config.cjs'),
  rootDir: require('node:path').join(__dirname, 'config'),
};
