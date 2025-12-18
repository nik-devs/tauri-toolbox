import { invoke as invokeCore } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

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

// Инициализация настроек
export function initSettings() {
    // Загружаем сохраненные ключи при загрузке страницы
    loadApiKeys();

    // Обработчики кнопок
    document.getElementById('saveKeysBtn')?.addEventListener('click', saveApiKeys);
    document.getElementById('exportKeysBtn')?.addEventListener('click', exportApiKeys);
    document.getElementById('importKeysBtn')?.addEventListener('click', importApiKeys);
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

