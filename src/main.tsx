import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import GooeyButtonController from './components/GooeyButtonController';
import DashboardPage from './DashboardPage';
import ExceptionPage from './ExceptionPage';
import './index.css';

const path = window.location.pathname;
const isDashboardPath = path === '/Dashboard' || path === '/Dashboard/' || path === '/dashboard' || path === '/dashboard/';
const isExceptionPath = path === '/exception' || path === '/exception/';

document.title = isExceptionPath ? 'OBP Exception' : isDashboardPath ? 'OBP Dashboard' : 'OBPUNCH';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GooeyButtonController />
    {isExceptionPath ? <ExceptionPage /> : isDashboardPath ? <DashboardPage /> : <App />}
  </React.StrictMode>
);
