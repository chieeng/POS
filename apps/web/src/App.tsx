import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { UpdateBanner } from '@/components/UpdateBanner';
import { startAuthListener } from '@/features/auth/authService';
import { startOutboxSync } from '@/features/outbox/outboxSync';
import { createAppRouter } from '@/routes/router';

export function App() {
  const [router] = useState(createAppRouter);
  useEffect(() => startAuthListener(), []);
  useEffect(() => startOutboxSync(), []);
  return (
    <>
      <UpdateBanner />
      <RouterProvider router={router} />
    </>
  );
}
