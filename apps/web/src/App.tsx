import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { startAuthListener } from '@/features/auth/authService';
import { createAppRouter } from '@/routes/router';

export function App() {
  const [router] = useState(createAppRouter);
  useEffect(() => startAuthListener(), []);
  return <RouterProvider router={router} />;
}
