const APP_CACHE = "hannin-app-v6";
const OLD_CACHES = ["hannin-cards-v1", "hannin-cards-v2"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await Promise.all(OLD_CACHES.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Ver.0.3以降、カード本体はHTML/CSS/SVGで描画するため
// 個別のカード画像ダウンロードは不要です。Next.jsの通常キャッシュに任せます。
self.addEventListener("fetch", () => {});
