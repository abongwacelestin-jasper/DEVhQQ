import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckIcon, CopyIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { ProductMark } from '../ui/ProductMark';
import { api } from '../../api/client';
import type { ApiMember, ApiProduct } from '../../api/types';
import { useProductCatalogue } from '../../hooks/useProductCatalogue';
import { products as seedProducts } from '../../data/portfolio';
import { roles } from '../../data/team';
import type { ProductId } from '../../types/portfolio';
import type { RoleName } from '../../types/team';

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after the server has created the invited member, so the page can resync. */
  onInvited?: () => Promise<void> | void;
}

/** Roles that can be handed out by invite — Owner is transferred, never granted. */
const invitableRoles = roles.filter((r) => r.name !== 'Owner');

export function InviteModal({ open, onClose, onInvited }: InviteModalProps) {
  const catalogue = useProductCatalogue();
  const products = catalogue.length
    ? catalogue.map((p) => ({ id: p.id as ProductId, name: p.name }))
    : seedProducts.map((p) => ({ id: p.id, name: p.name }));

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<RoleName>('Developer');
  const [access, setAccess] = useState<ProductId[]>(['renewberry']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set once the server has created the invite: the link is only shown here, once.
  const [created, setCreated] = useState<{ email: string; link: string; expires: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const toggle = (id: ProductId) =>
    setAccess((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const close = () => {
    setCreated(null);
    setCopied(false);
    setError('');
    onClose();
  };

  const copyLink = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${created.link}`);
      setCopied(true);
      toast.success('Invite link copied');
    } catch {
      toast.error('Copy failed — select the link and copy it manually');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid work email.');
    if (access.length === 0) return setError('Choose at least one product.');

    setBusy(true);
    setError('');
    try {
      const invite = await api<ApiMember & { inviteLink: string; inviteExpiresAt: string }>(
        '/api/team/invites',
        {
          method: 'POST',
          body: {
            email: email.trim(),
            name: name.trim() || undefined,
            role,
            products: access as ApiProduct[],
          },
        },
      );
      await onInvited?.();
      setCreated({
        email: invite.email,
        link: invite.inviteLink,
        expires: invite.inviteExpiresAt,
      });
      toast.success(`Invite created for ${invite.email}`, {
        description: `${invite.role} · ${invite.products.length} product${invite.products.length > 1 ? 's' : ''} · pending acceptance`,
      });
      setEmail('');
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The invite could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-ink/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
          />
          <motion.form
            onSubmit={submit}
            role="dialog"
            aria-label="Invite member"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-lg rounded-t-2xl bg-surface shadow-pop sm:rounded-2xl"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold text-ink">
                {created ? 'Invite ready to send' : 'Invite a member'}
              </h2>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-1.5 text-muted hover:bg-sunken"
                aria-label="Close"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </header>
            <div className="space-y-4 px-5 py-4">
              {created ? (
                <>
                  <p className="text-[13px] text-muted">
                    The account for <b className="text-ink">{created.email}</b> is pending until
                    this link is opened and a password is set. There is no mail service connected,
                    so pass the link on yourself.
                  </p>
                  <label className="block">
                    <span className="text-[12.5px] font-medium text-ink">Accept invite link</span>
                    <input
                      readOnly
                      value={`${window.location.origin}${created.link}`}
                      onFocus={(e) => e.currentTarget.select()}
                      className="mt-1 h-9 w-full rounded-lg border border-line bg-sunken/40 px-2.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
                    />
                  </label>
                  <p className="text-[11.5px] text-subtle">
                    Expires {new Date(created.expires).toLocaleString()}. The link works once; after
                    activation the account signs in normally.
                  </p>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="text-[12.5px] font-medium text-ink">Work email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError('');
                      }}
                      placeholder="name@techorg.io"
                      className="mt-1 h-9 w-full rounded-lg border border-line px-2.5 text-[13px] outline-none focus:border-accent"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[12.5px] font-medium text-ink">
                      Full name <span className="font-normal text-subtle">· optional</span>
                    </span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Derived from the email if left blank"
                      className="mt-1 h-9 w-full rounded-lg border border-line px-2.5 text-[13px] outline-none focus:border-accent"
                    />
                  </label>

                  <fieldset>
                    <legend className="text-[12.5px] font-medium text-ink">
                      Organization role
                    </legend>
                    <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {invitableRoles.map((r) => (
                        <label
                          key={r.name}
                          className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors duration-150 ${role === r.name ? 'border-ink bg-sunken/60 font-medium text-ink' : 'border-line text-muted hover:border-line-strong'}`}
                        >
                          <input
                            type="radio"
                            name="role"
                            className="sr-only"
                            checked={role === r.name}
                            onChange={() => setRole(r.name)}
                          />
                          {r.name}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-subtle">
                      {invitableRoles.find((r) => r.name === role)?.summary}
                    </p>
                  </fieldset>

                  <fieldset>
                    <legend className="text-[12.5px] font-medium text-ink">Product access</legend>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {products.map((p) => (
                        <label
                          key={p.id}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors duration-150 ${access.includes(p.id) ? 'border-ink text-ink' : 'border-line text-muted'}`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={access.includes(p.id)}
                            onChange={() => toggle(p.id)}
                          />
                          <ProductMark product={p.id} size="sm" />
                          {p.name}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-subtle">
                      Production access is never granted by invite — it is requested just in time.
                    </p>
                  </fieldset>

                  {error && (
                    <p className="text-[12.5px] text-bad" role="alert">
                      {error}
                    </p>
                  )}
                </>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
              {created ? (
                <>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] font-medium text-ink hover:bg-sunken"
                  >
                    {copied ? (
                      <CheckIcon className="h-3.5 w-3.5 text-ok" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" />
                    )}
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="h-8 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white hover:bg-ink/90"
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={close}
                    className="h-8 rounded-lg border border-line px-3 text-[12.5px] font-medium text-ink hover:bg-sunken"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white hover:bg-ink/90 disabled:opacity-60"
                  >
                    {busy && <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />}
                    {busy ? 'Creating…' : 'Create invite'}
                  </button>
                </>
              )}
            </footer>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
}
