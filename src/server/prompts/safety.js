// Critical: This rule is appended to all prompts to prevent the tool from removing itself
const SAFETY_RULE = `

CRITICAL: NEVER remove or modify these components/imports - they enable this editing tool:
- CursorOverlay, ClientOverlay, or any *Overlay component
- Any import from 'cursor-agent-browser-cli'
If you see these in the code, leave them exactly as they are.`;

module.exports = { SAFETY_RULE };

