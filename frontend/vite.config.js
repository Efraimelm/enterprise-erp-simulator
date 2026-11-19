import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, o Vite (porta 5173) repassa /api para o backend (porta 3001).
// Assim, navegador e API ficam na mesma origem e o cookie de sessão funciona sem CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
