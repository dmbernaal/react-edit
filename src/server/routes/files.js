const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEMP_IMAGE_DIR = path.join(os.tmpdir(), 'cursor-bridge-images');
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', '.cursor-temp', '.vercel', 'coverage', '__pycache__']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']);

const cleanupTempImages = () => {
  if (!fs.existsSync(TEMP_IMAGE_DIR)) return;
  const MAX_AGE = 24 * 60 * 60 * 1000;
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
      } catch (e) {}
    });
    if (cleaned > 0) console.log(`[cleanup] Removed ${cleaned} old temp images`);
  } catch (e) {}
};

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
  } catch (e) {}
  
  return results;
};

const createFilesRoute = () => {
  const router = express.Router();

  router.get('/api/files', (req, res) => {
    const { search = '' } = req.query;
    const projectRoot = process.cwd();
    
    try {
      const allFiles = listFiles(projectRoot);
      const searchLower = search.toLowerCase();
      const filtered = search
        ? allFiles.filter(f => f.toLowerCase().includes(searchLower))
        : allFiles;
      
      filtered.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aExact = aLower.includes(searchLower);
        const bExact = bLower.includes(searchLower);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.length - b.length;
      });
      
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

  router.post('/api/upload-image', (req, res) => {
    const { filename, data } = req.body;
    
    if (!filename || !data) {
      return res.status(400).json({ error: 'Missing filename or data' });
    }
    
    try {
      if (!fs.existsSync(TEMP_IMAGE_DIR)) {
        fs.mkdirSync(TEMP_IMAGE_DIR, { recursive: true });
      }
      
      const ext = path.extname(filename) || '.png';
      const safeName = path.basename(filename, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
      const uniqueName = `${safeName}-${Date.now()}${ext}`;
      const filePath = path.join(TEMP_IMAGE_DIR, uniqueName);
      
      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(filePath, buffer);
      
      console.log(`[upload] ${filePath} (${buffer.length} bytes)`);
      res.json({ success: true, path: filePath, name: uniqueName, size: buffer.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/file-preview', (req, res) => {
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
        const data = fs.readFileSync(fullPath);
        const base64 = data.toString('base64');
        const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
        const mime = mimeTypes[ext] || 'application/octet-stream';
        res.json({ type: 'image', data: `data:${mime};base64,${base64}` });
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n').slice(0, 50);
        res.json({ type: 'code', preview: lines.join('\n'), totalLines: content.split('\n').length });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', cwd: process.cwd() });
  });

  return router;
};

module.exports = { createFilesRoute, cleanupTempImages };

