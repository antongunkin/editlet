import pkg from './package.json' with { type: 'json' };

/**
 * The oldest supported browsers (`browserslist` in package.json) as build targets: `chrome 125` → `chrome125`. The admin
 * build (Vite: JS syntax, and Lightning CSS) and tsdown (browser-side modules such as the loader) lower syntax to
 * them. APIs are not polyfilled: code uses only what these browsers have.
 */
export const BROWSER_TARGETS: string[] = pkg.browserslist.map((query) => query.replace(' ', ''));
