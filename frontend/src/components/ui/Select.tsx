import type { SelectHTMLAttributes, ReactNode } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  children: ReactNode;
}

export function Select({
  id,
  label,
  error,
  className = '',
  required,
  children,
  ...props
}: SelectProps) {
  const selectId = id || `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={selectId} className="block text-sm font-medium text-[#161B22]">
        {label}
        {required && (
          <span className="ml-0.5 text-[#B42318]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <select
        id={selectId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={`block w-full rounded border bg-white px-3 py-2 text-sm text-[#161B22] transition-colors focus:border-[#0F4C81] focus:ring-2 focus:ring-[#0F4C81]/15 disabled:bg-[#ECEFF2] ${
          error ? 'border-[#B42318]' : 'border-[#CBD2D9]'
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-[#B42318]">
          {error}
        </p>
      )}
    </div>
  );
}
