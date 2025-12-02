const express = require('express');
const fs = require('fs');
const Diff = require('diff');

const createDiffRoute = (deps) => {
  const { revertStore } = deps;
  const router = express.Router();

  router.post('/diff', async (req, res) => {
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
        
        const changes = Diff.diffLines(file.original, currentContent);
        
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

  return router;
};

module.exports = { createDiffRoute };

