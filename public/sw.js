// 最小限の Service Worker（インストール導線のみ）
// キャッシュは一切行わず、すべてのリクエストをネットワークへそのまま流す。
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
