import { Panel } from '../../components/ui/Panel';
import { DeploymentsTable } from '../../components/delivery/DeploymentsTable';
import { EnvironmentPipeline } from '../../components/delivery/EnvironmentPipeline';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useProductTab, textMatch } from '../../hooks/useProductTab';
import { useDeployments } from '../../hooks/useDeployments';
import { environments } from '../../data/operations';
import { parseWhen } from '../../utils/date';

export function ProductDeployments() {
  const { product, filters } = useProductTab();
  const { inRange, label } = useDateRange();
  const { deployments } = useDeployments();
  const rows = deployments.filter(
    (d) =>
      d.product === product.id &&
      inRange(parseWhen(d.ago)) &&
      textMatch(filters.q, d.sha, d.message, d.env) &&
      (!filters.person || d.author === filters.person) &&
      (!filters.status || d.status === filters.status),
  );
  return (
    <div className="space-y-3.5">
      <Panel title="Environments">
        <div className="p-2.5">
          <EnvironmentPipeline lanes={environments.filter((e) => e.product === product.id)} />
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
        {rows.length === 0 ? (
          <p className="px-3.5 py-4 text-[12.5px] text-muted">No deployments in this range.</p>
        ) : (
          <DeploymentsTable rows={rows} showProvider />
        )}
      </Panel>
    </div>
  );
}
