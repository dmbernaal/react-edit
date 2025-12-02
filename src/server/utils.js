const path = require('path');
const fs = require('fs');

const cleanFilePath = (rawPath) => {
  if (!rawPath) return null;
  let cleaned = rawPath.split('?')[0];
  const prefixes = [
    'about://React/Server/',
    'webpack-internal://',
    '///rsc/./',
    '//rsc/./',
    '/rsc/./',
    'rsc/./',
    '///app-pages-browser/./',
    '//app-pages-browser/./',
    '/app-pages-browser/./',
    'app-pages-browser/./',
  ];
  for (const prefix of prefixes) {
    if (cleaned.includes(prefix)) cleaned = cleaned.split(prefix).pop();
  }
  return cleaned.replace(/^\/+/, '');
};

const findCursorAgent = () => {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const possiblePaths = [
    'cursor-agent',
    path.join(homeDir, '.local/bin/cursor-agent'),
    path.join(homeDir, '.cursor/bin/cursor-agent'),
    '/usr/local/bin/cursor-agent',
  ];
  
  for (const p of possiblePaths) {
    try {
      if (p === 'cursor-agent') {
        const result = require('child_process').spawnSync('which', [p]);
        if (result.status === 0) return p;
      } else if (fs.existsSync(p)) {
        return p;
      }
    } catch (e) {}
  }
  return null;
};

const injectVariables = (template, vars) => {
  return template
    .replace(/\$\{filePath\}/g, vars.filePath || '')
    .replace(/\$\{component\}/g, vars.component || '')
    .replace(/\$\{lineNumber\}/g, vars.lineNumber || '~')
    .replace(/\$\{instruction\}/g, vars.instruction || '')
    .replace(/\$\{elementText\}/g, vars.elementText || '')
    .replace(/\$\{elementTag\}/g, vars.elementTag || 'element')
    .replace(/\$\{elementClasses\}/g, vars.elementClasses || '')
    .replace(/\$\{elementHTML\}/g, vars.elementHTML || '')
    .replace(/\$\{parentContext\}/g, vars.parentContext || '');
};

module.exports = {
  cleanFilePath,
  findCursorAgent,
  injectVariables
};

