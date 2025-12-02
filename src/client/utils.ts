export const cleanFilePath = (rawPath: string | null): string | null => {
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
    if (cleaned.includes(prefix)) cleaned = cleaned.split(prefix).pop() || cleaned;
  }
  return cleaned.replace(/^\/+/, '');
};

export const inferFileFromRoute = (): string => {
  const pathname = window.location.pathname;
  if (pathname === '/') return 'app/page.tsx';
  return `app/${pathname.slice(1)}/page.tsx`;
};

export const getStoredValue = <T,>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch { return defaultValue; }
};

export const setStoredValue = (key: string, value: any) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

