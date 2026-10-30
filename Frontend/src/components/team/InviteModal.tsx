import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ShieldAlertIcon, XIcon } from 'lucide-react';
import { ProductMark } from '../ui/ProductMark';
import { products } from '../../data/portfolio';
import { roles } from '../../data/team';
import type { ProductId } from '../../types/portfolio';
import type { RoleName } from '../../types/team';

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
}

export function InviteModal({ open, onClose }: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleName>('Developer');
  const [access, setAccess] = useState<ProductId[]>(['renewberry']);
  const [prod, setProd] = useState(false);
  const [error, setError] = useState('');
  const prodAllowed = role === 'Operations' || role === 'Owner';

  const toggle = (id: ProductId) =>
    setAccess((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid work email.');
    if (access.length === 0) return setError('Choose at least one product.');
    toast.success(`Invite sent to ${email}`, {
      description: `${role} · ${access.length} product${access.length > 1 ? 's' : ''}${prod && prodAllowed ? ' · production access' : ''}`,
    });
    setEmail('');
    setError('');
    onClose();
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
            onClick={onClose}
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
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold text-ink">Invite a member</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted hover:bg-sunken"
                aria-label="Close"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </header>
            <div className="space-y-5 px-5 py-5">
              <label className="block">
                <span className="text-sm font-medium text-ink">Work email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@techorg.io"
                  className="mt-1.5 h-10 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-accent"
                />
              </label>

              <fieldset>
                <legend className="text-sm font-medium text-ink">Organization role</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {roles
                    .filter((r) => r.name !== 'Owner')
                    .map((r) => (
                      <label
                        key={r.name}
                        className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors duration-150 ${role === r.name ? 'border-ink bg-sunken/60 font-medium text-ink' : 'border-line text-muted hover:border-line-strong'}`}
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
                <p className="mt-1.5 text-xs text-subtle">
                  {roles.find((r) => r.name === role)?.summary}
                </p>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium text-ink">Product access</legend>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {products.map((p) => (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors duration-150 ${access.includes(p.id) ? 'border-ink text-ink' : 'border-line text-muted'}`}
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
              </fieldset>

              <div
                className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 ${prodAllowed ? 'border-line' : 'border-line bg-sunken/50'}`}
              >
                <ShieldAlertIcon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${prodAllowed ? 'text-warn' : 'text-subtle'}`}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink">Production access</p>
                  <p className="text-xs text-muted">
                    {prodAllowed
                      ? 'Granted explicitly, requires MFA, every action audited.'
                      : `Not available for ${role}s. Grant later through an access request.`}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prod && prodAllowed}
                  aria-label="Production access"
                  disabled={!prodAllowed}
                  onClick={() => setProd((v) => !v)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${prod && prodAllowed ? 'bg-accent' : 'bg-line-strong'}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${prod && prodAllowed ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                  />
                </button>
              </div>
              {error && (
                <p className="text-sm text-bad" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-sunken"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-9 rounded-lg bg-ink px-3 text-sm font-medium text-white hover:bg-ink/90"
              >
                Send invite
              </button>
            </footer>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
}
