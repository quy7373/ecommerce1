import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidthClass?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidthClass = 'max-w-xl',
}: ModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#11151C]/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto rounded-2xl border border-[#E6E4DD] bg-white shadow-2xl`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E6E4DD] bg-white/95 backdrop-blur-sm px-6 py-4">
          <h2 id="modal-title" className="text-lg font-semibold text-[#11151C]">
            {title}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-[#555E6D] transition-colors hover:bg-[#EFEDE7] hover:text-[#11151C] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
