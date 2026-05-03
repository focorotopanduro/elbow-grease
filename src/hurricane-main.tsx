import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import HurricaneUpliftPage from './HurricaneUpliftPage';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HurricaneUpliftPage />
  </StrictMode>
);
