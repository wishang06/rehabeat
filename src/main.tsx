import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/doto/900.css';
// The canvas overlay sets its hint labels in Archivo.
import '@fontsource-variable/archivo/wdth.css';
import './styles/theme.css';
import './index.css';
import { Landing } from './landing/Landing';

// The game brings the pose model with it, so the landing page does not load it.
const Game = lazy(() => import('./App').then((module) => ({ default: module.App })));
const HudPreview = lazy(() => import('./ui/hud/HudPreview').then((module) => ({ default: module.HudPreview })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading" role="status" aria-label="Loading" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/play/*" element={<Game />} />
          {/* The play HUD over a blank stage, fed by the mock frame: for design work and screenshots. */}
          <Route path="/hud/*" element={<HudPreview />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    <Toaster position="top-center" theme="dark" toastOptions={{ className: 'toast' }} />
  </StrictMode>,
);
