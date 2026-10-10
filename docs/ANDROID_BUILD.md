# ANDROID BUILD — от исходников до подписанного AAB/APK

Целевой стек: **Capacitor 6 + WebView (Chromium 90+)**. Игра — единый офлайн `dist/index.html`
(inline CSS+JS, 0 внешних запросов), поэтому WebView просто открывает локальный файл через
`https://localhost` (androidScheme) — работает без сети и в авиа-режиме.

## 0. Требования машины сборки
- Node 18+, npm 9+
- JDK 17
- Android SDK: platform 34, build-tools 34, cmdline-tools
- Gradle 8.x (идёт в комплекте Android Studio / wrapper)
- Переменные: `ANDROID_HOME`, `JAVA_HOME`

## 1. Сборка веб-части
```bash
npm install
npm run build          # esbuild → dist/game.js + полностью самодостаточный dist/index.html
npm test               # headless-юниты (детерминизм, физика, экономика)
npm run balance        # баланс-симуляция 2000 миссий/клетка
```
Проверка артефакта: открыть `dist/index.html` в Chrome DevTools device-mode (412×915, touch) —
игра должна стартовать без сети.

## 2. Нативный проект
```bash
npx cap add android     # создаёт android/ (уже закоммичен конфиг capacitor.config.ts)
npm run sync            # = npm run build && npx cap sync android
```
`capacitor.config.ts` уже содержит: appId `ru.siege.catapult`, webDir `dist`,
SplashScreen/StatusBar, `webContentsDebuggingEnabled:false`.

### Правки android/ (проверить после `cap add`)
`android/app/src/main/AndroidManifest.xml`:
```xml
<application
    android:hardwareAccelerated="true"
    android:largeHeap="false"
    android:allowBackup="true"
    ...>
<activity
    android:screenOrientation="portrait"
    android:configChanges="orientation|screenSize|keyboardHidden|smallestScreenSize|screenLayout"
    android:exported="true"
    android:launchMode="singleTask"
    android:theme="@style/AppTheme.NoActionBarLaunch">
```
`android/app/src/main/res/xml/config.xml` не нужен (Capacitor 6). В `MainActivity.onCreate`
ничего добавлять не требуется: back-button обрабатывается плагином `@capacitor/app`
(в игре: бой → пауза, экран → меню, меню → выход).

WebView-требования уже выставляет Capacitor по умолчанию: JS on, DOM storage on,
hardware acceleration on. Дополнительно игра сама:
- блокирует page-zoom (`touch-action:none`, `user-scalable=no`);
- учитывает notch через `viewport-fit=cover` + CSS `env(safe-area-inset-*)`;
- восстанавливает AudioContext по первому жесту;
- ставит игру на паузу и сейвится при `visibilitychange`.

## 3. Иконки и сплэш
```bash
npx @capacitor/assets generate --android --assetPath resources
```
(resources/: icon.png 1024², splash.png 2732², foreground/background для adaptive icons.)
Палитра: фон `#161310`, акцент `#D9A62E`.

## 4. Debug-прогон на устройстве
```bash
npm run build:dev            # esbuild --dev (sourcemap inline)
npx cap sync android
npx cap run android          # или: cd android && ./gradlew assembleDebug
```
Профилирование: Chrome → `chrome://inspect` → WebView ru.siege.catapult → DevTools
(Performance: frame time, Memory: heap-снимки до/после 30-минутной сессии).
В игре встроен HUD-FPS (`Настройки → Отладка → Показывать FPS`: fps, draw calls, треугольники,
обломки, уровень качества).

## 5. Релизная сборка и подпись
```bash
# ключ генерируем ОДИН раз и храним в 2 местах (сейф + офлайн-носитель):
keytool -genkey -v -keystore catapult.keystore -alias catapult -keyalg RSA -keysize 2048 -validity 10000
```
`android/key.properties` (НЕ коммитить):
```
storeFile=../../catapult.keystore
storePassword=***
keyAlias=catapult
keyPassword=***
```
`android/app/build.gradle` — стандартная связка `signingConfigs { release { ... key.properties } }`.
```bash
cd android && ./gradlew bundleRelease assembleRelease
# AAB: android/app/build/outputs/bundle/release/app-release.aab
# APK: android/app/build/outputs/apk/release/app-release.apk
```
Размер: веб-часть ~830 КБ (gzip ~250 КБ) → итоговый APK ≈ 3–6 МБ (далеко ниже бюджета 45 МБ).

## 6. Чек-лист перед загрузкой в Play Console
- [ ] `versionCode` инкрементирован, `versionName` = `CFG.VERSION`
- [ ] подписано релизным ключом; ключ забэкапен
- [ ] target SDK 34, min SDK 26 (Android 8.0)
- [ ] Data safety form: офлайн-игра, сбор данных = только геймплейная телеметрия (опционально), без геолокации/контактов
- [ ] IARC: 12+ (умеренное фэнтези-насилие, без крови)
- [ ] Политика конфиденциальности (URL) — шаблон в `docs/MONETIZATION.md` §6
- [ ] Тест-трек: internal → open (300+ установок) → production
- [ ] Скриншоты 8 шт (phone) + feature graphic 1024×500 + видео 30 с (захват через `scrcpy`)
- [ ] ASO-описание: катапульта, требушет, осада, физика, разрушение, siege, catapult, trebuchet

## 7. План Б / План В (Decision D2/D16)
- Если WebView не держит 60 FPS на целевом mid-range после auto-quality:
  1) фиксация качества `low` + 30 FPS-режим (уже есть);
  2) перенос рендера на нативный OpenGL ES 3.0 (модуль `systems/` не зависит от three.js —
     математика и конфиги переносятся 1:1, заменяется только слой `world/`);
  3) Unity-порт как отдельная ветка (GDD/баланс переиспользуются).
