import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TRANSITIONS } from '@solarflow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useLocale } from '@/lib/format';
import { Badge, Button, Card, CardBody, CardHeader, ErrorNote, Field, Modal, PageHeader, Spinner, Textarea } from '@/components/ui';
import { Notice } from '@/components/ui/extra';
import { useCommercialOptions } from '@/features/commercial/api';
import { DOC_TONE, showDate } from './common';

interface Doc {
  id: string; number: string; title: string; status: string; version: number; content: string; approvedAt: string | null; rejectionNote: string | null; unresolved: string[];
  customer: { id: string; name: string } | null; project: { id: string; number: string; name: string } | null; versions: { version: number; title: string; createdAt: string }[];
}

export function DocumentDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate(); const qc = useQueryClient(); const can = useAuth((s) => s.can); const org = useAuth((s) => s.session?.organization); const locale = useLocale();
  const opts = useCommercialOptions();
  const { data: d, isLoading, error } = useQuery({ queryKey: ['document', id], queryFn: () => api.get<Doc>(`/documents/${id}`) });
  const [text, setText] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ version: number; content: string } | null>(null);
  const [reject, setReject] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['document', id] }); qc.invalidateQueries({ queryKey: ['documents'] }); };
  const save = useMutation({ mutationFn: () => api.put(`/documents/${id}`, { content: text }), onSuccess: () => { setText(null); refresh(); } });
  const move = useMutation({ mutationFn: (v: { status: string; note?: string }) => api.post(`/documents/${id}/status`, v), onSuccess: () => { setReject(null); refresh(); } });
  const del = useMutation({ mutationFn: () => api.delete(`/documents/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); nav('/documents'); } });
  const pdf = useMutation({ mutationFn: async () => { const { documentPdf } = await import('@/features/operations/opsPdf'); await documentPdf({ number: d!.number, title: d!.title, version: d!.version, status: d!.status, approvedAt: d!.approvedAt, content: text ?? d!.content }, opts.data!, org?.logoUrl); } });
  const openVersion = useMutation({ mutationFn: (n: number) => api.get<{ version: number; content: string }>(`/documents/${id}/versions/${n}`), onSuccess: setViewing });

  if (isLoading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>;
  if (!d) return <ErrorNote error={error} />;
  const editable = can('document:edit') && ['DRAFT', 'REJECTED'].includes(d.status);
  const next = DOCUMENT_TRANSITIONS[d.status] ?? [];
  const dirty = text !== null && text !== d.content;

  return (
    <div>
      <PageHeader title={`${d.number} · ${d.title}`} description={[d.customer?.name, d.project ? `${d.project.number} ${d.project.name}` : null].filter(Boolean).join(' · ') || 'Document'}
        actions={<>
          <Badge tone={DOC_TONE[d.status]}>{DOCUMENT_STATUS_LABELS[d.status as keyof typeof DOCUMENT_STATUS_LABELS]}</Badge>
          <Button variant="outline" onClick={() => pdf.mutate()} loading={pdf.isPending} disabled={!opts.data}><Download className="h-4 w-4" />PDF</Button>
        </>} />
      <ErrorNote error={save.error ?? move.error ?? del.error ?? pdf.error} />
      {d.status === 'REJECTED' && d.rejectionNote && <div className="mb-4"><Notice tone="warn">Rejected: {d.rejectionNote}</Notice></div>}
      {d.unresolved.length > 0 && editable && <div className="mb-4"><Notice tone="warn">Values still to fill in: {d.unresolved.join(', ')}. Replace each marker with the real text before submitting.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <Card>
          <CardHeader title={`Version ${d.version}`} description={d.approvedAt ? `Approved ${showDate(d.approvedAt, locale)}` : editable ? 'Editing saves a new version' : 'Locked while it is in review or approved'} />
          <CardBody>
            <Textarea aria-label="Document text" rows={22} value={text ?? d.content} readOnly={!editable} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
            <div className="mt-3 flex flex-wrap gap-2">
              {editable && <Button loading={save.isPending} disabled={!dirty || (text ?? '').trim().length === 0} onClick={() => save.mutate()}>Save as new version</Button>}
              {can('document:edit') && next.includes('PENDING_APPROVAL') && <Button variant="accent" disabled={dirty} title={dirty ? 'Save first' : ''} loading={move.isPending} onClick={() => move.mutate({ status: 'PENDING_APPROVAL' })}>Submit for approval</Button>}
              {can('document:approve') && next.includes('APPROVED') && <Button variant="accent" loading={move.isPending} onClick={() => move.mutate({ status: 'APPROVED' })}>Approve</Button>}
              {can('document:approve') && next.includes('REJECTED') && <Button variant="outline" onClick={() => setReject('')}>Reject</Button>}
              {can('document:edit') && d.status === 'PENDING_APPROVAL' && <Button variant="ghost" onClick={() => move.mutate({ status: 'DRAFT' })}>Withdraw to draft</Button>}
              {can('document:edit') && d.status === 'REJECTED' && <Button variant="ghost" onClick={() => move.mutate({ status: 'DRAFT' })}>Back to draft</Button>}
              {can('document:delete') && d.status !== 'APPROVED' && <Button variant="ghost" className="ml-auto text-red-600" onClick={() => { if (window.confirm('Delete this document?')) del.mutate(); }}>Delete</Button>}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="History" />
          <ul className="divide-y divide-surface-line text-sm">
            {d.versions.map((v) => <li key={v.version} className="flex items-center justify-between px-4 py-2"><span>Version {v.version}<span className="block text-xs text-ink-muted">{showDate(v.createdAt, locale)}</span></span><Button size="sm" variant="ghost" onClick={() => openVersion.mutate(v.version)}>View</Button></li>)}
          </ul>
          {d.project && <p className="border-t border-surface-line px-4 py-3 text-xs"><Link className="text-brand hover:underline" to={`/projects/${d.project.id}`}>Open project {d.project.number}</Link></p>}
        </Card>
      </div>
      {viewing && <Modal open wide title={`Version ${viewing.version}`} onClose={() => setViewing(null)}><pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-surface-alt p-3 text-xs">{viewing.content}</pre><div className="mt-3 flex justify-end"><Button onClick={() => setViewing(null)}>Close</Button></div></Modal>}
      {reject !== null && (
        <Modal open title="Reject document" onClose={() => setReject(null)}>
          <Field label="Why is it rejected?"><Textarea rows={3} value={reject} onChange={(e) => setReject(e.target.value)} /></Field>
          <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setReject(null)}>Cancel</Button><Button loading={move.isPending} disabled={reject.trim().length < 2} onClick={() => move.mutate({ status: 'REJECTED', note: reject })}>Reject</Button></div>
        </Modal>
      )}
    </div>
  );
}
