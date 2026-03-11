/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

// Inject the precache manifest (replaced at build time by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA navigation fallback — serve index.html for all navigation requests
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// API calls — NetworkFirst (always try network, fall back to cache)
registerRoute(
  ({ url }) =>
    url.hostname.includes('execute-api') ||
    url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'api-cache' }),
)

// ── Push notification handler ──────────────────────────────────────────────────
// This is the critical handler that was missing — without it, push messages
// sent from the backend via web-push are silently ignored by the browser.
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload: {
    title: string
    body: string
    icon?: string
    badge?: string
    data?: { url: string }
  }

  try {
    payload = event.data.json() as typeof payload
  } catch {
    payload = { title: 'SYNTRA', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? '/icon-192.png',
      badge: payload.badge ?? '/badge-72.png',
      data: payload.data ?? { url: '/signals' },
      requireInteraction: false,
    }),
  )
})

// ── Notification click handler ─────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string })?.url ?? '/signals'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus existing tab if already open
        const existing = clients.find((c) => c.url.startsWith(self.location.origin))
        if (existing) {
          return existing.navigate(url).then(() => existing.focus())
        }
        return self.clients.openWindow(url)
      }),
  )
})

// ── Skip waiting on demand ─────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string })?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
