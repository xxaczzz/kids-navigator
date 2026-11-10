// Bump VERSION after any change so phones pick up the new files.
const VERSION = 'nav-v52';
const CORE = ['./', 'index.html', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'img/kostya.jpg', 'snd/ignition.mp3', 'snd/engine.ogg', 'snd/engine.wav', 'snd/plane.ogg', 'snd/plane.wav', 'snd/siren.ogg', 'snd/siren.wav', 'snd/meow.mp3', 'snd/horn1.mp3', 'snd/horn2.mp3', 'snd/nitro.mp3', 'snd/bus.ogg', 'snd/bus.wav', 'snd/breakdown.mp3', 'snd/repair.mp3', 'snd/song_ananasi.mp3', 'snd/robot.ogg', 'snd/robot.wav', 'snd/santa.mp3', 'snd/caravan.mp3', 'snd/robot_on.mp3', 'games/wash.js', 'img/wash_bg.jpg', 'snd/wash_foam.mp3', 'snd/wash_sponge.mp3', 'snd/wash_water.mp3', 'snd/wash_dryer.mp3', 'snd/wash_shine.mp3', 'snd/wash_pick.mp3', 'games/fire.js', 'img/fire_bg.jpg', 'snd/fire_siren.mp3', 'snd/fire_crackle.mp3', 'snd/fire_out.mp3'];
const SPRITES = ['car_fire', 'fire_truck', 'fire_cannon', 'fire_flame', 'fire_flame_s', 'fire_kid', 'fire_cat', 'fire_grandma', 'fire_i_drop', 'side_car_top', 'side_car_police', 'side_car_cat', 'side_car_blue', 'side_car_race', 'side_car_tesla', 'side_car_robot', 'wash_t_foam', 'wash_t_sponge', 'wash_t_water', 'wash_t_dryer', 'wash_i_water', 'winter_person_businessman', 'winter_person_couple', 'winter_person_dog', 'winter_person_girl_balloon', 'winter_person_grandma', 'winter_person_grandpa', 'winter_person_icecream', 'winter_person_kid', 'winter_person_mom_stroller', 'winter_person_runner', 'winter_person_scooter', 'winter_person_tourist', 'xmas_truck', 'santa', 'car_robot', 'robot_leg', 'pineapples', 'unicorn_shop', 'parking_tower', 'xmas_small', 'car_race', 'car_tesla', 'charger', 'car_service', 'bus', 'bus_stop', 'fir', 'snowman', 'xmas_tree', 'car', 'car_top', 'car_police', 'car_cat', 'car_blue', 'car_front', 'car_side', 'pin', 'airplane', 'house_1', 'house_2', 'house_3', 'house_4', 'tree_1', 'tree_2', 'tree_3', 'bush', 'pond',
  'apartment_1', 'apartment_2', 'office_tower', 'home', 'kindergarten', 'shop', 'gas_station', 'fire_station', 'playground',
  'police', 'hospital', 'school', 'train_station', 'cinema', 'ice_cream', 'pizza', 'post_office', 'car_wash', 'stadium',
  'airport', 'amusement_park', 'grandma', 'zoo', 'lighthouse', 'orbi_city', 'beach', 'port', 'aquapark', 'bakery', 'library', 'circus', 'toy_shop', 'dino_museum', 'vet', 'farm', 'camp', 'picnic', 'castle', 'windmill', 'haystack', 'cows', 'sheep', 'tractor', 'tent', 'beehives', 'apple_tree', 'rocks', 'deer', 'fountain', 'crane', 'mcdonalds', 'marriott', 'europe_square', 'lake_resort', 'grand_mall', 'metro_city', 'person_businessman', 'person_couple', 'person_dog', 'person_girl_balloon', 'person_grandma', 'person_grandpa', 'person_icecream', 'person_kid', 'person_mom_stroller', 'person_runner', 'person_scooter', 'person_tourist', 'train_engine', 'train_car', 'boat_sail', 'boat_ferry', 'boat_fishing', 'boat_yacht', 'parking_lot_small', 'parking_lot_medium', 'parking_lot_big', 'parking_small', 'parking_medium', 'parking_big', 'car_police', 'car_cat', 'car_blue'].map(n => 'img/' + n + '.png');

// recorded voice phrases (optional: a missing one falls back to the synthesiser)
const VOICE = ["a01", "a02", "b01", "b02", "b03", "b04", "b05", "b06", "b07", "b08", "b09", "b10", "b11", "b12", "b13", "b14", "b15", "b16", "b17", "b18", "b19", "b20", "b21", "b22", "b23", "b24", "b25", "b26", "b27", "b28", "b29", "b30", "b31", "b32", "b33", "b34", "b35", "b36", "b37", "b38", "b39", "b40", "b41", "b42", "c01", "c02", "c03", "c04", "c05", "c06", "c07", "c08", "c09", "c10", "c11", "c12", "c13", "c14", "c15", "c16", "c17", "c18", "c19", "c20", "c21", "c22", "c23", "c24", "c25", "c26", "c27", "c28", "c29", "c30", "c31", "c32", "c33", "c34", "c35", "c36", "c37", "c38", "c39", "c40", "c41", "c42", "c43", "c44", "d01", "d02", "d03", "d04", "d05", "d06", "d07", "d08", "e01", "e02", "f01", "f02", "f03", "g01", "g02", "g03", "g04", "g05", "g06", "h01", "h02", "h03", "h04", "h05", "h06", "h07", "h08", "h09", "h10", "h11", "h12", "h13", "h14", "h15", "h16", "h17", "h18", "h19", "h20", "h21", "h22", "h23", "h24", "h25", "h26", "h27", "h28", "h29", "k01", "k02"].map(c => 'snd/v/' + c + '.mp3');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    // cache: 'reload' skips the browser HTTP cache, so a new version never picks up old files
    await c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    // sprites are optional: missing ones fall back to emoji
    await Promise.allSettled(SPRITES.concat(VOICE).map(u => c.add(new Request(u, { cache: 'reload' }))));
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
