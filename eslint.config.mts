import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * Flat ESLint config following the `eslint-plugin-obsidianmd` standard.
 *
 * Role in the architecture:
 * Diffs the plugin against the official Obsidian guidelines (core + type-checked
 * typescript-eslint + `obsidianmd/*` rules). Verification only: nothing here is
 * bundled or shipped.
 *
 * Notes:
 * - `recommended` comes first, so the project-specific block below can only
 *   add to it (same order as the plugin's own documentation).
 * - `projectService` type-checks `main.ts` and `src/**` through `tsconfig.json`.
 *   `tsconfigRootDir` is intentionally omitted: it defaults to the working
 *   directory and avoids depending on `import.meta.dirname`, which the pinned
 *   `@types/node@16` does not type.
 * - `eslint.config.*` is not part of the tsconfig program, hence
 *   `allowDefaultProject` (it only has to be parseable, not type-checked).
 */
export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'.test-dist',
		'test',
	]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.*'],
				},
			},
		},
		rules: {
			// The declarative settings API requires minAppVersion >= 1.13; this
			// plugin still supports 1.5, so `display()` remains the supported path.
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
);
