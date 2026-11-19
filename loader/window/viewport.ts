// window.js → admin: what covers the bottom of the dialog (the home indicator, the on-screen keyboard). Inside the
// iframe `visualViewport` and `env(safe-area-inset-*)` read as zero, so the page measures them and tells the admin
// (`ViewportMessage`), which keeps its bottom bar above both.
import { WINDOW_SOURCE, type ViewportMessage } from './channel';
import { bottomInsets } from './geometry';

/**
 * Starts listening to the page's visual viewport (at most one message a frame) and returns `send`: call it after the
 * dialog moved or resized, and with `force` when the admin says `hello` (a fresh admin knows nothing yet). It posts
 * only when a value changed.
 */
export function startViewport(
  frame: () => HTMLIFrameElement | null,
  dialog: () => HTMLDialogElement | null,
): (force?: boolean) => void {
  // `env()` resolves only in CSS: a hidden probe in the dialog reads the page's safe area as a computed padding.
  const probe = document.createElement('div');
  probe.hidden = true;
  probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
  let last = '';
  const send = (force = false) => {
    const d = dialog();
    const target = frame()?.contentWindow;
    if (!d || !target) return;
    if (probe.parentNode !== d) d.append(probe);
    const layoutH = document.documentElement.clientHeight;
    const vv = window.visualViewport;
    const insets = bottomInsets(
      d.getBoundingClientRect().bottom,
      layoutH,
      vv ? vv.offsetTop + vv.height : layoutH,
      vv?.scale ?? 1,
      parseFloat(getComputedStyle(probe).paddingBottom) || 0,
    );
    const key = `${insets.safeBottom} ${insets.keyboard}`;
    if (key === last && !force) return;
    last = key;
    const message: ViewportMessage = { source: WINDOW_SOURCE, type: 'viewport', ...insets };
    target.postMessage(message, new URL(frame()!.src, location.href).origin);
  };
  // The keyboard's slide fires many resize and scroll events: send at most once a frame.
  let frameId = 0;
  const onChange = () => {
    frameId ||= requestAnimationFrame(() => {
      frameId = 0;
      send();
    });
  };
  window.visualViewport?.addEventListener('resize', onChange);
  window.visualViewport?.addEventListener('scroll', onChange);
  return send;
}
