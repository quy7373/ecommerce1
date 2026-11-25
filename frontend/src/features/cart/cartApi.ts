import { apiClient } from '@/lib/apiClient';
import type { Cart, DataEnvelope } from '@/lib/types';

export async function getCart(): Promise<Cart> {
  const response = await apiClient.get<DataEnvelope<Cart>>('/cart');
  return response.data.data;
}

export async function addCartItem(payload: {
  productId: string;
  quantity: number;
  cartVersion: number;
}): Promise<Cart> {
  const response = await apiClient.post<DataEnvelope<Cart>>('/cart/items', payload);
  return response.data.data;
}

export async function updateCartItem(
  productId: string,
  payload: { quantity: number; cartVersion: number }
): Promise<Cart> {
  const response = await apiClient.patch<DataEnvelope<Cart>>(
    `/cart/items/${encodeURIComponent(productId)}`,
    payload
  );
  return response.data.data;
}

export async function removeCartItem(productId: string, cartVersion: number): Promise<Cart> {
  const response = await apiClient.delete<DataEnvelope<Cart>>(
    `/cart/items/${encodeURIComponent(productId)}`,
    { data: { cartVersion } }
  );
  return response.data.data;
}
