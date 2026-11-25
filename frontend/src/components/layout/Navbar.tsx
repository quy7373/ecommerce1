import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  User as UserIcon,
  ShieldCheck,
  MessageSquareText,
  Menu,
  X,
  LogOut,
  LogIn,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/CartContext';
import { useTheme } from '@/features/theme/ThemeContext';
import { Button } from '@/components/ui/Button';

export function Navbar() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const { itemCount, clearLocalCart } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      clearLocalCart();
      setMobileOpen(false);
      navigate('/');
    } finally {
      setLoggingOut(false);
    }
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
      isActive
        ? 'bg-[#11151C] text-white shadow-xs'
        : 'text-[#555E6D] hover:bg-[#EFEDE7] hover:text-[#11151C]'
    }`;

  const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-[#11151C] text-white'
        : 'text-[#555E6D] hover:bg-[#EFEDE7] hover:text-[#11151C]'
    }`;

  const userInitial = user?.displayName?.trim().charAt(0).toUpperCase() || 'U';

  return (
    <header className="sticky top-0 z-40 border-b border-[#E6E4DD] bg-white/85 backdrop-blur-md">
      <a
        href="#main-content"
        className="sr-only-focusable absolute left-4 top-2 z-50 rounded-lg bg-[#0F4C81] px-3 py-2 text-sm font-semibold text-white"
      >
        Skip to main content
      </a>

      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link
            to="/"
            className="group flex items-center gap-2.5 text-lg font-bold tracking-tight text-[#11151C]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#11151C] transition-transform duration-200 group-hover:scale-105"
              aria-hidden="true"
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[#3B9EFF]" />
            </span>
            <span className="tracking-[-0.03em]">Kanto</span>
          </Link>

          <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1.5">
            <NavLink to="/" end className={navLinkClass}>
              Catalog
            </NavLink>
            <NavLink to="/support" className={navLinkClass}>
              <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>AI Support</span>
            </NavLink>
            {isAuthenticated && (
              <NavLink to="/account" className={navLinkClass}>
                <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Account</span>
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin" className={navLinkClass}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Admin</span>
              </NavLink>
            )}
          </nav>
        </div>

        <div className="hidden md:flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#D8D5CC] bg-white text-[#555E6D] shadow-[0_1px_2px_rgba(17,21,28,0.03)] transition-colors hover:border-[#ABA79B] hover:bg-[#FAF9F6] hover:text-[#11151C] cursor-pointer"
          >
            {isDark ? (
              <Sun className="h-4 w-4 text-[#FBBF24]" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          <Link
            to="/cart"
            aria-label={`Shopping cart${itemCount > 0 ? `, ${itemCount} items` : ''}`}
            className="inline-flex items-center gap-2 rounded-full border border-[#D8D5CC] bg-white px-3.5 py-1.5 text-sm font-medium text-[#11151C] shadow-[0_1px_2px_rgba(17,21,28,0.03)] transition-all hover:border-[#ABA79B] hover:bg-[#FAF9F6]"
          >
            <ShoppingCart className="h-4 w-4 text-[#555E6D]" aria-hidden="true" />
            <span>Cart</span>
            {itemCount > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#0F4C81] px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                {itemCount}
              </span>
            )}
          </Link>

          {isAuthenticated ? (
            <div className="flex items-center gap-2 pl-3 border-l border-[#E6E4DD]">
              <Link
                to="/account"
                className="flex items-center gap-2 rounded-full bg-[#F3F2EE] py-1 pl-1.5 pr-3 transition-colors hover:bg-[#EAE7DF]"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0F4C81] text-xs font-semibold text-white">
                  {userInitial}
                </span>
                <span className="max-w-32 truncate text-xs font-medium text-[#11151C]">
                  {user?.displayName}
                </span>
              </Link>
              <Button variant="ghost" size="sm" loading={loggingOut} onClick={handleLogout}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>Sign out</span>
              </Button>
            </div>
          ) : (
            <Link to="/login">
              <Button variant="primary" size="sm" className="rounded-full px-4">
                <LogIn className="h-4 w-4" aria-hidden="true" />
                <span>Sign in</span>
              </Button>
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center justify-center rounded-full border border-[#D8D5CC] bg-white p-2 text-[#11151C] cursor-pointer"
          >
            {isDark ? (
              <Sun className="h-5 w-5 text-[#FBBF24]" aria-hidden="true" />
            ) : (
              <Moon className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
          <Link
            to="/cart"
            aria-label={`Shopping cart${itemCount > 0 ? `, ${itemCount} items` : ''}`}
            className="relative inline-flex items-center justify-center rounded-full border border-[#D8D5CC] bg-white p-2 text-[#11151C]"
          >
            <ShoppingCart className="h-5 w-5" aria-hidden="true" />
            {itemCount > 0 && (
              <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[#0F4C81] px-1 text-[11px] font-semibold text-white tabular-nums">
                {itemCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex items-center justify-center rounded-lg p-2 text-[#11151C] hover:bg-[#EFEDE7] cursor-pointer"
          >
            {mobileOpen ? (
              <X className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Menu className="h-6 w-6" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          aria-label="Mobile navigation"
          className="border-t border-[#E6E4DD] bg-white px-4 py-3 space-y-1 md:hidden"
        >
          <NavLink to="/" end onClick={() => setMobileOpen(false)} className={mobileNavLinkClass}>
            Catalog
          </NavLink>
          <NavLink to="/cart" onClick={() => setMobileOpen(false)} className={mobileNavLinkClass}>
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            <span>Cart ({itemCount})</span>
          </NavLink>
          <NavLink to="/support" onClick={() => setMobileOpen(false)} className={mobileNavLinkClass}>
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
            <span>AI Support</span>
          </NavLink>
          {isAuthenticated && (
            <NavLink to="/account" onClick={() => setMobileOpen(false)} className={mobileNavLinkClass}>
              <UserIcon className="h-4 w-4" aria-hidden="true" />
              <span>Account and orders</span>
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" onClick={() => setMobileOpen(false)} className={mobileNavLinkClass}>
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>Admin dashboard</span>
            </NavLink>
          )}

          <div className="border-t border-[#E6E4DD] pt-3 mt-2">
            {isAuthenticated ? (
              <div className="flex items-center justify-between gap-2 px-2">
                <span className="truncate text-sm font-medium text-[#11151C]">
                  {user?.displayName}
                </span>
                <Button variant="outline" size="sm" loading={loggingOut} onClick={handleLogout}>
                  Sign out
                </Button>
              </div>
            ) : (
              <Link to="/login" onClick={() => setMobileOpen(false)} className="block">
                <Button variant="primary" className="w-full">
                  Sign in with Google
                </Button>
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
