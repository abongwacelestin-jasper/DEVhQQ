import React from 'react';
import { Link } from 'react-router-dom';
import {
  CheckIcon,
  FileIcon,
  LockIcon,
  PinIcon,
  SettingsIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Segmented } from '../ui/Segmented';
import { MessageItem, formatSize } from './MessageItem';
import { Composer } from './Composer';
import { useMessaging } from '../../contexts/MessagingContext';
import { memberById } from '../../utils/status';
import { formatDateTime } from '../../utils/date';
import type { Channel } from '../../types/messaging';

export type RailTab = 'about' | 'pinned' | 'files' | 'thread';

interface ChatRailProps {
  channel: Channel;
  tab: RailTab;
  onTab: (t: RailTab) => void;
  threadId: string | null;
  onThread: (id: string | null) => void;
  onSettings: () => void;
  onClose: () => void;
}

/** Right rail: channel details, permissions, pinned items, shared files and the open thread. */
export function ChatRail({
  channel,
  tab,
  onTab,
  threadId,
  onThread,
  onSettings,
  onClose,
}: ChatRailProps) {
  const { messages, canModerate } = useMessaging();
  const inChannel = messages.filter((m) => m.channelId === channel.id && !m.deleted);
  const pinned = inChannel.filter((m) => m.pinned);
  const files = inChannel.filter((m) => m.kind === 'file' || m.kind === 'code');
  const root = threadId ? messages.find((m) => m.id === threadId) : undefined;
  const replies = threadId ? inChannel.filter((m) => m.threadOf === threadId) : [];
  const p = channel.permissions;

  const rules: [string, boolean | string][] = [
    [
      'Who can post',
      p.post === 'admins' ? 'Admins only' : p.post === 'members' ? 'Members' : 'Everyone',
    ],
    ['Threads', p.threads],
    ['Reactions', p.reactions],
    ['Files', p.files],
    ['Stickers', p.stickers],
    ['External links', p.externalLinks],
    ['@channel', p.mentionAll === 'admins' ? 'Admins only' : 'Everyone'],
    ['Retention', `${p.retentionDays} days`],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Segmented
          label="Details"
          value={tab}
          onChange={onTab}
          options={[
            { value: 'about', label: 'About' },
            { value: 'pinned', label: 'Pinned', count: pinned.length },
            { value: 'files', label: 'Files', count: files.length },
            ...(root ? [{ value: 'thread' as RailTab, label: 'Thread' }] : []),
          ]}
        />

        <button
          onClick={onClose}
          className="ml-auto rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
          aria-label="Close details"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === 'about' && (
          <div className="space-y-3 p-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">
                {channel.kind === 'dm' ? channel.name : `#${channel.name}`}
              </p>
              {channel.topic && <p className="mt-0.5 text-[12px] text-muted">{channel.topic}</p>}
              <p className="mt-1 text-[11px] text-muted">
                Created by {memberById(channel.createdBy).name} ·{' '}
                {formatDateTime(new Date(channel.createdAt))}
              </p>
            </div>
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="flex items-center gap-1 text-[11.5px] font-semibold text-ink">
                  <ShieldCheckIcon className="h-3.5 w-3.5 text-ok" /> Permissions
                </h3>
                {canModerate(channel) && (
                  <button
                    onClick={onSettings}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
                  >
                    <SettingsIcon className="h-3 w-3" /> Edit
                  </button>
                )}
              </div>
              <dl className="divide-y divide-line rounded-md border border-line">
                {rules.map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between px-2.5 py-1 text-[12px]"
                  >
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-medium text-ink">
                      {typeof v === 'boolean' ? (
                        v ? (
                          <CheckIcon className="h-3.5 w-3.5 text-ok" aria-label="Allowed" />
                        ) : (
                          <LockIcon className="h-3.5 w-3.5 text-muted" aria-label="Off" />
                        )
                      ) : (
                        v
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3 className="mb-1 text-[11.5px] font-semibold text-ink">
                Members · {channel.members.length}
              </h3>
              <ul className="space-y-0.5">
                {channel.members.map((id) => {
                  const m = memberById(id);
                  return (
                    <li key={id}>
                      <Link
                        to={`/team/${id}`}
                        className="flex items-center gap-2 rounded px-1 py-1 hover:bg-sunken"
                      >
                        <span className="relative">
                          <Avatar id={id} size="sm" />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-white ${m.lastActive === 'Now' || /^\d+m$/.test(m.lastActive) ? 'bg-ok' : 'bg-line-strong'}`}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                          {m.name}
                        </span>
                        {channel.admins.includes(id) && (
                          <span className="rounded bg-sunken px-1 text-[10.5px] font-semibold text-ink">
                            Admin
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}

        {tab === 'pinned' && (
          <div className="p-2">
            {pinned.length === 0 ? (
              <Empty icon={PinIcon} text="Nothing pinned yet. Admins can pin important messages." />
            ) : (
              pinned.map((m) => <MessageItem key={m.id} message={m} channel={channel} />)
            )}
          </div>
        )}

        {tab === 'files' && (
          <ul className="divide-y divide-line">
            {files.length === 0 && (
              <Empty
                icon={FileIcon}
                text="Files and snippets shared here will collect in this tab."
              />
            )}
            {files.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-sunken font-mono text-[10px] font-bold text-ink">
                  {m.kind === 'code' ? m.code?.lang : (m.file?.name.split('.').pop() ?? 'file')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {m.kind === 'code'
                      ? `Snippet · ${m.code?.content.split('\n')[0]}`
                      : m.file?.name}
                  </span>
                  <span className="text-[11px] text-muted">
                    {memberById(m.author).name} ·{' '}
                    {m.file
                      ? formatSize(m.file.size)
                      : `${m.code?.content.split('\n').length} lines`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {tab === 'thread' && root && (
          <div className="flex min-h-full flex-col">
            <div className="border-b border-line p-2">
              <MessageItem message={root} channel={channel} />
            </div>
            <p className="px-3 pt-2 text-[11px] font-semibold text-muted">
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </p>
            <div className="flex-1 p-2">
              {replies.map((m) => (
                <MessageItem key={m.id} message={m} channel={channel} />
              ))}
            </div>
          </div>
        )}
      </div>
      {tab === 'thread' && root && channel.permissions.threads && (
        <Composer
          channel={{
            ...channel,
            permissions: {
              ...channel.permissions,
              post: channel.permissions.post === 'admins' ? 'members' : channel.permissions.post,
            },
          }}
          threadOf={root.id}
          compact
        />
      )}
      {tab === 'thread' && root && (
        <button
          onClick={() => {
            onThread(null);
            onTab('about');
          }}
          className="border-t border-line py-1.5 text-[11.5px] font-medium text-muted hover:text-ink"
        >
          Close thread
        </button>
      )}
    </div>
  );
}

function Empty({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <Icon className="h-5 w-5 text-muted" />
      <p className="mt-2 text-[12px] text-muted">{text}</p>
    </div>
  );
}
