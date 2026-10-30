import React from 'react';
import {
  BookOpenIcon,
  ClipboardListIcon,
  FileCodeIcon,
  GitForkIcon,
  HandshakeIcon,
  UsersIcon,
} from 'lucide-react';
import type { DocKind } from '../../types/docs';

const icons: Record<DocKind, React.ComponentType<{ className?: string }>> = {
  spec: FileCodeIcon,
  runbook: ClipboardListIcon,
  meeting: UsersIcon,
  decision: GitForkIcon,
  guide: BookOpenIcon,
  handover: HandshakeIcon,
};

const tint: Record<DocKind, string> = {
  spec: 'text-accent',
  runbook: 'text-bad',
  meeting: 'text-muted',
  decision: 'text-warn',
  guide: 'text-ok',
  handover: 'text-info',
};

export function DocKindIcon({
  kind,
  className = 'h-3.5 w-3.5',
}: {
  kind: DocKind;
  className?: string;
}) {
  const Icon = icons[kind];
  return <Icon className={`${className} shrink-0 ${tint[kind]}`} />;
}
