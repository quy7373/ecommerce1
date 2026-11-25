import { Link } from 'react-router-dom';
import { ShieldCheck, Truck, Sparkles } from 'lucide-react';

export function Footer() {
  return (
    <footer className="mt-auto border-t border-[#E6E4DD] bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 border-b border-[#EFEDE7] pb-8 md:grid-cols-12">
          <div className="md:col-span-5 space-y-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2.5 text-base font-bold tracking-tight text-[#11151C]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <span
                className="flex h-6 w-6 items-center justify-center rounded-md bg-[#11151C]"
                aria-hidden="true"
              >
                <span className="h-2 w-2 rounded-[2px] bg-[#3B9EFF]" />
              </span>
              <span>Kanto</span>
            </Link>
            <p className="max-w-sm text-sm leading-relaxed text-[#555E6D]">
              Precision workspace hardware and tactile desk goods crafted for calm, uninterrupted
              focus.
            </p>
          </div>

          <div className="md:col-span-4 space-y-2.5 text-xs text-[#555E6D]">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#11151C]">
              Store Guarantees
            </p>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#0F4C81] shrink-0" aria-hidden="true" />
              <span>Hosted Stripe Checkout (US test mode)</span>
            </div>
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-[#157347] shrink-0" aria-hidden="true" />
              <span>Real-time server-verified inventory reservations</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#9A5B13] shrink-0" aria-hidden="true" />
              <span>Grounded AI Support with cited store policies</span>
            </div>
          </div>

          <div className="md:col-span-3 space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#11151C]">
              Navigation
            </p>
            <div className="flex flex-col gap-2 text-sm text-[#555E6D]">
              <Link to="/" className="hover:text-[#11151C] transition-colors">
                Catalog
              </Link>
              <Link to="/support" className="hover:text-[#11151C] transition-colors">
                AI Support
              </Link>
              <Link to="/account" className="hover:text-[#11151C] transition-colors">
                Orders
              </Link>
              <Link to="/cart" className="hover:text-[#11151C] transition-colors">
                Shopping Cart
              </Link>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 pt-6 text-xs text-[#6B7684] sm:flex-row">
          <p>© {new Date().getFullYear()} Kanto Workspace Goods. US test-mode storefront (USD).</p>
          <p>HttpOnly session security · Exact USD pricing</p>
        </div>
      </div>
    </footer>
  );
}
