import { useQuery } from '@tanstack/react-query';
import { api, qs } from './api';
import type { Page } from './format';

export interface DirectoryUser { id: string; name: string; roleKeys: string[] }
export const useDirectory = () =>
  useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ data: DirectoryUser[] }>('/users/directory').then((r) => r.data), staleTime: 60_000, retry: false });

export interface CustomerLite { id: string; name: string; phone: string | null; email: string | null; addresses?: { id: string; label: string; line1: string; city: string | null; isDefault: boolean }[] }
export const useCustomerOptions = (enabled = true) =>
  useQuery({ queryKey: ['customer-options'], queryFn: () => api.get<Page<CustomerLite>>(`/customers${qs({ pageSize: 100, sort: 'name', order: 'asc' })}`).then((r) => r.data), staleTime: 30_000, enabled });

export interface Supplier { id: string; name: string; contactPerson: string | null; email: string | null; phone: string | null; address: string | null; taxId: string | null; paymentTerms: string | null; notes: string | null; _count?: { equipment: number; purchaseOrders: number } }
export const useSuppliers = (enabled = true) =>
  useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Page<Supplier>>(`/equipment/suppliers${qs({ pageSize: 100, sort: 'name', order: 'asc' })}`).then((r) => r.data), staleTime: 30_000, enabled });
