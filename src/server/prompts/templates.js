const { SAFETY_RULE } = require('./safety');

const PROMPT_TEMPLATES = {
  designer: `You are an elite UI/UX designer. Edit the file "\${filePath}".

THE USER SELECTED THIS EXACT ELEMENT:
\`\`\`html
\${elementHTML}
\`\`\`

TO FIND THIS ELEMENT, search for these CSS classes in the file:
\`\`\`
\${elementClasses}
\`\`\`

React component context: \${parentContext}
Element tag: <\${elementTag}>
Text content (if any): "\${elementText}"

USER REQUEST: \${instruction}

INSTRUCTIONS:
1. Search the file for the distinctive CSS classes above - they uniquely identify this element
2. The className string in the JSX will match these classes
3. Make the requested changes to that specific element
4. Don't ask questions, just make the edit` + SAFETY_RULE,

  minimal: `Edit "\${filePath}" with minimal changes.

FIND THIS ELEMENT by its classes:
\`\`\`
\${elementClasses}
\`\`\`

Element HTML:
\`\`\`html
\${elementHTML}
\`\`\`

TASK: \${instruction}

Search for the className in the code and make ONLY the requested change.` + SAFETY_RULE,

  engineer: `Edit "\${filePath}".

TARGET ELEMENT (search by className):
\`\`\`html
\${elementHTML}
\`\`\`

CSS Classes to search for: \${elementClasses}
Component context: \${parentContext}

TASK: \${instruction}

Find the element by its distinctive className and make clean, idiomatic changes.` + SAFETY_RULE,

  accessibility: `Edit "\${filePath}" for accessibility.

TARGET ELEMENT:
\`\`\`html
\${elementHTML}
\`\`\`

Classes: \${elementClasses}

TASK: \${instruction}

Find by className, then ensure: keyboard nav, screen readers, color contrast, focus states.` + SAFETY_RULE
};

module.exports = { PROMPT_TEMPLATES };

