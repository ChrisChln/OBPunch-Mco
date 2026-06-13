import React from 'react';
import ReactDOM from 'react-dom/client';
import GooeyButtonController from '../components/GooeyButtonController';
import MagicBentoController from '../components/MagicBentoController';
import AdminApp from './AdminApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('admin-root')!).render(
  <React.StrictMode>
    <GooeyButtonController />
    <MagicBentoController />
    <AdminApp />
  </React.StrictMode>
);
