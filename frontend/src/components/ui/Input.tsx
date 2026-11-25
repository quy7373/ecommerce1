import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Input({
  id,
  label,
  error,
  hint,
  className = '',
  required,
  ...props
}: InputProps) {
  const inputId = id || `input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-[#11151C]">
        {label}
        {required && (
          <span className="ml-0.5 text-[#B42318]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-[#11151C] placeholder:text-[#8C96A2] transition-all focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15 disabled:bg-[#EFEDE7] disabled:text-[#555E6D] ${
          error ? 'border-[#B42318] focus:border-[#B42318] focus:ring-[#B42318]/15' : 'border-[#D8D5CC]'
        } ${className}`}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-[#555E6D]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-[#B42318]">
          {error}
        </p>
      )}
    </div>
  );
}
