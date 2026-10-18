import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

const RouterComponent = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || window.desktopAPI))
  ? HashRouter
  : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterComponent>
      <App />
    </RouterComponent>
  </StrictMode>,
);
