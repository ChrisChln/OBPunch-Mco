import React from 'react';
import ReactDOM from 'react-dom/client';
import GooeyButtonController from '../components/GooeyButtonController';
import AgencyAppPage from './AgencyAppPage';
import '../index.css';

ReactDOM.createRoot(document.getElementById('agency-root')!).render(
  <React.StrictMode>
    <GooeyButtonController />
    <AgencyAppPage />
  </React.StrictMode>
);
