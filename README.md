# Deadlink
Vibe-coded site with underground music artists. and just a cool game project.

Русскоязычный сайт-игра про интернет-андер и электронику: диггинг конвертов, дропы, полка, карта сцен, граф связей, небо жанров и свой блок с зданиями.

**Сайт:** https://shamer36.github.io/deadlink/

## Как устроено
- `index.html`, `login.html` — сам сайт, раздаётся GitHub Pages.
- `media/` — обложки и 30-секундные отрывки, разложенные по папкам «Артист / Релиз».
- `media-map.json` + `sw.js` — сервис-воркер, который отдаёт файлы из `media/` по старым адресам `/_blob/<id>`.
- `config.js` — адрес базы.
- `backend/` — база на Netlify Functions + Netlify Blobs: аккаунты, общая база артистов и релизов, полки игроков, подарки, загрузки.
