// Exact API contract v1 types (docs/api/api-contract.md)

export type UUID = string;
export type Instant = string;
export type Money = number; // integer cents 0..100000000
export type CartMoney = number; // integer cents 0..495000000000
export type Qty = number; // integer 1..99

export type Role = 'CUSTOMER' | 'ADMIN';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'PAYMENT_REVIEW';

export interface User {
  id: UUID;
  email: string;
  displayName: string;
  role: Role;
}

export interface SessionResponse {
  user: User;
  csrfToken: string;
  expiresAt: Instant;
}

export interface PreauthCsrfResponse {
  csrfToken: string;
  expiresAt: Instant;
}

export interface AuthMessageResponse {
  message: string;
}

export interface PasswordLoginResponse {
  user: User;
  expiresAt: Instant;
}

export interface Category {
  id: UUID;
  name: string;
  slug: string;
}

export interface Product {
  id: UUID;
  sku: string;
  name: string;
  description: string;
  category: Category;
  price: Money;
  currency: 'USD';
  imageUrl: string | null;
  availableQuantity: number;
  active: boolean;
  version: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface Address {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: 'US';
  phone?: string;
}

export interface CartItem {
  product: Product;
  quantity: Qty;
  lineTotal: CartMoney;
}

export interface Cart {
  id: UUID;
  version: number;
  items: CartItem[];
  subtotal: CartMoney;
  shippingTotal: Money;
  taxTotal: Money;
  grandTotal: CartMoney;
  currency: 'USD';
}

export interface OrderItem {
  productId: UUID;
  sku: string;
  name: string;
  unitPrice: Money;
  quantity: Qty;
  lineTotal: Money;
}

export interface Order {
  id: UUID;
  status: OrderStatus;
  items: OrderItem[];
  shippingAddress: Address;
  subtotal: Money;
  shippingTotal: Money;
  taxTotal: Money;
  grandTotal: Money;
  currency: 'USD';
  createdAt: Instant;
  updatedAt: Instant;
  reservationExpiresAt: Instant;
  paidAt: Instant | null;
  cancellationRequestedAt: Instant | null;
  version: number;
}

export interface Checkout {
  orderId: UUID;
  sessionId: string;
  checkoutUrl: string;
  expiresAt: Instant;
}

export interface Cancellation {
  order: Order;
  pending: boolean;
}

export interface ErrorDetail {
  field: string;
  code: 'REQUIRED' | 'TYPE' | 'FORMAT' | 'RANGE' | 'UNKNOWN_FIELD' | 'CONFLICT' | string;
  message: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
    requestId: string;
  };
}

export interface ProductWrite {
  sku: string;
  name: string;
  description: string;
  categoryId: UUID;
  price: Money;
  imageUrl: string | null;
  stockOnHand: number;
  active: boolean;
}

export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'name_asc';

export interface ProductQueryParams {
  q?: string;
  categoryId?: UUID;
  minPrice?: Money;
  maxPrice?: Money;
  inStock?: boolean;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
}

export interface AdminProductQueryParams extends ProductQueryParams {
  active?: boolean;
}

export interface OrderQueryParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
}

export interface SupportCitation {
  documentId: string;
  title: string;
  version: string;
  section: string;
}

export interface SupportResponse {
  answer: string;
  citations: SupportCitation[];
  escalated: boolean;
}

export interface DataEnvelope<T> {
  data: T;
}
