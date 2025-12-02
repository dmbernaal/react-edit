import type { ModelOption, PromptTemplate } from './types';

export const DEBUG = process.env.NODE_ENV === 'development';
export const log = (...args: any[]) => DEBUG && console.log(...args);
export const API_BASE = 'http://localhost:3333';

export const MODELS: ModelOption[] = [
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

export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  designer: { id: 'designer', name: 'Designer', desc: 'Elite UI/UX focus', prompt: '' },
  minimal: { id: 'minimal', name: 'Minimal', desc: 'Smallest change', prompt: '' },
  engineer: { id: 'engineer', name: 'Engineer', desc: 'Clean code', prompt: '' },
  accessibility: { id: 'accessibility', name: 'A11y', desc: 'WCAG compliance', prompt: '' },
  custom: { id: 'custom', name: 'Custom', desc: 'Your prompt', prompt: '' }
};

export const colors = {
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
  addMode: '#06B6D4',
  addModeSoft: 'rgba(6,182,212,0.15)',
  addModeGlow: 'rgba(6,182,212,0.4)',
  editMode: '#34D399',
  editModeSoft: 'rgba(52,211,153,0.15)',
  editModeGlow: 'rgba(52,211,153,0.4)',
  accent: '#6F3BF5',
} as const;

