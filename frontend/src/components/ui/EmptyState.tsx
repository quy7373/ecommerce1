import type { ReactNode } from 'react';
import { PackageOpen } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#D8D5CC] bg-white/80 px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#EFEDE7] text-[#555E6D]">
        {icon || <PackageOpen className="h-5 w-5" aria-hidden="true" />}
      </div>
      <h3 className="text-base font-semibold text-[#11151C]">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[#555E6D]">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
