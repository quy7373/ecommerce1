import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string;
  hint?: string;
}

export function PasswordInput({
  id,
  label,
  error,
  hint,
  className = '',
  required,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputId = id || `input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-[#161B22]">
        {label}
        {required && (
          <span className="ml-0.5 text-[#B42318]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`block w-full rounded-lg border bg-white py-2.5 pl-3.5 pr-11 text-sm text-[#11151C] placeholder:text-[#8C96A2] transition-all focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15 disabled:bg-[#EFEDE7] disabled:text-[#555E6D] ${
            error
              ? 'border-[#B42318] focus:border-[#B42318] focus:ring-[#B42318]/15'
              : 'border-[#D8D5CC]'
          } ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? 'Hide input value' : 'Show input value'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-[#555E6D] hover:text-[#11151C] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0F4C81] cursor-pointer"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {hint && !error && (
        <p id={hintId} className="text-xs text-[#525C68]">
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
