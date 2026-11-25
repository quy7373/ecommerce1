import {
  Clock,
  CheckCircle2,
  Package,
  Truck,
  XCircle,
  AlertOctagon,
  Hourglass,
} from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { OrderStatus } from '@/lib/types';

const STATUS_META: Record<
  OrderStatus,
  { label: string; tone: BadgeTone; icon: typeof Clock }
> = {
  PENDING_PAYMENT: { label: 'Pending Payment', tone: 'warning', icon: Clock },
  PAID: { label: 'Paid', tone: 'success', icon: CheckCircle2 },
  PROCESSING: { label: 'Processing', tone: 'info', icon: Package },
  SHIPPED: { label: 'Shipped', tone: 'success', icon: Truck },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: XCircle },
  EXPIRED: { label: 'Expired', tone: 'neutral', icon: Hourglass },
  PAYMENT_REVIEW: { label: 'Payment Review', tone: 'danger', icon: AlertOctagon },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{meta.label}</span>
    </Badge>
  );
}
