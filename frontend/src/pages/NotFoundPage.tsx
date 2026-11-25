import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center space-y-4">
      <p className="text-sm font-semibold text-[#0F4C81] tabular-nums">404</p>
      <h1 className="text-3xl font-bold text-[#161B22]">Page not found</h1>
      <p className="text-sm text-[#525C68]">
        The page you requested does not exist or has moved.
      </p>
      <div className="pt-2">
        <Link to="/">
          <Button variant="primary">Return to catalog</Button>
        </Link>
      </div>
    </div>
  );
}
