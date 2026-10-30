import { useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { JsonTree } from './JsonTree';
import { CommentThread } from './CommentThread';
import { Card, CopyButton, EmptyState, StatusCode, fmtBytes, fmtMs } from './ConsoleBits';
import type { ConsoleResponse } from '../../types/console';

type Tab = 'body' | 'headers' | 'raw' | 'comments';

interface ResponseViewerProps {
  response: ConsoleResponse | null;
  sending: boolean;
  /** Route-shaped thread key for inline comments; omit to hide the Comments tab. */
  thread?: string;
  me?: { id: string; name: string };
}

export function ResponseViewer({ response, sending, thread, me }: ResponseViewerProps) {
  const [tab, setTab] = useState<Tab>('body');
  const tabs: Tab[] =
    thread && me ? ['body', 'headers', 'raw', 'comments'] : ['body', 'headers', 'raw'];

  if (sending) {
    return (
      <Card title="Response">
        <EmptyState>
          <LoaderCircleIcon className="mx-auto mb-2 h-5 w-5 animate-spin text-subtle" />
          Waiting for response…
        </EmptyState>
      </Card>
    );
  }
  if (!response) {
    return (
      <Card title="Response">
        <EmptyState>
          Send a request to see status, timing, headers and a highlighted body.
        </EmptyState>
      </Card>
    );
  }

  const requestId = response.headers.find(([k]) => k === 'x-request-id')?.[1];
  const pretty = response.body !== null ? JSON.stringify(response.body, null, 2) : response.text;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2.5 text-[12px]">
        <StatusCode status={response.status} withText />
        <span className="font-mono tabular-nums text-muted">{fmtMs(response.ms)}</span>
        <span className="font-mono tabular-nums text-muted">{fmtBytes(response.size)}</span>
        {requestId && (
          <span className="ml-auto truncate font-mono text-[10.5px] text-subtle" title="Request id">
            req {requestId.slice(0, 8)}
          </span>
        )}
      </div>
      <div className="flex items-end gap-1 border-b border-line px-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2.5 py-2 text-[12px] font-medium capitalize transition-colors duration-150 ${tab === t ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t}
            {t === 'headers' && (
              <span className="ml-1 text-[10.5px] text-subtle">{response.headers.length}</span>
            )}
          </button>
        ))}
        <span className="ml-auto pb-1.5">
          <CopyButton text={pretty} />
        </span>
      </div>
      {tab === 'comments' && thread && me ? (
        <CommentThread thread={thread} me={me} />
      ) : tab === 'headers' ? (
        <table className="w-full text-[11.5px]">
          <tbody>
            {response.headers.map(([k, v]) => (
              <tr key={k} className="border-b border-line last:border-0 align-top">
                <td className="w-[38%] px-3 py-1.5 font-mono text-subtle">{k}</td>
                <td className="break-all px-3 py-1.5 font-mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : tab === 'raw' ? (
        <pre className="scroll-thin max-h-[480px] overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[11.5px]">
          {response.text || '(empty)'}
        </pre>
      ) : response.body !== null ? (
        <JsonTree value={response.body} className="max-h-[520px] py-3 pl-6 pr-3" />
      ) : (
        <EmptyState>
          {response.status === 204
            ? '204 No Content — succeeded with nothing to return.'
            : '(empty body)'}
        </EmptyState>
      )}
    </Card>
  );
}
