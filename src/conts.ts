/**
 * AI: Static constants of the plugin.
 *
 * Role in the architecture:
 * Values that never change at runtime. Anything user-configurable (including the
 * template file name, since Sessione D) lives in `src/settings.ts`; here we keep
 * only its default and the shared file extension.
 */

/** AI: Extension of the files managed by the plugin (notes and templates). */
export const TEMPLATE_FILE_EXTENSION = "md";

/**
 * AI: Default base name of a folder template file, WITHOUT extension.
 * `!Template` → `!Template.md`. Kept as a base name so the setting is typed
 * without the extension.
 */
export const DEFAULT_TEMPLATE_BASENAME = "!Template";
