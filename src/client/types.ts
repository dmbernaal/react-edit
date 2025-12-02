export interface StreamEvent {
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

export interface RevisionStep {
  sessionId: string;
  instruction: string;
  summary: string;
  filesChanged: Array<{path: string; lines: number; isNew?: boolean}>;
}

export interface Target {
  fileName: string;
  lineNumber: number;
  componentName: string;
  elementText: string;
  elementTag: string;
  elementClasses: string;
  elementHTML: string;
  parentContext: string;
}

export interface DiffChange {
  value: string;
  added: boolean;
  removed: boolean;
}

export interface FileDiff {
  path: string;
  changes: DiffChange[];
  stats: {
    additions: number;
    deletions: number;
  };
}

export interface FileReference {
  path: string;
  name: string;
  isImage: boolean;
  previewUrl?: string;
}

export interface FileSearchResult {
  path: string;
  name: string;
  isImage: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
  desc: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  desc: string;
  prompt: string;
}

