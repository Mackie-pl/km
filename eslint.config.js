import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import angularPlugin from '@angular-eslint/eslint-plugin';
import angularTemplateParser from '@angular-eslint/template-parser';
import importPlugin from 'eslint-plugin-import';
import stylisticPlugin from '@stylistic/eslint-plugin';
import localPlugin from './tools/eslint-local/index.js';

export default [
	{
		ignores: [
			'dist',
			'node_modules',
			'src-tauri/target',
			'src-tauri/gen',
			'coverage',
			'*.d.ts',
		],
	},
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: 'tsconfig.json',
				createDefaultProgram: true,
			},
			globals: {
				window: 'readonly',
				document: 'readonly',
				localStorage: 'readonly',
				sessionStorage: 'readonly',
				indexedDB: 'readonly',
				crypto: 'readonly',
				console: 'readonly',
				navigator: 'readonly',
				screen: 'readonly',
				btoa: 'readonly',
				atob: 'readonly',
				setTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
				URL: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tsPlugin,
			'@angular-eslint': angularPlugin,
			'@stylistic': stylisticPlugin,
			import: importPlugin,
		},
		rules: {
			...js.configs.recommended.rules,
			...tsPlugin.configs['strict-type-checked'].rules,
			...tsPlugin.configs['stylistic-type-checked'].rules,
			'import/order': 'off',
			'import/no-duplicates': 'error',
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true,
				},
			],
			'@stylistic/comma-dangle': ['error', 'always-multiline'],
			'@stylistic/eol-last': ['error', 'always'],
			'no-var': 'error',
			'prefer-const': 'error',
			'@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
			'max-lines': [
				'warn',
				{
					max: 400,
					skipBlankLines: true,
					skipComments: true,
				},
			],
			'max-lines-per-function': [
				'error',
				{
					max: 800,
					skipBlankLines: true,
					skipComments: true,
				},
			],
			complexity: ['error', 9],
			'max-depth': ['error', 4],
		},
	},
	{
		files: ['src/**/*.spec.ts'],
		languageOptions: {
			globals: {
				describe: 'readonly',
				it: 'readonly',
				expect: 'readonly',
				beforeEach: 'readonly',
				afterEach: 'readonly',
				vi: 'readonly',
				assert: 'readonly',
			},
		},
		rules: {
			// Test assertions use chaining that strict type checking can't resolve statically
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-redundant-type-constituents': 'off',
			// Allow non-null assertions in tests when accessing fixtures
			'@typescript-eslint/no-non-null-assertion': 'off',
			// vitest globals are configured above
			'no-undef': 'off',
			// vitest globals are configured above
			'no-undef': 'off',
			// Relax file length for test files
			'max-lines': 'off',
			// Relax function length for test setup blocks
			'max-lines-per-function': 'off',
			// console.log is fine in tests
			'no-console': 'off',
		},
	},
	{
		files: ['src/**/*.html'],
		languageOptions: {
			parser: angularTemplateParser,
		},
		plugins: {
			'@angular-eslint': angularPlugin,
			local: localPlugin,
		},
		rules: {
			'@angular-eslint/directive-selector': [
				'error',
				{ type: 'attribute', prefix: 'app', style: 'kebab-case' },
			],
			'@angular-eslint/component-selector': [
				'error',
				{ type: 'element', prefix: 'app', style: 'kebab-case' },
			],
			'local/max-template-nesting': ['error', { max: 6 }],
		},
	},
];
