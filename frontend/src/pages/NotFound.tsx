import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';

export function NotFound() {
  return <EmptyState title="Page not found" description="That page doesn't exist, or you don't have access to it." action={<Link className="text-sm text-accent hover:underline" to="/dashboard">Back to dashboard</Link>} />;
}
