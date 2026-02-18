import React from 'react';
import ReactDOM from 'react-dom/client';
import DeviceApp from './DeviceApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('device-root')!).render(
  <React.StrictMode>
    <DeviceApp />
  </React.StrictMode>
);
