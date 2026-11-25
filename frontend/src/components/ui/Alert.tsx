import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import type { ErrorDetail } from '@/lib/types';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  details?: ErrorDetail[];
  requestId?: string | null;
  className?: string;
}

const styles: Record<AlertTone, { container: string; icon: typeof Info }> = {
  info: {
    container: 'border-[#C4DCF0] bg-[#EDF4FA] text-[#0B3A63]',
    icon: Info,
  },
  success: {
    container: 'border-[#C4E7D5] bg-[#ECF7F1] text-[#14523A]',
    icon: CheckCircle2,
  },
  warning: {
    container: 'border-[#F2D8AE] bg-[#FDF6EC] text-[#7A460E]',
    icon: AlertTriangle,
  },
  error: {
    container: 'border-[#F9C6C2] bg-[#FEF3F2] text-[#912018]',
    icon: AlertCircle,
  },
};

export function Alert({
  tone = 'info',
  title,
  children,
  details,
  requestId,
  className = '',
}: AlertProps) {
  const { container, icon: Icon } = styles[tone];
  const role = tone === 'error' || tone === 'warning' ? 'alert' : 'status';

  return (
    <div
      role={role}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${container} ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
        {details && details.length > 0 && (
          <ul className="mt-2 list-disc pl-4 space-y-0.5 text-xs">
            {details.map((d, idx) => (
              <li key={`${d.field}-${d.code}-${idx}`}>
                <span className="font-medium">{d.field}:</span> {d.message}
              </li>
            ))}
          </ul>
        )}
        {requestId && <p className="pt-1 text-xs opacity-75">Reference ID: {requestId}</p>}
      </div>
    </div>
  );
}
