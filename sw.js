// Service worker: cho phép mở app khi mất mạng (chỉ hoạt động khi app được đặt trên web, không áp dụng khi mở file trực tiếp).
const CACHE = 'doanh-thu-quan-v1';
// Thư viện Firebase (đồng bộ đám mây): địa chỉ có số phiên bản nên nội dung không bao giờ đổi.
const SDK = 'https://www.gstatic.com/firebasejs/12.4.0/';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/util.js', 'js/store.js', 'js/firebase-config.js', 'js/cloud.js',
  'js/revenue.js', 'js/payroll.js', 'js/settings.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  `${SDK}firebase-app-compat.js`, `${SDK}firebase-auth-compat.js`, `${SDK}firebase-firestore-compat.js`,
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const fetchAndStore = request => fetch(request).then(res => {
  const copy = res.clone();
  caches.open(CACHE).then(cache => cache.put(request, copy));
  return res;
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (request.url.startsWith(SDK)) {
    // Thư viện Firebase: dùng bản đã lưu, chưa có mới tải.
    e.respondWith(caches.match(request).then(hit => hit || fetchAndStore(request)));
  } else if (new URL(request.url).origin === location.origin) {
    // File của app: ưu tiên bản mới từ mạng, mất mạng thì dùng bản đã lưu.
    e.respondWith(fetchAndStore(request).catch(() => caches.match(request)));
  }
  // Các kết nối khác (đăng nhập, Firestore) đi thẳng ra mạng, không lưu lại.
});
