import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

function DashboardPlaceholder() {
  return <main style={{ minHeight: '100vh', background: '#fff' }} />;
}

const path = window.location.pathname;
const isDashboardPath = path === '/Dashboard' || path === '/Dashboard/' || path === '/dashboard' || path === '/dashboard/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDashboardPath ? <DashboardPlaceholder /> : <App />}
  </React.StrictMode>
);
