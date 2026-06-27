import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/devices': 'http://127.0.0.1:8000',
      '/registered-devices': 'http://127.0.0.1:8000',
      '/regsistered-devices': 'http://127.0.0.1:8000',
      '/connected': 'http://127.0.0.1:8000',
      '/logs': 'http://127.0.0.1:8000',
      '/eero': 'http://127.0.0.1:8000',
    },
  },
});