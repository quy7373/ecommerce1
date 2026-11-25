import { apiClient } from '@/lib/apiClient';
import type { DataEnvelope, SupportResponse } from '@/lib/types';

export async function sendSupportMessage(message: string): Promise<SupportResponse> {
  const response = await apiClient.post<DataEnvelope<SupportResponse>>(
    '/support/messages',
    { message },
    { timeout: 10000 }
  );
  return response.data.data;
}
