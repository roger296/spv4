import * as React from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PROBLEM_KINDS } from '@spv4/shared-types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination } from '@/components/data-table/data-table';
import { PageHeader } from '@/components/page-header';
import { QueryState } from '@/components/states';
import { useToast } from '@/hooks/use-toast';
import { useProblems, useResolveProblem, useSuggestAction } from '@/features/problems/use-problems';
import { errorMessage, isNotAvailable } from '@/lib/api';
import { formatAge, formatDateTime } from '@/lib/format';
import { PROBLEM_PHRASES, problemPhrase } from '@/lib/problem-phrases';
import type { ProblemQueueItem } from '@/lib/types';

export const Route = createFileRoute('/_authed/problems/')({
  validateSearch: (search: Record<string, unknown>) => ({
    kind: typeof search.kind === 'string' && search.kind ? search.kind : undefined,
    page: typeof search.page === 'number' && search.page > 1 ? search.page : undefined,
    open: search.open === false || search.open === 'false' ? false : undefined,
  }),
  component: ProblemsPage,
});

function ProblemsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { toast } = useToast();
  const page = search.page ?? 1;
  const showOpen = search.open !== false;
  const problems = useProblems({ open: showOpen ? true : undefined, kind: search.kind, page });
  const resolve = useResolveProblem();
  const suggest = useSuggestAction();
  const [resolving, setResolving] = React.useState<ProblemQueueItem | null>(null);
  const [resolution, setResolution] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<Record<string, string>>({});

  const submitResolve = async () => {
    if (!resolving || !resolution.trim()) return;
    try {
      await resolve.mutateAsync({ id: resolving.id, resolution: resolution.trim() });
      toast({ title: 'Problem resolved' });
      setResolving(null);
      setResolution('');
    } catch (err) {
      toast({ title: 'Could not resolve', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const askSuggestion = async (id: string) => {
    try {
      const r = await suggest.mutateAsync(id);
      setSuggestions((s) => ({ ...s, [id]: r.suggestion }));
    } catch (err) {
      toast({ title: isNotAvailable(err) ? 'Suggestions not available yet' : 'Could not get a suggestion', description: isNotAvailable(err) ? undefined : errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Problems" description="Oldest first, so nothing sits unnoticed." />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={showOpen ? 'default' : 'outline'} onClick={() => navigate({ search: { ...search, open: undefined, page: undefined } })}>
          Open
        </Button>
        <Button size="sm" variant={showOpen ? 'outline' : 'default'} onClick={() => navigate({ search: { ...search, open: false, page: undefined } })}>
          All
        </Button>
        <Select value={search.kind ?? '__all'} onValueChange={(v) => navigate({ search: { ...search, kind: v === '__all' ? undefined : v, page: undefined } })}>
          <SelectTrigger className="w-56" aria-label="Filter by kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Every kind</SelectItem>
            {PROBLEM_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {PROBLEM_PHRASES[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <QueryState isLoading={problems.isLoading} error={problems.error} data={problems.data} what="The problem queue" onRetry={() => problems.refetch()}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="rounded-md border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
              {showOpen ? 'No open problems. Nice.' : 'No problems recorded.'}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)] text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Order</th>
                      <th className="px-3 py-2 font-medium">Problem</th>
                      <th className="px-3 py-2 font-medium">Age</th>
                      <th className="px-3 py-2 font-medium">Last scan</th>
                      <th className="px-3 py-2 font-medium">Courier</th>
                      <th className="px-3 py-2 font-medium">Suggested action</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((p) => (
                      <tr key={p.id} className={p.resolvedAt ? 'border-b border-[var(--color-border)] opacity-60' : 'border-b border-[var(--color-border)]'}>
                        <td className="px-3 py-2">
                          <Link to="/orders/$reference" params={{ reference: p.orderNumber }} className="font-medium hover:underline">
                            {p.orderNumber}
                          </Link>
                          {p.trackingNumber && <div className="font-mono text-xs text-[var(--color-muted-foreground)]">{p.trackingNumber}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{problemPhrase(p.kind)}</div>
                          <div className="max-w-xs text-xs text-[var(--color-muted-foreground)]">{p.description}</div>
                        </td>
                        <td className="px-3 py-2" title={formatDateTime(p.openedAt)}>
                          {formatAge(p.openedAt)}
                        </td>
                        <td className="px-3 py-2 text-xs">{p.lastEventAt ? formatDateTime(p.lastEventAt) : '—'}</td>
                        <td className="px-3 py-2">{p.courierName ?? '—'}</td>
                        <td className="max-w-sm px-3 py-2 text-xs">{suggestions[p.id] ?? p.suggestedAction ?? <span className="text-[var(--color-muted-foreground)]">—</span>}</td>
                        <td className="px-3 py-2">
                          {!p.resolvedAt && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => askSuggestion(p.id)} disabled={suggest.isPending}>
                                Suggest action
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setResolving(p)}>
                                Resolve
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={data.pageSize || 50} total={data.total} onPageChange={(p) => navigate({ search: { ...search, page: p > 1 ? p : undefined } })} />
            </>
          )
        }
      </QueryState>

      <Dialog open={resolving !== null} onOpenChange={(v) => !v && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Resolve {resolving ? problemPhrase(resolving.kind).toLowerCase() : ''} on {resolving?.orderNumber}
            </DialogTitle>
          </DialogHeader>
          <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done" rows={4} autoFocus aria-label="Resolution" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button onClick={submitResolve} disabled={!resolution.trim() || resolve.isPending}>
              {resolve.isPending ? 'Saving…' : 'Mark resolved'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
