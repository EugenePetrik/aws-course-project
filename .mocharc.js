const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  require: ['ts-node/register', 'mochawesome/register'],
  extensions: ['ts'],
  spec: ['src/tests/**/*.spec.ts'],
  timeout: 180_000,
  slow: 60_000,
  color: true,
  reporter: 'mocha-multi-reporters',
  reporterEnabled: `mochawesome`,
  reporterOptions: 'configFile=.mocharc.js',
  mochawesomeReporterOptions: {
    consoleReporter: 'spec',
    charts: true,
    reportFilename: 'report',
  },
  parallel: false,
};
