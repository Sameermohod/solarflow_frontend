import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { restoreSession, tokenStore } from './lib/api';
import { NAV, isLive } from './lib/nav';
import { useAuth, type SessionPayload } from './store/auth';
import { FullPageSpinner } from './components/ui';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { ModulePlaceholder } from './pages/ModulePlaceholder';
import { SettingsLayout, SettingsIndex } from './pages/settings/SettingsLayout';
import { OrganizationTab, BrandingTab, RegionalTab, InvoiceTab, DomainTab } from './pages/settings/OrgTabs';
import { ProposalTab } from './pages/settings/ProposalTab';
import { PlatformConsolePage, PlatformLoginPage } from './pages/platform/PlatformPages';
import { ProjectsPage } from './pages/operations/ProjectsPage';
import { ProjectDetailPage } from './pages/operations/ProjectDetailPage';
import { MaintenancePage } from './pages/operations/MaintenancePage';
import { DocumentsPage } from './pages/operations/DocumentsPage';
import { DocumentDetailPage } from './pages/operations/DocumentDetailPage';
import { ReportsPage } from './pages/operations/ReportsPage';
import { TimesheetsPage } from './pages/operations/TimesheetsPage';
import { FinancePage } from './pages/operations/FinancePage';
import { UsersTab } from './pages/settings/UsersTab';
import { RolesTab } from './pages/settings/RolesTab';
import { AuditTab } from './pages/settings/AuditTab';
import { AccountTab } from './pages/settings/AccountTab';
import { NotFound } from './pages/NotFound';
import { CustomersPage } from './pages/customers/CustomersPage';
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage';
import { CrmPage } from './pages/crm/CrmPage';
import { SurveysPage } from './pages/surveys/SurveysPage';
import { SurveyDetailPage } from './pages/surveys/SurveyDetailPage';
import { CalculatorPage } from './pages/calculator/CalculatorPage';
import { EquipmentPage } from './pages/equipment/EquipmentPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { Guard } from './components/layout/Guard';
import { DesignsPage } from './features/design/DesignsPage';
import { BomListPage, BomDetailPage } from './pages/commercial/BomPage';
import { QuotationsListPage, QuotationDetailPage } from './pages/commercial/QuotationsPage';
import { ContractsListPage, ContractDetailPage } from './pages/commercial/ContractsPage';
import { InvoicesListPage, InvoiceDetailPage } from './pages/commercial/InvoicesPage';
import { PaymentsPage } from './pages/commercial/PaymentsPage';

// The editors pull in Konva, Three.js and jsPDF, so they load on demand.
const Editor2D = lazy(() => import('./features/design/Editor2D').then((m) => ({ default: m.Editor2D })));
const Editor3D = lazy(() => import('./features/design/Editor3D').then((m) => ({ default: m.Editor3D })));
function EditorRoute({ mode }: { mode: '2d' | '3d' }) {
  const { id = '' } = useParams();
  return <Suspense fallback={<FullPageSpinner />}>{mode === '2d' ? <Editor2D key={id} designId={id} /> : <Editor3D key={id} designId={id} />}</Suspense>;
}

function RequireAuth() {
  const status = useAuth((s) => s.status);
  const loc = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

export function App() {
  const { setSession, clear } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    const onSession = (e: Event) => setSession((e as CustomEvent<SessionPayload>).detail);
    window.addEventListener('sf:session', onSession);
    tokenStore.onSessionLost(() => { qc.clear(); clear(); });
    restoreSession().then((ok) => { if (!ok) clear(); });
    return () => window.removeEventListener('sf:session', onSession);
  }, [setSession, clear, qc]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/platform/login" element={<PlatformLoginPage />} />
      <Route path="/platform" element={<PlatformConsolePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          {NAV.filter((n) => !isLive(n)).map((n) => (
            <Route key={n.key} path={n.path} element={<ModulePlaceholder item={n} />} />
          ))}
          <Route path="/projects" element={<Guard perm="project:view"><ProjectsPage /></Guard>} />
          <Route path="/projects/:id" element={<Guard perm="project:view"><ProjectDetailPage /></Guard>} />
          <Route path="/maintenance" element={<Guard perm="maintenance:view"><MaintenancePage /></Guard>} />
          <Route path="/documents" element={<Guard perm="document:view"><DocumentsPage /></Guard>} />
          <Route path="/documents/:id" element={<Guard perm="document:view"><DocumentDetailPage /></Guard>} />
          <Route path="/timesheets" element={<Guard perm="timesheet:view"><TimesheetsPage /></Guard>} />
          <Route path="/finance" element={<Guard perm="payroll:view"><FinancePage /></Guard>} />
          <Route path="/reports" element={<Guard perm="report:view"><ReportsPage /></Guard>} />
          <Route path="/customers" element={<Guard perm="customer:view"><CustomersPage /></Guard>} />
          <Route path="/customers/:id" element={<Guard perm="customer:view"><CustomerDetailPage /></Guard>} />
          <Route path="/crm" element={<Guard perm="lead:view"><CrmPage /></Guard>} />
          <Route path="/surveys" element={<Guard perm="survey:view"><SurveysPage /></Guard>} />
          <Route path="/surveys/:id" element={<Guard perm="survey:view"><SurveyDetailPage /></Guard>} />
          <Route path="/calculator" element={<Guard perm="calculator:view"><CalculatorPage /></Guard>} />
          <Route path="/equipment" element={<Guard perm="equipment:view"><EquipmentPage /></Guard>} />
          <Route path="/inventory" element={<Guard perm="inventory:view"><InventoryPage /></Guard>} />
          <Route path="/designer-2d" element={<Guard perm="design:view"><DesignsPage mode="2d" /></Guard>} />
          <Route path="/designer-2d/:id" element={<Guard perm="design:view"><EditorRoute mode="2d" /></Guard>} />
          <Route path="/designer-3d" element={<Guard perm="design:view"><DesignsPage mode="3d" /></Guard>} />
          <Route path="/designer-3d/:id" element={<Guard perm="design:view"><EditorRoute mode="3d" /></Guard>} />
          <Route path="/bom" element={<Guard perm="bom:view"><BomListPage /></Guard>} />
          <Route path="/bom/:id" element={<Guard perm="bom:view"><BomDetailPage /></Guard>} />
          <Route path="/quotations" element={<Guard perm="quotation:view"><QuotationsListPage /></Guard>} />
          <Route path="/quotations/new" element={<Guard perm="quotation:create"><QuotationDetailPage isNew /></Guard>} />
          <Route path="/quotations/:id" element={<Guard perm="quotation:view"><QuotationDetailPage /></Guard>} />
          <Route path="/contracts" element={<Guard perm="contract:view"><ContractsListPage /></Guard>} />
          <Route path="/contracts/:id" element={<Guard perm="contract:view"><ContractDetailPage /></Guard>} />
          <Route path="/invoices" element={<Guard perm="invoice:view"><InvoicesListPage /></Guard>} />
          <Route path="/invoices/new" element={<Guard perm="invoice:create"><InvoiceDetailPage isNew /></Guard>} />
          <Route path="/invoices/:id" element={<Guard perm="invoice:view"><InvoiceDetailPage /></Guard>} />
          <Route path="/payments" element={<Guard perm="payment:view"><PaymentsPage /></Guard>} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<SettingsIndex />} />
            <Route path="organization" element={<OrganizationTab />} />
            <Route path="branding" element={<BrandingTab />} />
            <Route path="regional" element={<RegionalTab />} />
            <Route path="invoice" element={<InvoiceTab />} />
            <Route path="proposal" element={<ProposalTab />} />
            <Route path="domain" element={<DomainTab />} />
            <Route path="users" element={<UsersTab />} />
            <Route path="roles" element={<RolesTab />} />
            <Route path="audit" element={<AuditTab />} />
            <Route path="account" element={<AccountTab />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
