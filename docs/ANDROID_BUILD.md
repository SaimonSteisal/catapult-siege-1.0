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

## 1.5. Быстрый старт на Windows (PowerShell) — собрать APK для теста
Начиная с патча 1.0.12 в репозитории УЖЕ есть: `android/` (сгенерирован `cap add android`),
`capacitor.config.json` (без TypeScript-зависимости), скрипты `npm run apk:debug/apk:release`.

**Вариант А (самый надёжный, без командной строки):**
1. Поставь Android Studio (winget install Google.AndroidStudio) — она сама ставит JDK и SDK.
2. File → Open → выбери папку `android/` проекта. Дождись индексации/синка Gradle (первый раз 5–15 мин).
3. Подключи телефон (USB-отладка) или создай эмулятор → кнопка Run ▶. Студия сама соберёт и поставит APK.

**Вариант Б (команды, PowerShell 5.1 — обрати внимание: `;` вместо `&&`, `gradlew.bat` вместо `./gradlew`):**
```powershell
# один раз: JDK 17 и Android SDK (если ещё нет)
winget install EclipseAdoptium.Temurin.17.JDK
winget install Google.AndroidStudio          # ставит и SDK; либо sdkmanager отдельно
# перезапусти PowerShell и проверь:
java -version                                 # должно быть 17.x

# в папке проекта:
npm install
npm run sync                                  # сборка dist + копирование в android/assets
npm run apk:debug                             # = node tools/gradle.mjs assembleDebug
                                              # (кроссплатформенно: сам выберет gradlew/gradlew.bat,
                                              #  первый запуск качает Gradle ~5-10 мин)
# APK здесь:
#   android\app\build\outputs\apk\debug\app-debug.apk
```
Установка на телефон: скопируй `app-debug.apk`, разреши «неизвестные источники», поставь;
или `adb install -r app-debug.apk`.

**Частые ошибки и лечение:**
- `Could not find installation of TypeScript` — в репозитории больше НЕ бывает: `capacitor.config.ts`
  удалён (патч 1.2.3), единственный конфиг — `capacitor.config.json`. Если ошибка есть в твоей
  копии — удали старый `capacitor.config.ts` (или `npm i -D typescript`).
- `Permission denied` на `./gradlew` (Linux/macOS/WSL) — `chmod +x android/gradlew`
  (в репозитории бит 755 выставлен; git на Windows мог выкачать его без +x).
- `Лексема "&&" не является допустимым разделителем` — PowerShell 5.1: используй `;` или команды выше;
  в npm-скриптах `&&` работает (npm запускает их через cmd.exe).
- `SDK location not found` — создай `android/local.properties` со строкой
  `sdk.dir=C:\Users\<имя>\AppData\Local\Android\Sdk` (путь покажет Android Studio → Settings → SDK);
  скрипт `tools/make-local-properties.ps1` делает это сам, `tools/gradle.mjs` — предупреждает заранее.
- `JAVA_HOME is not set` — поставь Temurin 17 (выше) и перезапусти терминал, либо
  `$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"` в текущей сессии.
- Старый debug-APK не обновляется (`INSTALL_FAILED_VERSION_DOWNGRADE`) — удалённое приложение
  или versionCode: при релизе инкрементируй `versionCode` в `android/app/build.gradle`
  (сейчас versionCode 2 / versionName = CFG.VERSION = 1.2.3, см. чек-лист §6).

## 2. Нативный проект
```bash
npx cap add android     # создаёт android/ (в репозитории УЖЕ есть, повторно не нужно)
npm run sync            # = npm run build && npx cap sync android
```
`capacitor.config.json` содержит: appId `ru.siege.catapult`, webDir `dist`,
SplashScreen/StatusBar, `webContentsDebuggingEnabled:false`.

### Правки android/ (проверить после `cap add`)
(С патча 1.2.3 всё ниже УЖЕ внесено в репозиторийный манифест: `hardwareAccelerated`,
`screenOrientation="portrait"` — HUD рассчитан на портрет; при `cap add` заново — повторить.)
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
