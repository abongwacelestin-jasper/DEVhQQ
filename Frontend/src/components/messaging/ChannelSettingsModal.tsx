import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { useMessaging } from '../../contexts/MessagingContext';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import { retentionOptions } from '../../data/messaging';
import { chatBackgrounds, chatBackgroundStyle } from '../../utils/chatBackground';
import type { Channel, ChannelPermissions } from '../../types/messaging';

type Tab = 'general' | 'background' | 'permissions' | 'danger';

/** Channel admins edit name, topic, background, permissions, and archive or leave. */
export function ChannelSettingsModal({
  channel,
  open,
  onClose,
}: {
  channel: Channel;
  open: boolean;
  onClose: () => void;
}) {
  const { updateChannel, leave, canModerate } = useMessaging();
  const { log } = useAuth();
  const { requestReauth } = useReauth();
  const [tab, setTab] = useState<Tab>('general');
  const [draft, setDraft] = useState(channel);
  const [confirm, setConfirm] = useState('');
  const mod = canModerate(channel);

  useEffect(() => {
    if (open) {
      setDraft(channel);
      setConfirm('');
    }
  }, [open, channel]);

  const setPerm = <K extends keyof ChannelPermissions>(k: K, v: ChannelPermissions[K]) =>
    setDraft((d) => ({ ...d, permissions: { ...d.permissions, [k]: v } }));

  const save = () => {
    const name = draft.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    if (channel.kind !== 'dm' && !name) return toast.error('Channel name is required');
    const permsChanged =
      JSON.stringify(draft.permissions) !== JSON.stringify(channel.permissions) ||
      draft.private !== channel.private;
    const apply = () => {
      updateChannel(channel.id, { ...draft, name: channel.kind === 'dm' ? channel.name : name });
      if (permsChanged) log('Changed channel permissions', `#${name}`, true);
      toast.success('Channel updated');
      onClose();
    };
    if (permsChanged)
      requestReauth({
        title: 'Change channel permissions',
        description: `Updates who can post and share in #${name}.`,
        actionLabel: 'Verify & save',
        onConfirm: apply,
      });
    else apply();
  };

  const toggles: { k: keyof ChannelPermissions; label: string; hint: string }[] = [
    { k: 'threads', label: 'Threads', hint: 'Reply to a message in a side thread' },
    { k: 'reactions', label: 'Reactions', hint: 'Emoji reactions on messages' },
    { k: 'files', label: 'File uploads', hint: 'Max 25 MB, malware-scanned, no executables' },
    { k: 'stickers', label: 'Stickers', hint: 'Cartoon stickers in the composer' },
    { k: 'externalLinks', label: 'External links', hint: 'Off blocks links outside the workspace' },
    {
      k: 'memberInvites',
      label: 'Members can invite',
      hint: 'Otherwise only channel admins add people',
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        channel.kind === 'dm' ? `Conversation with ${channel.name}` : `#${channel.name} settings`
      }
      description="Permission changes need MFA and are recorded in the audit log."
      size="lg"
      footer={
        tab !== 'danger' && (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!mod && tab !== 'background'}>
              Save changes
            </Button>
          </>
        )
      }
    >
      <Segmented
        label="Settings section"
        value={tab}
        onChange={setTab}
        className="mb-3"
        options={[
          { value: 'general', label: 'General' },
          { value: 'background', label: 'Background' },
          ...(channel.kind !== 'dm' ? [{ value: 'permissions' as Tab, label: 'Permissions' }] : []),
          { value: 'danger', label: channel.kind === 'dm' ? 'Close' : 'Archive & leave' },
        ]}
      />

      {!mod && tab !== 'background' && tab !== 'danger' && (
        <p className="mb-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12px] text-muted">
          Read-only — only channel admins can change these.
        </p>
      )}

      {tab === 'general' && (
        <fieldset disabled={!mod} className="space-y-3">
          {channel.kind !== 'dm' && (
            <Field label="Name" hint="Lowercase, numbers and dashes.">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputClass}
              />
            </Field>
          )}
          <Field label="Topic">
            <textarea
              value={draft.topic}
              onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
              rows={2}
              className={`${inputClass} h-auto py-1.5`}
            />
          </Field>
          {channel.kind !== 'dm' && (
            <label className="flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span>
                <span className="block text-[12.5px] font-medium text-ink">Private channel</span>
                <span className="text-[11.5px] text-muted">
                  Hidden from non-members and search.
                </span>
              </span>
              <input
                type="checkbox"
                checked={draft.private}
                onChange={(e) => setDraft({ ...draft, private: e.target.checked })}
                className="h-4 w-4 accent-[#0F1115]"
              />
            </label>
          )}
        </fieldset>
      )}

      {tab === 'background' && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {chatBackgrounds.map((b) => (
            <li key={b.id}>
              <button
                onClick={() => setDraft({ ...draft, background: b.id })}
                aria-pressed={draft.background === b.id}
                className={`w-full overflow-hidden rounded-lg border-2 text-left transition-colors duration-150 ${draft.background === b.id ? 'border-ink' : 'border-line hover:border-line-strong'}`}
              >
                <span className="block h-16 p-2" style={chatBackgroundStyle(b.id)}>
                  <span className="block h-3 w-3/4 rounded-full bg-white shadow-sm" />
                  <span className="ml-auto mt-1.5 block h-3 w-1/2 rounded-full bg-ink/80" />
                </span>
                <span className="block border-t border-line px-2 py-1 text-[12px] font-medium text-ink">
                  {b.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === 'permissions' && (
        <fieldset disabled={!mod} className="space-y-3">
          <Field label="Who can post">
            <Segmented
              label="Who can post"
              value={draft.permissions.post}
              onChange={(v) => setPerm('post', v)}
              options={[
                { value: 'everyone', label: 'Everyone' },
                { value: 'members', label: 'Members' },
                { value: 'admins', label: 'Admins only' },
              ]}
            />
          </Field>
          <ul className="divide-y divide-line rounded-md border border-line">
            {toggles.map((t) => (
              <li key={t.k}>
                <label className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="block text-[12.5px] font-medium text-ink">{t.label}</span>
                    <span className="text-[11.5px] text-muted">{t.hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.permissions[t.k] as boolean}
                    onChange={(e) => setPerm(t.k, e.target.checked as never)}
                    className="h-4 w-4 accent-[#0F1115]"
                  />
                </label>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="@channel notifications">
              <select
                value={draft.permissions.mentionAll}
                onChange={(e) =>
                  setPerm('mentionAll', e.target.value as ChannelPermissions['mentionAll'])
                }
                className={inputClass}
              >
                <option value="admins">Admins only</option>
                <option value="everyone">Everyone</option>
              </select>
            </Field>
            <Field label="Message retention" hint="Older messages are permanently deleted.">
              <select
                value={draft.permissions.retentionDays}
                onChange={(e) => setPerm('retentionDays', Number(e.target.value))}
                className={inputClass}
              >
                {retentionOptions.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>
      )}

      {tab === 'danger' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
            <span>
              <span className="block text-[12.5px] font-semibold text-ink">
                {channel.kind === 'dm' ? 'Hide conversation' : 'Leave channel'}
              </span>
              <span className="text-[11.5px] text-muted">
                You’ll stop receiving messages. History stays for other members.
              </span>
            </span>
            <Button
              size="sm"
              onClick={() => {
                leave(channel.id);
                toast('Left conversation');
                onClose();
              }}
            >
              Leave
            </Button>
          </div>
          {mod && channel.kind !== 'dm' && (
            <div className="rounded-md border border-bad/30 bg-bad-soft/40 px-3 py-2.5">
              <p className="text-[12.5px] font-semibold text-bad">Archive #{channel.name}</p>
              <p className="text-[11.5px] text-muted">
                Read-only for everyone. Type the channel name to confirm.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={channel.name}
                  className={inputClass}
                  aria-label="Confirm channel name"
                />
                <Button
                  variant="danger"
                  disabled={confirm !== channel.name}
                  onClick={() =>
                    requestReauth({
                      title: `Archive #${channel.name}`,
                      description: 'Members keep read access; nobody can post.',
                      actionLabel: 'Verify & archive',
                      onConfirm: () => {
                        updateChannel(channel.id, { archived: true });
                        log('Archived channel', `#${channel.name}`, true);
                        toast.success(`#${channel.name} archived`);
                        onClose();
                      },
                    })
                  }
                >
                  Archive
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
