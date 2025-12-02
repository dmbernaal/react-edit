const { SAFETY_RULE } = require('./safety');

// ADD MODE TEMPLATES - For adding new elements
const ADD_PROMPT_TEMPLATES = {
  before: `You are an elite UI/UX designer. Edit the file "\${filePath}".

THE USER WANTS TO ADD A NEW ELEMENT BEFORE THIS EXISTING ELEMENT:
\`\`\`html
\${elementHTML}
\`\`\`

TO FIND THIS REFERENCE ELEMENT, search for these CSS classes in the file:
\`\`\`
\${elementClasses}
\`\`\`

React component context: \${parentContext}
Reference element tag: <\${elementTag}>

USER REQUEST - ADD NEW ELEMENT BEFORE THE ABOVE:
\${instruction}

INSTRUCTIONS:
1. Search the file for the distinctive CSS classes above to find the reference element
2. Add the NEW element IMMEDIATELY BEFORE (above) the reference element in the JSX
3. Create a new element that matches the existing code style
4. Use appropriate Tailwind CSS classes matching the existing design
5. Don't modify the existing element - only ADD new code before it
6. Don't ask questions, just add the new element` + SAFETY_RULE,

  after: `You are an elite UI/UX designer. Edit the file "\${filePath}".

THE USER WANTS TO ADD A NEW ELEMENT AFTER THIS EXISTING ELEMENT:
\`\`\`html
\${elementHTML}
\`\`\`

TO FIND THIS REFERENCE ELEMENT, search for these CSS classes in the file:
\`\`\`
\${elementClasses}
\`\`\`

React component context: \${parentContext}
Reference element tag: <\${elementTag}>

USER REQUEST - ADD NEW ELEMENT AFTER THE ABOVE:
\${instruction}

INSTRUCTIONS:
1. Search the file for the distinctive CSS classes above to find the reference element
2. Add the NEW element IMMEDIATELY AFTER (below) the reference element in the JSX
3. Create a new element that matches the existing code style
4. Use appropriate Tailwind CSS classes matching the existing design
5. Don't modify the existing element - only ADD new code after it
6. Don't ask questions, just add the new element` + SAFETY_RULE,

  'inside-start': `You are an elite UI/UX designer. Edit the file "\${filePath}".

THE USER WANTS TO ADD A NEW ELEMENT AS THE FIRST CHILD INSIDE THIS CONTAINER:
\`\`\`html
\${elementHTML}
\`\`\`

TO FIND THIS CONTAINER, search for these CSS classes in the file:
\`\`\`
\${elementClasses}
\`\`\`

React component context: \${parentContext}
Container element tag: <\${elementTag}>

USER REQUEST - ADD NEW ELEMENT AS FIRST CHILD:
\${instruction}

INSTRUCTIONS:
1. Search the file for the distinctive CSS classes above to find the container element
2. Add the NEW element as the FIRST CHILD inside this container
3. Create a new element that matches the existing code style
4. Use appropriate Tailwind CSS classes matching the existing design
5. Don't modify the existing content - only ADD new code at the beginning
6. Don't ask questions, just add the new element` + SAFETY_RULE,

  'inside-end': `You are an elite UI/UX designer. Edit the file "\${filePath}".

THE USER WANTS TO ADD A NEW ELEMENT AS THE LAST CHILD INSIDE THIS CONTAINER:
\`\`\`html
\${elementHTML}
\`\`\`

TO FIND THIS CONTAINER, search for these CSS classes in the file:
\`\`\`
\${elementClasses}
\`\`\`

React component context: \${parentContext}
Container element tag: <\${elementTag}>

USER REQUEST - ADD NEW ELEMENT AS LAST CHILD:
\${instruction}

INSTRUCTIONS:
1. Search the file for the distinctive CSS classes above to find the container element
2. Add the NEW element as the LAST CHILD inside this container
3. Create a new element that matches the existing code style
4. Use appropriate Tailwind CSS classes matching the existing design
5. Don't modify the existing content - only ADD new code at the end
6. Don't ask questions, just add the new element` + SAFETY_RULE
};

module.exports = { ADD_PROMPT_TEMPLATES };

