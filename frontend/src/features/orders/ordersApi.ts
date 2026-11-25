import { apiClient } from '@/lib/apiClient';
import type {
  Address,
  Cancellation,
  DataEnvelope,
  Order,
  OrderQueryParams,
  Page,
} from '@/lib/types';

function cleanQuery(params: OrderQueryParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params.status) query.status = params.status;
  return query;
}

export async function listOrders(params: OrderQueryParams = {}): Promise<Page<Order>> {
  const response = await apiClient.get<Page<Order>>('/orders', {
    params: cleanQuery(params),
  });
  return response.data;
}

export async function getOrder(orderId: string): Promise<Order> {
  const response = await apiClient.get<DataEnvelope<Order>>(`/orders/${encodeURIComponent(orderId)}`);
  return response.data.data;
}

export async function createOrder(
  payload: { cartVersion: number; shippingAddress: Address },
  idempotencyKey: string
): Promise<Order> {
  const response = await apiClient.post<DataEnvelope<Order>>('/orders', payload, {
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
  });
  return response.data.data;
}

export async function cancelOrder(orderId: string): Promise<Cancellation> {
  const response = await apiClient.post<DataEnvelope<Cancellation>>(
    `/orders/${encodeURIComponent(orderId)}/cancel`,
    {}
  );
  return response.data.data;
}

export async function deleteOrder(orderId: string): Promise<void> {
  await apiClient.delete(`/orders/${encodeURIComponent(orderId)}`);
}

export async function listAdminOrders(params: OrderQueryParams = {}): Promise<Page<Order>> {
  const response = await apiClient.get<Page<Order>>('/admin/orders', {
    params: cleanQuery(params),
  });
  return response.data;
}

export async function getAdminOrder(orderId: string): Promise<Order> {
  const response = await apiClient.get<DataEnvelope<Order>>(
    `/admin/orders/${encodeURIComponent(orderId)}`
  );
  return response.data.data;
}

export async function updateAdminOrderStatus(
  orderId: string,
  payload: { status: 'PROCESSING' | 'SHIPPED'; version: number }
): Promise<Order> {
  const response = await apiClient.patch<DataEnvelope<Order>>(
    `/admin/orders/${encodeURIComponent(orderId)}/status`,
    payload
  );
  return response.data.data;
}

export async function createAdminOrder(payload: {
  customerEmail?: string;
  items: { productId: string; quantity: number }[];
  shippingAddress: Address;
}): Promise<Order> {
  const response = await apiClient.post<DataEnvelope<Order>>('/admin/orders', payload);
  return response.data.data;
}

export async function updateAdminOrder(
  orderId: string,
  payload: { status?: Order['status']; shippingAddress?: Address; version: number }
): Promise<Order> {
  const response = await apiClient.patch<DataEnvelope<Order>>(
    `/admin/orders/${encodeURIComponent(orderId)}`,
    payload
  );
  return response.data.data;
}

export async function deleteAdminOrder(orderId: string, version: number): Promise<void> {
  await apiClient.delete(`/admin/orders/${encodeURIComponent(orderId)}`, {
    data: { version },
  });
}
