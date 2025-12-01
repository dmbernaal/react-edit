#!/usr/bin/env node
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = 3333;
const DEBUG = process.env.DEBUG === 'true' || process.env.CURSOR_BRIDGE_DEBUG === 'true';
const log = (...args) => DEBUG && console.log(...args);

// Store for reverts (in-memory, keyed by session)
const revertStore = new Map();

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

const PROMPT_TEMPLATES = {
  designer: `You are an elite UI/UX designer. Edit the file "\${filePath}".

THE USER SELECTED THIS EXACT ELEMENT:
\`\`\`html
\${elementHTML}
\`\`\`

TO FIND THIS ELEMENT, search for these CSS classes in the file:
\`\`\`
\${elementClasses}
\`\`\`

React component context: \${parentContext}
Element tag: <\${elementTag}>
Text content (if any): "\${elementText}"

USER REQUEST: \${instruction}

INSTRUCTIONS:
1. Search the file for the distinctive CSS classes above - they uniquely identify this element
2. The className string in the JSX will match these classes
3. Make the requested changes to that specific element
4. Don't ask questions, just make the edit`,

  minimal: `Edit "\${filePath}" with minimal changes.

FIND THIS ELEMENT by its classes:
\`\`\`
\${elementClasses}
\`\`\`

Element HTML:
\`\`\`html
\${elementHTML}
\`\`\`

TASK: \${instruction}

Search for the className in the code and make ONLY the requested change.`,

  engineer: `Edit "\${filePath}".

TARGET ELEMENT (search by className):
\`\`\`html
\${elementHTML}
\`\`\`

CSS Classes to search for: \${elementClasses}
Component context: \${parentContext}

TASK: \${instruction}

Find the element by its distinctive className and make clean, idiomatic changes.`,

  accessibility: `Edit "\${filePath}" for accessibility.

TARGET ELEMENT:
\`\`\`html
\${elementHTML}
\`\`\`

Classes: \${elementClasses}

TASK: \${instruction}

Find by className, then ensure: keyboard nav, screen readers, color contrast, focus states.`
};

// ============================================================================
// UTILITIES
// ============================================================================

const cleanFilePath = (rawPath) => {
  if (!rawPath) return null;
  let cleaned = rawPath.split('?')[0];
  const prefixes = [
    'about://React/Server/',
    'webpack-internal://',
    '///rsc/./',
    '//rsc/./',
    '/rsc/./',
    'rsc/./',
    '///app-pages-browser/./',  // Next.js App Router prefix
    '//app-pages-browser/./',
    '/app-pages-browser/./',
    'app-pages-browser/./',
  ];
  for (const prefix of prefixes) {
    if (cleaned.includes(prefix)) cleaned = cleaned.split(prefix).pop();
  }
  return cleaned.replace(/^\/+/, '');
};

const findCursorAgent = () => {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const possiblePaths = [
    'cursor-agent',
    path.join(homeDir, '.local/bin/cursor-agent'),
    path.join(homeDir, '.cursor/bin/cursor-agent'),
    '/usr/local/bin/cursor-agent',
  ];
  
  for (const p of possiblePaths) {
    try {
      if (p === 'cursor-agent') {
        const result = require('child_process').spawnSync('which', [p]);
        if (result.status === 0) return p;
      } else if (fs.existsSync(p)) {
        return p;
      }
    } catch (e) {}
  }
  return null;
};

const injectVariables = (template, vars) => {
  return template
    .replace(/\$\{filePath\}/g, vars.filePath || '')
    .replace(/\$\{component\}/g, vars.component || '')
    .replace(/\$\{lineNumber\}/g, vars.lineNumber || '~')
    .replace(/\$\{instruction\}/g, vars.instruction || '')
    .replace(/\$\{elementText\}/g, vars.elementText || '')
    .replace(/\$\{elementTag\}/g, vars.elementTag || 'element')
    .replace(/\$\{elementClasses\}/g, vars.elementClasses || '')
    .replace(/\$\{elementHTML\}/g, vars.elementHTML || '')
    .replace(/\$\{parentContext\}/g, vars.parentContext || '');
};

// ============================================================================
// STREAMING CURSOR AGENT RUNNER
// ============================================================================

const runCursorAgentStream = (prompt, cwd, options, onEvent, onComplete, onError) => {
  const cursorAgentPath = findCursorAgent();
  
  if (!cursorAgentPath) {
    onError(new Error('cursor-agent not found. Install: curl https://cursor.com/install -fsS | bash'));
    return;
  }

  // Write prompt to temp file
  const tempFile = path.join(require('os').tmpdir(), `cursor-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, prompt);

  // Build args array
  const args = ['-p', '-f', '--output-format', 'stream-json', '--stream-partial-output'];
  if (options.model && options.model !== 'auto') {
    args.push('--model', options.model);
  }
  if (options.chatId) {
    args.push('--resume', options.chatId);
  }

  log(`[stream] Starting: cursor-agent ${args.join(' ')}`);

  // Use spawn for streaming
  const child = spawn('sh', ['-c', `cat "${tempFile}" | "${cursorAgentPath}" ${args.join(' ')}`], {
    cwd: cwd,
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
  });

  let buffer = '';
  const fileWrites = []; // Track file writes for revert
  const fileWriteDetails = {}; // Track detailed info about each write (path -> {lines, size})

  child.stdout.on('data', (data) => {
    buffer += data.toString();
    
    // Process complete lines (NDJSON)
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const event = JSON.parse(line);
        
        // Track file writes/edits for revert capability
        if (event.type === 'tool_call' && event.subtype === 'started') {
          log('[debug] tool_call started:', JSON.stringify(event.tool_call).substring(0, 200));
          
          // Check for writeToolCall OR editToolCall (cursor-agent uses both)
          const toolCall = event.tool_call?.writeToolCall || event.tool_call?.editToolCall;
          if (toolCall?.args?.path) {
            const writePath = toolCall.args.path;
            const fullPath = path.isAbsolute(writePath) ? writePath : path.join(cwd, writePath);
            
            // Only track if not already tracked
            if (!fileWrites.some(fw => fw.relativePath === writePath)) {
              log('[debug] Tracking write to:', writePath);
              
              // Store original content before write
              if (fs.existsSync(fullPath)) {
                const originalContent = fs.readFileSync(fullPath, 'utf-8');
                fileWrites.push({ path: fullPath, original: originalContent, relativePath: writePath });
                log('[debug] Stored original content for:', writePath);
              } else {
                // New file being created
                fileWrites.push({ path: fullPath, original: null, relativePath: writePath, isNew: true });
                log('[debug] New file will be created:', writePath);
              }
            }
          }
        }
        
        // Track file write/edit completion details
        if (event.type === 'tool_call' && event.subtype === 'completed') {
          log('[debug] tool_call completed:', JSON.stringify(event.tool_call).substring(0, 200));
          
          // Check for writeToolCall OR editToolCall
          const writeResult = event.tool_call?.writeToolCall?.result?.success;
          const editResult = event.tool_call?.editToolCall?.result?.success;
          const result = writeResult || editResult;
          const toolCall = event.tool_call?.writeToolCall || event.tool_call?.editToolCall;
          
          if (result && toolCall?.args?.path) {
            const writePath = toolCall.args.path;
            fileWriteDetails[writePath] = {
              lines: result.linesAdded || result.linesCreated || 0,
              size: result.fileSize || 0
            };
            log('[debug] Write completed:', writePath, fileWriteDetails[writePath]);
          }
        }
        
        onEvent(event);
      } catch (e) {
        // Not valid JSON, might be partial
      }
    }
  });

  let stderrBuffer = '';
  
  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      console.log(`[stderr] ${text}`);  // Always show errors
      stderrBuffer += text + '\n';
    }
  });

  child.on('close', (code) => {
    // Clean up temp file
    try { fs.unlinkSync(tempFile); } catch (e) {}
    
    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        onEvent(event);
      } catch (e) {}
    }
    
    console.log(code === 0 ? '[done] ✓' : `[done] exit ${code}`);
    onComplete(code === 0, fileWrites, fileWriteDetails, stderrBuffer.trim());
  });

  child.on('error', (err) => {
    try { fs.unlinkSync(tempFile); } catch (e) {}
    onError(err);
  });

  return child;
};

// ============================================================================
// STREAMING API ENDPOINT (SSE)
// ============================================================================

app.post('/cursor-command-stream', async (req, res) => {
  const { 
    filePath, 
    instruction, 
    component, 
    lineNumber,
    elementText = '',
    elementTag = 'element',
    elementClasses = '',
    elementHTML = '',
    parentContext = '',
    model = 'auto',
    memoryMode = false,
    chatId = null,
    revisionSessionId = null, // For --resume on revision requests
    promptTemplate = 'designer',
    customPrompt = null
  } = req.body;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  console.log('\n' + '─'.repeat(60));
  console.log('STREAMING REQUEST');
  console.log('─'.repeat(60));

  // Validate
  if (!filePath || filePath === 'undefined') {
    sendEvent('error', { message: 'Missing file path' });
    res.end();
    return;
  }
  if (!instruction?.trim()) {
    sendEvent('error', { message: 'Missing instruction' });
    res.end();
    return;
  }

  // Clean path and setup
  const cleanedPath = cleanFilePath(filePath);
  const projectRoot = process.cwd();
  const fullFilePath = path.join(projectRoot, cleanedPath);
  const sessionId = `session-${Date.now()}`;

  // Essential logging (always shown)
  console.log(`[target] ${cleanedPath} <${elementTag}>`);
  console.log(`[task] ${instruction}`);
  
  // Verbose logging (DEBUG mode only)
  log(`[element] classes: "${elementClasses?.substring(0, 100)}${elementClasses?.length > 100 ? '...' : ''}"`);
  log(`[context] ${parentContext || 'none'}`);
  log(`[model] ${model}`);

  // Check file exists and store original for revert
  if (!fs.existsSync(fullFilePath)) {
    sendEvent('error', { message: `File not found: ${cleanedPath}` });
    res.end();
    return;
  }

  // Store original file content for potential revert
  const originalContent = fs.readFileSync(fullFilePath, 'utf-8');
  revertStore.set(sessionId, {
    files: [{ path: fullFilePath, original: originalContent, relativePath: cleanedPath }],
    timestamp: Date.now()
  });

  // Send initial event
  sendEvent('init', { 
    sessionId,
    file: cleanedPath,
    component,
    lineNumber,
    model
  });

  // Build prompt
  let template = customPrompt || PROMPT_TEMPLATES[promptTemplate] || PROMPT_TEMPLATES.designer;
  const prompt = injectVariables(template, {
    filePath: cleanedPath,
    component,
    lineNumber: lineNumber || '~',
    instruction,
    elementText: elementText || '',
    elementTag: elementTag || 'element',
    elementClasses: elementClasses || '',
    elementHTML: elementHTML || '',
    parentContext: parentContext || ''
  });

  // Full prompt (DEBUG mode only)
  if (DEBUG) {
    console.log('[prompt]');
    console.log('─'.repeat(40));
    console.log(prompt);
    console.log('─'.repeat(40));
  }

  // Accumulate thinking text to avoid fragmented display
  let thinkingBuffer = '';
  let agentSessionId = null; // cursor-agent's session_id for --resume
  
  const flushThinking = () => {
    if (thinkingBuffer.trim()) {
      sendEvent('thinking', { text: thinkingBuffer.trim() });
      thinkingBuffer = '';
    }
  };

  // Run cursor-agent with streaming
  // Use revisionSessionId for --resume if provided (revision mode), otherwise use chatId if memoryMode is on
  const resumeId = revisionSessionId || (memoryMode ? chatId : null);
  log('[debug] resumeId:', resumeId, 'revisionSessionId:', revisionSessionId, 'memoryMode:', memoryMode);
  
  runCursorAgentStream(
    prompt,
    projectRoot,
    { model, chatId: resumeId },
    // On each event
    (event) => {
      // Transform events for frontend
      if (event.type === 'system' && event.subtype === 'init') {
        agentSessionId = event.session_id; // Store for --resume
        sendEvent('system', { model: event.model, agentSessionId: event.session_id });
      } 
      else if (event.type === 'assistant') {
        // Accumulate thinking text instead of sending fragments
        const text = event.message?.content?.[0]?.text || '';
        if (text) {
          thinkingBuffer += text;
        }
      }
      else if (event.type === 'tool_call') {
        // Flush accumulated thinking before tool call
        flushThinking();
        if (event.subtype === 'started') {
          const tc = event.tool_call;
          if (tc.readToolCall) {
            sendEvent('tool', { 
              action: 'read', 
              status: 'started',
              path: tc.readToolCall.args.path 
            });
          } else if (tc.writeToolCall || tc.editToolCall) {
            const toolCall = tc.writeToolCall || tc.editToolCall;
            sendEvent('tool', { 
              action: 'write', 
              status: 'started',
              path: toolCall.args.path 
            });
          } else if (tc.function) {
            sendEvent('tool', { 
              action: tc.function.name || 'unknown', 
              status: 'started'
            });
          }
        } else if (event.subtype === 'completed') {
          const tc = event.tool_call;
          if (tc.readToolCall?.result?.success) {
            sendEvent('tool', { 
              action: 'read', 
              status: 'completed',
              path: tc.readToolCall.args.path,
              lines: tc.readToolCall.result.success.totalLines
            });
          } else if (tc.writeToolCall?.result?.success || tc.editToolCall?.result?.success) {
            const toolCall = tc.writeToolCall || tc.editToolCall;
            const result = toolCall.result.success;
            sendEvent('tool', { 
              action: 'write', 
              status: 'completed',
              path: toolCall.args.path,
              lines: result.linesAdded || result.linesCreated || 0,
              size: result.fileSize || 0
            });
          }
        }
      }
      else if (event.type === 'result') {
        // Flush any remaining thinking before result
        flushThinking();
        sendEvent('result', { 
          success: !event.is_error,
          duration: event.duration_ms,
          text: event.result
        });
      }
    },
    // On complete
    (success, fileWrites, fileWriteDetails, stderrOutput) => {
      log('[debug] Complete - fileWrites:', fileWrites.length, 'success:', success);
      
      // Update revert store with any additional file writes
      const stored = revertStore.get(sessionId);
      if (stored && fileWrites.length > 0) {
        stored.files = [...stored.files, ...fileWrites.filter(fw => 
          !stored.files.some(sf => sf.path === fw.path)
        )];
      }
      
      // Check for errors in stderr
      if (stderrOutput && stderrOutput.includes('Cannot use this model')) {
        sendEvent('error', { message: stderrOutput });
      }
      
      // Build detailed files changed array
      const filesChangedList = fileWrites.map(fw => ({
        path: fw.relativePath,
        isNew: fw.isNew || false,
        lines: fileWriteDetails[fw.relativePath]?.lines || 0,
        size: fileWriteDetails[fw.relativePath]?.size || 0
      }));
      
      log('[debug] filesChangedList:', filesChangedList.length, 'files');
      
      // Determine if changes were actually made
      const hasChanges = fileWrites.length > 0;
      const canRevert = hasChanges && success;
      log('[debug] hasChanges:', hasChanges, 'canRevert:', canRevert);
      
      sendEvent('complete', { 
        success: success && !stderrOutput?.includes('Cannot use this model'),
        sessionId,
        agentSessionId, // cursor-agent's session for --resume revisions
        canRevert,
        filesChanged: filesChangedList, // Now an array with details
        errorMessage: !success ? (stderrOutput || 'Command failed') : null
      });
      res.end();
    },
    // On error
    (error) => {
      sendEvent('error', { message: error.message });
      res.end();
    }
  );

  // Handle client disconnect
  req.on('close', () => {
    log('[stream] Client disconnected');
  });
});

// ============================================================================
// REVERT ENDPOINT
// ============================================================================

app.post('/revert', async (req, res) => {
  const { sessionId } = req.body;
  
  console.log(`[revert] Request for session: ${sessionId}`);
  
  const stored = revertStore.get(sessionId);
  if (!stored) {
    return res.status(404).json({ success: false, error: 'Session not found or expired' });
  }
  
  try {
    const reverted = [];
    for (const file of stored.files) {
      if (fs.existsSync(file.path)) {
        // Read current content for diff
        const currentContent = fs.readFileSync(file.path, 'utf-8');
        
        // Write back original
        fs.writeFileSync(file.path, file.original, 'utf-8');
        reverted.push({
          path: file.relativePath,
          originalLines: file.original.split('\n').length,
          currentLines: currentContent.split('\n').length
        });
        
        console.log(`[revert] Restored: ${file.relativePath}`);
      }
    }
    
    // Remove from store after revert
    revertStore.delete(sessionId);
    
    res.json({ success: true, reverted });
  } catch (error) {
    console.log(`[revert] Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// LEGACY NON-STREAMING ENDPOINT
// ============================================================================

app.post('/cursor-command', async (req, res) => {
  const { 
    filePath, 
    instruction, 
    component, 
    lineNumber,
    model = 'auto',
    memoryMode = false,
    chatId = null,
    promptTemplate = 'designer',
    customPrompt = null
  } = req.body;
  
  console.log('\n' + '─'.repeat(60));
  console.log('NEW REQUEST (non-streaming)');
  console.log('─'.repeat(60));
  
  // Validate
  if (!filePath || filePath === 'undefined') {
    return res.status(400).json({ error: "Missing file path" });
  }
  if (!instruction?.trim()) {
    return res.status(400).json({ error: "Missing instruction" });
  }

  // Clean path
  const cleanedPath = cleanFilePath(filePath);
  const projectRoot = process.cwd();
  const fullFilePath = path.join(projectRoot, cleanedPath);
  
  console.log(`[target] ${cleanedPath}:${lineNumber || '~'} <${component}>`);
  console.log(`[model] ${model}`);
  console.log(`[task] ${instruction}`);

  // Check file exists
  if (!fs.existsSync(fullFilePath)) {
    return res.status(404).json({ error: `File not found: ${cleanedPath}` });
  }

  // Build prompt
  let template = customPrompt || PROMPT_TEMPLATES[promptTemplate] || PROMPT_TEMPLATES.designer;
  const prompt = injectVariables(template, {
    filePath: cleanedPath,
    component,
    lineNumber: lineNumber || '~',
    instruction
  });

  try {
    // Build command
    let flags = '-p -f';
    if (model && model !== 'auto') {
      flags += ` --model ${model}`;
    }
    if (memoryMode && chatId) {
      flags += ` --resume ${chatId}`;
    }
    
    const tempFile = path.join(require('os').tmpdir(), `cursor-prompt-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, prompt);
    
    const cursorAgentPath = findCursorAgent();
    if (!cursorAgentPath) {
      return res.status(500).json({ error: 'cursor-agent not found' });
    }
    
    const command = `cat "${tempFile}" | "${cursorAgentPath}" ${flags}`;
    
    exec(command, {
      cwd: projectRoot,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
      timeout: 90000,
      maxBuffer: 1024 * 1024 * 10
    }, (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch (e) {}
      
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      
      res.json({ success: true, output: stdout });
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', cwd: process.cwd() });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
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
