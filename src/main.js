import { invoke as invokeCore } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getName, getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { initNavigation } from './navigation.js';
import { initSettings } from './settings.js';

// Проверяем доступность API
console.log('Tauri window API:', typeof getCurrentWindow);

// Используем invoke с проверкой и fallback
const invoke = invokeCore || (window.__TAURI__?.core?.invoke);

// Инициализация навигации и настроек
initNavigation();
initSettings();

// Установка версии в заголовок окна
async function setWindowTitle() {
    try {
        const [name, version] = await Promise.all([getName(), getVersion()]);
        const appWindow = getCurrentWindow();
        await appWindow.setTitle(`${name} v${version}`);
    } catch (error) {
        console.error('Ошибка при установке заголовка окна:', error);
    }
}

// Проверка обновлений
async function checkForUpdates(showNotification = false) {
    try {
        console.log('Проверка обновлений...');
        const update = await check();
        console.log('Результат проверки:', update);
        if (update?.available) {
            console.log('Найдено обновление:', update.version);
            if (showNotification) {
                showUpdateNotification(update);
            }
            // Плагин автоматически покажет диалог, если dialog: true в конфиге
            return update;
        } else {
            if (showNotification) {
                showNotificationMessage('Обновления не найдены. У вас установлена последняя версия.', 'success');
            }
            console.log('Обновления не найдены');
            return null;
        }
    } catch (error) {
        console.error('Ошибка при проверке обновлений:', error);
        console.error('Тип ошибки:', typeof error);
        console.error('Сообщение ошибки:', error.message);
        console.error('Стек ошибки:', error.stack);
        if (showNotification) {
            showNotificationMessage('Ошибка при проверке обновлений: ' + (error.message || String(error)), 'error');
        }
        return null;
    }
}

// Показ уведомления об обновлении
function showUpdateNotification(update) {
    const currentVersion = document.getElementById('currentVersion')?.textContent || 'неизвестна';
    const message = `Доступна новая версия: ${update.version}\nТекущая версия: ${currentVersion}`;
    
    if (confirm(message + '\n\nХотите установить обновление сейчас?')) {
        update.downloadAndInstall(
            (chunkLength, contentLength) => {
                console.log(`Загружено: ${chunkLength}/${contentLength || 0}`);
            },
            () => {
                console.log('Установка обновления...');
            }
        ).then(() => {
            showNotificationMessage('Обновление установлено. Приложение будет перезапущено.', 'success');
        }).catch((error) => {
            showNotificationMessage('Ошибка при установке обновления: ' + error.message, 'error');
        });
    }
}

// Показ уведомления
function showNotificationMessage(message, type = 'info') {
    // Простое уведомление через alert, можно заменить на более красивое
    alert(message);
}

// Устанавливаем заголовок и проверяем обновления после загрузки DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setWindowTitle();
        // Автоматическая проверка обновлений при запуске (без уведомления, если обновлений нет)
        checkForUpdates(false);
    });
} else {
    setWindowTitle();
    checkForUpdates(false);
}

// Экспортируем функцию для использования в настройках
window.checkForUpdates = checkForUpdates;

// WebP → PNG Конвертер
let selectedFolderPath = null;

const convertBtn = document.getElementById('convertBtn');
const selectedFolderDiv = document.getElementById('selectedFolder');
const progressDiv = document.getElementById('progress');
const resultsDiv = document.getElementById('results');

// Функция для установки выбранной папки
function setSelectedFolder(path) {
    selectedFolderPath = path;
    selectedFolderDiv.innerHTML = `
        <span class="folder-path">${escapeHtml(path)}</span>
        <button class="clear-folder-btn" id="clearFolderBtn" title="Очистить">✕</button>
    `;
    selectedFolderDiv.classList.add('has-folder');
    convertBtn.disabled = false;
    
    // Добавляем обработчик для кнопки очистки
    const clearBtn = document.getElementById('clearFolderBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Предотвращаем открытие диалога при клике на кнопку
            clearSelectedFolder();
        });
    }
}

// Функция для очистки выбранной папки
function clearSelectedFolder() {
    selectedFolderPath = null;
    selectedFolderDiv.innerHTML = '<div class="dropzone-placeholder">Перетащите папку сюда или кликните для выбора</div>';
    selectedFolderDiv.classList.remove('has-folder');
    convertBtn.disabled = true;
    resultsDiv.classList.add('hidden');
}

// Инициализация drag and drop через события окна Tauri
async function initDragAndDrop() {
    if (!selectedFolderDiv) {
        console.warn('selectedFolderDiv не найден');
        return;
    }
    
    try {
        const appWindow = getCurrentWindow();
        console.log('Окно получено:', appWindow);
        console.log('Методы окна:', Object.keys(appWindow));
        
        // В Tauri 2.0 используем onDragDropEvent для обработки drag and drop
        // Проверяем наличие метода
        if (typeof appWindow.onDragDropEvent === 'function') {
            console.log('Используем onDragDropEvent');
            
            const unlisten = await appWindow.onDragDropEvent((event) => {
                console.log('=== Tauri drag drop event ===');
                console.log('Event:', event);
                console.log('Event payload:', event.payload);
                
                if (event.payload.type === 'drop') {
                    selectedFolderDiv.classList.remove('drag-over');
                    const paths = event.payload.paths;
                    console.log('Dropped paths:', paths);
                    
                    if (paths && Array.isArray(paths) && paths.length > 0) {
                        const path = paths[0];
                        console.log('Processing path:', path);
                        handleDroppedPath(path);
                    } else {
                        console.warn('No paths found in drop event');
                    }
                } else if (event.payload.type === 'hover') {
                    selectedFolderDiv.classList.add('drag-over');
                    console.log('Drag hover');
                } else if (event.payload.type === 'cancel') {
                    selectedFolderDiv.classList.remove('drag-over');
                    console.log('Drag cancelled');
                }
            });
            
            console.log('Drag drop listener registered:', unlisten);
        } else {
            console.warn('onDragDropEvent не доступен, пробуем через listen');
            
            // Fallback: используем события через listen
            await appWindow.listen('tauri://drop', (event) => {
                console.log('=== Tauri drop event (fallback) ===');
                console.log('Event:', event);
                selectedFolderDiv.classList.remove('drag-over');
                
                const paths = Array.isArray(event.payload) ? event.payload : 
                             (event.payload?.paths || [event.payload].filter(Boolean));
                
                if (paths && paths.length > 0) {
                    handleDroppedPath(paths[0]);
                }
            });
            
            await appWindow.listen('tauri://drag', () => {
                selectedFolderDiv.classList.add('drag-over');
            });
            
            await appWindow.listen('tauri://drag-cancelled', () => {
                selectedFolderDiv.classList.remove('drag-over');
            });
        }
        
        console.log('Drag and drop инициализирован успешно');
    } catch (error) {
        console.error('Ошибка инициализации drag and drop:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Обработка перетащенного пути
async function handleDroppedPath(path) {
    try {
        const isDir = await invoke('check_path_is_directory', { path });
        if (isDir) {
            setSelectedFolder(path);
        } else {
            // Если это файл, берем родительскую папку
            const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
            if (lastSlash > 0) {
                setSelectedFolder(path.substring(0, lastSlash));
            } else {
                showError('Пожалуйста, перетащите папку, а не файл');
            }
        }
    } catch (error) {
        console.error('Ошибка проверки пути:', error);
        showError('Ошибка обработки пути: ' + (error.message || error));
    }
}

// Запускаем инициализацию drag and drop после загрузки DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM загружен, инициализируем drag and drop');
        initDragAndDrop();
    });
} else {
    console.log('DOM уже загружен, инициализируем drag and drop');
    initDragAndDrop();
}

// Визуальная обратная связь для drag and drop (HTML5 для визуализации)
// Также используем как основной способ, так как события Tauri могут не работать
// Используем capture phase чтобы перехватить события до Tauri
if (selectedFolderDiv) {
    // Обработчики на window с capture phase для перехвата событий до Tauri
    window.addEventListener('dragover', (e) => {
        const isInDropzone = selectedFolderDiv.contains(e.target) || 
                            selectedFolderDiv === e.target ||
                            e.target.closest('#dropzone-placeholder');
        if (isInDropzone) {
            e.preventDefault();
            e.stopPropagation();
            selectedFolderDiv.classList.add('drag-over');
            console.log('Window dragover on dropzone (capture)');
        }
    }, true); // capture phase
    
    window.addEventListener('dragenter', (e) => {
        const isInDropzone = selectedFolderDiv.contains(e.target) || 
                            selectedFolderDiv === e.target ||
                            e.target.closest('#dropzone-placeholder');
        if (isInDropzone) {
            e.preventDefault();
            e.stopPropagation();
            selectedFolderDiv.classList.add('drag-over');
            console.log('Window dragenter on dropzone (capture)');
        }
    }, true); // capture phase
    
    window.addEventListener('dragleave', (e) => {
        const isInDropzone = selectedFolderDiv.contains(e.target) || 
                            selectedFolderDiv === e.target ||
                            e.target.closest('#dropzone-placeholder');
        if (isInDropzone && !selectedFolderDiv.contains(e.relatedTarget)) {
            selectedFolderDiv.classList.remove('drag-over');
            console.log('Window dragleave from dropzone (capture)');
        }
    }, true); // capture phase
    
    // HTML5 drop - основной способ получения путей в Tauri
    // Используем capture phase чтобы перехватить событие до Tauri
    window.addEventListener('drop', async (e) => {
        const dropTarget = e.target;
        const isInDropzone = selectedFolderDiv.contains(dropTarget) || 
                            selectedFolderDiv === dropTarget ||
                            dropTarget.closest('#dropzone-placeholder');
        
        if (!isInDropzone) {
            return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Останавливаем дальнейшую обработку
        selectedFolderDiv.classList.remove('drag-over');
        
        console.log('=== Window drop event (capture) ===');
        console.log('Target:', dropTarget);
        console.log('DataTransfer:', e.dataTransfer);
        try {
            e.preventDefault();
            e.stopPropagation();
            
            console.log('Drop event received');
            console.log('dataTransfer:', e.dataTransfer);
            console.log('files:', e.dataTransfer.files);
            console.log('items:', e.dataTransfer.items);
            
            const items = e.dataTransfer.items;
            const files = Array.from(e.dataTransfer.files);
            
            let path = null;
            
            // В Tauri нужно использовать items для получения путей
            if (items && items.length > 0) {
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    console.log(`Item ${i}:`, {
                        kind: item.kind,
                        type: item.type,
                        getAsFile: typeof item.getAsFile
                    });
                    
                    // Пытаемся получить entry (работает в некоторых браузерах/Tauri)
                    if (item.webkitGetAsEntry) {
                        try {
                            const entry = item.webkitGetAsEntry();
                            console.log('Entry:', entry);
                            
                            if (entry) {
                                if (entry.isDirectory) {
                                    // Это папка
                                    path = entry.fullPath || entry.name;
                                    console.log('Directory found:', path);
                                    break;
                                } else if (entry.isFile) {
                                    // Это файл - получаем его путь и берем родительскую папку
                                    const file = await new Promise((resolve) => {
                                        entry.file(resolve);
                                    });
                                    console.log('File from entry:', file);
                                    
                                    if (file.path) {
                                        path = file.path;
                                        // Берем родительскую папку
                                        const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
                                        if (lastSlash > 0) {
                                            path = path.substring(0, lastSlash);
                                        }
                                        console.log('Parent directory:', path);
                                        break;
                                    }
                                }
                            }
                        } catch (err) {
                            console.error('Error getting entry:', err);
                        }
                    }
                    
                    // Альтернативный способ - через getAsFile
                    if (!path && item.getAsFile) {
                        try {
                            const file = item.getAsFile();
                            console.log('File from getAsFile:', file);
                            
                            if (file && file.path) {
                                path = file.path;
                                // Проверяем, папка это или файл
                                const isDir = await invoke('check_path_is_directory', { path }).catch(() => false);
                                if (!isDir) {
                                    // Это файл - берем родительскую папку
                                    const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
                                    if (lastSlash > 0) {
                                        path = path.substring(0, lastSlash);
                                    }
                                }
                                console.log('Path from getAsFile:', path);
                                break;
                            }
                        } catch (err) {
                            console.error('Error with getAsFile:', err);
                        }
                    }
                }
            }
            
            // Fallback: используем files напрямую
            if (!path && files.length > 0) {
                const file = files[0];
                console.log('Using file object:', file);
                console.log('File properties:', Object.keys(file));
                
                // В Tauri файлы могут иметь свойство path
                if (file.path) {
                    path = file.path;
                    console.log('Path from file.path:', path);
                } else {
                    console.warn('File object does not have path property');
                    console.log('File name:', file.name);
                    console.log('File size:', file.size);
                    console.log('File type:', file.type);
                }
            }
            
            if (path) {
                // Проверяем, что это папка
                try {
                    const isDir = await invoke('check_path_is_directory', { path });
                    console.log('Is directory:', isDir, 'for path:', path);
                    
                    if (isDir) {
                        setSelectedFolder(path);
                    } else {
                        // Если это файл, берем родительскую папку
                        const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
                        if (lastSlash > 0) {
                            const parentPath = path.substring(0, lastSlash);
                            console.log('Using parent path:', parentPath);
                            setSelectedFolder(parentPath);
                        } else {
                            showError('Пожалуйста, перетащите папку, а не файл');
                        }
                    }
                } catch (error) {
                    console.error('Ошибка проверки пути:', error);
                    showError('Ошибка проверки пути: ' + (error.message || error));
                }
            } else {
                console.warn('Не удалось получить путь из drop события');
                showError('Не удалось получить путь к папке. В Tauri drag and drop может работать ограниченно. Используйте кнопку "Выбрать папку".');
            }
        } catch (error) {
            console.error('Ошибка обработки drag and drop:', error);
            showError('Ошибка обработки перетаскивания: ' + (error.message || error));
        }
    }, false);
}

// Обработчик клика на дроп-зоне для выбора папки
selectedFolderDiv?.addEventListener('click', async (e) => {
    // Не открываем диалог, если кликнули на кнопку очистки
    if (e.target.closest('.clear-folder-btn')) {
        return;
    }
    
    // Если уже выбрана папка, не открываем диалог при клике на путь
    if (selectedFolderPath && e.target.closest('.folder-path')) {
        return;
    }
    
    try {
        if (!open) {
            throw new Error('Функция open не загружена');
        }
        const path = await open({
            directory: true,
            multiple: false,
            title: 'Выберите папку'
        });
        if (path) {
            setSelectedFolder(path);
        }
    } catch (error) {
        console.error('Ошибка выбора папки:', error);
        showError('Ошибка выбора папки: ' + (error.message || error));
    }
});

convertBtn?.addEventListener('click', async () => {
    if (!selectedFolderPath) {
        showError('Пожалуйста, выберите папку');
        return;
    }

       // Скрываем предыдущие результаты
       resultsDiv.classList.add('hidden');
       progressDiv.classList.remove('hidden');
       convertBtn.disabled = true;
       selectedFolderDiv.style.pointerEvents = 'none'; // Отключаем клики во время конвертации

    try {
        if (!invoke) {
            throw new Error('Функция invoke не загружена. Убедитесь, что приложение запущено через Tauri.');
        }
        const result = await invoke('convert_webp_to_png', {
            folderPath: selectedFolderPath
        });

        progressDiv.classList.add('hidden');
        showResults(result);
        
        // Показываем диалог удаления
        if (result.converted > 0) {
            showDeletePrompt(result.converted);
        }
    } catch (error) {
        progressDiv.classList.add('hidden');
        showError('Ошибка конвертации: ' + error);
       } finally {
           convertBtn.disabled = false;
           selectedFolderDiv.style.pointerEvents = ''; // Включаем клики обратно
       }
});

function showResults(result) {
    resultsDiv.classList.remove('hidden');
    resultsDiv.className = 'results ' + (result.failed === 0 ? 'success' : 'error');

    const html = `
        <div class="result-title">Результаты конвертации</div>
        <div class="result-stats">
            <div class="stat">
                <span class="stat-label">Конвертировано</span>
                <span class="stat-value success">${result.converted}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Ошибок</span>
                <span class="stat-value error">${result.failed}</span>
            </div>
        </div>
        ${result.errors.length > 0 ? `
            <div class="errors-list">
                <h4>Ошибки:</h4>
                ${result.errors.map(err => `<div class="error-item">${escapeHtml(err)}</div>`).join('')}
            </div>
        ` : ''}
    `;

    resultsDiv.innerHTML = html;
}

function showDeletePrompt(convertedCount) {
    const deletePrompt = document.createElement('div');
    deletePrompt.className = 'delete-prompt';
    deletePrompt.innerHTML = `
        <p>Конвертировано ${convertedCount} файл(ов). Удалить исходные WebP файлы?</p>
        <div class="delete-buttons">
            <button class="btn btn-danger" id="deleteBtn">Да, удалить</button>
            <button class="btn btn-secondary" id="cancelDeleteBtn">Нет, оставить</button>
        </div>
    `;

    resultsDiv.appendChild(deletePrompt);

    // Сохраняем ссылку на invoke в замыкании
    const invokeFn = invoke;
    const folderPath = selectedFolderPath;

    document.getElementById('deleteBtn').addEventListener('click', async () => {
        try {
            if (!invokeFn) {
                throw new Error('Функция invoke не загружена.');
            }
            const deleted = await invokeFn('delete_webp_files', {
                folderPath: folderPath
            });
            deletePrompt.innerHTML = `<p style="color: var(--success);">✓ Удалено ${deleted} WebP файл(ов)</p>`;
        } catch (error) {
            deletePrompt.innerHTML = `<p style="color: var(--error);">Ошибка удаления: ${error}</p>`;
        }
    });

    document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
        deletePrompt.remove();
    });
}

function showError(message) {
    if (!resultsDiv) return;
    resultsDiv.classList.remove('hidden');
    resultsDiv.className = 'results error';
    resultsDiv.innerHTML = `
        <div class="result-title" style="color: var(--error);">Ошибка</div>
        <p>${escapeHtml(message)}</p>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
