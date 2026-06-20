'use strict';
// ══════════════════════════════════════════════════════════
// sw.js — Service Worker для Slaŭnaya Eža PWA
// Стратегия: App Shell кэшируется при установке,
// GAS-запросы идут network-first с fallback на cache.
// ══════════════════════════════════════════════════════════

const CACHE_VERSION = '1.5.5'; // P5: таб «Лист» — список заказов с составом + JPG-генератор
const CACHE_NAME    = 'slaunaya-shell-' + CACHE_VERSION;
const GAS_CACHE     = 'slaunaya-gas-'   + CACHE_VERSION;

// Файлы App Shell — кэшируются при установке SW
const SHELL_FILES = [
  '/Slaunaya_eza/',
  '/Slaunaya_eza/index.html',
  '/Slaunaya_eza/css/style.css',
  '/Slaunaya_eza/js/api.js',
  '/Slaunaya_eza/js/render.js',
  '/Slaunaya_eza/js/app.js',
  '/Slaunaya_eza/js/receipt.js',
  '/Slaunaya_eza/js/sheet.js',
  '/Slaunaya_eza/icons/logo.png', // Унифицировано с PNG
  '/Slaunaya_eza/manifest.json',
];

// ── Установка: кэшируем App Shell ────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Shell cache error:', err))
  );
});

// ── Активация: удаляем старые кэши ───────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== GAS_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: логика обработки запросов ─────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // GAS-запросы: network-first, при ошибке — кэш
  if (url.includes('script.google.com') || url.includes('googleapis.com')) {
    event.respondWith(networkFirstGAS(event.request));
    return;
  }

  // GitHub Pages cache: cache-first для статики
  if (url.includes('vearjkeee.github.io') || url.includes('github.io')) {
    event.respondWith(cacheFirstShell(event.request));
    return;
  }
});

// ── Network-first для GAS (данные) ───────────────────────
async function networkFirstGAS(request) {
  const cache = await caches.open(GAS_CACHE);
  try {
    const response = await fetch(request.clone(), { redirect: 'follow' });
    if (response.ok) {
      // Кэшируем только GET getData — основной дата-запрос
      if (request.method === 'GET' && request.url.includes('action=getData')) {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (err) {
    // Сеть недоступна — пробуем кэш
    const cached = await cache.match(request);
    if (cached) return cached;
    // Совсем нет ничего — возвращаем офлайн-заглушку
    return new Response(
      JSON.stringify({ error: 'offline', _offline: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Cache-first для статических файлов ───────────────────
async function cacheFirstShell(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503 });
  }
}
