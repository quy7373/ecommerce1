import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  consequence?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  consequence,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-md">
      <div className="space-y-5">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F9C6C2] bg-[#FEF3F2] text-[#B42318]">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1.5 text-sm">
            <p className="font-medium text-[#11151C] leading-relaxed">{description}</p>
            {consequence && (
              <p className="text-xs text-[#B42318] leading-relaxed">{consequence}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-[#EFEDE7] pt-4">
          <Button variant="outline" size="sm" disabled={loading} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant="danger" size="sm" loading={loading} onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
