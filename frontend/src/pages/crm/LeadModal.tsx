import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, MessageSquare, Phone, UserCheck } from 'lucide-react';
import { LEAD_SOURCES, LEAD_STAGES, LEAD_STAGE_LABELS, leadSchema, type LeadStageKey } from '@solarflow/shared';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { dateOnly, label, toLocalInput, useLocale, useMoney } from '@/lib/format';
import { useDirectory } from '@/lib/hooks';
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';
import type { LeadRow } from './CrmPage';

type Form = z.input<typeof leadSchema>;
interface Activity { id: string; type: string; body: string; dueAt: string | null; completedAt: string | null; createdAt: string }
interface LeadDetail extends LeadRow {
  address: string | null; notes: string | null; lostReason: string | null; convertedAt: string | null; activities: Activity[];
  surveys: { id: string; status: string; scheduledAt: string | null }[]; customer: { id: string; name: string } | null;
}

export function LeadFormModal({ lead, onClose, onSaved }: { lead?: LeadDetail; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.session?.user.id);
  const dir = useDirectory();
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(leadSchema),
    defaultValues: lead
      ? { name: lead.name, companyName: lead.companyName ?? '', phone: lead.phone ?? '', email: lead.email ?? '', address: lead.address ?? '', source: lead.source as Form['source'], assignedToId: lead.assignedTo?.id ?? '', expectedCapacityKw: lead.expectedCapacityKw ?? '', expectedValue: lead.expectedValue ?? '', notes: lead.notes ?? '' }
      : { source: 'OTHER', assignedToId: me ?? '' },
  });
  const save = useMutation({
    mutationFn: (v: Form) => (lead ? api.patch<{ id: string }>(`/leads/${lead.id}`, { ...v, assignedToId: v.assignedToId || null }) : api.post<{ id: string }>('/leads', { ...v, assignedToId: v.assignedToId || null })),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['lead'] }); onSaved?.(lead?.id ?? r.id); onClose(); },
  });
  return (
    <Modal open wide title={lead ? 'Edit lead' : 'New lead'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name" htmlFor="l-name" error={errors.name?.message}><Input id="l-name" {...register('name')} /></Field>
          <Field label="Company" htmlFor="l-co"><Input id="l-co" {...register('companyName')} /></Field>
          <Field label="Phone" htmlFor="l-ph"><Input id="l-ph" type="tel" {...register('phone')} /></Field>
          <Field label="Email" htmlFor="l-em" error={errors.email?.message}><Input id="l-em" type="email" {...register('email')} /></Field>
          <Field label="Source" htmlFor="l-src"><Select id="l-src" {...register('source')}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
          <Field label="Assigned to" htmlFor="l-as"><Select id="l-as" {...register('assignedToId')}><option value="">Unassigned</option>{dir.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Expected capacity (kW)" htmlFor="l-kw" error={errors.expectedCapacityKw?.message}><Input id="l-kw" inputMode="decimal" {...register('expectedCapacityKw')} /></Field>
          <Field label="Expected value" htmlFor="l-val" error={errors.expectedValue?.message}><Input id="l-val" inputMode="decimal" {...register('expectedValue')} /></Field>
        </div>
        <Field label="Site address" htmlFor="l-ad"><Input id="l-ad" {...register('address')} /></Field>
        <Field label="Notes" htmlFor="l-no"><Textarea id="l-no" {...register('notes')} /></Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>{lead ? 'Save changes' : 'Create lead'}</Button></div>
      </form>
    </Modal>
  );
}

const ACT_ICON: Record<string, typeof Phone> = { CALL: Phone, NOTE: MessageSquare, EMAIL: MessageSquare, MEETING: UserCheck, FOLLOW_UP: CalendarClock };

export function LeadModal({ id, onClose, onConverted }: { id: string; onClose: () => void; onConverted: (customerId: string) => void }) {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const locale = useLocale();
  const money = useMoney();
  const { data: lead, isLoading, error } = useQuery({ queryKey: ['lead', id], queryFn: () => api.get<LeadDetail>(`/leads/${id}`) });
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convType, setConvType] = useState<'INDIVIDUAL' | 'BUSINESS'>('INDIVIDUAL');
  const [withSurvey, setWithSurvey] = useState(true);
  const [actType, setActType] = useState<'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'FOLLOW_UP'>('NOTE');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['lead', id] }); qc.invalidateQueries({ queryKey: ['leads-board'] }); qc.invalidateQueries({ queryKey: ['leads-list'] }); };

  const stage = useMutation({ mutationFn: (s: { stage: LeadStageKey; lostReason?: string }) => api.post(`/leads/${id}/stage`, s), onSuccess: () => { setReason(''); refresh(); } });
  const addAct = useMutation({
    mutationFn: () => api.post(`/leads/${id}/activities`, { type: actType, body, dueAt: actType === 'FOLLOW_UP' && due ? new Date(due).toISOString() : null }),
    onSuccess: () => { setBody(''); setDue(''); refresh(); },
  });
  const complete = useMutation({ mutationFn: (aid: string) => api.post(`/leads/${id}/activities/${aid}/complete`), onSuccess: refresh });
  const convert = useMutation({
    mutationFn: () => api.post<{ customerId: string }>(`/leads/${id}/convert`, { customerType: convType, createSurvey: withSurvey }),
    onSuccess: (r) => { refresh(); qc.invalidateQueries({ queryKey: ['customers'] }); onConverted(r.customerId); },
  });
  const del = useMutation({ mutationFn: () => api.delete(`/leads/${id}`), onSuccess: () => { refresh(); onClose(); } });
  const [lostAsk, setLostAsk] = useState(false);

  if (isLoading) return <Modal open wide title="Lead" onClose={onClose}><div className="flex justify-center py-12"><Spinner className="h-7 w-7" /></div></Modal>;
  if (error || !lead) return <Modal open title="Lead" onClose={onClose}><p className="text-sm text-ink-muted">This lead no longer exists.</p></Modal>;
  const edit = can('lead:edit');
  const openFollowUps = lead.activities.filter((a) => a.type === 'FOLLOW_UP' && !a.completedAt);

  return (
    <>
      <Modal open wide title={lead.name} onClose={onClose}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={lead.stage === 'WON' ? 'green' : lead.stage === 'LOST' ? 'red' : 'blue'}>{LEAD_STAGE_LABELS[lead.stage]}</Badge>
            {lead.customer && <Badge tone="green">Customer: {lead.customer.name}</Badge>}
            {edit && (
              <Select aria-label="Change stage" value={lead.stage} className="h-9 w-44" onChange={(e) => { const s = e.target.value as LeadStageKey; if (s === 'LOST') setLostAsk(true); else stage.mutate({ stage: s }); }}>
                {LEAD_STAGES.map((s) => <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>)}
              </Select>
            )}
            <div className="ml-auto flex gap-2">
              {edit && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
              {edit && can('customer:create') && !lead.customerId && <Button size="sm" variant="accent" onClick={() => setConverting(true)}>Convert to customer</Button>}
              {lead.customer && <Button size="sm" variant="outline" onClick={() => onConverted(lead.customer!.id)}>Open customer</Button>}
              {can('lead:delete') && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Delete this lead?')) del.mutate(); }}>Delete</Button>}
            </div>
          </div>
          <ErrorNote error={stage.error ?? del.error} />
          {lead.lostReason && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Lost: {lead.lostReason}</p>}

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-ink-muted">Company</dt><dd>{lead.companyName ?? '—'}</dd></div>
            <div><dt className="text-ink-muted">Assigned to</dt><dd>{lead.assignedTo ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}` : 'Unassigned'}</dd></div>
            <div><dt className="text-ink-muted">Phone</dt><dd>{lead.phone ? <a className="text-accent hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a> : '—'}</dd></div>
            <div><dt className="text-ink-muted">Email</dt><dd>{lead.email ?? '—'}</dd></div>
            <div><dt className="text-ink-muted">Source</dt><dd>{label(lead.source)}</dd></div>
            <div><dt className="text-ink-muted">Expected</dt><dd>{lead.expectedCapacityKw ? `${Number(lead.expectedCapacityKw)} kW` : '—'} · {lead.expectedValue ? money(lead.expectedValue) : '—'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-ink-muted">Site address</dt><dd>{lead.address ?? '—'}</dd></div>
            {lead.notes && <div className="sm:col-span-2"><dt className="text-ink-muted">Notes</dt><dd className="whitespace-pre-wrap">{lead.notes}</dd></div>}
          </dl>

          {openFollowUps.length > 0 && (
            <section aria-label="Open follow-ups" className="rounded-lg border border-surface-line">
              <h3 className="border-b border-surface-line bg-surface-alt px-3 py-2 text-sm font-semibold">Open follow-ups</h3>
              <ul className="divide-y divide-surface-line">
                {openFollowUps.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span><span className={f.dueAt && new Date(f.dueAt) < new Date() ? 'font-medium text-red-600' : 'font-medium'}>{f.dueAt ? formatDateTime(f.dueAt, locale) : ''}</span> · {f.body}</span>
                    {edit && <Button size="sm" variant="outline" aria-label={`Complete follow-up ${f.body}`} loading={complete.isPending} onClick={() => complete.mutate(f.id)}><Check className="h-4 w-4" />Done</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {edit && (
            <form className="space-y-2 rounded-lg border border-surface-line p-3" onSubmit={(e) => { e.preventDefault(); if (body.trim() && (actType !== 'FOLLOW_UP' || due)) addAct.mutate(); }}>
              <div className="flex flex-wrap gap-2">
                <Select aria-label="Activity type" value={actType} onChange={(e) => setActType(e.target.value as typeof actType)} className="h-9 w-40">
                  <option value="NOTE">Note</option><option value="CALL">Call</option><option value="EMAIL">Email</option><option value="MEETING">Meeting</option><option value="FOLLOW_UP">Follow-up reminder</option>
                </Select>
                {actType === 'FOLLOW_UP' && <Input aria-label="Follow-up due" type="datetime-local" value={due} min={toLocalInput(new Date().toISOString())} onChange={(e) => setDue(e.target.value)} className="h-9 w-56" />}
              </div>
              <Textarea aria-label="Activity details" placeholder={actType === 'FOLLOW_UP' ? 'What needs to happen?' : 'What was discussed?'} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[64px]" />
              <ErrorNote error={addAct.error} />
              <div className="flex justify-end"><Button type="submit" size="sm" loading={addAct.isPending} disabled={!body.trim() || (actType === 'FOLLOW_UP' && !due)}>{actType === 'FOLLOW_UP' ? 'Set reminder' : 'Add to timeline'}</Button></div>
            </form>
          )}

          <section aria-label="Activity timeline">
            <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
            <ul className="space-y-3">
              {lead.activities.map((a) => {
                const Icon = ACT_ICON[a.type] ?? MessageSquare;
                return (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-alt text-ink-muted"><Icon className="h-3.5 w-3.5" /></span>
                    <div><p className={a.completedAt ? 'text-ink-muted line-through' : ''}>{a.body}</p><p className="text-xs text-ink-muted">{label(a.type)} · {dateOnly(a.createdAt, locale)}{a.dueAt ? ` · due ${formatDateTime(a.dueAt, locale)}` : ''}</p></div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </Modal>

      {editing && <LeadFormModal lead={lead} onClose={() => setEditing(false)} onSaved={refresh} />}
      <Modal open={converting} title="Convert to customer" onClose={() => setConverting(false)}>
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Creates a customer from this lead's details{lead.address ? ' and its site address' : ''}. The lead keeps its history.</p>
          <Field label="Customer type" htmlFor="cv-type"><Select id="cv-type" value={convType} onChange={(e) => setConvType(e.target.value as typeof convType)}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business (uses the company name)</option></Select></Field>
          {can('survey:create') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withSurvey} onChange={(e) => setWithSurvey(e.target.checked)} />Also create a site survey to schedule</label>}
          <ErrorNote error={convert.error} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConverting(false)}>Cancel</Button><Button variant="accent" loading={convert.isPending} onClick={() => convert.mutate()}>Convert</Button></div>
        </div>
      </Modal>
      <Modal open={lostAsk} title="Why was this lead lost?" onClose={() => setLostAsk(false)}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) { stage.mutate({ stage: 'LOST', lostReason: reason.trim() }); setLostAsk(false); } }}>
          <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. price, chose a competitor" autoFocus />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setLostAsk(false)}>Cancel</Button><Button type="submit" variant="danger" disabled={!reason.trim()}>Mark as lost</Button></div>
        </form>
      </Modal>
    </>
  );
}
