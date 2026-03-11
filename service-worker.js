const CACHE_NAME = 'avimart-v1';
const STATIC_CACHE = 'avimart-static-v1';
const API_CACHE = 'avimart-api-v1';

// Assets to cache
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://i.ibb.co/F4Pf08KK/15298-removebg-preview-1.png'
];

// Install Event
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => {
        return Promise.all(
          keys.filter(key => key !== STATIC_CACHE && key !== API_CACHE)
            .map(key => caches.delete(key))
        );
      }),
      self.clients.claim()
    ])
  );
});

// Fetch Event - Network First, Cache Fallback
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // API requests (Firebase)
  if (url.hostname.includes('firebaseio.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful API responses
          if (response.status === 200) {
            const cacheCopy = response.clone();
            caches.open(API_CACHE)
              .then(cache => cache.put(event.request, cacheCopy));
          }
          return response;
        })
        .catch(() => {
          // Return cached API response if offline
          return caches.match(event.request)
            .then(cached => {
              if (cached) {
                return cached;
              }
              return new Response(
                JSON.stringify({ error: 'offline', message: 'You are offline' }),
                { headers: { 'Content-Type': 'application/json' } }
              );
            });
        })
    );
    return;
  }
  
  // Static assets - Cache First
  if (event.request.url.includes('i.ibb.co') || 
      event.request.url.includes('fonts.googleapis') ||
      event.request.url.includes('cdnjs')) {
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request))
    );
    return;
  }
  
  // HTML pages - Network First
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Background Sync
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncOrders());
  }
});

async function syncOrders() {
  try {
    const cache = await caches.open(API_CACHE);
    const requests = await cache.keys();
    
    for (const request of requests) {
      if (request.url.includes('orders')) {
        const response = await cache.match(request);
        if (response) {
          const order = await response.json();
          // Try to send to server
          await fetch(request.url, {
            method: 'POST',
            body: JSON.stringify(order),
            headers: { 'Content-Type': 'application/json' }
          });
          // Delete from cache after successful sync
          await cache.delete(request);
        }
      }
    }
  } catch (error) {
    console.log('[SW] Sync failed:', error);
  }
}

// Push Notification
self.addEventListener('push', event => {
  console.log('[SW] Push received');
  
  const options = {
    body: event.data.text(),
    icon: 'https://i.ibb.co/F4Pf08KK/15298-removebg-preview-1.png',
    badge: 'https://i.ibb.co/F4Pf08KK/15298-removebg-preview-1.png',
    vibrate: [200, 100, 200],
    data: {
      url: self.location.origin
    },
    actions: [
      {
        action: 'open',
        title: 'Open App'
      },
      {
        action: 'close',
        title: 'Close'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('AviMart', options)
  );
});

// Notification Click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});
