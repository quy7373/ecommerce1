import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-[#F3F2EE] text-[#3E4752] border-[#E2DFD7]',
  success: 'bg-[#ECF7F1] text-[#157347] border-[#C4E7D5]',
  warning: 'bg-[#FDF6EC] text-[#9A5B13] border-[#F2D8AE]',
  danger: 'bg-[#FEF3F2] text-[#B42318] border-[#F9C6C2]',
  info: 'bg-[#EDF4FA] text-[#0F4C81] border-[#C4DCF0]',
};

export function Badge({ tone = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
