import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { Spinner } from '@/components/ui/Spinner';

export function MainLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-[#F6F5F1] text-[#11151C]">
      <Navbar />
      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
      >
        <Suspense fallback={<Spinner label="Loading page..." />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
