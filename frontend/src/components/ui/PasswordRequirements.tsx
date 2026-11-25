import { Check, Circle } from 'lucide-react';
import { evaluatePasswordPolicy } from '@/lib/validation';

interface PasswordRequirementsProps {
  password: string;
}

export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  const status = evaluatePasswordPolicy(password);
  const items = [
    { key: 'length', met: status.length, label: '8–128 characters' },
    { key: 'uppercase', met: status.uppercase, label: 'Uppercase letter (A–Z)' },
    { key: 'lowercase', met: status.lowercase, label: 'Lowercase letter (a–z)' },
    { key: 'digit', met: status.digit, label: 'Number (0–9)' },
    { key: 'special', met: status.special, label: 'Special character (!@#$...)' },
  ];

  const metCount = items.filter((item) => item.met).length;
  const pct = Math.round((metCount / items.length) * 100);

  return (
    <div className="space-y-2 pt-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#EFEDE7]">
        <div
          className={`h-full transition-all duration-200 ${
            status.valid ? 'bg-[#157347]' : metCount >= 3 ? 'bg-[#0F4C81]' : 'bg-[#D97706]'
          }`}
          style={{ width: `${password.length > 0 ? Math.max(pct, 12) : 0}%` }}
        />
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 text-[11px]">
        {items.map((item) => (
          <li
            key={item.key}
            className={`inline-flex items-center gap-1.5 transition-colors ${
              item.met ? 'text-[#157347] font-medium' : 'text-[#6B7684]'
            }`}
          >
            {item.met ? (
              <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <Circle className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden="true" />
            )}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
