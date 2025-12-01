"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { init, getStack, getFileName } from 'react-grab/core';

// ============================================================================
// DEBUG MODE - Set to true to enable verbose console logging
// ============================================================================
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => DEBUG && console.log(...args);

// ============================================================================
// CONSTANTS
// ============================================================================

const MODELS = [
  { id: 'auto', name: 'Auto', desc: 'Cursor chooses' },
  { id: 'composer-1', name: 'Composer 1', desc: 'Cursor flagship' },
  { id: 'sonnet-4.5', name: 'Sonnet 4.5', desc: 'Fast & capable' },
  { id: 'sonnet-4.5-thinking', name: 'Sonnet 4.5 Thinking', desc: 'Deep reasoning' },
  { id: 'opus-4.5', name: 'Opus 4.5', desc: 'Most powerful' },
  { id: 'opus-4.5-thinking', name: 'Opus 4.5 Thinking', desc: 'Opus + reasoning' },
  { id: 'opus-4.1', name: 'Opus 4.1', desc: 'Previous gen' },
  { id: 'gpt-5', name: 'GPT-5', desc: 'OpenAI base' },
  { id: 'gpt-5-high', name: 'GPT-5 High', desc: 'Higher quality' },
  { id: 'gpt-5.1', name: 'GPT-5.1', desc: 'Latest GPT' },
  { id: 'gpt-5.1-high', name: 'GPT-5.1 High', desc: 'Best GPT' },
  { id: 'gpt-5-codex', name: 'GPT-5 Codex', desc: 'Code optimized' },
  { id: 'gpt-5-codex-high', name: 'GPT-5 Codex High', desc: 'Code + quality' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', desc: 'Latest code' },
  { id: 'gpt-5.1-codex-high', name: 'GPT-5.1 Codex High', desc: 'Best code' },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', desc: 'Google latest' },
  { id: 'grok', name: 'Grok', desc: 'xAI model' },
];

const PROMPT_TEMPLATES = {
  designer: { id: 'designer', name: 'Designer', desc: 'Elite UI/UX focus', prompt: '' },
  minimal: { id: 'minimal', name: 'Minimal', desc: 'Smallest change', prompt: '' },
  engineer: { id: 'engineer', name: 'Engineer', desc: 'Clean code', prompt: '' },
  accessibility: { id: 'accessibility', name: 'A11y', desc: 'WCAG compliance', prompt: '' },
  custom: { id: 'custom', name: 'Custom', desc: 'Your prompt', prompt: '' }
};

// ============================================================================
// DESIGN TOKENS
// ============================================================================

const colors = {
  void: '#0A0A0A',
  canvas: '#141414',
  surface: '#1A1A1A',
  elevated: '#1F1F1F',
  overlay: '#252525',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.7)',
  textTertiary: 'rgba(255,255,255,0.4)',
  textMuted: 'rgba(255,255,255,0.2)',
  borderSubtle: 'rgba(255,255,255,0.05)',
  borderDefault: 'rgba(255,255,255,0.1)',
  borderStrong: 'rgba(255,255,255,0.2)',
  brand: '#6F3BF5',
  brandSoft: 'rgba(111,59,245,0.15)',
  brandGlow: 'rgba(111,59,245,0.4)',
  success: '#10B981',
  successSoft: 'rgba(16,185,129,0.15)',
  error: '#EF4444',
  errorSoft: 'rgba(239,68,68,0.15)',
  warning: '#FBBF24',
  warningSoft: 'rgba(251,191,36,0.15)',
};

// ============================================================================
// TYPES
// ============================================================================

interface StreamEvent {
  id: string;
  type: 'init' | 'system' | 'thinking' | 'tool' | 'result' | 'complete' | 'error';
  text?: string;
  action?: string;
  status?: string;
  path?: string;
  lines?: number;
  model?: string;
  success?: boolean;
  sessionId?: string;
  canRevert?: boolean;
}

interface RevisionStep {
  sessionId: string;
  instruction: string;
  summary: string;
  filesChanged: Array<{path: string; lines: number; isNew?: boolean}>;
}

interface Target {
  fileName: string;
  lineNumber: number;
  componentName: string;
  elementText: string;
  elementTag: string;
  elementClasses: string;
  elementHTML: string;
  parentContext: string;
}

interface DiffChange {
  value: string;
  added: boolean;
  removed: boolean;
}

interface FileDiff {
  path: string;
  changes: DiffChange[];
  stats: {
    additions: number;
    deletions: number;
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

const cleanFilePath = (rawPath: string | null): string | null => {
  if (!rawPath) return null;
  let cleaned = rawPath.split('?')[0];
  const prefixes = [
    'about://React/Server/',
    'webpack-internal://',
    '///rsc/./',
    '//rsc/./',
    '/rsc/./',
    'rsc/./',
    '///app-pages-browser/./',  // Next.js App Router prefix
    '//app-pages-browser/./',
    '/app-pages-browser/./',
    'app-pages-browser/./',
  ];
  for (const prefix of prefixes) {
    if (cleaned.includes(prefix)) cleaned = cleaned.split(prefix).pop() || cleaned;
  }
  return cleaned.replace(/^\/+/, '');
};

const inferFileFromRoute = (): string => {
  const pathname = window.location.pathname;
  if (pathname === '/') return 'app/page.tsx';
  return `app/${pathname.slice(1)}/page.tsx`;
};

const getStoredValue = <T,>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch { return defaultValue; }
};

const setStoredValue = (key: string, value: any) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const Dropdown = ({ value, options, onChange, label, disabled = false }: { 
  value: string; 
  options: { id: string; name: string; desc: string }[]; 
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find(o => o.id === value);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          background: 'transparent',
          border: `1px solid ${colors.borderDefault}`,
          borderRadius: '6px',
          padding: '6px 10px',
          color: disabled ? colors.textMuted : colors.textSecondary,
          fontSize: '11px',
          fontFamily: 'ui-monospace, monospace',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 0.15s ease',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ color: colors.textTertiary, textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.5px' }}>{label}</span>
        <span style={{ color: colors.textPrimary }}>{selected?.name}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
          <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      
      {open && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          marginBottom: '4px',
          background: colors.elevated,
          border: `1px solid ${colors.borderDefault}`,
          borderRadius: '8px',
          padding: '4px',
          minWidth: '160px',
          maxHeight: '240px',
          overflowY: 'auto',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          zIndex: 10,
        }}>
          {options.map(opt => (
            <button
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 10px',
                background: opt.id === value ? colors.brandSoft : 'transparent',
                border: 'none',
                borderRadius: '4px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ color: colors.textPrimary, fontSize: '12px', fontWeight: 500 }}>{opt.name}</div>
              <div style={{ color: colors.textTertiary, fontSize: '10px', marginTop: '2px' }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Toggle = ({ value, onChange, label, disabled = false }: { 
  value: boolean; 
  onChange: (v: boolean) => void; 
  label: string;
  disabled?: boolean;
}) => (
  <button
    onClick={() => !disabled && onChange(!value)}
    disabled={disabled}
    style={{
      background: 'transparent',
      border: `1px solid ${value ? colors.brand : colors.borderDefault}`,
      borderRadius: '6px',
      padding: '6px 10px',
      color: value ? colors.brand : colors.textSecondary,
      fontSize: '11px',
      fontFamily: 'ui-monospace, monospace',
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      transition: 'all 0.15s ease',
      opacity: disabled ? 0.5 : 1,
    }}
  >
    <span style={{ 
      width: '6px', height: '6px', borderRadius: '50%', 
      background: value ? colors.brand : colors.textMuted,
      boxShadow: value ? `0 0 8px ${colors.brandGlow}` : 'none',
    }} />
    <span>{label}</span>
    <span style={{ color: value ? colors.brand : colors.textTertiary, fontWeight: 600, fontSize: '10px' }}>
      {value ? 'ON' : 'OFF'}
    </span>
  </button>
);

// Step component for streaming events
const StreamStep = ({ event, isLast }: { event: StreamEvent; isLast: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  
  const getIcon = () => {
    switch (event.type) {
      case 'system': return '◆';
      case 'thinking': return '◇';
      case 'tool': return event.action === 'read' ? '◁' : '▷';
      case 'result': return event.success ? '✓' : '✗';
      case 'error': return '!';
      default: return '●';
    }
  };
  
  const getColor = () => {
    switch (event.type) {
      case 'system': return colors.brand;
      case 'thinking': return colors.textTertiary;
      case 'tool': return event.status === 'completed' ? colors.success : colors.warning;
      case 'result': return event.success ? colors.success : colors.error;
      case 'error': return colors.error;
      default: return colors.textMuted;
    }
  };
  
  const getText = () => {
    switch (event.type) {
      case 'system': return `Using ${event.model}`;
      case 'thinking': return event.text?.substring(0, 100) + (event.text && event.text.length > 100 ? '...' : '');
      case 'tool': 
        if (event.status === 'started') return `${event.action === 'read' ? 'Reading' : 'Writing'} ${event.path}`;
        return `${event.action === 'read' ? 'Read' : 'Wrote'} ${event.path} (${event.lines} lines)`;
      case 'result': return event.success ? 'Changes applied' : 'Failed';
      case 'error': return event.text || 'Error occurred';
      default: return '';
    }
  };

  const hasExpandableContent = event.type === 'thinking' && event.text && event.text.length > 100;

  return (
    <div style={{ 
      display: 'flex', 
      gap: '10px',
      paddingBottom: isLast ? 0 : '8px',
    }}>
      {/* Timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '16px' }}>
        <div style={{
          width: '16px',
          height: '16px',
          borderRadius: '4px',
          background: `${getColor()}15`,
          border: `1px solid ${getColor()}30`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '9px',
          color: getColor(),
          fontWeight: 600,
        }}>
          {getIcon()}
        </div>
        {!isLast && (
          <div style={{
            width: '1px',
            flex: 1,
            background: colors.borderSubtle,
            marginTop: '4px',
          }} />
        )}
      </div>
      
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, paddingTop: '1px' }}>
        <div 
          onClick={() => hasExpandableContent && setExpanded(!expanded)}
          style={{ 
            fontSize: '11px', 
            color: event.type === 'thinking' ? colors.textTertiary : colors.textSecondary,
            fontFamily: event.type === 'tool' ? 'ui-monospace, monospace' : 'inherit',
            cursor: hasExpandableContent ? 'pointer' : 'default',
            lineHeight: 1.4,
          }}
        >
          {expanded ? event.text : getText()}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const CursorOverlay = () => {
  // Core state
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const [inspectorActive, setInspectorActive] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]); // Multi-select support
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<'idle' | 'streaming' | 'success' | 'error'>('idle');
  const [grabApi, setGrabApi] = useState<any>(null);

  // Streaming state
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null); // cursor-agent's session for --resume
  const [canRevert, setCanRevert] = useState(false);
  const [filesChanged, setFilesChanged] = useState<{path: string; lines: number; isNew?: boolean}[]>([]);
  const eventsContainerRef = useRef<HTMLDivElement>(null);
  
  // Revision history - tracks all edits in the current revision chain
  const [revisionHistory, setRevisionHistory] = useState<RevisionStep[]>([]);
  const currentInstructionRef = useRef<string>(''); // Track instruction at submit time
  const targetsRef = useRef<Target[]>([]); // Ref to access current targets in callbacks

  // Settings state (persisted)
  const [model, setModel] = useState(() => getStoredValue('cursor-bridge-model', 'auto'));
  const [memoryMode, setMemoryMode] = useState(() => getStoredValue('cursor-bridge-memory', false));
  const [chatId, setChatId] = useState<string | null>(null);
  const [promptTemplate, setPromptTemplate] = useState(() => getStoredValue('cursor-bridge-template', 'designer'));
  const [customPrompt, setCustomPrompt] = useState(() => getStoredValue('cursor-bridge-custom-prompt', ''));
  
  // UI state
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState('');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  
  // Diff panel state
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [diffData, setDiffData] = useState<FileDiff[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [activeDiffFile, setActiveDiffFile] = useState(0);

  // Persist settings
  useEffect(() => { setStoredValue('cursor-bridge-model', model); }, [model]);
  useEffect(() => { setStoredValue('cursor-bridge-memory', memoryMode); }, [memoryMode]);
  useEffect(() => { setStoredValue('cursor-bridge-template', promptTemplate); }, [promptTemplate]);
  useEffect(() => { setStoredValue('cursor-bridge-custom-prompt', customPrompt); }, [customPrompt]);

  // Keep targets ref in sync for use in callbacks (avoids stale closure)
  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  // Auto-scroll events
  useEffect(() => {
    if (eventsContainerRef.current) {
      eventsContainerRef.current.scrollTop = eventsContainerRef.current.scrollHeight;
    }
  }, [events]);

  // Initialize react-grab
  useEffect(() => {
    setMounted(true);
    const api = init({
      theme: { enabled: true, hue: 270, elementLabel: { backgroundColor: colors.surface, textColor: colors.textPrimary }},
      onElementSelect: async (element: Element) => {
        log("🔍 Selected element:", element);
        
        const stack = await getStack(element);
        const rawFileName = getFileName(stack);
        let fileName = cleanFilePath(rawFileName);
        
        const frameWithSource = stack.find(frame => frame.source !== null);
        let lineNumber = frameWithSource?.source?.lineNumber ?? 0;
        const componentName = frameWithSource?.name ?? element.tagName.toLowerCase();
        
        // Capture FULL element details - this is what cursor-agent needs!
        const elementTag = element.tagName.toLowerCase();
        const elementClasses = element.className || '';
        const elementText = element.textContent?.trim().substring(0, 100) || '';
        const elementHTML = element.outerHTML.length > 500 
          ? element.outerHTML.substring(0, 500) + '...'
          : element.outerHTML;
        
        // Build parent context from React component stack
        const parentContext = stack
          .slice(0, 6)
          .map(frame => frame.name)
          .filter((name, i, arr) => name && arr.indexOf(name) === i)
          .join(' → ');
        
        log("📚 Stack:", stack);
        log("📂 Raw file:", rawFileName);
        log("📂 Cleaned file:", fileName, "Line:", lineNumber);
        log("🏷️ Component:", componentName);
        log("🎨 Classes:", elementClasses.substring(0, 80) + (elementClasses.length > 80 ? '...' : ''));
        log("🌳 Context:", parentContext);
        
        if (!fileName) {
          log("🖥️ No source info - using route fallback");
          fileName = inferFileFromRoute();
          lineNumber = 0;
        }
        
        const newTarget: Target = { fileName, lineNumber, componentName, elementText, elementTag, elementClasses, elementHTML, parentContext };
        
        // Use ref to get current targets (avoids stale closure in callback)
        const currentTargets = targetsRef.current;
        
        log("📊 Current targets:", currentTargets.length, "New element:", elementTag, fileName, lineNumber);
        
        // If we already have targets, ADD to selection (multi-select)
        if (currentTargets.length > 0 && currentTargets.length < 5) {
          // Check for duplicates - use multiple criteria since line numbers can be the same for different elements
          const isDuplicate = currentTargets.some(t => 
            t.fileName === fileName && 
            t.lineNumber === lineNumber && 
            t.elementTag === elementTag &&
            t.elementClasses === elementClasses
          );
          if (!isDuplicate) {
            setTargets(prev => [...prev, newTarget]);
            log("➕ Added element to selection:", currentTargets.length + 1);
          } else {
            log("⚠️ Element already selected (exact match), skipping");
          }
        } else if (currentTargets.length >= 5) {
          log("⚠️ Max 5 elements reached");
        } else {
          // No existing targets - start fresh selection
          setTargets([newTarget]);
          setEvents([]);
          setCanRevert(false);
          setSessionId(null);
          log("🎯 New selection started");
        }
        
        setActive(true);
        setInspectorActive(false);
        api.deactivate();
      }
    });
    setGrabApi(api);
    return () => { if (api) api.deactivate(); };
  }, []);

  // Toggle inspector mode (activate/deactivate react-grab)
  const toggleInspector = () => {
    if (!grabApi) return;
    if (inspectorActive) {
      grabApi.deactivate();
      setInspectorActive(false);
    } else {
      grabApi.activate();
      setInspectorActive(true);
      setActive(false);
    }
  };

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || 
        (e.target as HTMLElement).tagName === 'BUTTON' ||
        (e.target as HTMLElement).tagName === 'INPUT') return;
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, initialX: position.x, initialY: position.y };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({ x: dragRef.current.initialX + dx, y: dragRef.current.initialY + dy });
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPromptEditor) setShowPromptEditor(false);
        else if (active && status !== 'streaming') closeChat();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, showPromptEditor, status]);

  // Send command with streaming
  const sendCommand = async () => {
    if (targets.length === 0 || !instruction.trim() || status === 'streaming') return;
    
    const userInstruction = instruction;
    currentInstructionRef.current = userInstruction; // Track for revision history
    setStatus('streaming');
    setEvents([]);
    setCanRevert(false);
    
    // For backwards compatibility, use first target for primary fields
    // Also send full targets array for multi-element support
    const primaryTarget = targets[0];
    
    try {
      const response = await fetch('http://localhost:3333/cursor-command-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Primary target (backwards compatible)
          filePath: primaryTarget.fileName,
          component: primaryTarget.componentName,
          lineNumber: primaryTarget.lineNumber,
          elementText: primaryTarget.elementText,
          elementTag: primaryTarget.elementTag,
          elementClasses: primaryTarget.elementClasses,
          elementHTML: primaryTarget.elementHTML,
          parentContext: primaryTarget.parentContext,
          // All targets for multi-select
          targets: targets,
          instruction: userInstruction,
          model,
          memoryMode,
          chatId,
          revisionSessionId: agentSessionId, // For --resume on revisions
          promptTemplate,
          customPrompt: promptTemplate === 'custom' ? customPrompt : null,
        })
      });

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const eventId = `${Date.now()}-${Math.random()}`;
              
              if (data.type === 'complete') {
                setSessionId(data.sessionId);
                setAgentSessionId(data.agentSessionId); // Store for --resume revisions
                setCanRevert(data.canRevert);
                setStatus(data.success ? 'success' : 'error');
                
                // Store detailed files changed info
                const hasChanges = Array.isArray(data.filesChanged) && data.filesChanged.length > 0;
                if (hasChanges) {
                  setFilesChanged(data.filesChanged);
                } else {
                  setFilesChanged([]);
                }
                
                // Add to revision history if successful with changes
                if (data.success && hasChanges) {
                  const fileCount = data.filesChanged.length;
                  const totalLines = data.filesChanged.reduce((sum: number, f: any) => sum + (f.lines || 0), 0);
                  const summary = `Modified ${fileCount} file${fileCount > 1 ? 's' : ''} (${totalLines} lines)`;
                  
                  setRevisionHistory(prev => [...prev, {
                    sessionId: data.sessionId,
                    instruction: currentInstructionRef.current,
                    summary,
                    filesChanged: data.filesChanged
                  }]);
                  
                  setEvents(prev => [...prev, { 
                    id: eventId, 
                    type: 'result', 
                    success: true, 
                    text: summary 
                  }]);
                } else if (data.success && !hasChanges) {
                  setEvents(prev => [...prev, { 
                    id: eventId, 
                    type: 'result', 
                    success: true, 
                    text: 'No changes were made' 
                  }]);
                } else if (!data.success) {
                  setEvents(prev => [...prev, { 
                    id: eventId, 
                    type: 'error', 
                    text: data.errorMessage || 'Operation failed' 
                  }]);
                }
              } else if (data.type === 'error') {
                setEvents(prev => [...prev, { ...data, id: eventId }]);
                setStatus('error');
              } else {
                setEvents(prev => [...prev, { ...data, id: eventId }]);
              }
            } catch (e) {}
          }
        }
      }
    } catch (e: any) {
      setEvents(prev => [...prev, { 
        id: `error-${Date.now()}`, 
        type: 'error', 
        text: e.message?.includes('fetch') ? 'Bridge not running. Run: npx cursor-bridge' : e.message 
      }]);
      setStatus('error');
    }
  };

  // Revert changes - keeps panel open for another attempt
  const handleRevert = async () => {
    if (!sessionId) return;
    
    try {
      const response = await fetch('http://localhost:3333/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Reset to idle state for another attempt (don't close panel)
        setStatus('idle');
        setEvents([]);
        setCanRevert(false);
        setSessionId(null);
        setAgentSessionId(null); // Clear for fresh start (undo means new attempt)
        setFilesChanged([]);
        setInstruction(""); // Clear instruction for fresh start
        setRevisionHistory([]); // Clear revision chain - starting fresh
      }
    } catch (e: any) {
      setEvents(prev => [...prev, { 
        id: `error-${Date.now()}`, 
        type: 'error', 
        text: 'Failed to revert' 
      }]);
    }
  };

  // Keep changes (just close)
  const handleKeep = () => {
    closeChat();
  };

  // Revise - keep panel open with agentSessionId for --resume
  const handleRevise = () => {
    // Reset to input mode but preserve agentSessionId and revisionHistory
    setStatus('idle');
    setEvents([]);
    setCanRevert(false);
    setSessionId(null);
    setFilesChanged([]);
    setInstruction(''); // Clear for new revision input
    // Keep agentSessionId for --resume
    // Keep revisionHistory to show what was done before
  };

  // Undo All - revert all revisions in the chain
  const handleUndoAll = async () => {
    if (revisionHistory.length === 0) return;
    
    try {
      // Revert all sessions in reverse order (most recent first)
      for (const step of [...revisionHistory].reverse()) {
        await fetch('http://localhost:3333/revert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: step.sessionId })
        });
      }
      
      // Also revert the current session if it exists
      if (sessionId) {
        await fetch('http://localhost:3333/revert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
      }
      
      // Clear everything and close
      closeChat();
    } catch (e: any) {
      setEvents(prev => [...prev, { 
        id: `error-${Date.now()}`, 
        type: 'error', 
        text: 'Failed to undo all changes' 
      }]);
    }
  };

  // Close and reset
  const closeChat = () => {
    setActive(false);
    setTargets([]); // Clear all selected elements
    setInstruction("");
    setStatus('idle');
    setEvents([]);
    setCanRevert(false);
    setSessionId(null);
    setAgentSessionId(null); // Clear for fresh start
    setFilesChanged([]);
    setRevisionHistory([]); // Clear revision chain
    setShowDiffPanel(false);
    setDiffData([]);
  };

  // Remove element from selection
  const handleRemoveTarget = (index: number) => {
    setTargets(prev => prev.filter((_, i) => i !== index));
  };

  // Fetch and show diff
  const handleViewDiff = async () => {
    if (!sessionId) return;
    
    setDiffLoading(true);
    try {
      const response = await fetch('http://localhost:3333/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      
      const data = await response.json();
      if (data.success && data.diffs.length > 0) {
        setDiffData(data.diffs);
        setActiveDiffFile(0);
        setShowDiffPanel(true);
      }
    } catch (e) {
      console.error('Failed to fetch diff:', e);
    } finally {
      setDiffLoading(false);
    }
  };

  // Close diff panel
  const closeDiffPanel = () => {
    setShowDiffPanel(false);
  };

  // Accept changes from diff panel
  const handleAcceptFromDiff = () => {
    setShowDiffPanel(false);
    handleKeep();
  };

  // Reject changes from diff panel (revert)
  const handleRejectFromDiff = async () => {
    setShowDiffPanel(false);
    await handleRevert();
  };

  // Open prompt editor
  const openPromptEditor = () => {
    setEditingPrompt(customPrompt);
    setShowPromptEditor(true);
  };

  // Save custom prompt
  const saveCustomPrompt = () => {
    setCustomPrompt(editingPrompt);
    setPromptTemplate('custom');
    setShowPromptEditor(false);
  };

  if (!mounted) return null;

  const isProcessing = status === 'streaming';
  const isComplete = status === 'success' || status === 'error';

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <>
      {/* Enable Agent Button (hidden - use CMD+C to activate) */}
      <div 
        onClick={toggleInspector}
        style={{
          display: 'none', // Hidden - use CMD+C
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 99999,
          cursor: 'pointer',
          alignItems: 'center',
          gap: '10px',
          background: inspectorActive ? colors.success : colors.surface,
          padding: '10px 16px',
          borderRadius: '30px',
          border: `1px solid ${inspectorActive ? colors.success : colors.borderDefault}`,
          color: colors.textPrimary,
          fontSize: '13px',
          fontFamily: 'system-ui, sans-serif',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          transition: 'all 0.2s ease',
        }}
      >
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: inspectorActive ? colors.textPrimary : colors.textMuted,
          boxShadow: inspectorActive ? '0 0 8px rgba(255,255,255,0.5)' : 'none',
        }} />
        <span>{inspectorActive ? 'Click Element' : 'Enable Agent'}</span>
      </div>

      {/* Main Chat Panel */}
      {active && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: 'fixed',
            bottom: `calc(80px - ${position.y}px)`,
            left: `calc(50% + ${position.x}px)`,
            transform: 'translateX(-50%)',
            zIndex: 99999,
            width: '500px',
            maxHeight: '70vh',
            background: colors.surface,
            border: `1px solid ${status === 'success' ? colors.success : status === 'error' ? colors.error : colors.borderDefault}`,
            borderRadius: '16px',
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 25px 60px rgba(0,0,0,0.5)`,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            cursor: isDragging ? 'grabbing' : 'default',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            transition: 'border-color 0.2s ease',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${colors.borderSubtle}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'grab',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: isProcessing ? colors.warning : status === 'success' ? colors.success : status === 'error' ? colors.error : colors.textTertiary,
                boxShadow: isProcessing ? '0 0 8px rgba(251,191,36,0.5)' : 'none',
                animation: isProcessing ? 'pulse 1s infinite' : 'none',
              }} />
              <span style={{ color: colors.textSecondary, fontSize: '12px', fontFamily: 'ui-monospace, monospace' }}>
                {targets[0]?.fileName?.split('/').pop()}
                {targets.length > 1 && (
                  <span style={{ color: colors.accent, marginLeft: '6px' }}>
                    +{targets.length - 1} more
                  </span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: colors.textTertiary, fontSize: '11px', fontFamily: 'ui-monospace, monospace' }}>
                L{targets[0]?.lineNumber || '~'}
              </span>
              {!isProcessing && (
                <button
                  onClick={closeChat}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: colors.textTertiary,
                    fontSize: '16px',
                    cursor: 'pointer',
                    padding: '0 4px',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Selected Elements (shown when idle or when multiple elements) */}
          {!isComplete && targets.length > 0 && (
            <div style={{
              padding: '10px 16px',
              borderBottom: `1px solid ${colors.borderSubtle}`,
              background: `${colors.surface}30`,
            }}>
              <div style={{ 
                fontSize: '10px', 
                textTransform: 'uppercase', 
                letterSpacing: '0.5px',
                color: colors.textTertiary,
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>Selected Elements ({targets.length}/5)</span>
                {targets.length < 5 && !isProcessing && (
                  <span style={{
                    color: colors.textTertiary,
                    fontSize: '9px',
                    opacity: 0.7,
                  }}>
                    ⌘C to add more
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {targets.map((t, i) => (
                  <div key={`${t.fileName}-${t.lineNumber}-${i}`} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 8px',
                    background: colors.elevated,
                    borderRadius: '4px',
                    fontSize: '11px',
                  }}>
                    <span style={{ 
                      color: colors.accent, 
                      fontSize: '10px',
                      fontWeight: 600,
                      width: '16px',
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ 
                      color: colors.textTertiary,
                      fontFamily: 'ui-monospace, monospace',
                    }}>
                      &lt;{t.elementTag}&gt;
                    </span>
                    <span style={{ 
                      color: colors.textSecondary,
                      fontFamily: 'ui-monospace, monospace',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {t.fileName?.split('/').pop()}
                    </span>
                    <span style={{ color: colors.textTertiary, fontSize: '10px' }}>
                      L{t.lineNumber}
                    </span>
                    {targets.length > 1 && !isProcessing && (
                      <button
                        onClick={() => handleRemoveTarget(i)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: colors.textTertiary,
                          fontSize: '12px',
                          cursor: 'pointer',
                          padding: '0 2px',
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Revision History (shown when there are previous revisions) */}
          {revisionHistory.length > 0 && (
            <div style={{
              padding: '12px 16px',
              borderBottom: `1px solid ${colors.borderSubtle}`,
              background: `${colors.surface}40`,
              maxHeight: '120px',
              overflowY: 'auto',
            }}>
              <div style={{ 
                fontSize: '10px', 
                textTransform: 'uppercase', 
                letterSpacing: '0.5px',
                color: colors.textTertiary,
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                position: 'sticky',
                top: 0,
                background: `${colors.surface}`,
                padding: '2px 0',
                zIndex: 1,
              }}>
                <span style={{ color: colors.accent }}>⟲</span> Revision History ({revisionHistory.length})
              </div>
              {revisionHistory.map((step, i) => {
                // Truncate long instructions
                const truncatedInstruction = step.instruction.length > 80 
                  ? step.instruction.substring(0, 80) + '...' 
                  : step.instruction;
                
                return (
                  <div key={step.sessionId} style={{
                    marginBottom: i === revisionHistory.length - 1 ? '0' : '10px',
                    paddingLeft: '12px',
                    borderLeft: `2px solid ${colors.accent}40`,
                  }}>
                    <div style={{
                      fontSize: '11px',
                      color: colors.textSecondary,
                      marginBottom: '3px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '6px',
                    }}>
                      <span style={{ 
                        color: colors.textTertiary,
                        fontSize: '10px',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}>#{i + 1}</span>
                      <span style={{ 
                        color: colors.textPrimary,
                        wordBreak: 'break-word',
                        lineHeight: 1.4,
                      }}>"{truncatedInstruction}"</span>
                    </div>
                    <div style={{
                      fontSize: '10px',
                      color: colors.textTertiary,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginLeft: '20px',
                    }}>
                      <span style={{ color: colors.success }}>✓</span>
                      {step.summary}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Events/Steps Area (shown when streaming or complete) */}
          {events.length > 0 && (
            <div 
              ref={eventsContainerRef}
              style={{ 
                padding: '12px 16px',
                maxHeight: '200px',
                overflowY: 'auto',
                borderBottom: `1px solid ${colors.borderSubtle}`,
                flexShrink: 0,
              }}
            >
              {events.map((event, i) => (
                <StreamStep key={event.id} event={event} isLast={i === events.length - 1} />
              ))}
            </div>
          )}

          {/* Input Area */}
          {!isComplete && (
            <div style={{ padding: '16px', flexShrink: 0 }}>
              <textarea
                autoFocus
                rows={3}
                disabled={isProcessing}
                value={instruction}
                onChange={e => !isProcessing && setInstruction(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !isProcessing && (e.preventDefault(), sendCommand())}
                placeholder={isProcessing ? "Processing..." : "Describe the change..."}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: colors.textPrimary,
                  fontSize: '14px',
                  fontFamily: 'system-ui, sans-serif',
                  lineHeight: 1.6,
                  resize: 'none',
                  opacity: isProcessing ? 0.5 : 1,
                }}
              />
            </div>
          )}

          {/* Revision Summary + Actions */}
          {isComplete && (
            <div style={{ 
              padding: '16px',
              flexShrink: 0,
            }}>
              {/* Files Changed Summary */}
              {canRevert && filesChanged.length > 0 && (
                <div style={{
                  marginBottom: '12px',
                  padding: '10px 12px',
                  background: colors.elevated,
                  borderRadius: '8px',
                  border: `1px solid ${colors.borderSubtle}`,
                }}>
                  <div style={{ 
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px'
                  }}>
                    <div style={{ 
                      fontSize: '10px', 
                      color: colors.textTertiary, 
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      Files Modified
                    </div>
                    <button
                      onClick={handleViewDiff}
                      disabled={diffLoading}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '2px 6px',
                        color: colors.accent,
                        fontSize: '10px',
                        fontWeight: 500,
                        cursor: diffLoading ? 'wait' : 'pointer',
                        opacity: diffLoading ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <span>◐</span> {diffLoading ? 'Loading...' : 'View Diff'}
                    </button>
                  </div>
                  {filesChanged.map((file, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '11px',
                      fontFamily: 'ui-monospace, monospace',
                      color: colors.textSecondary,
                      padding: '4px 0',
                    }}>
                      <span style={{ color: colors.success }}>
                        {file.isNew ? '+' : '~'}
                      </span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {file.path}
                      </span>
                      <span style={{ color: colors.textTertiary, fontSize: '10px' }}>
                        {file.lines} lines
                      </span>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Action Buttons */}
              <div style={{ 
                display: 'flex',
                gap: '8px',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}>
                {canRevert ? (
                  <>
                    {/* Undo All - only shown when there are multiple revisions (2+) */}
                    {revisionHistory.length > 1 && (
                      <button
                        onClick={handleUndoAll}
                        style={{
                          background: 'transparent',
                          border: `1px solid ${colors.error}40`,
                          borderRadius: '8px',
                          padding: '10px 14px',
                          color: colors.error,
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                        }}
                      >
                        <span>⟲</span> Undo All
                      </button>
                    )}
                    <button
                      onClick={handleRevert}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${colors.textTertiary}`,
                        borderRadius: '8px',
                        padding: '10px 14px',
                        color: colors.textSecondary,
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <span>↩</span> Undo
                    </button>
                    <button
                      onClick={handleRevise}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${colors.accent}`,
                        borderRadius: '8px',
                        padding: '10px 14px',
                        color: colors.accent,
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <span>✎</span> Revise
                    </button>
                    <button
                      onClick={handleKeep}
                      style={{
                        background: colors.success,
                        border: 'none',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        color: colors.void,
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: `0 0 20px ${colors.successSoft}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <span>✓</span> Accept
                    </button>
                  </>
                ) : (
                  <button
                    onClick={closeChat}
                    style={{
                      background: status === 'error' ? colors.error : colors.textTertiary,
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 24px',
                      color: colors.void,
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {status === 'error' ? 'Close' : 'Done'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Footer Controls */}
          {!isComplete && (
            <div style={{
              padding: '12px 16px',
              borderTop: `1px solid ${colors.borderSubtle}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <Dropdown label="Model" value={model} options={MODELS} onChange={setModel} disabled={isProcessing} />
                <Toggle label="Memory" value={memoryMode} onChange={v => { setMemoryMode(v); if (!v) setChatId(null); }} disabled={isProcessing} />
                <Dropdown label="Prompt" value={promptTemplate} options={Object.values(PROMPT_TEMPLATES)} onChange={setPromptTemplate} disabled={isProcessing} />
                <button
                  onClick={openPromptEditor}
                  disabled={isProcessing}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${colors.borderDefault}`,
                    borderRadius: '6px',
                    padding: '6px 8px',
                    color: colors.textTertiary,
                    fontSize: '10px',
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    opacity: isProcessing ? 0.5 : 1,
                  }}
                >
                  Edit
                </button>
              </div>
              
              <button
                onClick={sendCommand}
                disabled={isProcessing || !instruction.trim()}
                style={{
                  background: !isProcessing && instruction.trim() ? colors.textPrimary : colors.overlay,
                  color: !isProcessing && instruction.trim() ? colors.void : colors.textMuted,
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: !isProcessing && instruction.trim() ? 'pointer' : 'not-allowed',
                  boxShadow: !isProcessing && instruction.trim() ? '0 0 20px rgba(255,255,255,0.1)' : 'none',
                }}
              >
                {isProcessing ? 'Running...' : 'Send'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Prompt Editor Modal */}
      {showPromptEditor && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(4px)',
        }} onClick={() => setShowPromptEditor(false)}>
          <div 
            onClick={e => e.stopPropagation()}
            style={{
              width: '600px',
              maxHeight: '80vh',
              background: colors.surface,
              border: `1px solid ${colors.borderDefault}`,
              borderRadius: '16px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 30px 80px rgba(0,0,0,0.6)',
              overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '16px 20px',
              borderBottom: `1px solid ${colors.borderSubtle}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ color: colors.textPrimary, fontSize: '14px', fontWeight: 600 }}>Edit Custom Prompt</span>
              <button onClick={() => setShowPromptEditor(false)} style={{ background: 'transparent', border: 'none', color: colors.textTertiary, fontSize: '18px', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ marginBottom: '12px', color: colors.textTertiary, fontSize: '11px', fontFamily: 'ui-monospace, monospace' }}>
                Variables: {'${filePath}'} {'${component}'} {'${lineNumber}'} {'${instruction}'}
              </div>
              <textarea
                value={editingPrompt}
                onChange={e => setEditingPrompt(e.target.value)}
                style={{
                  width: '100%',
                  height: '300px',
                  background: colors.elevated,
                  border: `1px solid ${colors.borderDefault}`,
                  borderRadius: '8px',
                  padding: '12px',
                  color: colors.textPrimary,
                  fontSize: '12px',
                  fontFamily: 'ui-monospace, monospace',
                  lineHeight: 1.6,
                  resize: 'none',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{
              padding: '16px 20px',
              borderTop: `1px solid ${colors.borderSubtle}`,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
            }}>
              <button onClick={() => setShowPromptEditor(false)} style={{ background: 'transparent', border: `1px solid ${colors.borderDefault}`, borderRadius: '8px', padding: '8px 16px', color: colors.textSecondary, fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveCustomPrompt} style={{ background: colors.textPrimary, border: 'none', borderRadius: '8px', padding: '8px 16px', color: colors.void, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Diff Panel Modal */}
      {showDiffPanel && diffData.length > 0 && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.9)',
          backdropFilter: 'blur(8px)',
        }} onClick={closeDiffPanel}>
          <div 
            onClick={e => e.stopPropagation()}
            style={{
              width: '90vw',
              height: '90vh',
              background: colors.void,
              border: `1px solid ${colors.borderDefault}`,
              borderRadius: '16px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 100px rgba(0,0,0,0.8)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '16px 24px',
              borderBottom: `1px solid ${colors.borderSubtle}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: colors.surface,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ color: colors.textPrimary, fontSize: '14px', fontWeight: 600 }}>
                  Diff Preview
                </span>
                {/* File tabs */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {diffData.map((file, i) => (
                    <button
                      key={file.path}
                      onClick={() => setActiveDiffFile(i)}
                      style={{
                        background: activeDiffFile === i ? colors.accent + '20' : 'transparent',
                        border: `1px solid ${activeDiffFile === i ? colors.accent : colors.borderSubtle}`,
                        borderRadius: '6px',
                        padding: '4px 10px',
                        color: activeDiffFile === i ? colors.accent : colors.textSecondary,
                        fontSize: '11px',
                        fontFamily: 'ui-monospace, monospace',
                        cursor: 'pointer',
                      }}
                    >
                      {file.path}
                    </button>
                  ))}
                </div>
              </div>
              <button 
                onClick={closeDiffPanel} 
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: colors.textTertiary, 
                  fontSize: '20px', 
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                ×
              </button>
            </div>

            {/* Diff Content - Unified View */}
            <div style={{ 
              flex: 1, 
              overflow: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
              fontSize: '12px',
              lineHeight: 1.5,
            }}>
              {(() => {
                const changes = diffData[activeDiffFile]?.changes || [];
                let lineNum = 1;
                
                return changes.map((change, changeIdx) => {
                  const lines = change.value.split('\n');
                  // Remove last empty line from split if value ends with \n
                  if (lines[lines.length - 1] === '') lines.pop();
                  
                  return lines.map((line, lineIdx) => {
                    const currentLineNum = change.removed ? null : lineNum++;
                    if (change.added) lineNum--; // Don't increment for first render of added
                    if (!change.removed && !change.added) {
                      // unchanged line
                    }
                    
                    const isAdded = change.added;
                    const isRemoved = change.removed;
                    
                    return (
                      <div 
                        key={`${changeIdx}-${lineIdx}`}
                        style={{
                          display: 'flex',
                          background: isRemoved 
                            ? 'rgba(248, 81, 73, 0.15)' 
                            : isAdded 
                              ? 'rgba(63, 185, 80, 0.15)' 
                              : 'transparent',
                          borderLeft: isRemoved 
                            ? '3px solid #f85149' 
                            : isAdded 
                              ? '3px solid #3fb950' 
                              : '3px solid transparent',
                        }}
                      >
                        {/* Line indicator */}
                        <span style={{
                          width: '24px',
                          padding: '0 8px',
                          textAlign: 'center',
                          color: isRemoved ? '#f85149' : isAdded ? '#3fb950' : colors.textTertiary,
                          fontWeight: 600,
                          flexShrink: 0,
                          userSelect: 'none',
                        }}>
                          {isRemoved ? '−' : isAdded ? '+' : ' '}
                        </span>
                        
                        {/* Line number gutter */}
                        <span style={{
                          width: '50px',
                          padding: '0 8px',
                          textAlign: 'right',
                          color: colors.textTertiary,
                          background: isRemoved 
                            ? 'rgba(248, 81, 73, 0.1)' 
                            : isAdded 
                              ? 'rgba(63, 185, 80, 0.1)' 
                              : colors.surface,
                          borderRight: `1px solid ${colors.borderSubtle}`,
                          flexShrink: 0,
                          userSelect: 'none',
                          fontSize: '11px',
                        }}>
                          {!isRemoved ? (lineNum - (isAdded ? 0 : 1)) : ''}
                        </span>
                        
                        {/* Code content */}
                        <pre style={{
                          margin: 0,
                          padding: '0 16px',
                          flex: 1,
                          color: isRemoved 
                            ? '#f85149' 
                            : isAdded 
                              ? '#3fb950' 
                              : colors.textSecondary,
                          whiteSpace: 'pre',
                          overflow: 'visible',
                        }}>
                          {line || ' '}
                        </pre>
                      </div>
                    );
                  });
                });
              })()}
            </div>

            {/* Footer with actions */}
            <div style={{
              padding: '16px 24px',
              borderTop: `1px solid ${colors.borderSubtle}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: colors.surface,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                <span style={{ color: '#3fb950', fontWeight: 600 }}>
                  +{diffData[activeDiffFile]?.stats?.additions || 0}
                </span>
                <span style={{ color: '#f85149', fontWeight: 600 }}>
                  −{diffData[activeDiffFile]?.stats?.deletions || 0}
                </span>
                <span style={{ color: colors.textTertiary, fontSize: '11px' }}>
                  {diffData[activeDiffFile]?.changes?.length || 0} changes
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleRejectFromDiff}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${colors.error}60`,
                    borderRadius: '8px',
                    padding: '10px 20px',
                    color: colors.error,
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>✕</span> Reject Changes
                </button>
                <button
                  onClick={handleAcceptFromDiff}
                  style={{
                    background: colors.success,
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px 20px',
                    color: colors.void,
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: `0 0 20px ${colors.successSoft}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>✓</span> Accept Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pulse animation for processing indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
};
