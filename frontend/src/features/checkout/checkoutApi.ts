import { apiClient } from '@/lib/apiClient';
import type { Checkout, DataEnvelope } from '@/lib/types';

export async function createCheckoutSession(
  orderId: string,
  idempotencyKey: string
): Promise<Checkout> {
  const response = await apiClient.post<DataEnvelope<Checkout>>(
    '/checkout/sessions',
    { orderId },
    {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    }
  );
  return response.data.data;
}
