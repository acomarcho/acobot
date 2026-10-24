import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react' }), react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5390, strictPort: true, allowedHosts: ['.ts.net'] },
});
