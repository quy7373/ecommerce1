import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[#0F4C81] text-white shadow-[0_1px_2px_rgba(15,76,129,0.28)] hover:bg-[#0B3B66] active:bg-[#082D4D] disabled:bg-[#0F4C81]/40 disabled:shadow-none',
  secondary:
    'bg-[#11151C] text-white shadow-[0_1px_2px_rgba(17,21,28,0.25)] hover:bg-[#232A36] active:bg-[#0A0D12] disabled:bg-[#11151C]/40 disabled:shadow-none',
  outline:
    'border border-[#D8D5CC] bg-white text-[#11151C] shadow-[0_1px_2px_rgba(17,21,28,0.03)] hover:border-[#ABA79B] hover:bg-[#FAF9F6] active:bg-[#EFEDE7] disabled:text-[#8C96A2]',
  danger:
    'bg-[#B42318] text-white shadow-[0_1px_2px_rgba(180,35,24,0.25)] hover:bg-[#912018] active:bg-[#7A1B14] disabled:bg-[#B42318]/40 disabled:shadow-none',
  ghost:
    'text-[#555E6D] hover:bg-[#EFEDE7] hover:text-[#11151C] active:bg-[#E6E4DD] disabled:text-[#9AA3AE]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs sm:text-sm rounded-lg gap-1.5',
  md: 'px-4 py-2 text-sm rounded-lg gap-2',
  lg: 'px-5 py-2.5 text-sm rounded-xl gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}
