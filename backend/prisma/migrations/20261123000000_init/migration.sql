-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'ADMIN');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'CANCELLED', 'EXPIRED', 'PAYMENT_REVIEW');
CREATE TYPE "CheckoutState" AS ENUM ('NOT_STARTED', 'CREATING', 'READY', 'RECONCILING', 'CLOSED');
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');
CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED', 'REVIEW');
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'REVIEW');
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "AuditResourceType" AS ENUM ('PRODUCT', 'ORDER');
CREATE TYPE "AuditAction" AS ENUM ('CREATE_PRODUCT', 'UPDATE_PRODUCT', 'ARCHIVE_PRODUCT', 'UPDATE_ORDER_STATUS');
CREATE TYPE "SecurityAuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE', 'REVIEW');
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateTable: User
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "googleSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuthSession
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "csrfTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OAuthAttempt
CREATE TABLE "OAuthAttempt" (
    "id" UUID NOT NULL,
    "stateHash" TEXT NOT NULL,
    "browserBindingHash" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "encryptedCodeVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Category
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Product
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "imageUrl" TEXT,
    "stockOnHand" INTEGER NOT NULL,
    "stockReserved" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Product_price_check" CHECK ("price" >= 1 AND "price" <= 100000000),
    CONSTRAINT "Product_currency_check" CHECK ("currency" = 'USD'),
    CONSTRAINT "Product_stock_check" CHECK ("stockOnHand" >= 0 AND "stockOnHand" <= 1000000 AND "stockReserved" >= 0 AND "stockReserved" <= "stockOnHand"),
    CONSTRAINT "Product_version_check" CHECK ("version" >= 1)
);

-- CreateTable: Cart
CREATE TABLE "Cart" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Cart_version_check" CHECK ("version" >= 1)
);

-- CreateTable: CartItem
CREATE TABLE "CartItem" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CartItem_quantity_check" CHECK ("quantity" >= 1 AND "quantity" <= 99)
);

-- CreateTable: Order
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "cartVersion" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "shippingAddress" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "shippingTotal" INTEGER NOT NULL,
    "taxTotal" INTEGER NOT NULL,
    "grandTotal" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reservationExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "stripeSessionId" TEXT,
    "checkoutState" "CheckoutState" NOT NULL DEFAULT 'NOT_STARTED',
    "checkoutClaimUntil" TIMESTAMPTZ(6),
    "checkoutFirstAttemptAt" TIMESTAMPTZ(6),
    "checkoutRequestedExpiresAt" TIMESTAMPTZ(6),
    "cancellationRequestedAt" TIMESTAMPTZ(6),
    "paidAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Order_totals_check" CHECK (
        "subtotal" >= 0 AND "subtotal" <= 100000000
        AND "shippingTotal" >= 0 AND "shippingTotal" <= 100000000
        AND "taxTotal" >= 0 AND "taxTotal" <= 100000000
        AND "grandTotal" >= 0 AND "grandTotal" <= 100000000
        AND "grandTotal" = "subtotal" + "shippingTotal" + "taxTotal"
    ),
    CONSTRAINT "Order_currency_check" CHECK ("currency" = 'USD'),
    CONSTRAINT "Order_version_check" CHECK ("version" >= 1),
    CONSTRAINT "Order_cartVersion_check" CHECK ("cartVersion" >= 1)
);

-- CreateTable: OrderItem
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderItem_bounds_check" CHECK (
        "unitPrice" >= 1 AND "unitPrice" <= 100000000
        AND "quantity" >= 1 AND "quantity" <= 99
        AND "lineTotal" = "unitPrice" * "quantity"
        AND "lineTotal" <= 100000000
    )
);

-- CreateTable: InventoryReservation
CREATE TABLE "InventoryReservation" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryReservation_quantity_check" CHECK ("quantity" >= 1 AND "quantity" <= 99)
);

-- CreateTable: Payment
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentStatus" NOT NULL,
    "paidAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_amount_check" CHECK ("amount" >= 1 AND "amount" <= 100000000),
    CONSTRAINT "Payment_currency_check" CHECK ("currency" = 'USD')
);

-- CreateTable: WebhookEvent
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderId" UUID,
    "sessionId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimUntil" TIMESTAMPTZ(6),
    "lastErrorCode" TEXT,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WebhookEvent_attempts_check" CHECK ("attempts" >= 0)
);

-- CreateTable: IdempotencyRecord
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "resourceId" UUID,
    "claimUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "resourceType" "AuditResourceType" NOT NULL,
    "resourceId" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "changes" JSONB NOT NULL,
    "requestId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SecurityAuditOutbox
CREATE TABLE "SecurityAuditOutbox" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" UUID,
    "actorId" UUID,
    "resourceType" TEXT,
    "resourceId" UUID,
    "outcome" "SecurityAuditOutcome" NOT NULL,
    "reasonCode" TEXT,
    "metadata" JSONB NOT NULL,
    "exportedAt" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityAuditOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SecurityAuditOutbox_attempts_check" CHECK ("attempts" >= 0)
);

-- CreateTable: KnowledgeDocument
CREATE TABLE "KnowledgeDocument" (
    "id" UUID NOT NULL,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "owner" TEXT NOT NULL,
    "approvedAt" TIMESTAMPTZ(6),
    "sourcePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable: KnowledgeChunk
CREATE TABLE "KnowledgeChunk" (
    "id" UUID NOT NULL,
    "documentVersionId" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeChunk_ordinal_check" CHECK ("ordinal" >= 0)
);

-- Unique & Query Indexes
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");
CREATE UNIQUE INDEX "OAuthAttempt_stateHash_key" ON "OAuthAttempt"("stateHash");
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE INDEX "Product_categoryId_active_price_id_idx" ON "Product"("categoryId", "active", "price", "id");
CREATE INDEX "Product_active_createdAt_id_idx" ON "Product"("active", "createdAt", "id");
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");
CREATE UNIQUE INDEX "CartItem_cartId_productId_key" ON "CartItem"("cartId", "productId");
CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "Order"("stripeSessionId");
CREATE INDEX "Order_userId_createdAt_id_idx" ON "Order"("userId", "createdAt", "id");
CREATE INDEX "Order_status_reservationExpiresAt_idx" ON "Order"("status", "reservationExpiresAt");
CREATE UNIQUE INDEX "Order_one_pending_per_cart_version_idx" ON "Order"("cartId", "cartVersion") WHERE "status" = 'PENDING_PAYMENT';
CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");
CREATE UNIQUE INDEX "InventoryReservation_orderId_productId_key" ON "InventoryReservation"("orderId", "productId");
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "InventoryReservation"("status", "expiresAt");
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");
CREATE UNIQUE INDEX "Payment_stripeSessionId_key" ON "Payment"("stripeSessionId");
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");
CREATE UNIQUE INDEX "WebhookEvent_stripeEventId_key" ON "WebhookEvent"("stripeEventId");
CREATE INDEX "WebhookEvent_status_nextAttemptAt_idx" ON "WebhookEvent"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "IdempotencyRecord_userId_method_route_key_key" ON "IdempotencyRecord"("userId", "method", "route", "key");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE INDEX "AuditLog_resourceType_resourceId_createdAt_idx" ON "AuditLog"("resourceType", "resourceId", "createdAt");
CREATE INDEX "SecurityAuditOutbox_exportedAt_nextAttemptAt_idx" ON "SecurityAuditOutbox"("exportedAt", "nextAttemptAt");
CREATE UNIQUE INDEX "KnowledgeDocument_documentId_version_key" ON "KnowledgeDocument"("documentId", "version");
CREATE UNIQUE INDEX "KnowledgeDocument_one_approved_per_doc_idx" ON "KnowledgeDocument"("documentId") WHERE "status" = 'APPROVED';
CREATE UNIQUE INDEX "KnowledgeChunk_documentVersionId_section_ordinal_key" ON "KnowledgeChunk"("documentVersionId", "section", "ordinal");
CREATE INDEX "KnowledgeChunk_documentVersionId_idx" ON "KnowledgeChunk"("documentVersionId");

-- Foreign Keys
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
