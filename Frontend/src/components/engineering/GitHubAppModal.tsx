import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConnectRepoIllustration } from './ConnectRepoIllustration';
import { InlineError } from './states';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import type { ApiRepo } from './data/types';
import type { ProductId } from '../../types/portfolio';

interface GitHubAppModalProps {
  open: boolean;
  onClose: () => void;
  onLink: (body: { name: string; product: ProductId }) => Promise<ApiRepo>;
}

const NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Link a repository the GitHub App can already see to a TavetaHQ product
 * (`POST /api/repos`). Granting the app access to the repository happens on
 * GitHub; the server rejects names the installation can't read.
 */
export function GitHubAppModal({ open, onClose, onLink }: GitHubAppModalProps) {
  const { allowedProducts } = useProductFilter();
  const [name, setName] = useState('');
  const [product, setProduct] = useState<ProductId | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setProduct(allowedProducts[0]?.id ?? '');
    setError(null);
    setBusy(false);
  }, [open, allowedProducts]);

  const valid = NAME.test(name.trim()) && !!product;

  const submit = async () => {
    if (!valid || !product) return;
    setBusy(true);
    setError(null);
    try {
      const repo = await onLink({ name: name.trim(), product });
      toast.success(`${repo.name} linked`, {
        description: 'Commits, pull requests and checks appear as GitHub sends them.',
      });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link a repository"
      description="TavetaHQ reads from GitHub. GitHub stays authoritative for code, reviews and branch rules."
      illustration={<ConnectRepoIllustration />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || busy}>
            {busy ? 'Linking…' : 'Link repository'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Repository"
          hint="owner/name — the GitHub App must already have access to it."
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="techorg/renewberry-api"
            aria-invalid={!!name && !NAME.test(name.trim())}
            className={`${inputClass} font-mono`}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          label="Product"
          hint="Only members with access to this product will see the repository."
        >
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value as ProductId)}
            className={inputClass}
          >
            {allowedProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <InlineError error={error} />
      </form>
    </Modal>
  );
}
