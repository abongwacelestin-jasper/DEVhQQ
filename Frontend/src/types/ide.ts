export type IdeView = 'explorer' | 'search' | 'scm' | 'run';
export type PanelTab = 'problems' | 'output' | 'terminal';
export type GitStatus = 'M' | 'A' | 'D';
export type LineTone = 'ok' | 'bad' | 'muted' | 'cmd' | 'warn';

export interface ChangedFile {
  path: string;
  before: string;
  after: string;
  status: GitStatus;
}

export interface TermLine {
  id: number;
  text: string;
  tone?: LineTone;
}

export interface OutLine {
  text: string;
  tone?: LineTone;
}

export interface LintProblem {
  file: string;
  line: number;
  rule: string;
  preview: string;
  severity: 'error' | 'warning';
}

export interface IdeMarker {
  file: string;
  line: number;
  col: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  /** Marker owner: 'typescript', 'javascript', 'json' or 'devhq' (lint + secret scan). */
  source: string;
}

export interface IdeSettings {
  theme: 'dark' | 'light';
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  formatOnSave: boolean;
}

export interface IdeCommand {
  id: string;
  label: string;
  keys?: string;
  run: () => void;
}

export interface PickerItem {
  id: string;
  label: string;
  description?: string;
}

export interface Picker {
  placeholder: string;
  items?: PickerItem[];
  initial?: string;
  /** Lets the typed text be submitted when it doesn't match an item (e.g. a new branch name). */
  allowCreate?: boolean;
  onPick: (value: string) => void;
}

export interface RunResult {
  ok: boolean;
  ms: number;
  passed: number;
  failed: number;
}
