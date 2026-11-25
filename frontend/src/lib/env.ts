export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');

export const APPROVED_IMAGE_HOSTS: string[] = (import.meta.env.VITE_APPROVED_IMAGE_HOSTS || '')
  .split(',')
  .map((host: string) => host.trim().toLowerCase())
  .filter(Boolean);
