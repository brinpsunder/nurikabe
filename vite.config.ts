import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base '/nurikabe/' for the GitHub Pages project site, '/' for local dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/nurikabe/' : '/',
  plugins: [svelte()],
}));
