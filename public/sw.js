// Shows a notification when the server pushes one, and opens the call when it's tapped. It does
// nothing else: no caching, no offline pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Call desk', { body: data.body || '', tag: data.tag, data: { url: data.url || '/' }, renotify: true }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
    const open = all.find((c) => c.url === url) ?? all[0];
    return open ? open.focus().then((c) => ('navigate' in c && c.url !== url ? c.navigate(url) : c)) : self.clients.openWindow(url);
  }));
});
