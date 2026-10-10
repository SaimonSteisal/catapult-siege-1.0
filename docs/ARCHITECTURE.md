# ARCHITECTURE — Catapult Siege

## Стек
- **Рендер:** three.js r186 (WebGL2, fallback WebGL1), один direction light + hemi, без shadow-map на mobile-качествах.
- **Язык:** ES2022-модули → esbuild IIFE-бандл (~810 КБ, ~250 КБ gzip) → инлайн в единый `dist/index.html` (офлайн, без CDN).
- **Физика:** собственная (детерминизм, сиды, нет wasm): полунеявный Эйлер 1/120 с, heightmap 64², sphere-OBB broadphase-сетка 6 м, support-graph обрушений, пул обломков.
- **Упаковка:** Capacitor 6 (WebView) → APK/AAB. Плагины: Haptics, SplashScreen, StatusBar, Preferences, App (back-button).
- **Звук:** 100% процедурный WebAudio (0 ассетов): синтез выстрела/ударов/взрывов/ветра + процедурный амбиент-луп с интенсивностью боя, 3 шины, компрессор+лимитер, ducking.
- **Графика:** 0 внешних ассетов: процедурные canvas-текстуры (дерево/камень/металл/верёвка/трещины), low-poly геометрия, instancing (блоки, трава, камни, солдаты, обломки), vertex-color рельеф, gradient-sky dome, silhouette-горы.

## Структура
```
src/
  config.js            ВСЕ числа игры (баланс, цены, фазы, лимиты)
  main.js              Game: bootstrap, стейт-машина экранов, оркестрация боя, главный цикл, auto-quality
  core/  utils (rng/noise/pool/events), save (версии+миграции+автосейв 20 с), audio, input (жесты/зоны/мультитач), i18n (RU/EN)
  systems/
    physics.js         интеграция, столкновения, предикция, DebrisSystem (instanced-пул)
    structures.js      блоки: InstancedMesh на материал, урон, support-graph, лут, цели, горение
    fort.js            генератор крепостей: 12 схем × биомы, детерминизм сида
    trebuchet.js       машина: 6 узлов, износ, 6-фазная кинематика, строп, расчёт (процедурные человечки)
    ballistics.js      снаряды, урон-модели (фугас/поджог/пробитие/картечь), цепные реакции, CEP
    camera.js          режимы battle/flight/inspect, орбита/зум/пан, shake, slow-mo
    weather.js         ветер (база+порывы), дождь/снег (Points), туман, ночь, факелы
    enemy.js           гарнизон (InstancedMesh, ИИ), контрбатарейный огонь, маркеры incoming
    economy.js         бюджет вылазки, отчёт снабженца, КПД/ранг, рынок, idle-лагерь
    progression.js     техдерево 48 узлов + 12 синергий, ранги, трофеи, computeMods()
    crew.js            состав, скиллы (SkillDirector), усталость
    missions.js        кампания/день/испытание/полигон, цели, модификаторы, сиды
    vfx.js             пулы спрайтов (дым/искры/вспышки), кольца, декали, дуга, маркеры, floaters, shake/slow-mo
  world/ terrain (heightmap+biomes), materials (процедурные текстуры+палитра), scene (рендерер, свет, небо, флора, лагерь)
  ui/    dom (хелперы), hud (боевой), screens (меню/контракты/брифинг/итоги/чертёжная/расчёт/лагерь/настройки/пауза), style.css (дизайн-система)
tools/ build.mjs (esbuild+inline), serve.mjs, test-browser.mjs (E2E puppeteer), headless-test.mjs, balance-report.mjs
android/ Capacitor-проект (npx cap add android)
```

## Потоки данных
- **Событийная шина** (`core/utils.Emitter`): `resource:changed`, `tech:upgraded`, `crew:skill`, `save:*`, `economy:payout`… Системы не импортируют друг друга напрямую, кроме явных зависимостей (Game внедряет ссылки).
- **Game → системы:** каждый кадр: weather.update → physics.step(fixed) → structures.update → debris.update → ballistics.update → skills.update → enemy.update → trebuchet.update → vfx.update → rig.update → render. HUD обновляется раз в кадр лёгкими diff-ами.
- **Детерминизм:** весь рандом через seeded mulberry32; сид миссии = hashString(id); рекорды/дуэли по сиду воспроизводимы.
- **Time-scale:** `timeFreeze` (наводка) и `vfx.timeScale` (hit-stop/slow-mo) масштабируют игровой dt, не трогая dtReal для UI/камеры/звука.

## Память и производительность
- Пулы: снаряды, обломки (instanced, cap по качеству), спрайты VFX, декали, DOM-floaters, InstancedMesh-слоты блоков (free-list).
- Ноль аллокаций в горячем цикле, где возможно (scratch-векторы `_tmp*`); линии трасс переиспользуют буферы.
- Auto-quality: среднее frame time за 60 кадров → шаг вниз/вверх по `CFG.render.qualitySteps` (pixelRatio, тени, трава, обломки, частицы, туман).
- Instancing: блоки крепостей (8 материалов), трава/камни/деревья, солдаты, обломки. Draw calls в бою ≈ 25–70 (зависит от качества), треугольники ≈ 18k.
- Пауза рендера при `visibilitychange`; автосейв 20 с + на pagehide.

## Сейвы
`localStorage` (основной + `_bak`) → Capacitor Preferences (нативно). Версия `SAVE_VERSION=3`,
миграции по цепочке, reconcile с дефолтами (forward-compat), экспорт/импорт base64 из настроек.

## Расширяемость
- Новый тип ядра/цели/модификатор = запись в `config.js` (+ vfx-кейс при необходимости).
- Новая схема крепости = метод `FortBuilder` + запись в `SCHEME_BY_CHAPTER`.
- Локализация = словарь `core/i18n.js` (RU/EN готовы, архитектура под 7 языков).
- Monetization-хуки: `CFG.iap` выключен до серверной валидации (Decision D14).
