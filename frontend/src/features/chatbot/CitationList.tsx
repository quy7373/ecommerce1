import { FileText } from 'lucide-react';
import type { SupportCitation } from '@/lib/types';

interface CitationListProps {
  citations: SupportCitation[];
}

export function CitationList({ citations }: CitationListProps) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-3 border-t border-[#DDE2E7] pt-2.5">
      <p className="text-xs font-medium text-[#525C68]">Verified sources ({citations.length})</p>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {citations.map((c, idx) => (
          <li
            key={`${c.documentId}-${c.section}-${idx}`}
            className="inline-flex items-center gap-1.5 rounded border border-[#DDE2E7] bg-[#F7F8F9] px-2.5 py-1 text-xs text-[#161B22]"
          >
            <FileText className="h-3.5 w-3.5 text-[#0F4C81] shrink-0" aria-hidden="true" />
            <span className="font-medium">{c.title}</span>
            <span className="text-[#8C96A2]">/</span>
            <span className="text-[#525C68]">{c.section}</span>
            <span className="text-[#6B7684] tabular-nums">v{c.version}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
