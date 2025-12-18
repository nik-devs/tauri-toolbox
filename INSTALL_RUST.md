# Установка Rust для Windows

## Способ 1: Автоматическая установка (рекомендуется)

1. Откройте PowerShell от имени администратора
2. Выполните команду:

```powershell
Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe
.\rustup-init.exe
```

3. Следуйте инструкциям установщика (нажмите Enter для установки по умолчанию)
4. После установки перезапустите PowerShell или выполните:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

## Способ 2: Через официальный сайт

1. Перейдите на https://rustup.rs/
2. Скачайте и запустите `rustup-init.exe`
3. Следуйте инструкциям установщика

## Проверка установки

После установки выполните в новом окне PowerShell:

```powershell
rustc --version
cargo --version
```

Должны отобразиться версии Rust и Cargo.

## Дополнительные компоненты для Windows

После установки Rust, установите компоненты для сборки Windows приложений:

```powershell
rustup target add x86_64-pc-windows-msvc
```

## После установки

Перезапустите терминал и выполните:

```powershell
cd C:\Users\Nik\Documents\Toolbox
npm run tauri dev
```


