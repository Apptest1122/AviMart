const CACHE_NAME = 'avimart-v1';
const API_CACHE_NAME = 'avimart-api-v1';
const STATIC_CACHE_NAME = 'avimart-static-v1';

// Assets to cache on install
const STATIC_ASSETS = [
  './',
  './index.html',
  './admin.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0,0',
  'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2',
  'https://fonts.gstatic.com/s/materialiconsrounded/v112/LDItaoyNOAY6Uewc665JcIzCKsKc_M9flwmPq_HTTw.woff2',
  'https://i.ibb.co/F4Pf08KK/15298-removebg-preview-1.png'
];

// Firebase API endpoints to cache
const API_ENDPOINTS = [
  'https://avimart-3264c-default-rtdb.firebaseio.com/products.json',
  'https://avimart-3264c-default-rtdb.firebaseio.com/categories.json'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing Service Worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[Service Worker] Skip waiting on install');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating Service Worker...');
  
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        if (key !== STATIC_CACHE_NAME && key !== API_CACHE_NAME && key !== CACHE_NAME) {
          console.log('[Service Worker] Removing old cache:', key);
          return caches.delete(key);
        }
      }));
    })
    .then(() => {
      console.log('[Service Worker] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Helper: Check if request is for an API
function isApiRequest(url) {
  return url.includes('firebaseio.com') || 
         url.includes('imgbb.com') ||
         url.includes('maps.google.com');
}

// Helper: Check if request is for a static asset
function isStaticAsset(url) {
  return STATIC_ASSETS.some(asset => url.includes(asset)) ||
         url.includes('fonts.googleapis') ||
         url.includes('fonts.gstatic') ||
         url.includes('i.ibb.co') ||
         url.includes('via.placeholder.com');
}

// Helper: Network with cache fallback (stale-while-revalidate for API)
async function networkFirstWithCache(request, cacheName = API_CACHE_NAME) {
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    // If successful, update cache
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // If network fails, try cache
    console.log('[Service Worker] Network failed, trying cache for:', request.url);
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If no cache, return offline fallback
    return new Response(JSON.stringify({ 
      error: 'You are offline. Please check your connection.',
      offline: true 
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper: Cache first for static assets
async function cacheFirstWithNetwork(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    // Return cached response and update cache in background
    fetch(request).then(networkResponse => {
      if (networkResponse && networkResponse.status === 200) {
        caches.open(STATIC_CACHE_NAME).then(cache => {
          cache.put(request, networkResponse);
        });
      }
    }).catch(() => {});
    
    return cachedResponse;
  }
  
  // If not in cache, fetch from network
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    return new Response('Offline - Content not available', { status: 503 });
  }
}

// Fetch event - handle different request types
self.addEventListener('fetch', event => {
  const url = event.request.url;
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Handle API requests
  if (isApiRequest(url)) {
    event.respondWith(networkFirstWithCache(event.request, API_CACHE_NAME));
    return;
  }
  
  // Handle static assets
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }
  
  // Default: network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) {
            return cached;
          }
          // If offline and no cache, return offline page for navigation
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// Background sync for offline actions
self.addEventListener('sync', event => {
  if (event.tag === 'sync-orders') {
    console.log('[Service Worker] Syncing offline orders');
    event.waitUntil(syncOfflineOrders());
  }
});

// Function to sync offline orders when back online
async function syncOfflineOrders() {
  try {
    const db = await openOfflineDB();
    const offlineOrders = await db.getAll('offlineOrders');
    
    for (const order of offlineOrders) {
      try {
        const response = await fetch('https://avimart-3264c-default-rtdb.firebaseio.com/orders.json', {
          method: 'POST',
          body: JSON.stringify(order),
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          await db.delete('offlineOrders', order.id);
        }
      } catch (error) {
        console.error('[Service Worker] Failed to sync order:', error);
      }
    }
  } catch (error) {
    console.error('[Service Worker] Sync failed:', error);
  }
}

// IndexedDB helper for offline storage
async function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AviMartOffline', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('offlineOrders')) {
        db.createObjectStore('offlineOrders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('offlineCart')) {
        db.createObjectStore('offlineCart', { keyPath: 'id' });
      }
    };
  });
}

// Push notification event
self.addEventListener('push', event => {
  console.log('[Service Worker] Push received:', event);
  
  const options = {
    body: event.data.text(),
    icon: 'https://i.ibb.co/F4Pf08KK/15298-removebg-preview-1.png',
    badge: 'https://i.ibb.co/F4Pf08KK/15298-removebg-preview-1.png',
    vibrate: [200, 100, 200],
    data: {
      url: self.location.origin + '/index.html'
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

// Notification click event
self.addEventListener('notificationclick', event => {
  console.log('[Service Worker] Notification click:', event);
  
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});