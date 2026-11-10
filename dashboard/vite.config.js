import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api/users': {
        target: 'http://localhost:8081',
        changeOrigin: true
      },
      '/api/products': {
        target: 'http://localhost:8082',
        changeOrigin: true
      },
      '/api/orders': {
        target: 'http://localhost:8083',
        changeOrigin: true
      },
      '/api/payments': {
        target: 'http://localhost:8084',
        changeOrigin: true
      },
      '/api/inventory': {
        target: 'http://localhost:5050',
        changeOrigin: true
      },
      '/api/analysis': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
});
