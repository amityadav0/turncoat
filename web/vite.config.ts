import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Post-mortems live in ../docs/postmortems and are bundled at build time.
  server: { fs: { allow: ['..'] } },
});
