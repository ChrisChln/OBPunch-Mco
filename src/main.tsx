import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import GooeyButtonController from './components/GooeyButtonController';
import DashboardPage from './DashboardPage';
import './index.css';

const path = window.location.pathname;
const isDashboardPath = path === '/Dashboard' || path === '/Dashboard/' || path === '/dashboard' || path === '/dashboard/';

document.title = isDashboardPath ? 'OBP Dashboard' : 'OBPUNCH';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GooeyButtonController />
    {isDashboardPath ? <DashboardPage /> : <App />}
  </React.StrictMode>
);
