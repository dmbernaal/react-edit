#!/usr/bin/env node
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const Diff = require('diff');

// Modular imports
const { PROMPT_TEMPLATES, ADD_PROMPT_TEMPLATES } = require('./src/server/prompts');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const PORT = 3333;
const DEBUG = process.env.DEBUG === 'true' || process.env.CURSOR_BRIDGE_DEBUG === 'true';
const log = (...args) => DEBUG && console.log(...args);

// Store for reverts (in-memory, keyed by session)
const revertStore = new Map();

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
        
        if (event.type === 'tool_call' && event.subtype === 'started') {
          const toolCall = event.tool_call?.writeToolCall || event.tool_call?.editToolCall;
          if (toolCall?.args?.path) {
            const writePath = toolCall.args.path;
            const fullPath = path.isAbsolute(writePath) ? writePath : path.join(cwd, writePath);
            
            if (!fileWrites.some(fw => fw.relativePath === writePath)) {
              if (fs.existsSync(fullPath)) {
                fileWrites.push({ path: fullPath, original: fs.readFileSync(fullPath, 'utf-8'), relativePath: writePath });
              } else {
                fileWrites.push({ path: fullPath, original: null, relativePath: writePath, isNew: true });
              }
            }
          }
        }
        
        if (event.type === 'tool_call' && event.subtype === 'completed') {
          const result = event.tool_call?.writeToolCall?.result?.success || event.tool_call?.editToolCall?.result?.success;
          const toolCall = event.tool_call?.writeToolCall || event.tool_call?.editToolCall;
          
          if (result && toolCall?.args?.path) {
            fileWriteDetails[toolCall.args.path] = {
              lines: result.linesAdded || result.linesCreated || 0,
              size: result.fileSize || 0
            };
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
    targets = [], // Multi-select support
    model = 'auto',
    memoryMode = false,
    chatId = null,
    revisionSessionId = null, // For --resume on revision requests
    promptTemplate = 'designer',
    customPrompt = null,
    mode = 'edit', // 'edit' or 'add'
    addPosition = 'after', // 'before', 'after', 'inside-start', 'inside-end'
    fileReferences = [] // Referenced files and images
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
  console.log(`[mode] ${mode}${mode === 'add' ? ` (position: ${addPosition})` : ''}`);
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
  // Also store any additional files from multi-select
  const filesToTrack = new Map();
  filesToTrack.set(cleanedPath, {
    path: fullFilePath,
    original: fs.readFileSync(fullFilePath, 'utf-8'),
    relativePath: cleanedPath
  });
  
  // Add files from multi-select targets
  if (targets && targets.length > 1) {
    for (const t of targets) {
      const tCleanedPath = cleanFilePath(t.fileName);
      if (tCleanedPath && !filesToTrack.has(tCleanedPath)) {
        const tFullPath = path.join(projectRoot, tCleanedPath);
        if (fs.existsSync(tFullPath)) {
          filesToTrack.set(tCleanedPath, {
            path: tFullPath,
            original: fs.readFileSync(tFullPath, 'utf-8'),
            relativePath: tCleanedPath
          });
        }
      }
    }
  }
  
  revertStore.set(sessionId, {
    files: Array.from(filesToTrack.values()),
    timestamp: Date.now()
  });

  // Send initial event
  sendEvent('init', { 
    sessionId,
    file: cleanedPath,
    component,
    lineNumber,
    model,
    targetCount: targets?.length || 1
  });

  // Build prompt - use ADD templates if in add mode
  let template;
  if (mode === 'add' && ADD_PROMPT_TEMPLATES[addPosition]) {
    template = ADD_PROMPT_TEMPLATES[addPosition];
    console.log(`[prompt] Using ADD template: ${addPosition}`);
  } else {
    template = customPrompt || PROMPT_TEMPLATES[promptTemplate] || PROMPT_TEMPLATES.designer;
  }
  
  let prompt = injectVariables(template, {
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
  
  // Add multi-element context if more than one target
  if (targets && targets.length > 1) {
    const elementsContext = targets.map((t, i) => {
      return `${i + 1}. File: ${t.fileName}, Element: <${t.elementTag}>, Component: ${t.componentName || 'unknown'}, Classes: "${(t.elementClasses || '').substring(0, 100)}"`;
    }).join('\n');
    
    prompt += `\n\n---\nMULTIPLE ELEMENTS SELECTED (${targets.length} total):\n${elementsContext}\n\nApply the requested changes consistently across ALL these elements.`;
    
    console.log(`[multi-select] ${targets.length} elements selected`);
  }
  
  // Add file references (images and code files) to the prompt
  if (fileReferences && fileReferences.length > 0) {
    const images = fileReferences.filter(f => f.isImage);
    const codeFiles = fileReferences.filter(f => !f.isImage);
    
    let refSection = '\n\n---\nREFERENCED FILES:\n';
    
    if (images.length > 0) {
      refSection += `\nIMAGES (use these as design reference):\n`;
      images.forEach((img, i) => {
        refSection += `  ${i + 1}. ${img.path}\n`;
      });
      refSection += `\nIMPORTANT: Read and analyze these image files using the read_file tool. Use them as visual inspiration for the design.\n`;
    }
    
    if (codeFiles.length > 0) {
      refSection += `\nCODE FILES (read these for context):\n`;
      codeFiles.forEach((f, i) => {
        refSection += `  ${i + 1}. ${f.path}\n`;
      });
      refSection += `\nIMPORTANT: Read these files to understand the codebase structure, patterns, and styles to maintain consistency.\n`;
    }
    
    prompt += refSection;
    console.log(`[references] ${images.length} images, ${codeFiles.length} code files`);
  }

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

  const resumeId = revisionSessionId || (memoryMode ? chatId : null);
  
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
    (success, fileWrites, fileWriteDetails, stderrOutput) => {
      const stored = revertStore.get(sessionId);
      if (stored && fileWrites.length > 0) {
        stored.files = [...stored.files, ...fileWrites.filter(fw => 
          !stored.files.some(sf => sf.path === fw.path)
        )];
      }
      
      if (stderrOutput?.includes('Cannot use this model')) {
        sendEvent('error', { message: stderrOutput });
      }
      
      const filesChangedList = fileWrites.map(fw => ({
        path: fw.relativePath,
        isNew: fw.isNew || false,
        lines: fileWriteDetails[fw.relativePath]?.lines || 0,
        size: fileWriteDetails[fw.relativePath]?.size || 0
      }));
      
      const hasChanges = fileWrites.length > 0;
      const canRevert = hasChanges && success;
      
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
// DIFF ENDPOINT - Returns computed diff using the 'diff' library
// ============================================================================

app.post('/diff', async (req, res) => {
  const { sessionId } = req.body;
  
  const stored = revertStore.get(sessionId);
  if (!stored) {
    return res.status(404).json({ success: false, error: 'Session not found or expired' });
  }
  
  try {
    const diffs = [];
    for (const file of stored.files) {
      let currentContent = '';
      if (fs.existsSync(file.path)) {
        currentContent = fs.readFileSync(file.path, 'utf-8');
      }
      
      // Use diff library to compute line-by-line diff
      const changes = Diff.diffLines(file.original, currentContent);
      
      // Format changes for the client
      // Each change has: value (string), added (bool), removed (bool)
      const formattedChanges = changes.map(change => ({
        value: change.value,
        added: change.added || false,
        removed: change.removed || false,
      }));
      
      diffs.push({
        path: file.relativePath,
        changes: formattedChanges,
        stats: {
          additions: changes.filter(c => c.added).reduce((sum, c) => sum + c.value.split('\n').filter(l => l).length, 0),
          deletions: changes.filter(c => c.removed).reduce((sum, c) => sum + c.value.split('\n').filter(l => l).length, 0),
        }
      });
    }
    
    res.json({ success: true, diffs });
  } catch (error) {
    console.log(`[diff] Error: ${error.message}`);
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

// ============================================================================
// FILE REFERENCES & IMAGE UPLOAD
// ============================================================================

// Use system temp directory to avoid triggering Next.js file watcher
const TEMP_IMAGE_DIR = path.join(require('os').tmpdir(), 'cursor-bridge-images');
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', '.cursor-temp', '.vercel', 'coverage', '__pycache__']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']);

// Cleanup old temp images on startup (files older than 24h)
const cleanupTempImages = () => {
  if (!fs.existsSync(TEMP_IMAGE_DIR)) return;
  const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();
  let cleaned = 0;
  
  try {
    fs.readdirSync(TEMP_IMAGE_DIR).forEach(file => {
      const filePath = path.join(TEMP_IMAGE_DIR, file);
      try {
        const { mtimeMs } = fs.statSync(filePath);
        if (now - mtimeMs > MAX_AGE) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (e) { /* ignore individual file errors */ }
    });
    if (cleaned > 0) console.log(`[cleanup] Removed ${cleaned} old temp images`);
  } catch (e) { /* ignore if dir doesn't exist */ }
};

// Recursively list files (lightweight, uses native fs)
const listFiles = (dir, baseDir = dir, results = [], depth = 0, maxDepth = 8) => {
  if (depth > maxDepth) return results;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        listFiles(fullPath, baseDir, results, depth + 1, maxDepth);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  } catch (e) { /* ignore permission errors */ }
  
  return results;
};

// GET /api/files - List project files for @ autocomplete
app.get('/api/files', (req, res) => {
  const { search = '' } = req.query;
  const projectRoot = process.cwd();
  
  try {
    const allFiles = listFiles(projectRoot);
    
    // Filter by search term (case-insensitive)
    const searchLower = search.toLowerCase();
    const filtered = search
      ? allFiles.filter(f => f.toLowerCase().includes(searchLower))
      : allFiles;
    
    // Sort: exact matches first, then by path length
    filtered.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aExact = aLower.includes(searchLower);
      const bExact = bLower.includes(searchLower);
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.length - b.length;
    });
    
    // Determine if file is an image
    const filesWithMeta = filtered.slice(0, 30).map(f => ({
      path: f,
      isImage: IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()),
      name: path.basename(f)
    }));
    
    res.json({ files: filesWithMeta });
  } catch (error) {
    res.status(500).json({ error: error.message, files: [] });
  }
});

// POST /api/upload-image - Save dropped/uploaded image to temp directory
app.post('/api/upload-image', (req, res) => {
  const { filename, data } = req.body; // data is base64
  
  if (!filename || !data) {
    return res.status(400).json({ error: 'Missing filename or data' });
  }
  
  try {
    // Ensure temp directory exists
    if (!fs.existsSync(TEMP_IMAGE_DIR)) {
      fs.mkdirSync(TEMP_IMAGE_DIR, { recursive: true });
    }
    
    // Generate unique filename
    const ext = path.extname(filename) || '.png';
    const safeName = path.basename(filename, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    const uniqueName = `${safeName}-${Date.now()}${ext}`;
    const filePath = path.join(TEMP_IMAGE_DIR, uniqueName);
    
    // Decode base64 and save
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, buffer);
    
    console.log(`[upload] ${filePath} (${buffer.length} bytes)`);
    res.json({ success: true, path: filePath, name: uniqueName, size: buffer.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/file-preview - Read file content (for image preview or code preview)
app.get('/api/file-preview', (req, res) => {
  const { path: filePath } = req.query;
  
  if (!filePath) {
    return res.status(400).json({ error: 'Missing path' });
  }
  
  const fullPath = path.join(process.cwd(), filePath);
  
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  try {
    const ext = path.extname(filePath).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(ext);
    
    if (isImage) {
      // Return base64 for images
      const data = fs.readFileSync(fullPath);
      const base64 = data.toString('base64');
      const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
      const mime = mimeTypes[ext] || 'application/octet-stream';
      res.json({ type: 'image', data: `data:${mime};base64,${base64}` });
    } else {
      // Return first 50 lines for code files
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').slice(0, 50);
      res.json({ type: 'code', preview: lines.join('\n'), totalLines: content.split('\n').length });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
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
  // Cleanup old temp images on startup
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
