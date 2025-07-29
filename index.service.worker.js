// This service worker is required to expose an exported Godot project as a
// Progressive Web App. It provides an offline fallback page telling the user
// that they need an Internet connection to run the project if desired.
// Incrementing CACHE_VERSION will kick off the install event and force
// previously cached resources to be updated from the network.
/** @type {string} */
const CACHE_VERSION = '1753822206|347031566215';
/** @type {string} */
const CACHE_PREFIX = 'Orchestrator-sw-cache-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
/** @type {string} */
const OFFLINE_URL = 'index.offline.html';
/** @type {boolean} */
const ENSURE_CROSSORIGIN_ISOLATION_HEADERS = true;
// Files that will be cached on load.
/** @type {string[]} */
const CACHED_FILES = ["index.html","index.js","index.offline.html","index.icon.png","index.apple-touch-icon.png","index.audio.worklet.js","index.audio.position.worklet.js"];
// Files that we might not want the user to preload, and will only be cached on first load.
/** @type {string[]} */
const CACHEABLE_FILES = ["index.wasm","index.pck"];
const FULL_CACHE = CACHED_FILES.concat(CACHEABLE_FILES);

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHED_FILES)));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(caches.keys().then(
		function (keys) {
			// Remove old caches.
			return Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
		}
	).then(function () {
		// Enable navigation preload if available.
		return ('navigationPreload' in self.registration) ? self.registration.navigationPreload.enable() : Promise.resolve();
	}));
});

/**
 * Ensures that the response has the correct COEP/COOP headers
 * @param {Response} response
 * @returns {Response}
 */
function ensureCrossOriginIsolationHeaders(response) {
	if (!ENSURE_CROSSORIGIN_ISOLATION_HEADERS || !response) {
		return response;
	}
	if (response.headers.get('Cross-Origin-Embedder-Policy') === 'require-corp'
		&& response.headers.get('Cross-Origin-Opener-Policy') === 'same-origin') {
		return response;
	}

	const crossOriginIsolatedHeaders = new Headers(response.headers);
	crossOriginIsolatedHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
	crossOriginIsolatedHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: crossOriginIsolatedHeaders,
	});
}

/**
 * Fetches from the network, checks for updates using ETag, and falls back to the cache.
 * @param {FetchEvent} event
 * @param {Cache} cache
 * @param {boolean} isCacheable
 * @returns {Promise<Response>}
 */
async function networkFirstThenCache(event, cache, isCacheable) {
	const cachedResponse = await cache.match(event.request);
	const headers = {};
	if (cachedResponse && cachedResponse.headers.has('etag')) {
		headers['If-None-Match'] = cachedResponse.headers.get('etag');
	}

	try {
		const networkResponse = await fetch(event.request, { headers });

		if (networkResponse.status === 304) {
			// The resource has not been modified.
			return ensureCrossOriginIsolationHeaders(cachedResponse);
		}

		// The resource has been updated or is new.
		if (isCacheable) {
			const responseToCache = networkResponse.clone();
			cache.put(event.request, responseToCache);
		}
		return ensureCrossOriginIsolationHeaders(networkResponse);
	} catch (error) {
		// Network request failed, probably offline.
		console.error('Network error:', error);
		if (cachedResponse) {
			return ensureCrossOriginIsolationHeaders(cachedResponse);
		}
		if (event.request.mode === 'navigate') {
			return caches.match(OFFLINE_URL);
		}
		return new Response('Network error', {
			status: 408,
			headers: { 'Content-Type': 'text/plain' },
		});
	}
}

self.addEventListener(
	'fetch',
	/**
	 * Triggered on fetch
	 * @param {FetchEvent} event
	 */
	(event) => {
		const isNavigate = event.request.mode === 'navigate';
		const url = new URL(event.request.url);
		const localPath = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
		const isCacheable = FULL_CACHE.includes(localPath) || (isNavigate && localPath === '');

		if (isCacheable) {
			event.respondWith((async () => {
				const cache = await caches.open(CACHE_NAME);
				return networkFirstThenCache(event, cache, isCacheable);
			})());
		} else if (ENSURE_CROSSORIGIN_ISOLATION_HEADERS) {
			event.respondWith((async () => {
				const response = await fetch(event.request);
				return ensureCrossOriginIsolationHeaders(response);
			})());
		}
	}
);


self.addEventListener('message', (event) => {
	// No cross origin
	if (event.origin !== self.origin) {
		return;
	}
	const id = event.source.id || '';
	const msg = event.data || '';
	// Ensure it's one of our clients.
	self.clients.get(id).then(function (client) {
		if (!client) {
			return; // Not a valid client.
		}
		if (msg === 'claim') {
			self.skipWaiting().then(() => self.clients.claim());
		} else if (msg === 'clear') {
			caches.delete(CACHE_NAME);
		} else if (msg === 'update') {
			self.skipWaiting().then(() => self.clients.claim()).then(() => self.clients.matchAll()).then((all) => all.forEach((c) => c.navigate(c.url)));
		}
	});
});