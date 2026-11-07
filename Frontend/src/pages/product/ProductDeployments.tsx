import { Panel } from '../../components/ui/Panel';
import { DeploymentsTable } from '../../components/delivery/DeploymentsTable';
import { EnvironmentPipeline } from '../../components/delivery/EnvironmentPipeline';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useProductTab, textMatch } from '../../hooks/useProductTab';
import { useDeployments } from '../../hooks/useDeployments';
import { lanesFromDeployments } from '../../components/delivery/environments';
import { DataState } from '../../components/engineering/states';

export function ProductDeployments() {
  const { product, filters } = useProductTab();
  const { inRange, label } = useDateRange();
  const { deployments, loading, error, reload } = useDeployments();
  const rows = deployments.filter(
    (d) =>
      d.product === product.id &&
      inRange(new Date(d.createdAt)) &&
      textMatch(filters.q, d.sha, d.message, d.env) &&
      (!filters.person || d.author === filters.person) &&
      (!filters.status || d.status === filters.status),
  );
  return (
    <div className="space-y-3.5">
      <Panel title="Environments">
        <div className="p-2.5">
          <EnvironmentPipeline lanes={lanesFromDeployments(deployments, product.id)} />
        </div>
      </Panel>
      <Panel
        title="Deployment history"
        meta={
          <span>
            {label} · {rows.length}
          </span>
        }
      >
        {loading || (error && deployments.length === 0) ? (
          <div className="p-2.5">
            <DataState
              status={loading ? 'loading' : 'error'}
              error={error}
              what="Deployments"
              rows={3}
              onRetry={() => void reload()}
            />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-3.5 py-4 text-[12.5px] text-muted">No deployments in this range.</p>
        ) : (
          <DeploymentsTable rows={rows} showProvider />
        )}
      </Panel>
    </div>
  );
}
