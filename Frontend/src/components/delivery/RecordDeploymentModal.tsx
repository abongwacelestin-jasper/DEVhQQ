import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { InlineError } from '../engineering/states';
import { api } from '../../api/client';
import type { ApiDeployment } from '../../api/types';
import { useAuth } from '../../contexts/AuthContext';
import { products } from '../../data/portfolio';
import type { ProductId } from '../../types/portfolio';

/**
 * Records a deployment request (`POST /api/deployments`). Production records
 * start as awaiting-approval on the server; the provider still executes.
 */
export function RecordDeploymentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { canSeeProduct } = useAuth();
  const visible = useMemo(() => products.filter((p) => canSeeProduct(p.id)), [canSeeProduct]);
  const [product, setProduct] = useState<ProductId | ''>('');
  const [env, setEnv] = useState<'staging' | 'production'>('staging');
  const [version, setVersion] = useState('');
  const [sha, setSha] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const shaHint = useId();

  useEffect(() => {
    if (open) {
      setError(null);
      setProduct((p) => p || visible[0]?.id || '');
    }
  }, [open, visible]);

  const shaOk = /^[0-9a-f]{7,40}$/.test(sha);
  const versionOk = /^[\w.-]{1,40}$/.test(version);
  const valid = !!product && shaOk && versionOk;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<ApiDeployment>('/api/deployments', {
        method: 'POST',
        body: { product, env, version, sha },
      });
      onClose();
      setVersion('');
      setSha('');
      navigate(`/deployments/${created.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record deployment"
      description="Production requests wait for approval by someone else (two-person rule)."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="record-deploy" disabled={!valid || busy}>
            {busy ? 'Recording…' : 'Record'}
          </Button>
        </>
      }
    >
      <form id="record-deploy" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Product">
          <select
            className={inputClass}
            value={product}
            onChange={(e) => setProduct(e.target.value as ProductId)}
            required
          >
            {visible.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Environment">
          <select
            className={inputClass}
            value={env}
            onChange={(e) => setEnv(e.target.value as 'staging' | 'production')}
          >
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </Field>
        <Field label="Version" hint="Letters, digits, dot, dash, underscore">
          <input
            className={inputClass}
            value={version}
            onChange={(e) => setVersion(e.target.value.trim())}
            placeholder="v2.4.0"
            required
            aria-invalid={!!version && !versionOk}
          />
        </Field>
        <Field label="Commit SHA">
          <input
            className={`${inputClass} font-mono`}
            value={sha}
            onChange={(e) => setSha(e.target.value.trim().toLowerCase())}
            placeholder="a91e3f0"
            required
            aria-invalid={!!sha && !shaOk}
            aria-describedby={shaHint}
          />
          <span
            id={shaHint}
            className={`mt-1 block text-[11px] ${sha && !shaOk ? 'text-bad' : 'text-muted'}`}
          >
            7–40 lowercase hex characters
          </span>
        </Field>
      </form>
      <InlineError error={error} />
    </Modal>
  );
}
