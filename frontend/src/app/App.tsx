import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/features/theme/ThemeContext';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { CartProvider } from '@/features/cart/CartContext';
import { MainLayout } from '@/components/layout/MainLayout';
import { HomePage } from '@/pages/HomePage';

const ProductDetailPage = lazy(() =>
  import('@/pages/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage }))
);
const CartPage = lazy(() => import('@/pages/CartPage').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() =>
  import('@/pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage }))
);
const AccountPage = lazy(() =>
  import('@/pages/AccountPage').then((m) => ({ default: m.AccountPage }))
);
const AdminDashboardPage = lazy(() =>
  import('@/pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage }))
);
const SupportCenterPage = lazy(() =>
  import('@/pages/SupportCenterPage').then((m) => ({ default: m.SupportCenterPage }))
);
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('@/pages/RegisterPage').then((m) => ({ default: m.RegisterPage }))
);
const VerifyEmailPage = lazy(() =>
  import('@/pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage }))
);
const ForgotPasswordPage = lazy(() =>
  import('@/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))
);
const ResetPasswordPage = lazy(() =>
  import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
        <CartProvider>
          <Routes>
            <Route element={<MainLayout />}>
                <Route index element={<HomePage />} />
                <Route path="products/:productId" element={<ProductDetailPage />} />
                <Route path="login" element={<LoginPage />} />
                <Route path="register" element={<RegisterPage />} />
                <Route path="verify-email" element={<VerifyEmailPage />} />
                <Route path="forgot-password" element={<ForgotPasswordPage />} />
                <Route path="reset-password" element={<ResetPasswordPage />} />
                <Route path="support" element={<SupportCenterPage />} />

                <Route
                  path="cart"
                  element={
                    <ProtectedRoute>
                      <CartPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="checkout"
                  element={
                    <ProtectedRoute>
                      <CheckoutPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="account"
                  element={
                    <ProtectedRoute>
                      <AccountPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="admin"
                  element={
                    <ProtectedRoute requireAdmin>
                      <AdminDashboardPage />
                    </ProtectedRoute>
                  }
                />

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
