import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

// GitHub Pages serves this project from /return-them-home/.
// `vite-plugin-cesium` copies Cesium's static assets (Workers, Assets,
// Widgets, ThirdParty) and wires up CESIUM_BASE_URL automatically, so we
// never commit the Cesium build into the repo.
export default defineConfig({
  base: '/return-them-home/',
  plugins: [cesium()],
  server: {
    port: 5180,
    host: '0.0.0.0',
  },
  build: {
    // The high-quality British Museum model is ~15MB; don't warn about it.
    chunkSizeWarningLimit: 4096,
  },
});
