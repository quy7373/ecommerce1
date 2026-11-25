import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-[#E6E4DD] bg-white shadow-[0_1px_3px_rgba(17,21,28,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}
