# Toolbox

Набор утилит для работы на базе Tauri.

## Возможности

- 🔄 Автоматическое обновление через GitHub релизы
- 🌙 Темная тема по умолчанию
- 🗂️ Вкладки с задачами: параметры и материалы сохраняются при переключении, задачу можно переоткрыть из списка «Задачи» (кнопка «↗ Открыть»)
- 🔁 Повторная генерация без сброса — можно поправить промпт/материалы/параметры и запустить заново, не очищая форму

### Утилиты

**Обычные инструменты:**
- 🖼️ Конвертация WebP в PNG

**AI утилиты:**
- 🔍 Upscale - увеличение разрешения изображений
- ✂️ Remove Background - удаление фона изображений
- 🎬 Frame To Frame Video - генерация плавного видео-перехода между изображениями
- 📹 Video Upscale - увеличение разрешения и FPS видео
- 🎥 Camera Control - изменение угла камеры и перспективы изображения
- 🎨 Qwen Edit Plus - редактирование изображений с помощью AI
- 🍌 Nano Edit Pro - редактирование изображений (Nano Banana Pro)
- 🎨 Style Transfer - стилизация изображения
- 🎭 Image To Pose - генерация позы из изображения
- 🏷️ Image Tags - генерация тегов для изображения
- 🎞️ H3 Text/Image → Video - MiniMax H3: видео со звуком из текста и опциональных кадров
- 🎞️ H3 Reference → Video - MiniMax H3: видео со звуком по референс-материалам

> H3-инструменты появляются, только когда в настройках указан URL соответствующего RunPod-эндпоинта (`Fl2vaEndpoint` / `Ref2vaEndpoint`). Промпт собирает Grok (grok-4.5) из описания на любом языке; правила промптинга и лоры настраиваются там же.

## Быстрый старт

### Требования

- Node.js (v18 или выше)
- Rust (последняя стабильная версия)
- Windows SDK (для сборки на Windows)
- Xcode Command Line Tools (для сборки на macOS): `xcode-select --install`
- ffmpeg (для видео/аудио утилит — см. раздел [Зависимость ffmpeg](#зависимость-ffmpeg))

### Установка Rust

**Автоматическая установка (рекомендуется):**

1. Откройте PowerShell от имени администратора
2. Выполните команду:

```powershell
Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe
.\rustup-init.exe
```

3. Следуйте инструкциям установщика (нажмите Enter для установки по умолчанию)
4. После установки перезапустите PowerShell

**Альтернативный способ:** Перейдите на https://rustup.rs/ и скачайте установщик

**Проверка установки:**

```powershell
rustc --version
cargo --version
```

**Установка компонентов для Windows:**

```powershell
rustup target add x86_64-pc-windows-msvc
```

**Установка компонентов для macOS (Apple Silicon, M1–M5):**

```bash
rustup target add aarch64-apple-darwin
```

### Зависимость ffmpeg

Видео/аудио утилиты (зацикливание, реверс, извлечение и наложение звука) вызывают
системный `ffmpeg` — он **не входит** в состав приложения, его нужно установить отдельно.

**macOS:**

```bash
brew install ffmpeg
```

Приложение ищет ffmpeg в типовых местах установки Homebrew/MacPorts
(`/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`), потому что GUI-приложения
на macOS запускаются с урезанным `PATH`. Если ffmpeg не найден, утилита покажет
подсказку с командой установки.

**Windows:** установите ffmpeg и убедитесь, что он доступен в `PATH`
(например, через `winget install Gyan.FFmpeg` или `choco install ffmpeg`).

### Установка зависимостей

```bash
npm install
```

### Запуск в режиме разработки

```bash
npm run tauri dev
```

### Сборка приложения

```bash
npm run tauri build
```

Собранное приложение будет находиться в `src-tauri/target/release/bundle/`.

**Сборка под macOS (Apple Silicon):**

```bash
npm run tauri build -- --target aarch64-apple-darwin
```

> ⚠️ Сборка **не подписана** Apple Developer ID (для личного использования это нормально).
> При первом запуске Gatekeeper может заблокировать приложение. Обойти разово:
> ПКМ по `.app` → «Открыть» → «Открыть», либо снять карантин командой:
>
> ```bash
> xattr -dr com.apple.quarantine /путь/к/Toolbox.app
> ```
>
> Автообновление (`latest.json`) настроено только для Windows-сборки.

**Примечание:** Перед первой сборкой необходимо добавить иконки в папку `src-tauri/icons/`:
- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (для macOS)
- `icon.ico` (для Windows)

Или временно закомментируйте секцию `icon` в `src-tauri/tauri.conf.json`.

## Настройка автообновления

Для работы автообновления необходимо:

1. Создать GitHub репозиторий для проекта
2. Сгенерировать ключевую пару для подписи релизов:

```bash
# На Windows PowerShell:
npx @tauri-apps/cli signer generate -w $env:USERPROFILE\.tauri\toolbox.key

# Или на Linux/Mac:
npx @tauri-apps/cli signer generate -w ~/.tauri/toolbox.key
```

3. Обновить `src-tauri/tauri.conf.json`:
   - Замените `YOUR_USERNAME` на ваш GitHub username
   - Замените `YOUR_PUBLIC_KEY_HERE` на публичный ключ из шага 2
   - Обновите `repository` в `Cargo.toml` на URL вашего репозитория

4. Настройте GitHub Secrets:
   - Перейдите в Settings → Secrets and variables → Actions
   - Добавьте `TAURI_PRIVATE_KEY` - содержимое файла `toolbox.key`:
     ```powershell
     Get-Content $env:USERPROFILE\.tauri\toolbox.key
     ```
   - Добавьте `TAURI_KEY_PASSWORD` (если использовали пароль при генерации ключа)

5. Создание релиза:
   - Обновите версию в `src-tauri/Cargo.toml` и `tauri.conf.json`
   - Создайте тег: `git tag v1.0.0 && git push origin v1.0.0`
   - GitHub Actions автоматически соберет и создаст релиз

### GitHub Actions

**Автоматические релизы:**
- При создании и push тега (например, `v1.0.0`) автоматически собирается приложение и создается релиз на GitHub
- При коммите в ветку `main` или `master` выполняется проверка сборки и создаются артефакты (доступны 7 дней)

**Ручной запуск workflow:**
1. Перейдите на вкладку **Actions** в GitHub
2. Выберите workflow **Release**
3. Нажмите **Run workflow**
4. Выберите ветку и нажмите **Run workflow**

**Отладка:**
- Проверьте логи в разделе **Actions**
- Убедитесь, что все секреты настроены правильно
- Проверьте, что версия в `Cargo.toml` и `tauri.conf.json` совпадает с тегом

### О latest.json

**Да, latest.json обязателен для автообновления Tauri 2.0.** 

Tauri updater не может работать только по версии релиза, потому что ему нужна:
- **Подпись файла (signature)** - для проверки подлинности обновления (обязательно)
- **URL для скачивания** - прямой путь к установочному файлу
- **Метаданные** - версия, дата публикации, заметки

`tauri-action` автоматически создает `latest.json` с подписью при сборке (если `includeUpdaterJson: true` и настроен `TAURI_PRIVATE_KEY`). Файл должен загружаться в релиз автоматически.

Если `latest.json` не создается:
1. Проверьте, что `TAURI_PRIVATE_KEY` настроен в GitHub Secrets
2. Проверьте логи GitHub Actions - там будет указано, где искать файл
3. Файл обычно создается в `src-tauri/target/release/bundle/nsis/latest.json` или рядом с установочным файлом

### Формат latest.json

```json
{
  "version": "1.0.0",
  "notes": "Описание обновления",
  "pub_date": "2024-01-01T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "подпись файла (обязательно!)",
      "url": "https://github.com/USERNAME/toolbox/releases/download/v1.0.0/toolbox_1.0.0_x64-setup.exe"
    }
  }
}
```

## Использование

### WebP → PNG Конвертер

1. Перейдите на вкладку "Инструменты"
2. Нажмите "Открыть" на карточке "WebP → PNG Конвертер"
3. Нажмите "Выбрать папку" и выберите папку с WebP файлами
4. Нажмите "Конвертировать"
5. После конвертации выберите, удалять ли исходные WebP файлы

### AI Утилиты

Все AI утилиты доступны на вкладке "AI". Выберите нужную утилиту и следуйте инструкциям в интерфейсе.

## Разработка

### Структура проекта

```
toolbox/
├── src/                      # Frontend код (React)
│   ├── components/           # React компоненты
│   │   ├── utilities/       # Компоненты утилит
│   │   └── Navigation.jsx   # Навигация
│   ├── contexts/            # React контексты
│   ├── hooks/               # React хуки
│   ├── pages/               # Страницы приложения
│   ├── utils/               # Утилиты
│   ├── App.jsx              # Главный компонент
│   ├── main.jsx             # Точка входа React
│   └── style.css            # Стили
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs          # Точка входа
│   │   └── commands.rs      # Команды Tauri
│   ├── capabilities/        # Конфигурация разрешений
│   └── Cargo.toml           # Зависимости Rust
├── scripts/                 # Скрипты для управления версиями
├── index.html               # HTML шаблон
└── package.json             # Зависимости Node.js
```

### Управление версиями

Для синхронизации версий между `package.json` и `Cargo.toml`:

```bash
npm run version:patch   # Увеличить patch версию (1.0.0 → 1.0.1)
npm run version:minor   # Увеличить minor версию (1.0.0 → 1.1.0)
npm run version:major   # Увеличить major версию (1.0.0 → 2.0.0)
npm run version:sync    # Синхронизировать версии
```

## Лицензия

MIT

