Детский навигатор (PWA)

Файлы: index.html, app.js, manifest.json, sw.js, icon-192.png, icon-512.png, img/*.png

Новые картинки: положить в img/ с именем из списка (police.png, hospital.png и т.д.),
в sw.js поднять VERSION (nav-v1 -> nav-v2), залить заново. Пока картинки нет, место показывается эмодзи.

Деплой Cloudflare Pages: Workers & Pages -> Create -> Pages -> Upload assets -> перетащить папку.
Деплой GitHub Pages: залить папку в репозиторий, Settings -> Pages -> Branch: main, / (root).
Нужен HTTPS (оба дают), иначе Chrome не предложит установку.

Установка на Android: открыть ссылку в Chrome -> меню ⋮ -> «Установить приложение».
