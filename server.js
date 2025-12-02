#!/usr/bin/env node
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

// Modular imports
const { PROMPT_TEMPLATES, ADD_PROMPT_TEMPLATES } = require('./src/server/prompts');
const { cleanFilePath, findCursorAgent, injectVariables } = require('./src/server/utils');
const { runCursorAgentStream } = require('./src/server/runner');
const { revertStore } = require('./src/server/store');
const { 
  createStreamRoute, 
  createRevertRoute, 
  createDiffRoute, 
  createFilesRoute, 
  createLegacyRoute,
  cleanupTempImages 
} = require('./src/server/routes');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const PORT = 3333;
const DEBUG = process.env.DEBUG === 'true' || process.env.CURSOR_BRIDGE_DEBUG === 'true';
const log = (...args) => DEBUG && console.log(...args);

// Shared dependencies for routes
const deps = {
  PROMPT_TEMPLATES,
  ADD_PROMPT_TEMPLATES,
  cleanFilePath,
  findCursorAgent,
  injectVariables,
  runCursorAgentStream,
  revertStore,
  log,
  DEBUG
};

// Mount routes
app.use(createStreamRoute(deps));
app.use(createRevertRoute(deps));
app.use(createDiffRoute(deps));
app.use(createFilesRoute());
app.use(createLegacyRoute(deps));

// Start server
app.listen(PORT, () => {
  cleanupTempImages();
  
  console.log('─'.repeat(50));
  console.log('CURSOR BRIDGE v2.0');
  console.log('─'.repeat(50));
  console.log(`Server:  http://localhost:${PORT}`);
  console.log(`Project: ${process.cwd()}`);
  if (DEBUG) console.log('Debug:   ENABLED (verbose logging)');
  console.log('─'.repeat(50));
  console.log('Ready. Tip: DEBUG=true npx cursor-bridge');
  console.log('─'.repeat(50) + '\n');
});
