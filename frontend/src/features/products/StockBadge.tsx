import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface StockBadgeProps {
  availableQuantity: number;
  active?: boolean;
}

export function StockBadge({ availableQuantity, active = true }: StockBadgeProps) {
  if (!active) {
    return (
      <Badge tone="neutral">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Archived</span>
      </Badge>
    );
  }

  if (availableQuantity <= 0) {
    return (
      <Badge tone="danger">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Out of Stock</span>
      </Badge>
    );
  }

  if (availableQuantity <= 5) {
    return (
      <Badge tone="warning">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Only {availableQuantity} left</span>
      </Badge>
    );
  }

  return (
    <Badge tone="success">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      <span>In Stock ({availableQuantity})</span>
    </Badge>
  );
}
