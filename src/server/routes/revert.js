const express = require('express');
const fs = require('fs');

const createRevertRoute = (deps) => {
  const { revertStore } = deps;
  const router = express.Router();

  router.post('/revert', async (req, res) => {
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
          const currentContent = fs.readFileSync(file.path, 'utf-8');
          fs.writeFileSync(file.path, file.original, 'utf-8');
          reverted.push({
            path: file.relativePath,
            originalLines: file.original.split('\n').length,
            currentLines: currentContent.split('\n').length
          });
          console.log(`[revert] Restored: ${file.relativePath}`);
        }
      }
      
      revertStore.delete(sessionId);
      res.json({ success: true, reverted });
    } catch (error) {
      console.log(`[revert] Error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};

module.exports = { createRevertRoute };

