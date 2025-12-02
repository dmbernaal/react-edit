const { createStreamRoute } = require('./stream');
const { createRevertRoute } = require('./revert');
const { createDiffRoute } = require('./diff');
const { createFilesRoute, cleanupTempImages } = require('./files');
const { createLegacyRoute } = require('./legacy');

module.exports = {
  createStreamRoute,
  createRevertRoute,
  createDiffRoute,
  createFilesRoute,
  createLegacyRoute,
  cleanupTempImages
};

