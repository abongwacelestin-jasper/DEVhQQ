import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckIcon } from 'lucide-react';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Avatar } from '../ui/Avatar';
import { ChatIllustration } from '../illustrations/ChatIllustration';
import { useMessaging } from '../../contexts/MessagingContext';
import { useAuth } from '../../contexts/AuthContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { defaultPermissions } from '../../data/messaging';
import { members } from '../../data/team';
import type { ChannelKind } from '../../types/messaging';
import type { ProductId } from '../../types/portfolio';

type Mode = 'dm' | 'channel';

export function NewChannelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createChannel, visible } = useMessaging();
  const { session, canDo } = useAuth();
  const { allowedProducts } = useProductFilter();
  const navigate = useNavigate();
  const me = session?.memberId ?? 'm1';
  const canCreate = canDo('channel:create');
  const [mode, setMode] = useState<Mode>('dm');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<ChannelKind>('channel');
  const [product, setProduct] = useState<ProductId | ''>('');
  const [priv, setPriv] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (open) {
      setMode('dm');
      setName('');
      setTopic('');
      setPicked([]);
      setQ('');
      setPriv(false);
      setProduct('');
      setKind('channel');
    }
  }, [open]);

  const people = members.filter(
    (m) => m.id !== me && m.status === 'active' && m.name.toLowerCase().includes(q.toLowerCase()),
  );
  const toggle = (id: string) =>
    setPicked((l) =>
      l.includes(id) ? l.filter((x) => x !== id) : mode === 'dm' ? [id] : [...l, id],
    );

  const create = () => {
    if (mode === 'dm') {
      const peer = picked[0];
      if (!peer) return;
      const existing = visible.find(
        (c) =>
          c.kind === 'dm' &&
          c.members.length === 2 &&
          c.members.includes(me) &&
          c.members.includes(peer),
      );
      if (existing) {
        navigate(`/messages/${existing.id}`);
        return onClose();
      }
      const peerM = members.find((m) => m.id === peer)!;
      const ch = createChannel({
        name: peerM.name,
        kind: 'dm',
        topic: '',
        members: [me, peer],
        admins: [],
        private: true,
        background: 'plain',
        permissions: { ...defaultPermissions },
      });
      navigate(`/messages/${ch.id}`);
      return onClose();
    }
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug) return toast.error('Give the channel a name');
    if (visible.some((c) => c.name === slug)) return toast.error(`#${slug} already exists`);
    const ch = createChannel({
      name: slug,
      kind,
      topic: topic.trim(),
      product: product || undefined,
      members: [me, ...picked],
      admins: [me],
      private: priv,
      background: kind === 'project' ? 'dots' : 'plain',
      permissions: { ...defaultPermissions },
    });
    toast.success(`#${slug} created`);
    navigate(`/messages/${ch.id}`);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New conversation"
      description="Direct messages are always private. Channels follow workspace permissions."
      illustration={<ChatIllustration className="h-14 w-auto" />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={create}
            disabled={mode === 'dm' ? picked.length === 0 : !name.trim()}
          >
            {mode === 'dm' ? 'Open conversation' : 'Create channel'}
          </Button>
        </>
      }
    >
      <Segmented
        label="Conversation type"
        value={mode}
        onChange={(v) => {
          setMode(v);
          setPicked([]);
        }}
        className="mb-3"
        options={[
          { value: 'dm', label: 'Direct message' },
          ...(canCreate ? [{ value: 'channel' as Mode, label: 'Channel' }] : []),
        ]}
      />

      {mode === 'channel' && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. mirror-beta"
              className={inputClass}
            />
          </Field>
          <Field label="Type">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ChannelKind)}
              className={inputClass}
            >
              <option value="channel">Team channel</option>
              <option value="project">Project channel</option>
              {canDo('channel:moderate') && <option value="announcement">Announcement</option>}
            </select>
          </Field>
          <Field label="Topic" className="sm:col-span-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What is this channel for?"
              className={inputClass}
            />
          </Field>
          <Field label="Product">
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value as ProductId | '')}
              className={inputClass}
            >
              <option value="">None</option>
              {allowedProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center justify-between rounded-md border border-line px-3 self-end h-8">
            <span className="text-[12.5px] font-medium text-ink">Private</span>
            <input
              type="checkbox"
              checked={priv}
              onChange={(e) => setPriv(e.target.checked)}
              className="h-4 w-4 accent-[#0F1115]"
            />
          </label>
        </div>
      )}
      <Field
        label={
          mode === 'dm' ? 'Who do you want to message?' : `Add people · ${picked.length} selected`
        }
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          className={inputClass}
        />
      </Field>
      <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line scroll-thin">
        {people.map((m) => {
          const on = picked.includes(m.id);
          return (
            <li key={m.id}>
              <button
                onClick={() => toggle(m.id)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${on ? 'bg-accent-soft/60' : 'hover:bg-sunken'}`}
              >
                <Avatar id={m.id} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {m.name} <span className="text-muted">· {m.role}</span>
                </span>
                {on && <CheckIcon className="h-4 w-4 text-accent" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
