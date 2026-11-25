import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { isSafeImageUrl } from '@/lib/validation';

interface ProductImageProps {
  src: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
}

export function ProductImage({
  src,
  alt,
  className = '',
  priority = false,
}: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  const validSrc = !failed && isSafeImageUrl(src) ? src : null;

  if (!validSrc) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#EFEDE7] to-[#E6E3DA] text-[#8C897E] ${className}`}
      >
        <Package className="h-9 w-9 stroke-[1.4]" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={validSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={`object-cover bg-[#EFEDE7] transition-opacity duration-300 ${
        loaded ? 'opacity-100' : 'opacity-0'
      } ${className}`}
    />
  );
}
