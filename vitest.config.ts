import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
		globals: true,
		include: ['src/**/*.spec.ts'],
		pool: 'forks',
	},
	resolve: {
		alias: {
			'@ui': path.resolve(__dirname, './src/app/ui'),
			'@vault': path.resolve(__dirname, './src/app/core/vault'),
			'@core': path.resolve(__dirname, './src/app/core'),
			'@services': path.resolve(__dirname, './src/app/core/services'),
			'@types': path.resolve(__dirname, './src/app/core/types'),
			'@adapters': path.resolve(__dirname, './src/app/core/adapters'),
		},
	},
});
