import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke as invokeCore } from '@tauri-apps/api/core';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { loadApiKeys } from './settings.js';

const invoke = invokeCore || (window.__TAURI__?.core?.invoke);

// Вспомогательная функция для поиска элемента по ID (с учетом измененных ID)
function findElementInContainer(container, baseId) {
    // Сначала пробуем найти по точному ID
    let element = container.querySelector ? 
        container.querySelector(`#${baseId}`) : 
        (container.getElementById ? container.getElementById(baseId) : null);
    
    // Если не найден, ищем элемент, ID которого начинается с baseId
    if (!element) {
        const allElements = container.querySelectorAll(`[id^="${baseId}"]`);
        if (allElements.length > 0) {
            element = allElements[0];
        }
    }
    
    return element;
}

// Элементы DOM
const selectedImageDiv = document.getElementById('selectedImage');
const previewSection = document.getElementById('previewSection');
const previewImage = document.getElementById('previewImage');
const fileName = document.getElementById('fileName');
const upscaleBtn = document.getElementById('upscaleBtn');
const upscaleProgress = document.getElementById('upscaleProgress');
const resultSection = document.getElementById('resultSection');
const resultImage = document.getElementById('resultImage');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const upscaleError = document.getElementById('upscaleError');

let selectedFile = null;
let resultImageUrl = null;

// Функция для экранирования HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Функция для установки выбранного изображения
function setSelectedImage(file) {
    selectedFile = file;
    
    // Обновляем drop zone - показываем имя файла и кнопку очистки
    const fileDisplayName = file.name || (file.path ? file.path.split(/[/\\]/).pop() : 'Изображение');
    selectedImageDiv.innerHTML = `
        <span class="folder-path">${escapeHtml(fileDisplayName)}</span>
        <button class="clear-folder-btn" id="clearImageBtn" title="Очистить">✕</button>
    `;
    selectedImageDiv.classList.add('has-folder');
    upscaleBtn.disabled = false;
    
    // Добавляем обработчик для кнопки очистки
    const clearBtn = document.getElementById('clearImageBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelectedImage();
        });
    }
    
    // Показываем превью
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        previewSection.classList.remove('hidden');
        if (fileName) {
            fileName.textContent = file.name || fileDisplayName;
        }
    };
    reader.readAsDataURL(file);
    
    // Скрываем результат и ошибки
    resultSection.classList.add('hidden');
    hideError();
}

// Функция для очистки выбранного изображения
function clearSelectedImage() {
    selectedFile = null;
    resultImageUrl = null;
    selectedImageDiv.innerHTML = '<div class="dropzone-placeholder">Перетащите изображение сюда или кликните для выбора</div>';
    selectedImageDiv.classList.remove('has-folder');
    upscaleBtn.disabled = true;
    previewSection.classList.add('hidden');
    resultSection.classList.add('hidden');
    upscaleProgress.classList.add('hidden');
    hideError();
}

// Обработка перетащенного файла
async function handleDroppedFile(path) {
    try {
        // Проверяем, что это файл, а не папка
        const isDir = await invoke('check_path_is_directory', { path }).catch(() => false);
        if (isDir) {
            return null;
        }
        
        // Проверяем расширение файла
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
        if (!imageExtensions.includes(ext)) {
            return null;
        }
        
        // Читаем файл через Tauri FS plugin
        const fileData = await readFile(path);
        const fileName = path.split(/[/\\]/).pop();
        
        // Определяем MIME тип по расширению
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp'
        };
        const mimeType = mimeTypes[ext] || 'image/png';
        
        const blob = new Blob([fileData], { type: mimeType });
        const fileObj = new File([blob], fileName, { type: mimeType });
        fileObj.path = path; // Сохраняем путь для совместимости
        
        // Проверяем размер файла
        const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
        if (fileObj.size > MAX_FILE_SIZE) {
            return null;
        }
        
        return fileObj;
    } catch (error) {
        console.error('Ошибка обработки файла:', error);
        showError('Ошибка обработки файла: ' + (error.message || error));
    }
}

// Обработка HTML5 drop события для файлов
async function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    selectedImageDiv.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) {
        return;
    }
    
    const file = files[0];
    
    // Проверяем тип файла
    if (!file.type.startsWith('image/')) {
        showError('Пожалуйста, выберите файл изображения');
        return;
    }
    
    // Проверяем размер файла (максимум 5MB для FAL API)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
        showError(`Файл слишком большой. Максимальный размер: 5MB. Ваш файл: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
        return;
    }
    
    setSelectedImage(file);
}

// Инициализация drag and drop
async function initDragAndDrop() {
    if (!selectedImageDiv) {
        console.warn('selectedImageDiv не найден');
        return;
    }
    
    try {
        const appWindow = getCurrentWindow();
        
        // HTML5 drag and drop для визуальной обратной связи и обработки файлов
        window.addEventListener('dragover', (e) => {
            const isInDropzone = selectedImageDiv.contains(e.target) || selectedImageDiv === e.target;
            if (isInDropzone) {
                e.preventDefault();
                e.stopPropagation();
                selectedImageDiv.classList.add('drag-over');
            }
        }, true);
        
        window.addEventListener('dragleave', (e) => {
            const isInDropzone = selectedImageDiv.contains(e.target) || selectedImageDiv === e.target;
            if (isInDropzone && !selectedImageDiv.contains(e.relatedTarget)) {
                selectedImageDiv.classList.remove('drag-over');
            }
        }, true);
        
        // HTML5 drop - основной способ для файлов
        window.addEventListener('drop', (e) => {
            const isInDropzone = selectedImageDiv.contains(e.target) || selectedImageDiv === e.target;
            if (isInDropzone) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                selectedImageDiv.classList.remove('drag-over');
                handleFileDrop(e);
            }
        }, true);
        
        // Tauri drag drop events - для обработки путей файлов
        if (typeof appWindow.onDragDropEvent === 'function') {
            await appWindow.onDragDropEvent((event) => {
                if (event.payload.type === 'drop') {
                    selectedImageDiv.classList.remove('drag-over');
                    const paths = event.payload.paths;
                    
                    if (paths && Array.isArray(paths) && paths.length > 0) {
                        const path = paths[0];
                        // Обрабатываем только если HTML5 drop не сработал (нет файлов в dataTransfer)
                        // Это fallback для случаев, когда HTML5 drop не работает
                        handleDroppedFile(path).then(file => {
                            if (file) {
                                setSelectedImage(file);
                            }
                        });
                    }
                } else if (event.payload.type === 'hover') {
                    selectedImageDiv.classList.add('drag-over');
                } else if (event.payload.type === 'cancel') {
                    selectedImageDiv.classList.remove('drag-over');
                }
            });
        }
        
    } catch (error) {
        console.error('Ошибка инициализации drag and drop:', error);
    }
}

// Инициализация обработчиков событий
function initEventHandlers() {
    // Обработчик клика на дроп-зоне для выбора файла
    if (selectedImageDiv) {
        selectedImageDiv.addEventListener('click', async () => {
            try {
                const file = await open({
                    multiple: false,
                    filters: [{
                        name: 'Images',
                        extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
                    }]
                });
                
                if (file) {
                    // В Tauri open возвращает путь, нужно создать File объект
                    // Используем readFile из Tauri FS plugin
                    try {
                        const fileData = await readFile(file);
                        const fileName = file.split(/[/\\]/).pop();
                        
                        // Определяем MIME тип по расширению
                        const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
                        const mimeTypes = {
                            '.jpg': 'image/jpeg',
                            '.jpeg': 'image/jpeg',
                            '.png': 'image/png',
                            '.gif': 'image/gif',
                            '.bmp': 'image/bmp',
                            '.webp': 'image/webp'
                        };
                        const mimeType = mimeTypes[ext] || 'image/png';
                        
                        const blob = new Blob([fileData], { type: mimeType });
                        const fileObj = new File([blob], fileName, { type: mimeType });
                        fileObj.path = file; // Сохраняем путь для совместимости
                        setSelectedImage(fileObj);
                    } catch (err) {
                        console.error('Ошибка чтения файла:', err);
                        showError('Ошибка загрузки файла: ' + (err.message || err));
                    }
                }
            } catch (error) {
                console.error('Ошибка выбора файла:', error);
                if (error !== 'User cancelled the dialog') {
                    showError('Ошибка выбора файла: ' + (error.message || error));
                }
            }
        });
    }

    // Обработчик кнопки Upscale
    if (upscaleBtn) {
        upscaleBtn.addEventListener('click', async () => {
            if (!selectedFile) return;
            
            // Получаем FAL API ключ из настроек
            let falKey;
            try {
                const settings = await invoke('load_settings');
                if (!settings || !settings.api_keys || !settings.api_keys.FAL) {
                    showError('FAL API ключ не найден. Пожалуйста, добавьте его в настройках.');
                    return;
                }
                falKey = settings.api_keys.FAL;
            } catch (error) {
                console.error('Ошибка загрузки настроек:', error);
                showError('Ошибка загрузки настроек. Проверьте FAL API ключ в настройках.');
                return;
            }
            
            // Динамически импортируем FAL клиент
            const { fal } = await import('@fal-ai/client');
            
            // Настраиваем FAL клиент
            fal.config({
                credentials: falKey
            });
            
            // Показываем прогресс
            upscaleBtn.disabled = true;
            upscaleProgress.classList.remove('hidden');
            resultSection.classList.add('hidden');
            hideError();
            
            try {
                // Проверяем размер файла
                const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
                if (selectedFile.size > MAX_FILE_SIZE) {
                    throw new Error(`Файл слишком большой. Максимальный размер: 5MB. Ваш файл: ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`);
                }
                
                // Загружаем файл в FAL storage
                const imageUrl = await fal.storage.upload(selectedFile);
                console.log('Uploaded image URL:', imageUrl);
                
                // Вызываем upscale API с safe check disabled
                const result = await fal.subscribe("fal-ai/recraft/upscale/crisp", {
                    input: {
                        image_url: imageUrl,
                        sync_mode: true,
                        enable_safety_checker: false  // Важно: отключаем safety check как в примере
                    },
                    logs: true,
                    onQueueUpdate: (update) => {
                        if (update.status === "IN_PROGRESS") {
                            console.log('Processing:', update.logs?.map(log => log.message).join('\n'));
                        }
                    },
                });
                
                // Показываем результат
                resultImageUrl = result.data.image.url;
                resultImage.src = resultImageUrl;
                resultSection.classList.remove('hidden');
                
                // Прокручиваем к результату
                resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                
            } catch (error) {
                console.error('Ошибка upscale:', error);
                let errorMessage = error.message || 'Ошибка при обработке изображения';
                
                if (error.body?.detail) {
                    const details = Array.isArray(error.body.detail) 
                        ? error.body.detail.map(d => JSON.stringify(d)).join(', ')
                        : JSON.stringify(error.body.detail);
                    errorMessage = `Ошибка валидации: ${details}`;
                }
                
                showError(errorMessage);
            } finally {
                upscaleBtn.disabled = false;
                upscaleProgress.classList.add('hidden');
            }
        });
    }

    // Обработчик кнопки скачивания
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
            if (!resultImageUrl) return;
            
            try {
                // Скачиваем изображение
                const response = await fetch(resultImageUrl);
                const blob = await response.blob();
                
                // Используем Tauri dialog для сохранения
                const { save } = await import('@tauri-apps/plugin-dialog');
                const filePath = await save({
                    filters: [{
                        name: 'Images',
                        extensions: ['png']
                    }],
                    defaultPath: 'upscaled-image.png'
                });
                
                if (filePath) {
                    // Сохраняем файл
                    const arrayBuffer = await blob.arrayBuffer();
                    await writeFile(filePath, new Uint8Array(arrayBuffer));
                    showSuccess('Изображение успешно сохранено!');
                }
            } catch (error) {
                console.error('Ошибка скачивания:', error);
                showError('Ошибка при сохранении изображения: ' + (error.message || error));
            }
        });
    }

    // Обработчик кнопки очистки
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearSelectedImage();
        });
    }
}

// Функции для показа ошибок и успеха
function showError(message) {
    if (upscaleError) {
        upscaleError.textContent = message;
        upscaleError.classList.remove('hidden');
    }
}

function hideError() {
    if (upscaleError) {
        upscaleError.classList.add('hidden');
    }
}

function showSuccess(message) {
    // Можно использовать alert или создать уведомление
    alert(message);
}

// Инициализация при загрузке страницы
export function initUpscale() {
    // Инициализируем для всех существующих страниц Upscale
    initUpscaleForPage(document);
}

// Инициализация для конкретного документа/элемента
export function initUpscaleForPage(container) {
    console.log('initUpscaleForPage вызван, container:', container);
    console.log('container.id:', container?.id);
    
    // Если container - это document, ищем страницу в нем
    // Если container - это сама страница, используем её
    let upscalePage;
    if (container.id && container.classList.contains('ai-tab-page')) {
        // Это уже клонированная страница
        upscalePage = container;
    } else {
        // Ищем страницу в контейнере
        upscalePage = container.getElementById ? 
            container.getElementById('page-utility-upscale') : 
            container.querySelector('#page-utility-upscale');
    }
    
    if (!upscalePage) {
        console.log('upscalePage не найдена');
        return;
    }
    
    console.log('upscalePage найдена:', upscalePage.id);
    
    // Инициализируем обработчики событий для этой страницы
    initEventHandlersForContainer(upscalePage);
    
    // Инициализируем drag and drop для этой страницы
    initDragAndDropForContainer(upscalePage);
}

// Инициализация обработчиков для конкретного контейнера
function initEventHandlersForContainer(container) {
    const selectedImageDiv = findElementInContainer(container, 'selectedImage');
    const upscaleBtn = findElementInContainer(container, 'upscaleBtn');
    const downloadBtn = findElementInContainer(container, 'downloadBtn');
    const clearBtn = findElementInContainer(container, 'clearBtn');
    
    // Обработчик клика на дроп-зоне для выбора файла
    if (selectedImageDiv && !selectedImageDiv.dataset.initialized) {
        selectedImageDiv.dataset.initialized = 'true';
        selectedImageDiv.addEventListener('click', async () => {
            try {
                const file = await open({
                    multiple: false,
                    filters: [{
                        name: 'Images',
                        extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
                    }]
                });
                
                if (file) {
                    // В Tauri open возвращает путь, нужно создать File объект
                    // Используем readFile из Tauri FS plugin
                    try {
                        const fileData = await readFile(file);
                        const fileName = file.split(/[/\\]/).pop();
                        
                        // Определяем MIME тип по расширению
                        const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
                        const mimeTypes = {
                            '.jpg': 'image/jpeg',
                            '.jpeg': 'image/jpeg',
                            '.png': 'image/png',
                            '.gif': 'image/gif',
                            '.bmp': 'image/bmp',
                            '.webp': 'image/webp'
                        };
                        const mimeType = mimeTypes[ext] || 'image/png';
                        
                        const blob = new Blob([fileData], { type: mimeType });
                        const fileObj = new File([blob], fileName, { type: mimeType });
                        fileObj.path = file; // Сохраняем путь для совместимости
                        setSelectedImageForContainer(fileObj, container);
                    } catch (err) {
                        console.error('Ошибка чтения файла:', err);
                        showErrorForContainer('Ошибка загрузки файла: ' + (err.message || err), container);
                    }
                }
            } catch (error) {
                console.error('Ошибка выбора файла:', error);
                if (error !== 'User cancelled the dialog') {
                    showErrorForContainer('Ошибка выбора файла: ' + (error.message || error), container);
                }
            }
        });
    }
    
    // Обработчик кнопки Upscale
    if (upscaleBtn && !upscaleBtn.dataset.initialized) {
        upscaleBtn.dataset.initialized = 'true';
        upscaleBtn.addEventListener('click', async () => {
            const selectedFile = getSelectedFileForContainer(container);
            if (!selectedFile) return;
            
            // Получаем FAL API ключ из настроек
            let falKey;
            try {
                const settings = await invoke('load_settings');
                if (!settings || !settings.api_keys || !settings.api_keys.FAL) {
                    showErrorForContainer('FAL API ключ не найден. Пожалуйста, добавьте его в настройках.', container);
                    return;
                }
                falKey = settings.api_keys.FAL;
            } catch (error) {
                console.error('Ошибка загрузки настроек:', error);
                showErrorForContainer('Ошибка загрузки настроек. Проверьте FAL API ключ в настройках.', container);
                return;
            }
            
            // Динамически импортируем FAL клиент
            const { fal } = await import('@fal-ai/client');
            
            // Настраиваем FAL клиент
            fal.config({
                credentials: falKey
            });
            
            // Показываем прогресс
            const upscaleProgress = findElementInContainer(container, 'upscaleProgress');
            const resultSection = findElementInContainer(container, 'resultSection');
            
            upscaleBtn.disabled = true;
            if (upscaleProgress) upscaleProgress.classList.remove('hidden');
            if (resultSection) resultSection.classList.add('hidden');
            hideErrorForContainer(container);
            
            try {
                // Проверяем размер файла
                const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
                if (selectedFile.size > MAX_FILE_SIZE) {
                    throw new Error(`Файл слишком большой. Максимальный размер: 5MB. Ваш файл: ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`);
                }
                
                // Загружаем файл в FAL storage
                const imageUrl = await fal.storage.upload(selectedFile);
                console.log('Uploaded image URL:', imageUrl);
                
                // Вызываем upscale API с safe check disabled
                const result = await fal.subscribe("fal-ai/recraft/upscale/crisp", {
                    input: {
                        image_url: imageUrl,
                        sync_mode: true,
                        enable_safety_checker: false  // Важно: отключаем safety check как в примере
                    },
                    logs: true,
                    onQueueUpdate: (update) => {
                        if (update.status === "IN_PROGRESS") {
                            console.log('Processing:', update.logs?.map(log => log.message).join('\n'));
                        }
                    },
                });
                
                // Показываем результат
                const resultImage = findElementInContainer(container, 'resultImage');
                const resultImageUrl = result.data.image.url;
                if (resultImage) resultImage.src = resultImageUrl;
                if (resultSection) {
                    resultSection.classList.remove('hidden');
                    resultSection.dataset.resultUrl = resultImageUrl;
                }
                
                // Прокручиваем к результату
                if (resultSection) {
                    resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                
            } catch (error) {
                console.error('Ошибка upscale:', error);
                let errorMessage = error.message || 'Ошибка при обработке изображения';
                
                if (error.body?.detail) {
                    const details = Array.isArray(error.body.detail) 
                        ? error.body.detail.map(d => JSON.stringify(d)).join(', ')
                        : JSON.stringify(error.body.detail);
                    errorMessage = `Ошибка валидации: ${details}`;
                }
                
                showErrorForContainer(errorMessage, container);
            } finally {
                upscaleBtn.disabled = false;
                if (upscaleProgress) upscaleProgress.classList.add('hidden');
            }
        });
    }
    
    // Обработчик кнопки скачивания
    if (downloadBtn && !downloadBtn.dataset.initialized) {
        downloadBtn.dataset.initialized = 'true';
        downloadBtn.addEventListener('click', async () => {
            const resultSection = findElementInContainer(container, 'resultSection');
            const resultImageUrl = resultSection?.dataset.resultUrl;
            
            if (!resultImageUrl) return;
            
            try {
                // Скачиваем изображение
                const response = await fetch(resultImageUrl);
                const blob = await response.blob();
                
                // Используем Tauri dialog для сохранения
                const { save } = await import('@tauri-apps/plugin-dialog');
                const filePath = await save({
                    filters: [{
                        name: 'Images',
                        extensions: ['png']
                    }],
                    defaultPath: 'upscaled-image.png'
                });
                
                if (filePath) {
                    // Сохраняем файл
                    const arrayBuffer = await blob.arrayBuffer();
                    await writeFile(filePath, new Uint8Array(arrayBuffer));
                    showSuccess('Изображение успешно сохранено!');
                }
            } catch (error) {
                console.error('Ошибка скачивания:', error);
                showErrorForContainer('Ошибка при сохранении изображения: ' + (error.message || error), container);
            }
        });
    }
    
    // Обработчик кнопки очистки
    if (clearBtn && !clearBtn.dataset.initialized) {
        clearBtn.dataset.initialized = 'true';
        clearBtn.addEventListener('click', () => {
            clearSelectedImageForContainer(container);
        });
    }
}

// Вспомогательные функции для работы с контейнерами
function setSelectedImageForContainer(file, container) {
    console.log('setSelectedImageForContainer вызван:', file.name, container);
    
    // Ищем selectedImage - может быть с измененным ID или без
    let selectedImageDiv = container.querySelector ? 
        container.querySelector('#selectedImage') : 
        (container.getElementById ? container.getElementById('selectedImage') : null);
    
    // Если не найден, ищем по атрибуту data-dropzone или по классу
    if (!selectedImageDiv) {
        selectedImageDiv = container.querySelector('[data-dropzone="true"]') || 
                          container.querySelector('.selected-folder');
    }
    
    // Если все еще не найден, ищем элемент, ID которого начинается с selectedImage
    if (!selectedImageDiv) {
        const allElements = container.querySelectorAll('[id^="selectedImage"]');
        if (allElements.length > 0) {
            selectedImageDiv = allElements[0];
        }
    }
    const previewSection = findElementInContainer(container, 'previewSection');
    const previewImage = findElementInContainer(container, 'previewImage');
    const fileName = findElementInContainer(container, 'fileName');
    const upscaleBtn = findElementInContainer(container, 'upscaleBtn');
    const resultSection = findElementInContainer(container, 'resultSection');
    
    console.log('Найденные элементы:', {
        selectedImageDiv: !!selectedImageDiv,
        previewSection: !!previewSection,
        previewImage: !!previewImage,
        fileName: !!fileName,
        upscaleBtn: !!upscaleBtn
    });
    
    if (!selectedImageDiv) {
        console.error('selectedImageDiv не найден в контейнере');
        return;
    }
    
    // Сохраняем файл в data-атрибут
    selectedImageDiv.dataset.selectedFile = JSON.stringify({ name: file.name, size: file.size });
    
    // Обновляем drop zone
    const fileDisplayName = file.name || (file.path ? file.path.split(/[/\\]/).pop() : 'Изображение');
    selectedImageDiv.innerHTML = `
        <span class="folder-path">${escapeHtml(fileDisplayName)}</span>
        <button class="clear-folder-btn" id="clearImageBtn" title="Очистить">✕</button>
    `;
    selectedImageDiv.classList.add('has-folder');
    if (upscaleBtn) upscaleBtn.disabled = false;
    
    // Показываем превью
    const reader = new FileReader();
    reader.onload = (e) => {
        if (previewImage) previewImage.src = e.target.result;
        if (previewSection) previewSection.classList.remove('hidden');
        if (fileName) fileName.textContent = file.name || fileDisplayName;
    };
    reader.readAsDataURL(file);
    
    // Скрываем результат и ошибки
    if (resultSection) resultSection.classList.add('hidden');
    hideErrorForContainer(container);
}

function clearSelectedImageForContainer(container) {
    const selectedImageDiv = findElementInContainer(container, 'selectedImage');
    const previewSection = findElementInContainer(container, 'previewSection');
    const upscaleBtn = findElementInContainer(container, 'upscaleBtn');
    const resultSection = findElementInContainer(container, 'resultSection');
    const upscaleProgress = findElementInContainer(container, 'upscaleProgress');
    
    if (selectedImageDiv) {
        delete selectedImageDiv.dataset.selectedFile;
        selectedImageDiv.innerHTML = '<div class="dropzone-placeholder">Перетащите изображение сюда или кликните для выбора</div>';
        selectedImageDiv.classList.remove('has-folder');
    }
    if (upscaleBtn) upscaleBtn.disabled = true;
    if (previewSection) previewSection.classList.add('hidden');
    if (resultSection) resultSection.classList.add('hidden');
    if (upscaleProgress) upscaleProgress.classList.add('hidden');
    hideErrorForContainer(container);
}

function getSelectedFileForContainer(container) {
    const selectedImageDiv = findElementInContainer(container, 'selectedImage');
    // В реальности нужно хранить File объект, но для упрощения используем data-атрибут
    // Это ограничение - нужно будет переделать на глобальное хранилище
    return selectedImageDiv?.dataset.selectedFile ? JSON.parse(selectedImageDiv.dataset.selectedFile) : null;
}

function showErrorForContainer(message, container) {
    const upscaleError = findElementInContainer(container, 'upscaleError');
    if (upscaleError) {
        upscaleError.textContent = message;
        upscaleError.classList.remove('hidden');
    }
}

function hideErrorForContainer(container) {
    const upscaleError = findElementInContainer(container, 'upscaleError');
    if (upscaleError) {
        upscaleError.classList.add('hidden');
    }
}

function initDragAndDropForContainer(container) {
    console.log('initDragAndDropForContainer вызван, container:', container);
    console.log('container.id:', container?.id);
    console.log('container.classList:', container?.classList);
    
    // Ищем selectedImage - может быть с измененным ID или без
    let selectedImageDiv = findElementInContainer(container, 'selectedImage');
    
    // Если не найден, ищем по атрибуту data-dropzone или по классу
    if (!selectedImageDiv) {
        selectedImageDiv = container.querySelector('[data-dropzone="true"]') || 
                          container.querySelector('.selected-folder');
    }
    
    console.log('selectedImageDiv найден:', !!selectedImageDiv);
    if (selectedImageDiv) {
        console.log('selectedImageDiv.id:', selectedImageDiv.id);
        console.log('selectedImageDiv.dataset.dragInitialized:', selectedImageDiv.dataset.dragInitialized);
    }
    
    if (!selectedImageDiv) {
        console.log('selectedImageDiv не найден');
        return;
    }
    
    // Проверяем, не инициализирован ли уже этот конкретный элемент
    // Используем camelCase для dataset (дефисы не поддерживаются)
    const initKey = `dragInitialized${container.id.replace(/-/g, '')}`;
    if (selectedImageDiv.dataset[initKey]) {
        console.log('selectedImageDiv уже инициализирован для этого контейнера');
        return;
    }
    
    selectedImageDiv.dataset[initKey] = 'true';
    console.log('Инициализируем drag and drop для контейнера:', container.id);
    
    // HTML5 drag and drop для визуальной обратной связи и обработки файлов
    const handleDragOver = (e) => {
        const isInDropzone = selectedImageDiv.contains(e.target) || selectedImageDiv === e.target;
        if (isInDropzone) {
            e.preventDefault();
            e.stopPropagation();
            selectedImageDiv.classList.add('drag-over');
        }
    };
    
    const handleDragLeave = (e) => {
        const isInDropzone = selectedImageDiv.contains(e.target) || selectedImageDiv === e.target;
        if (isInDropzone && !selectedImageDiv.contains(e.relatedTarget)) {
            selectedImageDiv.classList.remove('drag-over');
        }
    };
    
    const handleDrop = async (e) => {
        const isInDropzone = selectedImageDiv.contains(e.target) || selectedImageDiv === e.target;
        if (isInDropzone) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            selectedImageDiv.classList.remove('drag-over');
            
            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0) {
                return;
            }
            
            const file = files[0];
            
            // Проверяем тип файла
            if (!file.type.startsWith('image/')) {
                showErrorForContainer('Пожалуйста, выберите файл изображения', container);
                return;
            }
            
            // Проверяем размер файла (максимум 5MB для FAL API)
            const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
            if (file.size > MAX_FILE_SIZE) {
                showErrorForContainer(`Файл слишком большой. Максимальный размер: 5MB. Ваш файл: ${(file.size / 1024 / 1024).toFixed(2)}MB`, container);
                return;
            }
            
            setSelectedImageForContainer(file, container);
        }
    };
    
    // Добавляем обработчики на window с проверкой контейнера
    window.addEventListener('dragover', handleDragOver, true);
    window.addEventListener('dragleave', handleDragLeave, true);
    window.addEventListener('drop', handleDrop, true);
    
    // Также добавляем обработчики на сам контейнер для надежности
    if (container.addEventListener) {
        container.addEventListener('dragover', handleDragOver, true);
        container.addEventListener('dragleave', handleDragLeave, true);
        container.addEventListener('drop', handleDrop, true);
    }
    
    // Tauri drag drop events - для обработки путей файлов
    // Используем listen вместо onDragDropEvent, так как onDragDropEvent может быть вызван только один раз
    try {
        const appWindow = getCurrentWindow();
        // Сохраняем ссылку на контейнер для проверки
        const containerRef = container;
        const selectedImageDivRef = selectedImageDiv;
        
        console.log('Регистрируем обработчик drag drop для вкладки');
        console.log('containerRef:', containerRef);
        console.log('containerRef.id:', containerRef?.id);
        console.log('containerRef.classList:', containerRef?.classList);
        
        // Используем listen для отдельных событий
        appWindow.listen('tauri://drop', (event) => {
            console.log('Upscale: tauri://drop event получен:', event);
            console.log('Upscale: containerRef:', containerRef);
            console.log('Upscale: containerRef.classList:', containerRef.classList);
            console.log('Upscale: containerRef.classList.contains("active"):', containerRef.classList.contains('active'));
            
            // Проверяем, что активная страница - это наш контейнер
            const isActiveTab = containerRef.classList.contains('active');
            if (!isActiveTab) {
                console.log('Upscale: Вкладка не активна, пропускаем. Активна ли:', isActiveTab);
                return; // Не обрабатываем, если вкладка не активна
            }
            
            console.log('Upscale: Вкладка активна, обрабатываем drop');
            
            // В tauri://drop payload - это массив путей или объект с paths
            const paths = Array.isArray(event.payload) ? event.payload : 
                         (event.payload?.paths || [event.payload].filter(Boolean));
            
            console.log('Upscale: paths из события:', paths);
            
            if (paths && paths.length > 0) {
                const path = paths[0];
                console.log('Upscale: Обработка drop для вкладки:', path);
                
                if (selectedImageDivRef) {
                    selectedImageDivRef.classList.remove('drag-over');
                }
                
                handleDroppedFile(path).then(file => {
                    console.log('Upscale: handleDroppedFile вернул:', file);
                    if (file) {
                        console.log('Upscale: Файл получен, устанавливаем:', file.name);
                        setSelectedImageForContainer(file, containerRef);
                    } else {
                        console.warn('Upscale: Файл не был создан из пути:', path);
                        showErrorForContainer('Не удалось обработать файл. Проверьте, что это изображение.', containerRef);
                    }
                }).catch(err => {
                    console.error('Upscale: Ошибка обработки файла:', err);
                    showErrorForContainer('Ошибка обработки файла: ' + (err.message || err), containerRef);
                });
            } else {
                console.warn('Upscale: paths пуст или не найден');
            }
        }).then(() => {
            console.log('Upscale: Обработчик tauri://drop зарегистрирован');
        }).catch(err => {
            console.error('Upscale: Ошибка регистрации обработчика tauri://drop:', err);
        });
        
        appWindow.listen('tauri://drag', (event) => {
            const isActiveTab = containerRef.classList.contains('active');
            if (!isActiveTab) {
                return;
            }
            
            const position = event.payload?.position || {};
            const elementAtPoint = document.elementFromPoint(
                position.x || 0, 
                position.y || 0
            );
            
            const isInContainer = !elementAtPoint || (
                containerRef.contains(elementAtPoint) ||
                elementAtPoint.closest('.ai-tab-page') === containerRef ||
                selectedImageDivRef?.contains(elementAtPoint) ||
                elementAtPoint.closest('#selectedImage') === selectedImageDivRef
            );
            
            if (isInContainer) {
                if (selectedImageDivRef) {
                    selectedImageDivRef.classList.add('drag-over');
                }
            }
        });
        
        appWindow.listen('tauri://drag-cancelled', () => {
            if (selectedImageDivRef) {
                selectedImageDivRef.classList.remove('drag-over');
            }
        });
    } catch (err) {
        console.error('Ошибка инициализации Tauri drag drop:', err);
    }
}

