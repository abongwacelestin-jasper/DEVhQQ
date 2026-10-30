import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Modal } from '../ui/Modal';
import type { EmailPrefs } from '../../hooks/useAssignmentEmails';

interface EmailSettingsModalProps {
  open: boolean;
  onClose: () => void;
  prefs: EmailPrefs;
  email: string;
  onSave: (p: EmailPrefs) => void;
  onTest: () => void;
}

export function EmailSettingsModal({
  open,
  onClose,
  prefs,
  email,
  onSave,
  onTest,
}: EmailSettingsModalProps) {
  const [draft, setDraft] = useState(prefs);
  useEffect(() => {
    if (open) setDraft(prefs);
  }, [open, prefs]);

  const save = () => {
    onSave(draft);
    toast.success('Email preferences saved');
    onClose();
  };

  const rows: { key: keyof Omit<EmailPrefs, 'mode'>; label: string; hint: string }[] = [
    { key: 'onAssign', label: 'A task is assigned to me', hint: 'Includes tasks created for you' },
    { key: 'onUnassign', label: 'A task is moved off me', hint: 'So handovers never surprise you' },
    { key: 'onDue', label: 'My task is due tomorrow', hint: 'One reminder, the day before' },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Email notifications"
      description={`Sent to ${email}. In-app notifications always stay on.`}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <button
            onClick={onTest}
            disabled={draft.mode === 'off'}
            className="text-[12.5px] font-medium text-accent hover:underline disabled:text-muted disabled:no-underline"
          >
            Send test email
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-8 rounded-md border border-line-strong px-3 text-[12.5px] font-medium text-ink hover:bg-sunken/60"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="h-8 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-white hover:bg-ink/90"
            >
              Save
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-[12px] font-semibold text-ink">Delivery</p>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Delivery">
            {(
              [
                ['instant', 'Instant'],
                ['daily', 'Daily digest'],
                ['off', 'Off'],
              ] as const
            ).map(([m, l]) => (
              <button
                key={m}
                role="radio"
                aria-checked={draft.mode === m}
                onClick={() => setDraft({ ...draft, mode: m })}
                className={`h-8 rounded-md border text-[12px] font-medium ${draft.mode === m ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink hover:bg-sunken/60'}`}
              >
                {l}
              </button>
            ))}
          </div>
          {draft.mode === 'daily' && (
            <p className="mt-1.5 text-[11.5px] text-muted">
              One email at 08:00 in your timezone with everything from the last day.
            </p>
          )}
        </div>
        <fieldset
          disabled={draft.mode === 'off'}
          className="divide-y divide-line rounded-lg border border-line disabled:opacity-50"
        >
          {rows.map((r) => (
            <label key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="block text-[12.5px] font-medium text-ink">{r.label}</span>
                <span className="block text-[11.5px] text-muted">{r.hint}</span>
              </span>
              <input
                type="checkbox"
                checked={draft[r.key]}
                onChange={(e) => setDraft({ ...draft, [r.key]: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#0F1115]"
              />
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}
