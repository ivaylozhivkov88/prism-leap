var CACHE_NAME = "prism-leap-v2";
var CORE = ["./", "./index.html", "./style.css", "./game.js", "./manifest.json"];
var STATIC = [
  "./assets/favicon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/bg-nebula.jpg",
  "./assets/menu-tunnel.jpg",
  "./assets/ring-quad.jpg",
  "./assets/glow-burst.jpg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE.concat(STATIC));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

function isCoreRequest(url) {
  return CORE.some(function (path) {
    return url.pathname === new URL(path, self.location).pathname
      || url.pathname.endsWith("/") && path === "./";
  });
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isCoreRequest(url)) {
    // network-first: an actively-updated game should never get stuck on a stale cached build
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return caches.match(event.request); })
    );
    return;
  }

  // static art assets rarely change: cache-first is fine here
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      });
    })
  );
});
