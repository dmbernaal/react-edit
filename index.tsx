"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { TitaniumShell } from './src/client/components/Titanium';
import { ArrowUp, Paperclip, Sparkles, X, Image as ImageIcon, FileText, Zap } from 'lucide-react';

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
  const instructionInputRef = useRef<HTMLTextAreaElement>(null);

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

  // File references & attachments state
  const [fileReferences, setFileReferences] = useState<FileReference[]>([]);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [fileSearchResults, setFileSearchResults] = useState<FileSearchResult[]>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [fileSearchIndex, setFileSearchIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const fileSearchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Persist settings
  useEffect(() => { setStoredValue('cursor-bridge-model', model); }, [model]);
  useEffect(() => { setStoredValue('cursor-bridge-memory', memoryMode); }, [memoryMode]);
  useEffect(() => { setStoredValue('cursor-bridge-template', promptTemplate); }, [promptTemplate]);
  useEffect(() => { setStoredValue('cursor-bridge-custom-prompt', customPrompt); }, [customPrompt]);

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

  const selectFileReference = (file: FileSearchResult) => {
    const textBeforeCursor = instruction.slice(0, cursorPosition);
    const textAfterCursor = instruction.slice(cursorPosition);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (atMatch) {
      const beforeAt = textBeforeCursor.slice(0, atMatch.index);
      setInstruction(beforeAt + '@' + file.path + ' ' + textAfterCursor);
      if (!fileReferences.some(f => f.path === file.path)) {
        setFileReferences(prev => [...prev, { path: file.path, name: file.name, isImage: file.isImage }]);
      }
    }
    setShowFileSearch(false);
    setFileSearchResults([]);
    instructionInputRef.current?.focus();
  };

  const handleInstructionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showFileSearch && fileSearchResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFileSearchIndex(prev => Math.min(prev + 1, fileSearchResults.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFileSearchIndex(prev => Math.max(prev - 1, 0)); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectFileReference(fileSearchResults[fileSearchIndex]); }
      else if (e.key === 'Escape') { e.preventDefault(); setShowFileSearch(false); setFileSearchResults([]); }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCommand();
    }
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
          onMouseDown={handleMouseDown}
          style={{
            position: 'fixed',
            bottom: `calc(80px - ${position.y}px)`,
            left: `calc(50% + ${position.x}px)`,
            transform: 'translateX(-50%)',
            zIndex: 99999,
            width: '560px', // Slightly wider for premium feel
            maxHeight: '70vh',
            cursor: isDragging ? 'grabbing' : 'default',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header / Status Area */}
          <div style={{
            padding: '20px 24px 10px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Status Dot */}
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: mode === 'add' ? colors.addMode :
                  isProcessing ? colors.warning : status === 'success' ? colors.success : status === 'error' ? colors.error : colors.editMode,
                boxShadow: mode === 'add' ? `0 0 10px ${colors.addModeGlow}` :
                  isProcessing ? '0 0 10px rgba(251,191,36,0.5)' : `0 0 10px ${colors.editModeGlow}`,
                animation: isProcessing ? 'pulse 1s infinite' : 'none',
              }} />

              {/* Context Info */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{
                  color: colors.textPrimary,
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '-0.01em'
                }}>
                  {mode === 'add' ? 'Add to Codebase' : 'Edit Codebase'}
                </span>
                <span style={{
                  color: colors.textTertiary,
                  fontSize: '11px',
                  fontFamily: 'ui-monospace, monospace'
                }}>
                  {targets.length > 0 ? (
                    <>
                      {targets[0]?.fileName?.split('/').pop()}
                      {targets.length > 1 && ` +${targets.length - 1}`}
                      <span style={{ margin: '0 6px', opacity: 0.3 }}>|</span>
                      L{targets[0]?.lineNumber || '~'}
                    </>
                  ) : 'No selection'}
                </span>
              </div>
            </div>

            {/* Close Button */}
            <button
              onClick={closeChat}
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.textTertiary,
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.color = colors.textPrimary}
              onMouseLeave={e => e.currentTarget.style.color = colors.textTertiary}
            >
              <X size={16} />
            </button>
          </div>

          {/* Content Area */}
          <div style={{
            padding: '0 12px 12px 12px', // Tighter padding (was 24px)
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            flex: 1,
            overflow: 'hidden',
          }}>

            {/* Stream/History Area */}
            {(events.length > 0 || revisionHistory.length > 0) && (
              <div
                ref={eventsContainerRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  minHeight: '100px',
                  marginBottom: '10px',
                  paddingRight: '4px',
                }}
              >
                {/* Revision History */}
                {revisionHistory.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    {revisionHistory.map((step, i) => (
                      <div key={step.sessionId} style={{
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '8px',
                        marginBottom: '8px',
                        border: '1px solid rgba(255,255,255,0.05)',
                      }}>
                        <div style={{ fontSize: '11px', color: colors.textSecondary, marginBottom: '4px' }}>
                          <span style={{ color: colors.accent, marginRight: '6px' }}>#{i + 1}</span>
                          {step.instruction}
                        </div>
                        <div style={{ fontSize: '10px', color: colors.success, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Zap size={10} /> {step.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Live Events */}
                {events.map((event, i) => (
                  <StreamStep key={event.id} event={event} isLast={i === events.length - 1} />
                ))}
              </div>
            )}

            {/* Input Slot (Recessed) */}
            {!isComplete && (
              <div style={{
                background: 'rgba(255,255,255,0.02)', // Lighter, more subtle (was rgba(0,0,0,0.3))
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '12px', // Slightly tighter padding
                boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.2)', // Softer inset shadow
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                transition: 'border-color 0.2s ease',
              }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
              >
                {/* File References */}
                {fileReferences.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {fileReferences.map((file) => (
                      <div key={file.path} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '4px 8px',
                        background: 'rgba(255,255,255,0.05)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        color: colors.textSecondary,
                        border: '1px solid rgba(255,255,255,0.05)',
                      }}>
                        {file.isImage ? <ImageIcon size={12} /> : <FileText size={12} />}
                        <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </span>
                        <button onClick={() => removeFileReference(file.path)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Textarea */}
                <div style={{ position: 'relative' }}>
                  <textarea
                    ref={instructionInputRef}
                    autoFocus
                    rows={events.length > 0 ? 2 : 3}
                    disabled={isProcessing}
                    value={instruction}
                    onChange={!isProcessing ? handleInstructionChange : undefined}
                    onKeyDown={!isProcessing ? handleInstructionKeyDown : undefined}
                    placeholder={isProcessing ? "Processing..." : mode === 'add' ? "Describe what to add... (Use @ to reference files)" : "Describe your change... (Use @ to reference files, ⌘C to add more)"}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: colors.textPrimary,
                      fontSize: '15px',
                      fontFamily: 'system-ui, sans-serif',
                      lineHeight: 1.5,
                      resize: 'none',
                      opacity: isProcessing ? 0.5 : 1,
                      minHeight: '80px', // Taller input area (was 60px)
                    }}
                  />

                  {/* @ Autocomplete */}
                  {showFileSearch && fileSearchResults.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      right: 0,
                      maxHeight: '200px',
                      overflowY: 'auto',
                      background: '#1C1C1C',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      marginBottom: '8px',
                      boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                      zIndex: 100,
                    }}>
                      {fileSearchResults.map((file, idx) => (
                        <div
                          key={file.path}
                          onClick={() => selectFileReference(file)}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: idx === fileSearchIndex ? 'rgba(255,255,255,0.05)' : 'transparent',
                          }}
                        >
                          {file.isImage ? <ImageIcon size={14} /> : <FileText size={14} />}
                          <div style={{ flex: 1, overflow: 'hidden' }}>
                            <div style={{ fontSize: '13px', color: colors.textPrimary }}>{file.name}</div>
                            <div style={{ fontSize: '11px', color: colors.textTertiary }}>{file.path}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {/* Attach Button (Icon Only - Subtle) */}
                    <label style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '32px', height: '32px', // Fixed square size
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      color: colors.textSecondary, // Subtle color
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    >
                      <Paperclip size={16} style={{ opacity: 0.7 }} />
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          files.forEach(file => handleImageUpload(file));
                          e.target.value = '';
                        }}
                      />
                    </label>

                    {/* Model Selector (No Label, Consistent Height) */}
                    <div style={{ height: '32px' }}>
                      <Dropdown
                        label=""
                        value={model}
                        options={MODELS}
                        onChange={setModel}
                        disabled={isProcessing}
                      />
                    </div>
                  </div>

                  {/* The Gem Button */}
                  <button
                    onClick={sendCommand}
                    disabled={!instruction.trim() || isProcessing}
                    style={{
                      background: instruction.trim()
                        ? `linear-gradient(135deg, ${colors.brand} 0%, #A855F7 100%)`
                        : 'rgba(255,255,255,0.05)',
                      border: 'none',
                      borderRadius: '8px', // Match other buttons
                      width: '32px', // Match height
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: instruction.trim() ? 'pointer' : 'not-allowed',
                      color: instruction.trim() ? '#FFF' : 'rgba(255,255,255,0.2)',
                      boxShadow: instruction.trim() ? `0 0 20px ${colors.brandGlow}` : 'none',
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      transform: instruction.trim() ? 'scale(1)' : 'scale(0.95)',
                    }}
                    onMouseEnter={e => instruction.trim() && (e.currentTarget.style.transform = 'scale(1.05)')}
                    onMouseLeave={e => instruction.trim() && (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    {isProcessing ? (
                      <div style={{
                        width: '14px', height: '14px', borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#FFF',
                        animation: 'spin 1s linear infinite',
                      }} />
                    ) : (
                      <ArrowUp size={18} strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Completed State Actions */}
            {isComplete && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  onClick={handleRevert}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    color: colors.textSecondary,
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Undo
                </button>
                <button
                  onClick={handleKeep}
                  style={{
                    background: colors.success,
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    color: '#000',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: `0 0 15px ${colors.successSoft}`,
                  }}
                >
                  Accept
                </button>
              </div>
            )}
          </div>
        </TitaniumShell>
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
