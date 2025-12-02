const express = require('express');
const path = require('path');
const fs = require('fs');

const createStreamRoute = (deps) => {
  const { 
    PROMPT_TEMPLATES, 
    ADD_PROMPT_TEMPLATES, 
    cleanFilePath, 
    injectVariables, 
    runCursorAgentStream, 
    revertStore, 
    log, 
    DEBUG 
  } = deps;
  
  const router = express.Router();

  router.post('/cursor-command-stream', async (req, res) => {
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
      targets = [],
      model = 'auto',
      memoryMode = false,
      chatId = null,
      revisionSessionId = null,
      promptTemplate = 'designer',
      customPrompt = null,
      mode = 'edit',
      addPosition = 'after',
      fileReferences = []
    } = req.body;

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

    const cleanedPath = cleanFilePath(filePath);
    const projectRoot = process.cwd();
    const fullFilePath = path.join(projectRoot, cleanedPath);
    const sessionId = `session-${Date.now()}`;

    console.log(`[mode] ${mode}${mode === 'add' ? ` (position: ${addPosition})` : ''}`);
    console.log(`[target] ${cleanedPath} <${elementTag}>`);
    console.log(`[task] ${instruction}`);
    
    log(`[element] classes: "${elementClasses?.substring(0, 100)}${elementClasses?.length > 100 ? '...' : ''}"`);
    log(`[context] ${parentContext || 'none'}`);
    log(`[model] ${model}`);

    if (!fs.existsSync(fullFilePath)) {
      sendEvent('error', { message: `File not found: ${cleanedPath}` });
      res.end();
      return;
    }

    const filesToTrack = new Map();
    filesToTrack.set(cleanedPath, {
      path: fullFilePath,
      original: fs.readFileSync(fullFilePath, 'utf-8'),
      relativePath: cleanedPath
    });
    
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

    sendEvent('init', { 
      sessionId,
      file: cleanedPath,
      component,
      lineNumber,
      model,
      targetCount: targets?.length || 1
    });

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
    
    if (targets && targets.length > 1) {
      const elementsContext = targets.map((t, i) => {
        return `${i + 1}. File: ${t.fileName}, Element: <${t.elementTag}>, Component: ${t.componentName || 'unknown'}, Classes: "${(t.elementClasses || '').substring(0, 100)}"`;
      }).join('\n');
      
      prompt += `\n\n---\nMULTIPLE ELEMENTS SELECTED (${targets.length} total):\n${elementsContext}\n\nApply the requested changes consistently across ALL these elements.`;
      
      console.log(`[multi-select] ${targets.length} elements selected`);
    }
    
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

    if (DEBUG) {
      console.log('[prompt]');
      console.log('─'.repeat(40));
      console.log(prompt);
      console.log('─'.repeat(40));
    }

    let thinkingBuffer = '';
    let agentSessionId = null;
    
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
      (event) => {
        if (event.type === 'system' && event.subtype === 'init') {
          agentSessionId = event.session_id;
          sendEvent('system', { model: event.model, agentSessionId: event.session_id });
        } 
        else if (event.type === 'assistant') {
          const text = event.message?.content?.[0]?.text || '';
          if (text) {
            thinkingBuffer += text;
          }
        }
        else if (event.type === 'tool_call') {
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
          agentSessionId,
          canRevert,
          filesChanged: filesChangedList,
          errorMessage: !success ? (stderrOutput || 'Command failed') : null
        });
        res.end();
      },
      (error) => {
        sendEvent('error', { message: error.message });
        res.end();
      },
      log
    );

    req.on('close', () => {
      log('[stream] Client disconnected');
    });
  });

  return router;
};

module.exports = { createStreamRoute };

