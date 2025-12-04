"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { init, getStack, getFileName } from 'react-grab/core';

// Modular imports
import type {
  StreamEvent,
  RevisionStep,
  Target,
  FileDiff,
  FileReference,
  FileSearchResult
} from './src/client/types';
import { DEBUG, log, API_BASE, MODELS, PROMPT_TEMPLATES, colors } from './src/client/constants';
import { cleanFilePath, inferFileFromRoute, getStoredValue, setStoredValue } from './src/client/utils';
import { Dropdown, Toggle, StreamStep } from './src/client/components';
import { TitaniumShell, TitaniumButton } from './src/client/components/Titanium';
import { ArrowUp, Paperclip, Sparkles, X, Image as ImageIcon, FileText, Zap, Command, Plus } from 'lucide-react';

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

  // Add Mode state
  const [mode, setMode] = useState<'edit' | 'add'>('edit');
  const [addPosition, setAddPosition] = useState<'before' | 'after' | 'inside-start' | 'inside-end'>('after');
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const modeRef = useRef<'edit' | 'add'>('edit'); // Ref for callback access

  // Streaming state
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null); // cursor-agent's session for --resume
  const [canRevert, setCanRevert] = useState(false);
  const [filesChanged, setFilesChanged] = useState<{ path: string; lines: number; isNew?: boolean }[]>([]);
  const eventsContainerRef = useRef<HTMLDivElement>(null);
  const instructionInputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null); // null = not yet calculated
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);

  // Diff panel state
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [diffData, setDiffData] = useState<FileDiff[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [activeDiffFile, setActiveDiffFile] = useState(0);

  // File references & attachments state
  const [fileReferences, setFileReferences] = useState<FileReference[]>([]);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [fileSearchResults, setFileSearchResults] = useState<FileSearchResult[]>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [fileSearchIndex, setFileSearchIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const fileSearchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  
  // Multi-select UI state
  const [showTargetsDropdown, setShowTargetsDropdown] = useState(false);
  const targetsPillRef = useRef<HTMLButtonElement>(null);

  // Persist settings
  useEffect(() => { setStoredValue('cursor-bridge-model', model); }, [model]);
  useEffect(() => { setStoredValue('cursor-bridge-memory', memoryMode); }, [memoryMode]);
  useEffect(() => { setStoredValue('cursor-bridge-template', promptTemplate); }, [promptTemplate]);
  useEffect(() => { setStoredValue('cursor-bridge-custom-prompt', customPrompt); }, [customPrompt]);

  // Calculate initial centered position on mount
  useEffect(() => {
    if (position === null && typeof window !== 'undefined') {
      const panelWidth = 600;
      const panelHeight = 350; // Approximate height
      // Calculate offset from bottom-right to center the panel
      // bottom: 20px - y, right: 20px - x
      // To center: we need bottom = (vh - panelHeight) / 2, right = (vw - panelWidth) / 2
      // So: 20 - y = (vh - panelHeight) / 2 => y = 20 - (vh - panelHeight) / 2
      // And: 20 - x = (vw - panelWidth) / 2 => x = 20 - (vw - panelWidth) / 2
      const centerY = 20 - (window.innerHeight - panelHeight) / 2;
      const centerX = 20 - (window.innerWidth - panelWidth) / 2;
      setPosition({ x: centerX, y: centerY });
    }
  }, [position]);

  // Keep targets ref in sync for use in callbacks (avoids stale closure)
  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  // Keep mode ref in sync for use in callbacks (avoids stale closure)
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Auto-scroll events
  useEffect(() => {
    if (eventsContainerRef.current) {
      eventsContainerRef.current.scrollTop = eventsContainerRef.current.scrollHeight;
    }
  }, [events]);

  // Auto-focus input when panel opens (especially in add mode)
  useEffect(() => {
    if (active && mode === 'add' && !showPositionPicker && instructionInputRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        instructionInputRef.current?.focus();
      }, 100);
    }
  }, [active, mode, showPositionPicker]);

  // Dynamically change react-grab colors based on mode
  // react-grab uses Shadow DOM, so we need to access it through the host element
  const updateReactGrabColors = useCallback(() => {
    // react-grab creates a host element with data-react-grab attribute
    const host = document.querySelector('[data-react-grab]');
    if (!host || !host.shadowRoot) {
      return false;
    }

    // The shadowRoot contains the renderer where filter is applied
    // Find the first div child which should be the rendererRoot
    const rendererRoot = host.shadowRoot.querySelector('div');
    if (rendererRoot) {
      const hueShift = modeRef.current === 'add' ? '237deg' : '165deg';
      rendererRoot.style.filter = `hue-rotate(${hueShift})`;
      return true;
    }
    return false;
  }, []);

  // Update colors when mode changes
  useEffect(() => {
    if (inspectorActive) {
      // Try immediately
      if (!updateReactGrabColors()) {
        // If failed, retry after a delay
        const timer = setTimeout(updateReactGrabColors, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [mode, inspectorActive, updateReactGrabColors]);

  // ============================================================================
  // FILE REFERENCES & @ AUTOCOMPLETE
  // ============================================================================

  const searchFiles = useCallback(async (query: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/files?search=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const data = await res.json();
      setFileSearchResults(data.files || []);
      setFileSearchIndex(0);
    } catch (e) {
      log('[file-search] Error:', e);
    }
  }, []);

  const handleInstructionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    setInstruction(value);
    setCursorPosition(cursorPos);

    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (atMatch) {
      const query = atMatch[1];
      setFileSearchQuery(query);
      setShowFileSearch(true);
      if (fileSearchDebounceRef.current) clearTimeout(fileSearchDebounceRef.current);
      fileSearchDebounceRef.current = setTimeout(() => searchFiles(query), 150);
    } else {
      setShowFileSearch(false);
      setFileSearchResults([]);
    }
  };

  // Insert styled file mention into contentEditable
  const insertFileMention = (file: FileSearchResult) => {
    const el = instructionInputRef.current;
    if (!el) return;
    
    // Get current HTML and find the @query to replace
    const existingHTML = el.innerHTML;
    const currentText = el.innerText || '';
    const atMatch = currentText.match(/@([^\s@]*)$/);
    
    // Create the mention HTML
    const mentionHTML = `<span class="file-mention" contenteditable="false" data-path="${file.path}"><span class="file-mention-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg></span>${file.name}</span>`;
    
    if (atMatch) {
      const queryText = atMatch[0]; // e.g. "@des"
      const lastIndex = existingHTML.lastIndexOf(queryText);
      
      if (lastIndex !== -1) {
        el.innerHTML = existingHTML.slice(0, lastIndex) + mentionHTML + '&nbsp;';
      } else {
        // Fallback: replace at end
        el.innerHTML = existingHTML.replace(/@[^\s@]*$/, '') + mentionHTML + '&nbsp;';
      }
    } else {
      // No @ found, just append
      el.innerHTML = existingHTML + mentionHTML + '&nbsp;';
    }
    
    // Move cursor to end
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.focus();
    
    // Update instruction state
    setInstruction(el.innerText || '');
    
    // Add to file references
    if (!fileReferences.some(f => f.path === file.path)) {
      setFileReferences(prev => [...prev, { path: file.path, name: file.name, isImage: file.isImage }]);
    }
    
    setShowFileSearch(false);
    setFileSearchResults([]);
  };

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = (reader.result as string).split(',')[1];
      try {
        const res = await fetch(`${API_BASE}/api/upload-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, data: base64Data })
        });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        log('[upload] Success:', data.path);
        setFileReferences(prev => [...prev, { path: data.path, name: data.name, isImage: true, previewUrl: reader.result as string }]);
      } catch (e) { log('[upload] Error:', e); }
    };
    reader.readAsDataURL(file);
  };

  // Handle file selection from file input (images only - use @ for code files)
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      // Upload images to temp directory
      if (file.type.startsWith('image/')) {
        await handleImageUpload(file);
      }
      // Note: Code files should be added via @ autocomplete which searches the project
    }

    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFileReference = (path: string) => {
    setFileReferences(prev => prev.filter(f => f.path !== path));
    setInstruction(prev => prev.replace(new RegExp(`@${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?`, 'g'), ''));
  };

  useEffect(() => {
    setMounted(true);
    const api = init({
      theme: { enabled: true, hue: 0, elementLabel: { backgroundColor: colors.surface, textColor: colors.textPrimary } },
      onElementSelect: async (element: Element) => {
        log("Selected element:", element.tagName, element.className?.substring(0, 50));

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

        if (!fileName) {
          fileName = inferFileFromRoute();
          lineNumber = 0;
        }

        const newTarget: Target = { fileName, lineNumber, componentName, elementText, elementTag, elementClasses, elementHTML, parentContext };
        const currentTargets = targetsRef.current;
        const currentMode = modeRef.current;

        if (currentMode === 'add') {
          setTargets([newTarget]);
          setAddPosition('after'); // Default to "after" - user can change if needed
          setShowPositionPicker(false); // Skip position picker for faster flow
          setEvents([]);
          setCanRevert(false);
          setSessionId(null);
          setActive(true);
          setInspectorActive(false);
          api.deactivate();
          return;
        }

        if (currentTargets.length > 0 && currentTargets.length < 5) {
          const isDuplicate = currentTargets.some(t =>
            t.fileName === fileName &&
            t.lineNumber === lineNumber &&
            t.elementTag === elementTag &&
            t.elementClasses === elementClasses
          );
          if (!isDuplicate) {
            setTargets(prev => [...prev, newTarget]);
          }
        } else if (currentTargets.length >= 5) {
          // Max elements reached
        } else {
          setTargets([newTarget]);
          setEvents([]);
          setCanRevert(false);
          setSessionId(null);
        }

        setActive(true);
        setInspectorActive(false);
        api.deactivate();
      }
    });
    setGrabApi(api);
    return () => api?.deactivate();
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
      setShowTargetsDropdown(false); // Close dropdown when re-activating inspector
    }
  };

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' ||
      (e.target as HTMLElement).tagName === 'BUTTON' ||
      (e.target as HTMLElement).tagName === 'INPUT') return;
    if (position === null) return; // Not ready yet
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

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key repeats (held down keys)
      if (e.repeat) return;

      // Escape key
      if (e.key === 'Escape') {
        if (showPositionPicker) {
          setShowPositionPicker(false);
          setMode('edit');
        } else if (showPromptEditor) {
          setShowPromptEditor(false);
        } else if (active && status !== 'streaming') {
          closeChat();
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (modeRef.current !== 'edit') {
          setMode('edit');
          setShowPositionPicker(false);
        }
        setInspectorActive(true);
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        setMode('add');
        setShowPositionPicker(false);
        setTargets([]);
        setEvents([]);
        setCanRevert(false);
        setSessionId(null);
        setActive(false);

        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'c', code: 'KeyC', metaKey: true, ctrlKey: e.ctrlKey, bubbles: true, cancelable: true,
        }));
        setInspectorActive(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, showPromptEditor, showPositionPicker, status, grabApi, inspectorActive]);

  // Send command with streaming
  const sendCommand = async () => {
    if (targets.length === 0 || !instruction.trim() || status === 'streaming') return;

    const userInstruction = instruction;
    currentInstructionRef.current = userInstruction; // Track for revision history
    setStatus('streaming');
    setEvents([]);
    setCanRevert(false);
    setShowTargetsDropdown(false); // Close dropdown when starting stream
    setShowPositionPicker(false); // Hide position picker when sending

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
          // Add mode specific
          mode: mode,
          addPosition: mode === 'add' ? addPosition : null,
          // File references (images, code files)
          fileReferences: fileReferences.map(f => ({ path: f.path, isImage: f.isImage })),
        })
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedComplete = false;
      let lastEventTime = Date.now();

      // Timeout checker - if no events for 30s, assume connection died
      const timeoutCheck = setInterval(() => {
        if (Date.now() - lastEventTime > 30000) {
          clearInterval(timeoutCheck);
          if (!receivedComplete) {
            setEvents(prev => [...prev, {
              id: `timeout-${Date.now()}`,
              type: 'error',
              text: 'Connection timed out. The agent may still be processing. Try again if needed.'
            }]);
            setStatus('error');
          }
        }
      }, 5000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lastEventTime = Date.now();

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const eventId = `${Date.now()}-${Math.random()}`;

                if (data.type === 'complete') {
                  receivedComplete = true;
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
              } catch (e) { }
            }
          }
        }

        // Stream ended - check if we got a complete event
        if (!receivedComplete) {
          setEvents(prev => [...prev, {
            id: `disconnect-${Date.now()}`,
            type: 'error',
            text: 'Connection closed unexpectedly. Try again.'
          }]);
          setStatus('error');
        }
      } finally {
        clearInterval(timeoutCheck);
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

  // Cancel running operation
  const handleCancel = () => {
    setStatus('error');
    setEvents(prev => [...prev, {
      id: `cancel-${Date.now()}`,
      type: 'error',
      text: 'Cancelled by user'
    }]);
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
    // Reset add mode state
    setMode('edit');
    setShowPositionPicker(false);
    setAddPosition('after');
    // Clear file references
    setFileReferences([]);
    setShowFileSearch(false);
    setFileSearchResults([]);
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
    } catch {
      // Diff fetch failed silently
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
        <TitaniumShell
          mode={mode}
          isActive={isProcessing}
          onMouseDown={handleMouseDown}
          style={{
            position: 'fixed',
            bottom: `calc(20px - ${position?.y ?? 0}px)`, // Dynamic Y
            right: `calc(20px - ${position?.x ?? 0}px)`,   // Dynamic X (inverted for right alignment)
            width: '600px',
            zIndex: 999999,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
          header={
            <>
              {/* Mode Indicator / Context Label */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                pointerEvents: 'none', // Let clicks pass through to drag handle unless interactive
              }}>
                {/* Mode Label */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.5px',
                  color: mode === 'add' ? colors.addMode : colors.editMode,
                  textTransform: 'uppercase',
                }}>
                  <div style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: 'currentColor',
                    boxShadow: `0 0 8px ${mode === 'add' ? colors.addMode : colors.editMode}`
                  }} />
                  {mode === 'add' ? 'Add to Codebase' : 'Edit Codebase'}
                </div>

                {/* Selected Elements Display */}
                {targets.length > 0 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    pointerEvents: 'auto',
                  }}>
                    {/* Primary Target Pill - Clickable when multiple */}
                    <button
                      ref={targetsPillRef}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (targets.length > 1) {
                          setShowTargetsDropdown(!showTargetsDropdown);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        background: 'rgba(255,255,255,0.08)',
                        border: 'none',
                        cursor: targets.length > 1 ? 'pointer' : 'default',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => {
                        if (targets.length > 1) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
                        }
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                      }}
                    >
                      <span style={{
                        fontSize: '11px',
                        color: colors.textSecondary,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        maxWidth: '120px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {targets[0].fileName.split('/').pop() || targets[0].fileName}
                      </span>
                      
                      {/* Multi-select Badge (inline) */}
                      {targets.length > 1 && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '1px 5px',
                          marginLeft: '4px',
                          borderRadius: '999px',
                          background: mode === 'add' ? 'rgba(168, 85, 247, 0.25)' : 'rgba(52, 211, 153, 0.25)',
                          fontSize: '9px',
                          fontWeight: 700,
                          color: mode === 'add' ? colors.addMode : colors.editMode,
                        }}>
                          +{targets.length - 1}
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Close Button */}
              <div style={{ marginLeft: 'auto', pointerEvents: 'auto' }}>
                <button
                  onClick={() => setActive(false)}
                  style={{
                    width: '20px', height: '20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: colors.textSecondary,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    cursor: 'pointer',
                    padding: 0,
                    borderRadius: '50%', // Circle
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = colors.textPrimary;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.color = colors.textSecondary;
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            </>
          }
          footer={
            <>
              {/* Left Controls: Attach & Model */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Hidden File Input (Images only - use @ for code files) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                {/* Attach Button (Circle) */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  draggable={false}
                  style={{
                    width: '28px', height: '28px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(255,255,255,0.03)', // Subtle fill for definition
                    border: '1px solid rgba(255,255,255,0.05)', // Subtle border
                    borderRadius: '50%', // Circle
                    color: colors.textSecondary,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = colors.textPrimary;
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    e.currentTarget.style.color = colors.textSecondary;
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                  }}
                >
                  <Paperclip size={14} strokeWidth={2} />
                </button>

                {/* Add File Reference Button (+) - Triggers @ search */}
                <button
                  onClick={() => {
                    const el = instructionInputRef.current;
                    if (el) {
                      el.focus();
                      // Append @ at the end
                      const currentHTML = el.innerHTML;
                      el.innerHTML = currentHTML + '@';
                      // Move cursor to end
                      const range = document.createRange();
                      const sel = window.getSelection();
                      range.selectNodeContents(el);
                      range.collapse(false);
                      sel?.removeAllRanges();
                      sel?.addRange(range);
                      // Trigger file search
                      setShowFileSearch(true);
                      setFileSearchQuery('');
                      searchFiles('');
                    }
                  }}
                  draggable={false}
                  style={{
                    width: '28px', height: '28px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '50%',
                    color: colors.textSecondary,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = colors.textPrimary;
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    e.currentTarget.style.color = colors.textSecondary;
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                  }}
                >
                  <Plus size={14} strokeWidth={2} />
                </button>

                {/* Model Dropdown (Pill handled in component or wrapper) */}
                <div style={{ height: '28px' }}>
                  <Dropdown
                    value={model}
                    onChange={setModel}
                    options={MODELS}
                    label="" // No label
                  />
                </div>
              </div>

              {/* Right Control: Titanium Send Button */}
              <div style={{ height: '28px' }}>
                <TitaniumButton
                  onClick={sendCommand}
                  disabled={status === 'streaming' || !instruction.trim()}
                  isLoading={status === 'streaming'}
                  mode={mode}
                >
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>
                    {mode === 'add' ? 'Add' : 'Edit'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', opacity: 0.6 }}>
                    <Command size={10} strokeWidth={3} />
                    <ArrowUp size={10} strokeWidth={3} />
                  </div>
                </TitaniumButton>
              </div>
            </>
          }
        >
          {/* Image Attachments Only - Screenshots go here */}
          {fileReferences.filter(f => f.isImage).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px 16px 8px 16px' }}>
              {fileReferences.filter(f => f.isImage).map((file) => (
                <div key={file.path} style={{
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '5px',
                  padding: '3px 6px 3px 5px',
                  background: 'rgba(168, 85, 247, 0.12)',
                  borderRadius: '5px',
                  color: '#C4B5FD',
                  border: '1px solid rgba(168, 85, 247, 0.2)',
                  transition: 'all 0.15s ease',
                }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '3px',
                    background: 'rgba(168, 85, 247, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <ImageIcon size={9} />
                  </div>
                  <span style={{ 
                    maxWidth: '120px', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '10px',
                  }}>
                    {file.name}
                  </span>
                  <button 
                    onClick={() => removeFileReference(file.path)} 
                    style={{ 
                      background: 'transparent', 
                      border: 'none', 
                      color: 'inherit', 
                      cursor: 'pointer', 
                      padding: '1px',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0.5,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.opacity = '0.5';
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <X size={8} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <style>{`
            .titanium-input:empty::before {
              content: attr(data-placeholder);
              color: rgba(255, 255, 255, 0.25);
              pointer-events: none;
            }
            .titanium-input:focus {
              outline: none;
            }
            .file-mention {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              padding: 2px 6px 2px 4px;
              background: rgba(59, 130, 246, 0.18);
              border: 1px solid rgba(59, 130, 246, 0.3);
              border-radius: 5px;
              color: #93C5FD;
              font-size: 13px;
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-weight: 500;
              vertical-align: middle;
              margin: 0 2px;
              line-height: 1.4;
              user-select: none;
            }
            .file-mention-icon {
              width: 16px;
              height: 16px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              background: rgba(59, 130, 246, 0.25);
              border-radius: 3px;
              flex-shrink: 0;
            }
            .file-mention-icon svg {
              width: 10px;
              height: 10px;
            }
          `}</style>
          
          {/* Rich Text Input - contentEditable for styled @ mentions */}
          <div
            ref={instructionInputRef}
            className="titanium-input"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Describe your change... (Use @ to reference files, ⌘C to add more)"
            onInput={(e) => {
              const target = e.currentTarget;
              setInstruction(target.innerText || '');
              
              // Detect @ pattern for file search
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const textNode = range.startContainer;
                if (textNode.nodeType === Node.TEXT_NODE) {
                  const textContent = textNode.textContent || '';
                  const cursorPos = range.startOffset;
                  const textBeforeCursor = textContent.slice(0, cursorPos);
                  const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
                  
                  if (atMatch) {
                    const query = atMatch[1];
                    setFileSearchQuery(query);
                    setShowFileSearch(true);
                    if (fileSearchDebounceRef.current) clearTimeout(fileSearchDebounceRef.current);
                    fileSearchDebounceRef.current = setTimeout(() => searchFiles(query), 150);
                  } else {
                    setShowFileSearch(false);
                    setFileSearchResults([]);
                  }
                } else {
                  // Cursor might be in an element, not text - check parent
                  const text = target.innerText || '';
                  const atMatch = text.match(/@([^\s@]*)$/);
                  if (atMatch) {
                    const query = atMatch[1];
                    setFileSearchQuery(query);
                    setShowFileSearch(true);
                    if (fileSearchDebounceRef.current) clearTimeout(fileSearchDebounceRef.current);
                    fileSearchDebounceRef.current = setTimeout(() => searchFiles(query), 150);
                  } else {
                    setShowFileSearch(false);
                    setFileSearchResults([]);
                  }
                }
              }
            }}
            onKeyDown={(e) => {
              if (showFileSearch && fileSearchResults.length > 0) {
                if (e.key === 'ArrowDown') { 
                  e.preventDefault(); 
                  setFileSearchIndex(prev => Math.min(prev + 1, fileSearchResults.length - 1)); 
                }
                else if (e.key === 'ArrowUp') { 
                  e.preventDefault(); 
                  setFileSearchIndex(prev => Math.max(prev - 1, 0)); 
                }
                else if (e.key === 'Enter' || e.key === 'Tab') { 
                  e.preventDefault();
                  insertFileMention(fileSearchResults[fileSearchIndex]);
                }
                else if (e.key === 'Escape') { 
                  e.preventDefault(); 
                  setShowFileSearch(false); 
                  setFileSearchResults([]); 
                }
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendCommand();
              }
            }}
            style={{
              width: '100%',
              minHeight: '120px',
              maxHeight: '400px',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: colors.textPrimary,
              fontSize: '15px',
              lineHeight: '1.6',
              padding: '12px 16px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          />
        </TitaniumShell>
      )}

      {/* @ File Search Dropdown - Portal to escape overflow:hidden */}
      {active && showFileSearch && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: (() => {
              if (!instructionInputRef.current) return 200;
              const rect = instructionInputRef.current.getBoundingClientRect();
              return window.innerHeight - rect.top + 8;
            })(),
            left: (() => {
              if (!instructionInputRef.current) return 100;
              const rect = instructionInputRef.current.getBoundingClientRect();
              return rect.left;
            })(),
            width: (() => {
              if (!instructionInputRef.current) return 400;
              const rect = instructionInputRef.current.getBoundingClientRect();
              return rect.width - 32;
            })(),
            marginLeft: '16px',
            background: '#1A1A1A',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px',
            padding: '6px',
            maxHeight: '240px',
            overflowY: 'auto',
            boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
            zIndex: 1000000,
          }}
        >
          {/* Header with Close Button */}
          <div style={{
            padding: '8px 12px 6px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            marginBottom: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ 
              fontSize: '10px', 
              fontWeight: 600, 
              color: colors.textTertiary, 
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Files {fileSearchQuery && `· "${fileSearchQuery}"`}
            </span>
            <button
              onClick={() => {
                setShowFileSearch(false);
                setFileSearchResults([]);
              }}
              style={{
                width: '18px',
                height: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.06)',
                border: 'none',
                borderRadius: '4px',
                color: colors.textTertiary,
                cursor: 'pointer',
                padding: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
                e.currentTarget.style.color = colors.textSecondary;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                e.currentTarget.style.color = colors.textTertiary;
              }}
            >
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
          
          {fileSearchResults.length > 0 ? (
            fileSearchResults.map((file, index) => (
              <button
                key={file.path}
                onClick={() => insertFileMention(file)}
                onMouseEnter={() => setFileSearchIndex(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  padding: '10px 12px',
                  background: index === fileSearchIndex ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  marginBottom: '2px',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  background: file.isImage ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {file.isImage ? (
                    <ImageIcon size={14} style={{ color: '#A855F7' }} />
                  ) : (
                    <FileText size={14} style={{ color: '#3B82F6' }} />
                  )}
                </div>
                <div style={{ overflow: 'hidden', flex: 1 }}>
                  <div style={{ 
                    color: index === fileSearchIndex ? colors.textPrimary : colors.textSecondary, 
                    fontSize: '13px', 
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {file.name}
                  </div>
                  <div style={{ 
                    color: colors.textTertiary, 
                    fontSize: '11px', 
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  }}>
                    {file.path}
                  </div>
                </div>
                {index === fileSearchIndex && (
                  <div style={{
                    fontSize: '10px',
                    color: colors.textTertiary,
                    padding: '2px 6px',
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: '4px',
                    fontFamily: 'ui-monospace, monospace',
                  }}>
                    ↵
                  </div>
                )}
              </button>
            ))
          ) : (
            <div style={{
              padding: '16px',
              color: colors.textTertiary,
              fontSize: '12px',
              textAlign: 'center',
            }}>
              {fileSearchQuery ? `No files matching "${fileSearchQuery}"` : 'Type to search files...'}
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Selected Elements Dropdown - Portal to escape overflow:hidden */}
      {active && showTargetsDropdown && targets.length > 1 && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div 
          style={{
            position: 'fixed',
            top: (() => {
              if (!targetsPillRef.current) return 100;
              const rect = targetsPillRef.current.getBoundingClientRect();
              return rect.bottom + 8;
            })(),
            left: (() => {
              if (!targetsPillRef.current) return 100;
              const rect = targetsPillRef.current.getBoundingClientRect();
              return rect.left;
            })(),
            minWidth: '260px',
            background: colors.surface,
            border: `1px solid ${colors.borderDefault}`,
            borderRadius: '12px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            overflow: 'hidden',
            zIndex: 1000000,
          }}
          onMouseLeave={() => setShowTargetsDropdown(false)}
        >
          {/* Header */}
          <div style={{
            padding: '10px 12px',
            borderBottom: `1px solid ${colors.borderDefault}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.5px',
              color: colors.textTertiary,
              textTransform: 'uppercase',
            }}>
              Selected Elements
            </span>
            <span style={{
              fontSize: '10px',
              color: colors.textTertiary,
            }}>
              {targets.length}/5
            </span>
          </div>
          
          {/* Elements List */}
          <div style={{ padding: '6px' }}>
            {targets.map((target, idx) => (
              <div
                key={`${target.fileName}-${target.lineNumber}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: idx === 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                  marginBottom: '2px',
                }}
              >
                {/* Element Number */}
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '5px',
                  background: idx === 0 
                    ? (mode === 'add' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(52, 211, 153, 0.15)')
                    : 'rgba(255,255,255,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 600,
                  color: idx === 0 
                    ? (mode === 'add' ? colors.addMode : colors.editMode)
                    : colors.textTertiary,
                }}>
                  {idx + 1}
                </div>
                
                {/* Element Info */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{
                    fontSize: '12px',
                    color: colors.textSecondary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    &lt;{target.elementTag}&gt;
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: colors.textTertiary,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {target.fileName.split('/').pop()}:{target.lineNumber}
                  </div>
                </div>
                
                {/* Remove Button (except for primary) */}
                {idx > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setTargets(prev => prev.filter((_, i) => i !== idx));
                      if (targets.length <= 2) setShowTargetsDropdown(false);
                    }}
                    style={{
                      width: '20px',
                      height: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      color: colors.textTertiary,
                      cursor: 'pointer',
                      opacity: 0.6,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                      e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.opacity = '0.6';
                    }}
                  >
                    <X size={10} />
                  </button>
                )}
                
                {/* Primary Badge */}
                {idx === 0 && (
                  <span style={{
                    fontSize: '9px',
                    fontWeight: 600,
                    color: mode === 'add' ? colors.addMode : colors.editMode,
                    letterSpacing: '0.3px',
                  }}>
                    PRIMARY
                  </span>
                )}
              </div>
            ))}
          </div>
          
          {/* Footer hint */}
          <div style={{
            padding: '8px 12px',
            borderTop: `1px solid ${colors.borderDefault}`,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <Command size={10} style={{ color: colors.textTertiary }} />
            <span style={{
              fontSize: '10px',
              color: colors.textTertiary,
            }}>
              ⌘C to add more elements
            </span>
          </div>
        </div>,
        document.body
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
