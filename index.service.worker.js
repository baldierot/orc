// This service worker is required to expose an exported Godot project as a
// Progressive Web App. It provides an offline fallback page telling the user
// that they need an Internet connection to run the project if desired.
// Incrementing CACHE_VERSION will kick off the install event and force
// previously cached resources to be updated from the network.
/** @type {string} */
const CACHE_VERSION = '1753997393|14230026359_v2'; // Incremented version to trigger update
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
	if (!response || response.headers.get('Cross-Origin-Embedder-Policy') === 'require-corp'
		&& response.headers.get('Cross-Origin-Opener-Policy') === 'same-origin') {
		return response;
	}

	const crossOriginIsolatedHeaders = new Headers(response.headers);
	crossOriginIsolatedHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
	crossOriginIsolatedHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
	const newResponse = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: crossOriginIsolatedHeaders,
	});

	return newResponse;
}

self.addEventListener(
	'fetch',
	/**
	 * Triggered on fetch
	 * @param {FetchEvent} event
	 */
	(event) => {
		const isNavigate = event.request.mode === 'navigate';
		const url = event.request.url || '';
		const referrer = event.request.referrer || '';
		const base = referrer.slice(0, referrer.lastIndexOf('/') + 1);
		const local = url.startsWith(base) ? url.replace(base, '') : '';
		const isCacheable = FULL_CACHE.some((v) => v === local) || (base === referrer && base.endsWith(CACHED_FILES[0]));

		if (isNavigate || isCacheable) {
			event.respondWith((async () => {
				const cache = await caches.open(CACHE_NAME);

				try {
					// Network first: Try to fetch from the network.
					const networkResponse = await fetch(event.request);

					// If the fetch is successful, update the cache.
					if (isCacheable) {
						cache.put(event.request, networkResponse.clone());
					}

					return ENSURE_CROSSORIGIN_ISOLATION_HEADERS
						? ensureCrossOriginIsolationHeaders(networkResponse)
						: networkResponse;
				} catch (e) {
					// Network failed, try to get it from the cache.
					console.error('Network request failed, trying cache.', e);
					const cachedResponse = await cache.match(event.request);
					if (cachedResponse) {
						return ENSURE_CROSSORIGIN_ISOLATION_HEADERS
							? ensureCrossOriginIsolationHeaders(cachedResponse)
							: cachedResponse;
					}

					// If it's a navigation request and it's not in the cache, show the offline page.
					if (isNavigate) {
						return await caches.match(OFFLINE_URL);
					}
					
					// For other requests, if not in cache, it will result in a network error.
					return new Response(`Resource not available offline: ${event.request.url}`, {
						status: 404,
						statusText: "Not Found"
					});
				}
			})());
		} else if (ENSURE_CROSSORIGIN_ISOLATION_HEADERS) {
			event.respondWith((async () => {
				let response = await fetch(event.request);
				response = ensureCrossOriginIsolationHeaders(response);
				return response;
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