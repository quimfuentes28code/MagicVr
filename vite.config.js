import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS en desarrollo: los móviles sólo dejan usar la cámara en páginas seguras.
export default defineConfig({
  base: './',
  plugins: [basicSsl()],
  server: { host: true },
});
