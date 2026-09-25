import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@xterm/xterm/css/xterm.css';
import './globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
