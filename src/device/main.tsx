import React from 'react';
import ReactDOM from 'react-dom/client';
import GooeyButtonController from '../components/GooeyButtonController';
import DeviceApp from './DeviceApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('device-root')!).render(
  <React.StrictMode>
    <GooeyButtonController />
    <DeviceApp />
  </React.StrictMode>
);
