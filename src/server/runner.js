const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { findCursorAgent } = require('./utils');

const runCursorAgentStream = (prompt, cwd, options, onEvent, onComplete, onError, log = () => {}) => {
  const cursorAgentPath = findCursorAgent();
  
  if (!cursorAgentPath) {
    onError(new Error('cursor-agent not found. Install: curl https://cursor.com/install -fsS | bash'));
    return;
  }

  const tempFile = path.join(os.tmpdir(), `cursor-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, prompt);

  const args = ['-p', '-f', '--output-format', 'stream-json', '--stream-partial-output'];
  if (options.model && options.model !== 'auto') {
    args.push('--model', options.model);
  }
  if (options.chatId) {
    args.push('--resume', options.chatId);
  }

  log(`[stream] Starting: cursor-agent ${args.join(' ')}`);

  const child = spawn('sh', ['-c', `cat "${tempFile}" | "${cursorAgentPath}" ${args.join(' ')}`], {
    cwd: cwd,
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
  });

  let buffer = '';
  const fileWrites = [];
  const fileWriteDetails = {};

  child.stdout.on('data', (data) => {
    buffer += data.toString();
    
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
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
      console.log(`[stderr] ${text}`);
      stderrBuffer += text + '\n';
    }
  });

  child.on('close', (code) => {
    try { fs.unlinkSync(tempFile); } catch (e) {}
    
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

module.exports = { runCursorAgentStream };

