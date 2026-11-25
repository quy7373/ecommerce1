import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  label?: string;
  className?: string;
}

export function Spinner({ label = 'Loading...', className = '' }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-14 text-[#525C68] ${className}`}
    >
      <Loader2 className="h-6 w-6 animate-spin text-[#0F4C81]" aria-hidden="true" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
