import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatDateTime } from '@/lib/utils';
import { Card, EmptyState, ErrorNote, Input, Pagination, Spinner, Table, Td, Th } from '@/components/ui';

interface Row { id: string; action: string; entity: string; entityId: string | null; ip: string | null; createdAt: string; user: { firstName: string; lastName: string; email: string } | null }

export function AuditTab() {
  const locale = useAuth((s) => s.session?.organization.locale);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', page, search],
    queryFn: () => api.get<{ data: Row[]; meta: { page: number; totalPages: number; total: number } }>(`/audit-logs${qs({ page, pageSize: 20, search })}`),
    placeholderData: (p) => p,
  });
  return (
    <Card>
      <div className="border-b border-surface-line px-5 py-4"><Input aria-label="Filter by action" placeholder="Filter by action, e.g. user.create" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" /></div>
      <ErrorNote error={error} />
      {isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !data?.data.length ? <EmptyState title="No audit entries" /> : (
        <>
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Entity</Th><Th>IP</Th></tr></thead>
            <tbody>
              {data.data.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-ink-muted">{formatDateTime(r.createdAt, locale)}</Td>
                  <Td>{r.user ? `${r.user.firstName} ${r.user.lastName}` : <span className="text-ink-muted">System</span>}</Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td>{r.entity}</Td>
                  <Td className="text-ink-muted">{r.ip ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
