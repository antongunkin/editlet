import {
  adminMessage,
  isSiteToAdminMessage,
  readEditletRoute,
  withEditletRoute,
  type AdminToSiteMessage,
  type MessageBody,
} from '../../protocol';

const embedded = window.parent !== window;
let pinned: string | null = null;
let route = readEditletRoute(location.href) ?? '';

const $ = (id: string) => document.getElementById(id)!;

const send = (body: MessageBody<AdminToSiteMessage>) => {
  if (embedded && pinned) window.parent.postMessage(adminMessage(body), pinned);
};

const render = () => {
  $('embedded').textContent = String(embedded);
  $('route').textContent = route === '' ? '(root)' : route;
};

const go = (next: string) => {
  route = next;
  history.replaceState(history.state, '', withEditletRoute(location.href, next));
  render();
  send({ type: 'navigate', route: next });
};

const actions: [string, () => void][] = [
  ['Root', () => go('')],
  ['Schema', () => go('schema')],
  ['hello-world', () => go('post/hello-world')],
  ['Close', () => send({ type: 'close' })],
  ['Refresh', () => send({ type: 'refresh' })],
  ['Highlight hello-world', () => send({ type: 'highlight', entry: 'post/hello-world' })],
  ['Clear highlight', () => send({ type: 'highlight', entry: null })],
  ['Layout full', () => send({ type: 'layout', layout: 'full' })],
  ['Layout side', () => send({ type: 'layout', layout: 'side' })],
];
for (const [label, fn] of actions) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  $('buttons').append(b);
}

window.addEventListener('keydown', (e) => e.key === 'Escape' && send({ type: 'close' }));

window.addEventListener('message', (e) => {
  if (!embedded || e.source !== window.parent || !isSiteToAdminMessage(e.data)) return;
  if (pinned === null) {
    // Same-site stub: a cross-site admin must check e.origin against a configured allowlist instead.
    if (e.origin !== location.origin || e.data.type !== 'init') return;
    pinned = e.origin;
  } else if (e.origin !== pinned) return;
  const m = e.data;
  if (m.type === 'init') {
    $('init').textContent = JSON.stringify(m, null, 2);
    route = m.route;
    history.replaceState(history.state, '', withEditletRoute(location.href, route));
  } else if (m.type === 'navigate') {
    route = m.route;
    history.replaceState(history.state, '', withEditletRoute(location.href, route));
  } else if (m.type === 'close-request') send({ type: 'close' });
  render();
});

render();
if (embedded) window.parent.postMessage(adminMessage({ type: 'ready' }), '*');
