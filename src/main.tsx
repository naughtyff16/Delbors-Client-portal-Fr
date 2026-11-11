import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import './index.css';
import { ToastProvider } from './lib/ui';
import { PortalAuthProvider } from './auth';
import { router } from './router';
import { loadAppConfig } from './lib/shared';
import { applyReleaseContacts } from './lib/api-client/portalAuth';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } } });

// Approved release contacts (app-config.json) are applied before the first screen renders.
void loadAppConfig().then((cfg) => applyReleaseContacts(cfg.releaseContacts)).finally(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PortalAuthProvider>
          <RouterProvider router={router} />
        </PortalAuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
));
