import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Calculator, Camera, ExternalLink, LocateFixed, Trash2, Upload } from 'lucide-react';
import { ATTACHMENT_CATEGORIES, ATTACHMENT_LABELS, updateSurveySchema } from '@solarflow/shared';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { dateOnly, fileSize, label, personName, toLocalInput, useLocale } from '@/lib/format';
import { useDirectory } from '@/lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { AuthImage, DownloadLink, Notice } from '@/components/ui/extra';
import { SURVEY_TONE } from './SurveysPage';

type Form = z.input<typeof updateSurveySchema>;
interface Attachment { id: string; category: (typeof ATTACHMENT_CATEGORIES)[number]; fileName: string; mime: string; sizeBytes: number; createdAt: string }
interface Survey extends Record<string, unknown> {
  id: string; status: string; scheduledAt: string | null; completedAt: string | null; missingForCompletion: string[];
  customer: { id: string; name: string; phone: string | null }; address: { line1: string; city: string | null } | null; engineer: { id: string; firstName: string; lastName: string } | null;
  attachments: Attachment[]; calculations: { id: string; name: string }[];
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const big = 'h-11 text-base';

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return <Card><CardHeader title={title} description={hint} /><CardBody className="grid gap-4 sm:grid-cols-2">{children}</CardBody></Card>;
}

export function SurveyDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const locale = useLocale();
  const dir = useDirectory();
  const [geoErr, setGeoErr] = useState('');
  const { data: s, isLoading, error } = useQuery({ queryKey: ['survey', id], queryFn: () => api.get<Survey>(`/site-surveys/${id}`) });
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isDirty } } = useForm<Form>({ resolver: zodResolver(updateSurveySchema) });

  useEffect(() => {
    if (!s) return;
    reset({
      engineerId: str(s.engineer?.id), scheduledAt: s.scheduledAt ? (toLocalInput(s.scheduledAt) as never) : ('' as never),
      propertyType: str(s.propertyType), buildingType: str(s.buildingType), floors: str(s.floors) as never, roofType: str(s.roofType), roofMaterial: str(s.roofMaterial),
      roofLengthM: str(s.roofLengthM) as never, roofWidthM: str(s.roofWidthM) as never, roofOrientationDeg: str(s.roofOrientationDeg) as never, roofSlopeDeg: str(s.roofSlopeDeg) as never,
      availableRoofAreaM2: str(s.availableRoofAreaM2) as never, roofAccess: str(s.roofAccess), shadingNotes: str(s.shadingNotes),
      connectionType: str(s.connectionType), phase: (s.phase as 'SINGLE' | 'THREE' | null) ?? undefined, monthlyConsumptionKwh: str(s.monthlyConsumptionKwh) as never, avgMonthlyBill: str(s.avgMonthlyBill) as never,
      existingSolar: !!s.existingSolar, existingSolarKw: str(s.existingSolarKw) as never, gridConnectivity: str(s.gridConnectivity), sanctionedLoadKw: str(s.sanctionedLoadKw) as never,
      backupRequirement: str(s.backupRequirement), latitude: str(s.latitude) as never, longitude: str(s.longitude) as never, notes: str(s.notes),
    });
  }, [s, reset]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['survey', id] }); qc.invalidateQueries({ queryKey: ['surveys'] }); };
  const save = useMutation({ mutationFn: (v: Form) => api.patch(`/site-surveys/${id}`, { ...v, engineerId: v.engineerId || null }), onSuccess: refresh });
  const setStatus = useMutation({ mutationFn: (status: string) => api.post(`/site-surveys/${id}/status`, { status }), onSuccess: refresh });
  const upload = useMutation({
    mutationFn: ({ file, category }: { file: File; category: string }) => { const fd = new FormData(); fd.append('category', category); fd.append('file', file); return api.upload(`/site-surveys/${id}/attachments`, fd); },
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (aid: string) => api.delete(`/site-surveys/${id}/attachments/${aid}`), onSuccess: refresh });
  const pickers = useRef<Record<string, HTMLInputElement | null>>({});

  if (isLoading) return <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>;
  if (error || !s) return <EmptyState title="Survey not found" action={<Link to="/surveys" className="text-sm text-accent hover:underline">Back to surveys</Link>} />;

  const edit = can('survey:edit') && s.status !== 'CANCELLED';
  const lat = watch('latitude');
  const lng = watch('longitude');
  const hasCoords = lat !== null && lat !== undefined && String(lat) !== '' && lng !== null && lng !== undefined && String(lng) !== '';
  const locate = () => {
    setGeoErr('');
    if (!navigator.geolocation) return setGeoErr('This device does not support location capture. Enter coordinates manually.');
    navigator.geolocation.getCurrentPosition(
      (p) => { setValue('latitude', p.coords.latitude.toFixed(6) as never, { shouldDirty: true }); setValue('longitude', p.coords.longitude.toFixed(6) as never, { shouldDirty: true }); },
      (e) => setGeoErr(e.code === e.PERMISSION_DENIED ? 'Location permission was denied. Enter coordinates manually.' : 'Could not get your location. Enter coordinates manually.'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const field = (name: keyof Form & string, text: string, props: { type?: string; inputMode?: 'decimal' | 'numeric'; hint?: string } = {}) => (
    <Field label={text} htmlFor={`sv-${name}`} hint={props.hint} error={(errors as Record<string, { message?: string }>)[name]?.message}>
      <Input id={`sv-${name}`} className={big} type={props.type} inputMode={props.inputMode} disabled={!edit} {...register(name as never)} />
    </Field>
  );
  const dec = (name: keyof Form & string, text: string, hint?: string) => field(name, text, { inputMode: 'decimal', hint });

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="pb-28">
      <Link to="/surveys" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Surveys</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Survey: {s.customer.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">{s.address ? `${s.address.line1}${s.address.city ? `, ${s.address.city}` : ''}` : 'No address'} · {s.customer.phone ?? 'no phone'} · scheduled {dateOnly(s.scheduledAt, locale)}</p>
        </div>
        <div className="flex items-center gap-2"><Badge tone={SURVEY_TONE[s.status] ?? 'neutral'}>{label(s.status)}</Badge>
          {can('calculator:view') && <Link to={`/calculator?surveyId=${id}`}><Button variant="outline"><Calculator className="h-4 w-4" />Open in calculator</Button></Link>}</div>
      </div>

      {s.status !== 'COMPLETED' && s.missingForCompletion.length > 0 && <div className="mb-4"><Notice>To complete this survey, still needed: {s.missingForCompletion.join(', ')}.</Notice></div>}
      <div className="space-y-6">
        <Section title="Visit">
          <Field label="Survey engineer" htmlFor="sv-eng"><Select id="sv-eng" className={big} disabled={!edit} {...register('engineerId')}><option value="">Unassigned</option>{dir.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          {field('scheduledAt', 'Scheduled for', { type: 'datetime-local' })}
        </Section>

        <Section title="Building">
          <Field label="Property type" htmlFor="sv-pt"><Select id="sv-pt" className={big} disabled={!edit} {...register('propertyType')}><option value="">Select…</option>{['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Institutional'].map((o) => <option key={o}>{o}</option>)}</Select></Field>
          {field('buildingType', 'Building type')}
          {field('floors', 'Number of floors', { inputMode: 'numeric' })}
          <Field label="Roof type" htmlFor="sv-rt"><Select id="sv-rt" className={big} disabled={!edit} {...register('roofType')}><option value="">Select…</option>{['Flat RCC', 'Sloped', 'Gable', 'Hip', 'Metal sheet', 'Tiled', 'Other'].map((o) => <option key={o}>{o}</option>)}</Select></Field>
          {field('roofMaterial', 'Roof material')}
          {dec('roofLengthM', 'Roof length (m)')}
          {dec('roofWidthM', 'Roof width (m)')}
          {dec('availableRoofAreaM2', 'Available roof area (m²)', 'Usable area after obstacles and setbacks')}
          {dec('roofOrientationDeg', 'Orientation (° from north)', '180 = south-facing')}
          {dec('roofSlopeDeg', 'Roof slope (°)')}
          <div className="sm:col-span-2"><Field label="Roof access" htmlFor="sv-ra"><Textarea id="sv-ra" disabled={!edit} className="min-h-[64px] text-base" {...register('roofAccess')} /></Field></div>
          <div className="sm:col-span-2"><Field label="Shading and obstacles" htmlFor="sv-sh"><Textarea id="sv-sh" disabled={!edit} className="min-h-[64px] text-base" {...register('shadingNotes')} /></Field></div>
        </Section>

        <Section title="Electrical">
          {field('connectionType', 'Connection type')}
          <Field label="Phase" htmlFor="sv-ph"><Select id="sv-ph" className={big} disabled={!edit} {...register('phase')}><option value="">Select…</option><option value="SINGLE">Single-phase</option><option value="THREE">Three-phase</option></Select></Field>
          {dec('monthlyConsumptionKwh', 'Monthly consumption (kWh)')}
          {dec('avgMonthlyBill', 'Average monthly bill')}
          {dec('sanctionedLoadKw', 'Sanctioned load (kW)')}
          {field('gridConnectivity', 'Grid connectivity')}
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-5 w-5" disabled={!edit} {...register('existingSolar')} />Existing solar installation</label>
          {watch('existingSolar') && dec('existingSolarKw', 'Existing solar capacity (kW)')}
          <div className="sm:col-span-2">{field('backupRequirement', 'Backup requirement')}</div>
        </Section>

        <Section title="Location" hint="Capture on site with GPS, or type the coordinates.">
          {dec('latitude', 'Latitude')}
          {dec('longitude', 'Longitude')}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            {edit && <Button variant="outline" onClick={locate}><LocateFixed className="h-4 w-4" />Use my current location</Button>}
            {hasCoords && <a className="inline-flex items-center gap-1 text-sm text-accent hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`}><ExternalLink className="h-3.5 w-3.5" />View on map</a>}
            {geoErr && <p role="alert" className="text-sm text-red-600">{geoErr}</p>}
          </div>
        </Section>

        <Card><CardHeader title="Notes" /><CardBody><Textarea aria-label="Survey notes" disabled={!edit} className="text-base" {...register('notes')} /></CardBody></Card>

        <Card>
          <CardHeader title="Photos and documents" description="Use the camera on a phone, or choose files. Images, PDF, DOCX and XLSX up to 10 MB." />
          <CardBody className="space-y-6">
            <ErrorNote error={upload.error ?? del.error} />
            {ATTACHMENT_CATEGORIES.map((cat) => {
              const files = s.attachments.filter((a) => a.category === cat);
              const photo = cat === 'ROOF_PHOTO' || cat === 'BUILDING_PHOTO' || cat === 'METER_PHOTO';
              return (
                <div key={cat}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{ATTACHMENT_LABELS[cat]} <span className="font-normal text-ink-muted">({files.length})</span></h3>
                    {edit && <>
                      <input ref={(el) => { pickers.current[cat] = el; }} type="file" multiple className="hidden" aria-label={`Add ${ATTACHMENT_LABELS[cat]}`}
                        accept={photo ? 'image/*' : '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx'} {...(photo ? { capture: 'environment' as const } : {})}
                        onChange={(e) => { Array.from(e.target.files ?? []).forEach((file) => upload.mutate({ file, category: cat })); e.target.value = ''; }} />
                      <Button size="sm" variant="outline" loading={upload.isPending && upload.variables?.category === cat} onClick={() => pickers.current[cat]?.click()}>{photo ? <Camera className="h-4 w-4" /> : <Upload className="h-4 w-4" />}{photo ? 'Take / add photo' : 'Add file'}</Button></>}
                  </div>
                  {files.length > 0 && (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {files.map((f) => (
                        <li key={f.id} className="overflow-hidden rounded-lg border border-surface-line">
                          {f.mime.startsWith('image/') ? <AuthImage path={`/site-surveys/${id}/attachments/${f.id}`} alt={f.fileName} className="h-28 w-full" /> : <div className="flex h-28 items-center justify-center bg-surface-alt text-xs text-ink-muted">{f.mime === 'application/pdf' ? 'PDF' : 'Document'}</div>}
                          <div className="flex items-center justify-between gap-1 p-2 text-xs"><div className="min-w-0"><DownloadLink path={`/site-surveys/${id}/attachments/${f.id}`} fileName={f.fileName}>Download</DownloadLink><p className="truncate text-ink-muted">{fileSize(f.sizeBytes)}</p></div>
                            {edit && <button type="button" aria-label={`Delete ${f.fileName}`} onClick={() => del.mutate(f.id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>
        {s.calculations.length > 0 && <Card><CardHeader title="Saved calculations from this survey" /><CardBody className="space-y-1">{s.calculations.map((c) => <Link key={c.id} to={`/calculator?load=${c.id}`} className="block text-sm text-accent hover:underline">{c.name}</Link>)}</CardBody></Card>}
        <p className="text-xs text-ink-muted">Survey engineer: {s.engineer ? personName(s.engineer) : 'unassigned'}</p>
      </div>

      {edit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-line bg-white/95 px-4 py-3 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
            <Button type="submit" size="md" loading={save.isPending} disabled={!isDirty}>Save changes</Button>
            {save.isSuccess && !isDirty && <span role="status" className="text-sm text-accent">Saved</span>}
            <ErrorNote error={save.error ?? setStatus.error} />
            <div className="ml-auto flex gap-2">
              {s.status === 'SCHEDULED' && <Button variant="outline" onClick={() => setStatus.mutate('IN_PROGRESS')} loading={setStatus.isPending}>Start survey</Button>}
              {s.status !== 'COMPLETED' && <Button variant="accent" disabled={isDirty} title={isDirty ? 'Save your changes first' : undefined} onClick={() => setStatus.mutate('COMPLETED')} loading={setStatus.isPending}>Mark completed</Button>}
              {s.status !== 'CANCELLED' && s.status !== 'COMPLETED' && <Button variant="ghost" onClick={() => { if (window.confirm('Cancel this survey?')) setStatus.mutate('CANCELLED'); }}>Cancel</Button>}
              {s.status === 'COMPLETED' && <Button variant="outline" onClick={() => setStatus.mutate('IN_PROGRESS')}>Reopen</Button>}
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
