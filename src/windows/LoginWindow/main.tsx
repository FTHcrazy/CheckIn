import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import 'antd/dist/reset.css';
import { antdProviderProps } from '@/shared/styles/antd-theme';
import App from './App';
import './index.scss';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider {...antdProviderProps}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
