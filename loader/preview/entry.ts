// Bundle entry for preview.js (built into the admin dist, injected by the loader for editors only). Starts the overlay
// once per page even if the script is injected twice; config.json sits next to preview.js in the admin dist.
import { startOverlay } from './overlay';

import { EDITLET_SOURCE } from '../protocol';

const KEY = Symbol.for(`${EDITLET_SOURCE}.preview`);
const scope = globalThis as typeof globalThis & { [KEY]?: ReturnType<typeof startOverlay> };

scope[KEY] ??= startOverlay({ configUrl: new URL(/* @vite-ignore */ 'config.json', import.meta.url).href });
