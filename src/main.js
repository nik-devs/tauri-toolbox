import { invoke as invokeCore } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

// Используем invoke с проверкой и fallback
const invoke = invokeCore || (window.__TAURI__?.core?.invoke);

// Проверка импорта
console.log('invoke:', typeof invoke);
console.log('invokeCore:', typeof invokeCore);
console.log('open:', typeof open);
console.log('window.__TAURI__:', typeof window.__TAURI__);

let selectedFolderPath = null;

const selectFolderBtn = document.getElementById('selectFolderBtn');
const convertBtn = document.getElementById('convertBtn');
const selectedFolderDiv = document.getElementById('selectedFolder');
const progressDiv = document.getElementById('progress');
const resultsDiv = document.getElementById('results');

selectFolderBtn.addEventListener('click', async () => {
    try {
        if (!open) {
            throw new Error('Функция open не загружена');
        }
        console.log('Вызываем open...');
        const path = await open({
            directory: true,
            multiple: false,
            title: 'Выберите папку'
        });
        console.log('Выбранный путь:', path);
        if (path) {
            selectedFolderPath = path;
            selectedFolderDiv.textContent = path;
            selectedFolderDiv.classList.add('has-folder');
            convertBtn.disabled = false;
        }
    } catch (error) {
        console.error('Ошибка выбора папки:', error);
        console.error('Стек ошибки:', error.stack);
        showError('Ошибка выбора папки: ' + (error.message || error));
    }
});

convertBtn.addEventListener('click', async () => {
    if (!selectedFolderPath) {
        showError('Пожалуйста, выберите папку');
        return;
    }

    // Скрываем предыдущие результаты
    resultsDiv.classList.add('hidden');
    progressDiv.classList.remove('hidden');
    convertBtn.disabled = true;
    selectFolderBtn.disabled = true;

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
        selectFolderBtn.disabled = false;
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

