import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const [owner, repository] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const githubBase = repository && repository.toLowerCase() !== `${owner?.toLowerCase()}.github.io` ? `/${repository}/` : '/';

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? githubBase : '/',
  build: { target: 'es2022' },
});
