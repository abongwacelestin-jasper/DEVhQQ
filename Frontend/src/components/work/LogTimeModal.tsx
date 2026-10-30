import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useWork } from '../../contexts/WorkContext';
import { formatMinutes } from '../../utils/taskEvents';

const quick = [30, 60, 120, 240];

export function LogTimeModal({
  taskKey,
  onClose,
}: {
  taskKey: string | null;
  onClose: () => void;
}) {
  const { logTime } = useWork();
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (taskKey) {
      setHours(1);
      setMinutes(0);
      setNote('');
    }
  }, [taskKey]);

  const total = hours * 60 + minutes;
  const save = () => {
    if (!taskKey || total <= 0) return;
    logTime(taskKey, total, note.trim() || undefined);
    toast.success(`Logged ${formatMinutes(total)} on ${taskKey}`);
    onClose();
  };

  return (
    <Modal
      open={taskKey !== null}
      onClose={onClose}
      title={`Log time · ${taskKey ?? ''}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={total <= 0 || total > 16 * 60} onClick={save}>
            Log {total > 0 ? formatMinutes(total) : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q}
            onClick={() => {
              setHours(Math.floor(q / 60));
              setMinutes(q % 60);
            }}
            className={`h-7 rounded-md border px-2.5 text-[12px] font-medium transition-colors duration-150 ${total === q ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink hover:border-line-strong'}`}
          >
            {formatMinutes(q)}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Hours">
          <input
            type="number"
            min={0}
            max={16}
            value={hours}
            onChange={(e) => setHours(Math.max(0, Number(e.target.value)))}
            className={inputClass}
          />
        </Field>
        <Field label="Minutes">
          <input
            type="number"
            min={0}
            max={59}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Math.min(59, Math.max(0, Number(e.target.value))))}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="What did you work on?" className="mt-3">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note"
          className={inputClass}
        />
      </Field>
      {total > 16 * 60 && (
        <p className="mt-2 text-[12px] text-bad">A single entry can’t exceed 16 hours.</p>
      )}
    </Modal>
  );
}
