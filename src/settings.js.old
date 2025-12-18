import { invoke as invokeCore } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';

const invoke = invokeCore || (window.__TAURI__?.core?.invoke);

const API_KEYS = {
    FAL: 'apiKeyFAL',
    Replicate: 'apiKeyReplicate',
    HF: 'apiKeyHF',
    GPT: 'apiKeyGPT',
    Grok: 'apiKeyGrok'
};

// Загрузка сохраненных ключей
export async function loadApiKeys() {
    try {
        const settings = await invoke('load_settings');
        if (settings && settings.api_keys) {
            Object.keys(API_KEYS).forEach(key => {
                const inputId = API_KEYS[key];
                const input = document.getElementById(inputId);
                if (input && settings.api_keys[key]) {
                    input.value = settings.api_keys[key];
                }
            });
        }
    } catch (error) {
        console.log('Настройки не найдены, используем значения по умолчанию');
    }
}

// Сохранение ключей
export async function saveApiKeys() {
    const keys = {};
    Object.keys(API_KEYS).forEach(key => {
        const inputId = API_KEYS[key];
        const input = document.getElementById(inputId);
        if (input && input.value.trim()) {
            keys[key] = input.value.trim();
        }
    });

    try {
        await invoke('save_settings', { 
            settings: { 
                api_keys: keys 
            } 
        });
        showNotification('Ключи успешно сохранены', 'success');
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        showNotification('Ошибка сохранения ключей', 'error');
    }
}

// Экспорт ключей в JSON
export async function exportApiKeys() {
    const keys = {};
    Object.keys(API_KEYS).forEach(key => {
        const inputId = API_KEYS[key];
        const input = document.getElementById(inputId);
        if (input && input.value.trim()) {
            keys[key] = input.value.trim();
        }
    });

    try {
        const filePath = await save({
            defaultPath: 'toolbox-api-keys.json',
            filters: [{
                name: 'JSON',
                extensions: ['json']
            }]
        });

        if (filePath) {
            // Используем правильный API для записи файла
            await writeTextFile(filePath, JSON.stringify(keys, null, 2));
            showNotification('Ключи успешно экспортированы', 'success');
        }
    } catch (error) {
        console.error('Ошибка экспорта:', error);
        showNotification('Ошибка экспорта ключей', 'error');
    }
}

// Импорт ключей из JSON
export async function importApiKeys() {
    try {
        const filePath = await open({
            filters: [{
                name: 'JSON',
                extensions: ['json']
            }],
            multiple: false
        });

        if (filePath) {
            const content = await readTextFile(filePath);
            const keys = JSON.parse(content);

            // Заполняем поля
            Object.keys(API_KEYS).forEach(key => {
                const inputId = API_KEYS[key];
                const input = document.getElementById(inputId);
                if (input && keys[key]) {
                    input.value = keys[key];
                }
            });

            // Автоматически сохраняем после импорта
            await saveApiKeys();
            showNotification('Ключи успешно импортированы и сохранены', 'success');
        }
    } catch (error) {
        console.error('Ошибка импорта:', error);
        showNotification('Ошибка импорта ключей', 'error');
    }
}

// Загрузка версии приложения
async function loadAppVersion() {
    try {
        const version = await getVersion();
        const versionElement = document.getElementById('currentVersion');
        if (versionElement) {
            versionElement.textContent = `v${version}`;
        }
    } catch (error) {
        console.error('Ошибка при загрузке версии:', error);
        const versionElement = document.getElementById('currentVersion');
        if (versionElement) {
            versionElement.textContent = 'Ошибка загрузки';
        }
    }
}

// Проверка обновлений
async function checkForUpdates() {
    const checkBtn = document.getElementById('checkUpdatesBtn');
    if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.textContent = '⏳ Проверка...';
    }

    try {
        const update = await check();
        if (update?.available) {
            const currentVersion = document.getElementById('currentVersion')?.textContent || 'неизвестна';
            const message = `Доступна новая версия: ${update.version}\nТекущая версия: ${currentVersion}\n\nХотите установить обновление сейчас?`;
            
            if (confirm(message)) {
                checkBtn.textContent = '⬇️ Загрузка...';
                await update.downloadAndInstall(
                    (chunkLength, contentLength) => {
                        console.log(`Загружено: ${chunkLength}/${contentLength || 0}`);
                    },
                    () => {
                        checkBtn.textContent = '⚙️ Установка...';
                        console.log('Установка обновления...');
                    }
                );
                showNotification('Обновление установлено. Приложение будет перезапущено.', 'success');
            }
        } else {
            showNotification('Обновления не найдены. У вас установлена последняя версия.', 'success');
        }
    } catch (error) {
        console.error('Ошибка при проверке обновлений:', error);
        showNotification('Ошибка при проверке обновлений: ' + (error.message || String(error)), 'error');
    } finally {
        if (checkBtn) {
            checkBtn.disabled = false;
            checkBtn.textContent = '🔄 Проверить обновления';
        }
    }
}

// Инициализация настроек
export function initSettings() {
    // Загружаем сохраненные ключи при загрузке страницы
    loadApiKeys();
    
    // Загружаем версию приложения
    loadAppVersion();

    // Обработчики кнопок
    document.getElementById('saveKeysBtn')?.addEventListener('click', saveApiKeys);
    document.getElementById('exportKeysBtn')?.addEventListener('click', exportApiKeys);
    document.getElementById('importKeysBtn')?.addEventListener('click', importApiKeys);
    document.getElementById('checkUpdatesBtn')?.addEventListener('click', checkForUpdates);
}

// Показ уведомлений
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

