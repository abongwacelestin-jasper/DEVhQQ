import type { ProductId } from './portfolio';

export type DocKind = 'spec' | 'runbook' | 'meeting' | 'decision' | 'guide' | 'handover';
export type DocStatus = 'draft' | 'in-review' | 'published';
export type DocVisibility = 'project' | 'workspace' | 'restricted';

export interface DocVersion {
  id: string;
  at: string;
  by: string;
  summary: string;
  body: string;
}

export interface DocComment {
  id: string;
  at: string;
  by: string;
  text: string;
  resolved?: boolean;
}

export interface ProjectDoc {
  id: string;
  projectId: string;
  product: ProductId;
  title: string;
  kind: DocKind;
  status: DocStatus;
  visibility: DocVisibility;
  /** Lightweight markdown: #, ##, -, [ ], [x], ``` code, > note. */
  body: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  versions: DocVersion[];
  comments: DocComment[];
  editors: string[];
}
