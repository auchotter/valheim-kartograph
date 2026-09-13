import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MapWorkspace } from './components/MapWorkspace';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MapWorkspace />
  </StrictMode>,
);
