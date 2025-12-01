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

// Store for reverts (in-memory, keyed by session)
const revertStore = new Map();

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

const PROMPT_TEMPLATES = {
  designer: `You are an elite 0.1% UI/UX designer—the caliber that Apple, Stripe, Linear, and Vercel compete to hire.

Edit the file "\${filePath}".

The user clicked on a <\${elementTag}> element containing the text: "\${elementText}"
Component name from React stack: \${component}
Approximate line number: \${lineNumber} (may not be exact, search for the text content instead)

USER REQUEST: \${instruction}

Instructions:
- Find the element by searching for its text content "\${elementText}" in the file
- Make the requested changes directly to the file
- Focus on the specific element the user selected
- Don't ask questions, just make the edit
- Execute with surgical precision`,

  minimal: `Make the smallest possible change to achieve the goal. No extra modifications.

Edit the file "\${filePath}".

The user clicked on a <\${elementTag}> element containing: "\${elementText}"
Approximate line: \${lineNumber}

TASK: \${instruction}

Find the element by its text content and make only the requested change.`,

  engineer: `You are a senior software engineer. Write clean, maintainable, idiomatic code.

Edit the file "\${filePath}".

The user clicked on a <\${elementTag}> element containing: "\${elementText}"
Component: \${component}
Approximate line: \${lineNumber}

TASK: \${instruction}

Find the element by searching for "\${elementText}" in the file and make the change. Follow existing patterns.`,

  accessibility: `You are an accessibility specialist ensuring WCAG 2.1 AA compliance.

Edit the file "\${filePath}".

The user clicked on a <\${elementTag}> element containing: "\${elementText}"
Line: \${lineNumber}

TASK: \${instruction}

Find the element and ensure: keyboard navigation, screen readers, color contrast, focus states.`
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
    .replace(/\$\{elementTag\}/g, vars.elementTag || 'element');
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

  console.log(`[stream] Starting: cursor-agent ${args.join(' ')}`);

  // Use spawn for streaming
  const child = spawn('sh', ['-c', `cat "${tempFile}" | "${cursorAgentPath}" ${args.join(' ')}`], {
    cwd: cwd,
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
  });

  let buffer = '';
  const fileWrites = []; // Track file writes for revert

  child.stdout.on('data', (data) => {
    buffer += data.toString();
    
    // Process complete lines (NDJSON)
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const event = JSON.parse(line);
        
        // Track file writes for revert capability
        if (event.type === 'tool_call' && event.subtype === 'started') {
          if (event.tool_call?.writeToolCall?.args?.path) {
            const writePath = event.tool_call.writeToolCall.args.path;
            const fullPath = path.isAbsolute(writePath) ? writePath : path.join(cwd, writePath);
            
            // Store original content before write
            if (fs.existsSync(fullPath)) {
              const originalContent = fs.readFileSync(fullPath, 'utf-8');
              fileWrites.push({ path: fullPath, original: originalContent, relativePath: writePath });
            }
          }
        }
        
        onEvent(event);
      } catch (e) {
        // Not valid JSON, might be partial
      }
    }
  });

  child.stderr.on('data', (data) => {
    console.log(`[stream] stderr: ${data.toString().trim()}`);
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
    
    console.log(`[stream] Completed with code ${code}`);
    onComplete(code === 0, fileWrites);
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
    model = 'auto',
    memoryMode = false,
    chatId = null,
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

  console.log(`[target] ${cleanedPath}:${lineNumber || '~'} <${component}>`);
  console.log(`[element] <${elementTag}> "${elementText?.substring(0, 80)}${elementText?.length > 80 ? '...' : ''}"`);
  console.log(`[model] ${model}`);
  console.log(`[task] ${instruction}`);

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
    elementTag: elementTag || 'element'
  });

  console.log('[prompt preview]', prompt.substring(0, 300).replace(/\n/g, ' ') + '...');

  // Run cursor-agent with streaming
  runCursorAgentStream(
    prompt,
    projectRoot,
    { model, chatId: memoryMode ? chatId : null },
    // On each event
    (event) => {
      // Transform events for frontend
      if (event.type === 'system' && event.subtype === 'init') {
        sendEvent('system', { model: event.model, sessionId: event.session_id });
      } 
      else if (event.type === 'assistant') {
        const text = event.message?.content?.[0]?.text || '';
        if (text) {
          sendEvent('thinking', { text });
        }
      }
      else if (event.type === 'tool_call') {
        if (event.subtype === 'started') {
          const tc = event.tool_call;
          if (tc.readToolCall) {
            sendEvent('tool', { 
              action: 'read', 
              status: 'started',
              path: tc.readToolCall.args.path 
            });
          } else if (tc.writeToolCall) {
            sendEvent('tool', { 
              action: 'write', 
              status: 'started',
              path: tc.writeToolCall.args.path 
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
          } else if (tc.writeToolCall?.result?.success) {
            sendEvent('tool', { 
              action: 'write', 
              status: 'completed',
              path: tc.writeToolCall.args.path,
              lines: tc.writeToolCall.result.success.linesCreated,
              size: tc.writeToolCall.result.success.fileSize
            });
          }
        }
      }
      else if (event.type === 'result') {
        sendEvent('result', { 
          success: !event.is_error,
          duration: event.duration_ms,
          text: event.result
        });
      }
    },
    // On complete
    (success, fileWrites) => {
      // Update revert store with any additional file writes
      const stored = revertStore.get(sessionId);
      if (stored && fileWrites.length > 0) {
        stored.files = [...stored.files, ...fileWrites.filter(fw => 
          !stored.files.some(sf => sf.path === fw.path)
        )];
      }
      
      sendEvent('complete', { 
        success,
        sessionId,
        canRevert: true
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
    console.log('[stream] Client disconnected');
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
  console.log('─'.repeat(60));
  console.log('CURSOR BRIDGE v2.0 (Streaming)');
  console.log('─'.repeat(60));
  console.log(`Server:  http://localhost:${PORT}`);
  console.log(`Project: ${process.cwd()}`);
  console.log('Endpoints:');
  console.log('  POST /cursor-command-stream  (SSE streaming)');
  console.log('  POST /cursor-command         (legacy)');
  console.log('  POST /revert                 (undo changes)');
  console.log('─'.repeat(60));
  console.log('Ready. Waiting for requests...');
  console.log('─'.repeat(60) + '\n');
});
