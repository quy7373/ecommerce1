import { memo } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProductImage } from '@/components/ui/ProductImage';
import { formatMoney } from '@/lib/money';
import type { Product } from '@/lib/types';
import { prefetchProduct } from './productsApi';
import { StockBadge } from './StockBadge';

interface ProductCardProps {
  product: Product;
  onAddToCart?: (product: Product) => void;
  adding?: boolean;
  priority?: boolean;
}

export const ProductCard = memo(function ProductCard({
  product,
  onAddToCart,
  adding = false,
  priority = false,
}: ProductCardProps) {
  const outOfStock = !product.active || product.availableQuantity <= 0;
  const handlePrefetch = () => prefetchProduct(product.id);

  return (
    <article
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      className="group flex flex-col overflow-hidden rounded-2xl border border-[#E6E4DD] bg-white shadow-[0_1px_2px_rgba(17,21,28,0.04)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[#CBC7BC] hover:shadow-[0_14px_30px_rgba(17,21,28,0.08)]"
    >
      <Link
        to={`/products/${product.id}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-[#EFEDE7]"
      >
        <ProductImage
          src={product.imageUrl}
          alt={product.name}
          priority={priority}
          className="h-full w-full transition-transform duration-500 ease-out will-change-transform group-hover:scale-[1.04]"
        />
        <div className="absolute right-3 top-3">
          <div className="rounded-full bg-white/90 backdrop-blur-xs shadow-xs">
            <StockBadge availableQuantity={product.availableQuantity} active={product.active} />
          </div>
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-[#0F4C81]">
            {product.category.name}
          </span>
          <span className="text-[11px] font-mono text-[#7A828F]">{product.sku}</span>
        </div>

        <Link
          to={`/products/${product.id}`}
          className="mt-2 line-clamp-2 text-base font-semibold leading-snug text-[#11151C] transition-colors group-hover:text-[#0F4C81]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {product.name}
        </Link>

        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-[#555E6D]">
          {product.description}
        </p>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#F0EEE8] pt-4 mt-5">
          <p
            className="text-xl font-bold tracking-tight text-[#11151C] tabular-nums"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {formatMoney(product.price)}
          </p>

          {onAddToCart && (
            <Button
              size="sm"
              variant={outOfStock ? 'outline' : 'secondary'}
              disabled={outOfStock}
              loading={adding}
              onClick={() => onAddToCart(product)}
              aria-label={`Add ${product.name} to cart`}
              className="rounded-xl px-3.5"
            >
              <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{outOfStock ? 'Unavailable' : 'Add'}</span>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
});
