import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { useAuth } from './AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Spinner label="Verifying your session..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (requireAdmin && !isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#FEF3F2] text-[#B42318] border border-[#F9C6C2]">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-[#161B22]">Access Denied</h1>
        <p className="mt-2 text-sm text-[#525C68]">
          Administrator privileges are required to open this area. All admin operations are enforced
          on the server.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/">
            <Button variant="primary">Return to catalog</Button>
          </Link>
          <Link to="/account">
            <Button variant="outline">My account</Button>
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
