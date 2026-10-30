import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { FirefighterIllustration } from '../illustrations/FirefighterIllustration';
import { useIncidents } from '../../contexts/IncidentContext';
import { products } from '../../data/portfolio';
import { members } from '../../data/team';
import { monitors } from '../../data/operations';
import type { Incident } from '../../types/operations';
import type { ProductId } from '../../types/portfolio';

const severities: { value: Incident['severity']; label: string }[] = [
  { value: 'SEV1', label: 'SEV1 · outage' },
  { value: 'SEV2', label: 'SEV2 · major' },
  { value: 'SEV3', label: 'SEV3 · minor' },
];

const serviceSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function DeclareIncidentModal() {
  const { declareOpen, setDeclareOpen, declare } = useIncidents();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [product, setProduct] = useState<ProductId>('renewberry');
  const [service, setService] = useState('');
  const [severity, setSeverity] = useState<Incident['severity']>('SEV2');
  const [owner, setOwner] = useState('m11');
  const [impact, setImpact] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!declareOpen) return;
    setTitle('');
    setProduct('renewberry');
    setService(serviceSlug(monitors[0].name));
    setSeverity('SEV2');
    setOwner('m11');
    setImpact('');
    setError('');
  }, [declareOpen]);

  const services = monitors.filter((m) => m.product === product);
  const owners = members.filter(
    (m) =>
      m.status === 'active' &&
      m.products.includes(product) &&
      (m.role === 'Operations' || m.role === 'Developer' || m.role === 'Owner'),
  );
  const close = () => setDeclareOpen(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 5)
      return setError('Describe what’s broken in a few words — e.g. “Checkout returns 500s”.');
    if (impact.trim().length < 5)
      return setError('Say who or what is affected so responders can judge urgency.');
    let id: string;
    try {
      id = await declare({
        title: title.trim(),
        product,
        service,
        severity,
        owner,
        impact: impact.trim(),
      });
    } catch {
      setError('The incident could not be declared. Try again.');
      return;
    }
    close();
    toast.error(`${id} declared · ${severity}`, {
      description: 'Owner paged · recorded in the audit log.',
    });
    navigate(`/incidents/${id}`);
  };

  return (
    <Modal
      open={declareOpen}
      onClose={close}
      title="Declare an incident"
      description="Opens an incident, pages the owner and starts the timeline. Every step is recorded."
      size="lg"
      illustration={<FirefighterIllustration className="h-12 w-auto" />}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="danger" type="submit" form="declare-incident">
            Declare {severity}
          </Button>
        </>
      }
    >
      <form id="declare-incident" onSubmit={submit} className="space-y-3">
        <Field label="What’s happening?">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Checkout returns 500 errors"
            className={inputClass}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[12px] font-medium text-ink">Severity</span>
          <Segmented
            label="Severity"
            value={severity}
            onChange={setSeverity}
            options={severities}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Product">
            <select
              value={product}
              onChange={(e) => {
                const p = e.target.value as ProductId;
                setProduct(p);
                const first = monitors.find((m) => m.product === p);
                setService(first ? serviceSlug(first.name) : '');
              }}
              className={inputClass}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Affected service">
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className={inputClass}
            >
              {services.map((m) => (
                <option key={m.id} value={serviceSlug(m.name)}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Owner">
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={inputClass}>
              {owners.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.role}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Impact" hint="Who is affected and how. Shown at the top of the incident.">
          <textarea
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
            rows={3}
            placeholder="e.g. ~5% of checkout attempts fail in EU"
            className={`${inputClass} h-auto resize-none py-1.5`}
          />
        </Field>
        {severity === 'SEV1' && (
          <p className="rounded-md bg-bad-soft px-3 py-2 text-[12px] font-medium text-bad">
            SEV1 also pages the secondary on-call and the workspace Owner.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md bg-bad-soft px-3 py-2 text-[12px] font-medium text-bad"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
