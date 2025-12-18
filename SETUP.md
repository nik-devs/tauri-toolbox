# Инструкция по настройке

## Настройка автообновления

### 1. Создание ключевой пары для подписи

```bash
# На Windows PowerShell:
npx @tauri-apps/cli signer generate -w $env:USERPROFILE\.tauri\toolbox.key

# Или на Linux/Mac:
npx @tauri-apps/cli signer generate -w ~/.tauri/toolbox.key
```

Это создаст приватный ключ (`toolbox.key`) и публичный ключ (`toolbox.key.pub`).

### 2. Обновление конфигурации

1. Откройте `src-tauri/tauri.conf.json`
2. Замените `YOUR_USERNAME` на ваш GitHub username в URL обновления
3. Замените `YOUR_PUBLIC_KEY_HERE` на содержимое файла `toolbox.key.pub`

### 3. Обновление Cargo.toml

Откройте `src-tauri/Cargo.toml` и обновите:
- `authors` - ваше имя
- `repository` - URL вашего GitHub репозитория

### 4. GitHub Actions workflows

Созданы два workflow файла:

1. **`.github/workflows/release.yml`** - автоматически создает релиз при push тега (например, `v1.0.0`)
2. **`.github/workflows/build-on-commit.yml`** - собирает приложение при коммите в main/master (для проверки)

Workflow файлы уже созданы в проекте. Они автоматически запустятся при push в репозиторий.

### 5. Настройка GitHub Secrets

В настройках репозитория GitHub добавьте секреты:
- `TAURI_PRIVATE_KEY` - содержимое файла `toolbox.key`
- `TAURI_KEY_PASSWORD` - пароль для ключа (если использовали)

### 6. Создание релиза

После настройки, создайте тег и запушите его:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions автоматически соберет приложение и создаст релиз.

## Добавление иконок

Создайте папку `src-tauri/icons/` и добавьте следующие файлы:
- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (для macOS)
- `icon.ico` (для Windows)

Или используйте инструмент для генерации иконок из одного изображения.

