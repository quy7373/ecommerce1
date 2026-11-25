import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { PaginationMeta } from '@/lib/types';

interface PaginationProps {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
}

export function Pagination({ pagination, onPageChange }: PaginationProps) {
  const { page, totalPages, totalItems } = pagination;
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-4 border-t border-[#DDE2E7] pt-5"
    >
      <p className="text-sm text-[#525C68] tabular-nums">
        Page <span className="font-semibold text-[#161B22]">{page}</span> of{' '}
        <span className="font-semibold text-[#161B22]">{totalPages}</span> ({totalItems} items)
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span>Previous</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
