import { Link, useNavigate } from 'react-router-dom';
import { ChevronRightIcon } from 'lucide-react';
import type { Deployment } from '../../types/operations';
import { ProductMark } from '../ui/ProductMark';
import { StatusBadge } from '../ui/StatusBadge';
import { Avatar } from '../ui/Avatar';
import { deployMeta, firstName, productById } from '../../utils/status';

export function DeploymentsTable({
  rows,
  showProvider = false,
}: {
  rows: Deployment[];
  showProvider?: boolean;
}) {
  const navigate = useNavigate();
  if (rows.length === 0) {
    return (
      <p className="px-3.5 py-8 text-center text-[12.5px] text-muted">
        No deployments match these filters.
      </p>
    );
  }
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-muted">
              <th className="px-3.5 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Env</th>
              <th className="px-3 py-2 font-medium">Commit</th>
              <th className="px-3 py-2 font-medium">By</th>
              {showProvider && (
                <th className="hidden px-3 py-2 font-medium xl:table-cell">Provider</th>
              )}
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3.5 py-2 text-right font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.id}
                onClick={() => navigate(`/deployments/${d.id}`)}
                className="cursor-pointer border-b border-line transition-colors duration-150 last:border-0 hover:bg-sunken/50"
              >
                <td className="whitespace-nowrap px-3.5 py-2">
                  <Link
                    to={`/deployments/${d.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 font-medium text-ink"
                  >
                    <ProductMark product={d.product} size="sm" />
                    {productById(d.product).name}
                  </Link>
                </td>
                <td className="px-3 py-2 capitalize text-muted">{d.env}</td>
                <td className="max-w-[240px] px-3 py-2">
                  <p className="truncate font-mono text-[11.5px]">
                    <span className="text-ink">{d.sha}</span>{' '}
                    <span className="text-muted">{d.message}</span>
                  </p>
                  {d.failedStep && (
                    <p className="text-[11.5px] text-bad">Failed at “{d.failedStep}”</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="flex items-center gap-1.5 text-muted">
                    <Avatar id={d.author} size="xs" />
                    {firstName(d.author)}
                  </span>
                </td>
                {showProvider && (
                  <td className="hidden whitespace-nowrap px-3 py-2 text-muted xl:table-cell">
                    {d.provider}
                  </td>
                )}
                <td className="px-3 py-2">
                  <StatusBadge {...deployMeta[d.status]} dot />
                </td>
                <td className="whitespace-nowrap px-3.5 py-2 text-right text-[11.5px] text-muted">
                  {d.ago}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((d) => (
          <li key={d.id}>
            <Link
              to={`/deployments/${d.id}`}
              className="flex items-center gap-2.5 px-3.5 py-2.5 active:bg-sunken/60"
            >
              <ProductMark product={d.product} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <span className="font-medium text-ink">{productById(d.product).name}</span>
                  <span className="capitalize text-muted">· {d.env}</span>
                  <span className="ml-auto shrink-0 text-[11.5px] text-muted">{d.ago}</span>
                </div>
                <p className="truncate font-mono text-[11.5px] text-muted">
                  <span className="text-ink">{d.sha}</span> {d.message}
                </p>
                <div className="mt-1">
                  <StatusBadge {...deployMeta[d.status]} dot />
                </div>
              </div>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
