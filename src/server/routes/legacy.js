const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const createLegacyRoute = (deps) => {
  const { PROMPT_TEMPLATES, cleanFilePath, findCursorAgent, injectVariables } = deps;
  const router = express.Router();

  router.post('/cursor-command', async (req, res) => {
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
    
    if (!filePath || filePath === 'undefined') {
      return res.status(400).json({ error: "Missing file path" });
    }
    if (!instruction?.trim()) {
      return res.status(400).json({ error: "Missing instruction" });
    }

    const cleanedPath = cleanFilePath(filePath);
    const projectRoot = process.cwd();
    const fullFilePath = path.join(projectRoot, cleanedPath);
    
    console.log(`[target] ${cleanedPath}:${lineNumber || '~'} <${component}>`);
    console.log(`[model] ${model}`);
    console.log(`[task] ${instruction}`);

    if (!fs.existsSync(fullFilePath)) {
      return res.status(404).json({ error: `File not found: ${cleanedPath}` });
    }

    let template = customPrompt || PROMPT_TEMPLATES[promptTemplate] || PROMPT_TEMPLATES.designer;
    const prompt = injectVariables(template, {
      filePath: cleanedPath,
      component,
      lineNumber: lineNumber || '~',
      instruction
    });

    try {
      let flags = '-p -f';
      if (model && model !== 'auto') {
        flags += ` --model ${model}`;
      }
      if (memoryMode && chatId) {
        flags += ` --resume ${chatId}`;
      }
      
      const tempFile = path.join(os.tmpdir(), `cursor-prompt-${Date.now()}.txt`);
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

  return router;
};

module.exports = { createLegacyRoute };

