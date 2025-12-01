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

// Clean up webpack/RSC file paths
const cleanFilePath = (rawPath) => {
  if (!rawPath) return null;
  
  let cleaned = rawPath;
  cleaned = cleaned.split('?')[0];
  
  const prefixes = [
    'about://React/Server/',
    'webpack-internal://',
    '///rsc/./',
    '//rsc/./',
    '/rsc/./',
    'rsc/./',
  ];
  
  for (const prefix of prefixes) {
    if (cleaned.includes(prefix)) {
      cleaned = cleaned.split(prefix).pop();
    }
  }
  
  cleaned = cleaned.replace(/^\/+/, '');
  return cleaned;
};

// Find cursor-agent binary
const findCursorAgent = () => {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const possiblePaths = [
    'cursor-agent', // In PATH
    path.join(homeDir, '.local/bin/cursor-agent'), // Linux/macOS default install location
    path.join(homeDir, '.cursor/bin/cursor-agent'), // Alternative location
    '/usr/local/bin/cursor-agent',
  ];
  
  for (const p of possiblePaths) {
    try {
      if (p === 'cursor-agent') {
        // Check if it's in PATH by trying to access it
        const result = require('child_process').spawnSync('which', [p]);
        if (result.status === 0) return p;
      } else if (fs.existsSync(p)) {
        return p;
      }
    } catch (e) {
      // Continue to next path
    }
  }
  return null;
};

// Run cursor-agent CLI using shell pipe (cursor-agent needs real pipe, not Node stream)
const runCursorAgent = (prompt, cwd) => {
  return new Promise((resolve, reject) => {
    const cursorAgentPath = findCursorAgent();
    
    if (!cursorAgentPath) {
      reject(new Error('cursor-agent not found. Install with: curl https://cursor.com/install -fsS | bash'));
      return;
    }
    
    console.log(`🤖 Found cursor-agent at: ${cursorAgentPath}`);
    
    // Write prompt to temp file to avoid shell escaping issues
    const tempFile = path.join(require('os').tmpdir(), `cursor-prompt-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, prompt);
    console.log(`📝 Wrote prompt to: ${tempFile}`);
    
    // Use shell pipe - cursor-agent needs actual pipe from shell, not Node.js stream
    const command = `cat "${tempFile}" | "${cursorAgentPath}" -p -f`;
    
    console.log(`🤖 Running: cat prompt.txt | cursor-agent -p -f`);
    console.log(`📁 Working directory: ${cwd}`);
    console.log(`💬 Prompt preview: ${prompt.substring(0, 80)}...`);
    console.log(`⏳ Waiting for cursor-agent...`);
    
    const startTime = Date.now();
    
    // Progress indicator
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stdout.write(`\r⏳ Running... ${elapsed}s`);
    }, 1000);

    exec(command, {
      cwd: cwd,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
      },
      timeout: 60000,  // 60 second timeout
      maxBuffer: 1024 * 1024 * 10  // 10MB buffer
    }, (error, stdout, stderr) => {
      clearInterval(progressInterval);
      
      // Clean up temp file
      try { fs.unlinkSync(tempFile); } catch (e) {}
      
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stdout.write('\r' + ' '.repeat(30) + '\r');
      
      console.log(`🏁 Finished in ${elapsed}s`);
      
      if (stderr && stderr.trim()) {
        console.log(`ℹ️  Stderr: ${stderr.trim()}`);
      }
      
      if (stdout && stdout.trim()) {
        console.log(`📤 Output: ${stdout.trim()}`);
      }
      
      if (error) {
        if (error.killed) {
          console.log(`⏰ Process was killed (timeout)`);
          reject(new Error('cursor-agent timed out'));
        } else {
          console.log(`❌ Error: ${error.message}`);
          reject(error);
        }
        return;
      }
      
      resolve({ success: true, output: stdout });
    });
  });
};

app.post('/cursor-command', async (req, res) => {
  const { filePath, instruction, component } = req.body;
  
  console.log('\n' + '='.repeat(60));
  console.log('🚀 NEW EDIT REQUEST');
  console.log('='.repeat(60));
  
  // 1. Validate
  if (!filePath || filePath === 'undefined') {
    console.error("❌ Error: Missing filePath");
    return res.status(400).json({ error: "Missing file path" });
  }

  if (!instruction || !instruction.trim()) {
    console.error("❌ Error: Missing instruction");
    return res.status(400).json({ error: "Missing instruction" });
  }

  // 2. Clean the file path
  const cleanedPath = cleanFilePath(filePath);
  const projectRoot = process.cwd();
  const fullFilePath = path.join(projectRoot, cleanedPath);
  
  console.log(`📍 Component:    <${component} />`);
  console.log(`📂 File:         ${cleanedPath}`);
  console.log(`📂 Full path:    ${fullFilePath}`);
  console.log(`💬 Instruction:  ${instruction}`);

  // 3. Check if file exists
  if (!fs.existsSync(fullFilePath)) {
    console.error(`❌ File not found: ${fullFilePath}`);
    return res.status(404).json({ error: `File not found: ${cleanedPath}` });
  }

  // 4. Build the prompt for cursor-agent
  const prompt = `Edit the file "${cleanedPath}".

Context: The user is looking at their React app in the browser and clicked on a <${component}> element.

Task: ${instruction}

Instructions:
- Make the changes directly to the file
- Focus on the <${component}> element the user selected
- Don't ask questions, just make the edit`;

  console.log('-'.repeat(60));
  console.log('📋 Prompt:');
  console.log(prompt);
  console.log('-'.repeat(60));

  try {
    console.log('\n🤖 Running cursor-agent...\n');
    
    const result = await runCursorAgent(prompt, projectRoot);
    
    console.log('\n' + '-'.repeat(60));
    console.log('✅ SUCCESS! Changes applied.');
    console.log('👀 Check your browser - HMR should update automatically.');
    console.log('='.repeat(60) + '\n');
    
    res.json({ 
      success: true, 
      message: "Changes applied by cursor-agent",
      output: result.output
    });

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.message.includes('not found')) {
      console.log('\n💡 To install Cursor CLI:');
      console.log('   curl https://cursor.com/install -fsS | bash\n');
    }
    
    console.log('='.repeat(60) + '\n');
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      installHint: error.message.includes('not found') 
        ? 'Install Cursor CLI: curl https://cursor.com/install -fsS | bash'
        : null
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', cwd: process.cwd() });
});

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🔌 CURSOR BRIDGE - Browser → AI → Code');
  console.log('='.repeat(60));
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`📁 Project: ${process.cwd()}`);
  console.log('');
  console.log('🎯 Flow:');
  console.log('   1. Click element in browser');
  console.log('   2. Type instruction');
  console.log('   3. Press Enter');
  console.log('   4. cursor-agent edits the code');
  console.log('   5. HMR updates browser instantly!');
  console.log('');
  console.log('📦 Requires Cursor CLI:');
  console.log('   curl https://cursor.com/install -fsS | bash');
  console.log('='.repeat(60) + '\n');
});
