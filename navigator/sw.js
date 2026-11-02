// Bump VERSION after any change so phones pick up the new files.
const VERSION = 'nav-v32';
const CORE = ['./', 'index.html', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'img/kostya.jpg', 'snd/ignition.mp3', 'snd/engine.ogg', 'snd/engine.wav', 'snd/plane.ogg', 'snd/plane.wav', 'snd/siren.ogg', 'snd/siren.wav', 'snd/meow.mp3', 'snd/horn1.mp3', 'snd/horn2.mp3', 'snd/nitro.mp3'];
const SPRITES = ['car', 'car_top', 'car_police', 'car_cat', 'car_blue', 'car_front', 'car_side', 'pin', 'airplane', 'house_1', 'house_2', 'house_3', 'house_4', 'tree_1', 'tree_2', 'tree_3', 'bush', 'pond',
  'apartment_1', 'apartment_2', 'office_tower', 'home', 'kindergarten', 'shop', 'gas_station', 'fire_station', 'playground',
  'police', 'hospital', 'school', 'train_station', 'cinema', 'ice_cream', 'pizza', 'post_office', 'car_wash', 'stadium',
  'airport', 'amusement_park', 'grandma', 'zoo', 'lighthouse', 'orbi_city', 'beach', 'port', 'aquapark', 'bakery', 'library', 'circus', 'toy_shop', 'dino_museum', 'vet', 'farm', 'camp', 'picnic', 'castle', 'windmill', 'haystack', 'cows', 'sheep', 'tractor', 'tent', 'beehives', 'apple_tree', 'rocks', 'deer', 'fountain', 'crane', 'mcdonalds', 'marriott', 'europe_square', 'lake_resort', 'grand_mall', 'metro_city', 'person_businessman', 'person_couple', 'person_dog', 'person_girl_balloon', 'person_grandma', 'person_grandpa', 'person_icecream', 'person_kid', 'person_mom_stroller', 'person_runner', 'person_scooter', 'person_tourist', 'train_engine', 'train_car', 'boat_sail', 'boat_ferry', 'boat_fishing', 'boat_yacht', 'parking_lot_small', 'parking_lot_medium', 'parking_lot_big', 'parking_small', 'parking_medium', 'parking_big', 'car_police', 'car_cat', 'car_blue'].map(n => 'img/' + n + '.png');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    // cache: 'reload' skips the browser HTTP cache, so a new version never picks up old files
    await c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    // sprites are optional: missing ones fall back to emoji
    await Promise.allSettled(SPRITES.map(u => c.add(new Request(u, { cache: 'reload' }))));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
    }
    return res;
  })));
});
