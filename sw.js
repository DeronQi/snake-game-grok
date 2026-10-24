'use strict';

/**
 * 网络优先，失败时用缓存兜底（含页面导航）。
 * activate 时清掉旧版本缓存。静态资源版本与页面里的 ?v=1 保持一致。
 */
var CACHE = 'snake-v1';
var ASSETS = [
  './',
  './index.html',
  './style.css?v=1',
  './ai.js?v=1',
  './game.js?v=1',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  var cache = await caches.open(CACHE);
  try {
    var fresh = await fetch(req, { cache: 'no-store' });
    if (fresh && fresh.ok) {
      await cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    var cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      return (await caches.match('./index.html')) || (await caches.match('./')) || Promise.reject(err);
    }
    throw err;
  }
}
