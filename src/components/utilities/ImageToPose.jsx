import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';
import { generateTimestamp } from '../../utils/fileUtils';
import { showNotification } from '../../utils/notifications';

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp'
};

const DRAW_MODE_OPTIONS = [
  { value: 'full-pose', label: 'Full Pose' },
  { value: 'body-pose', label: 'Body Pose' },
  { value: 'face-pose', label: 'Face Pose' },
  { value: 'hand-pose', label: 'Hand Pose' },
  { value: 'face-hand-mask', label: 'Face Hand Mask' },
  { value: 'face-mask', label: 'Face Mask' },
  { value: 'hand-mask', label: 'Hand Mask' }
];

export default function ImageToPose({ tabId = `image-to-pose-${Date.now()}`, isActive = true }) {
  const { getTabState, updateTabState, setTabState } = useTabsState();
  const { addTask, updateTask } = useTasks();
  
  const { getTask } = useTasks();
  
  // Получаем состояние для этой конкретной вкладки
  const savedState = getTabState(tabId);
  
  // Инициализируем состояние из сохраненных данных
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(savedState?.previewUrl || null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(savedState?.resultUrl || null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [drawMode, setDrawMode] = useState(savedState?.drawMode ?? 'full-pose');
  const dropzoneRef = useRef(null);
  const currentTaskIdRef = useRef(savedState?.taskId || null);
  const fileNameRef = useRef(savedState?.fileName || null);
  const filePathRef = useRef(savedState?.filePath || null);
  const restoredTabIdRef = useRef(null);

  // Восстанавливаем состояние при монтировании или смене tabId
  useEffect(() => {
    // Если уже восстановили для этого tabId, не делаем повторно
    if (restoredTabIdRef.current === tabId) return;
    restoredTabIdRef.current = tabId;
    
    const restoreState = async () => {
      const state = getTabState(tabId);
      if (!state) return;
      
      // Восстанавливаем базовое состояние
      if (state.previewUrl) {
        setPreviewUrl(state.previewUrl);
      }
      if (state.resultUrl) {
        setResultUrl(state.resultUrl);
      }
      if (state.drawMode) {
        setDrawMode(state.drawMode);
      }
      if (state.fileName) {
        fileNameRef.current = state.fileName;
      }
      if (state.filePath) {
        filePathRef.current = state.filePath;
      }
      if (state.taskId) {
        currentTaskIdRef.current = state.taskId;
      }
      
      // Восстанавливаем задачу если она есть
      if (state.taskId) {
        const task = getTask(state.taskId);
        if (task) {
          // Если задача выполняется - показываем прогресс
          if (task.status === 'running') {
            setIsProcessing(true);
          }
          
          // Если задача завершена - показываем результат
          if (task.status === 'completed' && task.resultUrl) {
            setResultUrl(task.resultUrl);
            setIsProcessing(false);
          }
          
          // Если задача провалилась - показываем ошибку
          if (task.status === 'failed') {
            setError(task.error || 'Ошибка выполнения задачи');
            setIsProcessing(false);
          }
        }
      }
      
      // Восстанавливаем File из сохраненного пути
      if (state.filePath && state.previewUrl) {
        try {
          const fileData = await readFile(state.filePath);
          const fileName = state.fileName || state.filePath.split(/[/\\]/).pop();
          const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
          const mimeType = MIME_TYPES[ext] || 'image/png';
          
          const blob = new Blob([fileData], { type: mimeType });
          const fileObj = new File([blob], fileName, { type: mimeType });
          fileObj.path = state.filePath;
          
          setSelectedFile(fileObj);
        } catch (err) {
          console.error('Не удалось восстановить файл:', err);
        }
      }
    };
    
    restoreState();
  }, [tabId, getTabState, getTask]);

  // Подписываемся на изменения задачи для этой вкладки
  const { tasks } = useTasks();
  useEffect(() => {
    if (!currentTaskIdRef.current) return;
    
    const task = tasks.find(t => t.id === currentTaskIdRef.current);
    if (!task) return;
    
    // Обновляем состояние в зависимости от статуса задачи
    if (task.status === 'running' && !isProcessing) {
      setIsProcessing(true);
    } else if (task.status === 'completed' && task.resultUrl && resultUrl !== task.resultUrl) {
      setResultUrl(task.resultUrl);
      setIsProcessing(false);
      updateTabState(tabId, { resultUrl: task.resultUrl });
    } else if (task.status === 'failed' && !error) {
      setError(task.error || 'Ошибка выполнения задачи');
      setIsProcessing(false);
    } else if (task.status !== 'running' && isProcessing) {
      setIsProcessing(false);
    }
  }, [tasks, isProcessing, resultUrl, error, tabId, updateTabState]);

  // Сохраняем состояние при изменении (только для текущей вкладки)
  useEffect(() => {
    if (tabId && restoredTabIdRef.current === tabId) {
      updateTabState(tabId, {
        fileName: selectedFile?.name || fileNameRef.current,
        filePath: selectedFile?.path || filePathRef.current,
        previewUrl,
        resultUrl,
        drawMode,
        taskId: currentTaskIdRef.current
      });
    }
  }, [selectedFile, previewUrl, resultUrl, drawMode, tabId, updateTabState]);

  const handleFileSelect = useCallback(async (file) => {
    if (!file) return;

    // Проверяем тип файла
    if (!file.type?.startsWith('image/')) {
      const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')).toLowerCase() : '';
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        setError('Пожалуйста, выберите файл изображения');
        return;
      }
    }

    // Проверяем размер файла
    if (file.size > MAX_FILE_SIZE) {
      setError(`Файл слишком большой. Максимальный размер: 5MB. Ваш файл: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }

    setSelectedFile(file);
    fileNameRef.current = file.name;
    filePathRef.current = file.path;
    setError(null);
    setResultUrl(null);

    // Создаем превью
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target.result);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDroppedFile = useCallback(async (path) => {
    try {
      // Проверяем, что это файл, а не папка
      const isDir = await invoke('check_path_is_directory', { path }).catch(() => false);
      if (isDir) {
        return;
      }

      // Проверяем расширение файла
      const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        setError('Пожалуйста, выберите файл изображения');
        return;
      }

      // Читаем файл через Tauri FS plugin
      const fileData = await readFile(path);
      const fileName = path.split(/[/\\]/).pop();
      const mimeType = MIME_TYPES[ext] || 'image/png';

      const blob = new Blob([fileData], { type: mimeType });
      const fileObj = new File([blob], fileName, { type: mimeType });
      fileObj.path = path;

      handleFileSelect(fileObj);
    } catch (err) {
      console.error('Ошибка обработки файла:', err);
      setError('Ошибка обработки файла: ' + (err.message || err));
    }
  }, [handleFileSelect]);

  // Drag and drop через Tauri (только для активной вкладки)
  useEffect(() => {
    if (!isActive) return;
    
    const appWindow = getCurrentWindow();

    if (typeof appWindow.onDragDropEvent === 'function') {
      const unlisten = appWindow.onDragDropEvent((event) => {
        if (!isActive) return;
        
        const dropzone = dropzoneRef.current;
        if (!dropzone) return;
        
        const pageElement = dropzone.closest('.page');
        if (!pageElement || !pageElement.classList.contains('active')) return;
        
        if (event.payload.type === 'drop') {
          setIsDragging(false);
          const paths = event.payload.paths;
          if (paths && Array.isArray(paths) && paths.length > 0) {
            handleDroppedFile(paths[0]);
          }
        } else if (event.payload.type === 'hover') {
          setIsDragging(true);
        } else if (event.payload.type === 'cancel') {
          setIsDragging(false);
        }
      });

      return () => {
        unlisten?.then(fn => fn());
      };
    }
  }, [handleDroppedFile, isActive]);

  // HTML5 drag and drop (только для активной вкладки)
  const handleDragOver = useCallback((e) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [isActive]);

  const handleDragLeave = useCallback((e) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dropzoneRef.current?.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  }, [isActive]);

  const handleDrop = useCallback((e) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect, isActive]);

  const handleClick = useCallback(async () => {
    try {
      const path = await openFileDialog({
        filters: [{
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
        }]
      });

      if (path) {
        await handleDroppedFile(path);
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') {
        console.error('Ошибка выбора файла:', err);
        setError('Ошибка выбора файла: ' + (err.message || err));
      }
    }
  }, [handleDroppedFile]);

  const handleClear = useCallback(() => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setResultUrl(null);
    setError(null);
    setIsProcessing(false);
    setDrawMode('full-pose');
    fileNameRef.current = null;
    filePathRef.current = null;
    currentTaskIdRef.current = null;
    if (tabId) {
      setTabState(tabId, {
        fileName: null,
        filePath: null,
        previewUrl: null,
        resultUrl: null,
        drawMode: 'full-pose',
        taskId: null
      });
    }
  }, [tabId, setTabState]);

  const handleGenerate = useCallback(async () => {
    if (!selectedFile && !previewUrl) {
      setError('Пожалуйста, выберите изображение');
      return;
    }
    
    if (!selectedFile) {
      setError('Файл был потерян. Пожалуйста, выберите изображение заново.');
      return;
    }

    // Получаем FAL API ключ из настроек
    let falKey;
    try {
      const settings = await invoke('load_settings');
      if (!settings || !settings.api_keys || !settings.api_keys.FAL) {
        setError('FAL API ключ не найден. Пожалуйста, добавьте его в настройках.');
        return;
      }
      falKey = settings.api_keys.FAL;
    } catch (err) {
      console.error('Ошибка загрузки настроек:', err);
      setError('Ошибка загрузки настроек. Проверьте FAL API ключ в настройках.');
      return;
    }

    // Создаем задачу
    const taskId = addTask({
      type: 'image-to-pose',
      title: `Image To Pose: ${selectedFile.name}`,
      description: `Генерация позы из изображения ${selectedFile.name}`,
      status: 'running',
      progress: 0,
      tabId: tabId
    });
    currentTaskIdRef.current = taskId;
    updateTabState(tabId, { taskId });

    // Динамически импортируем FAL клиент
    const { fal } = await import('@fal-ai/client');

    // Настраиваем FAL клиент
    fal.config({
      credentials: falKey
    });

    setIsProcessing(true);
    setError(null);
    setResultUrl(null);

    try {
      // Проверяем размер файла
      if (selectedFile.size > MAX_FILE_SIZE) {
        throw new Error(`Файл слишком большой. Максимальный размер: 5MB. Ваш файл: ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`);
      }

      updateTask(taskId, { progress: 10, status: 'running' });

      // Загружаем файл в FAL storage
      const imageUrl = await fal.storage.upload(selectedFile);
      console.log('Uploaded image URL:', imageUrl);
      updateTask(taskId, { progress: 30, status: 'running' });

      // Вызываем dwpose API
      const result = await fal.subscribe("fal-ai/dwpose", {
        input: {
          image_url: imageUrl,
          draw_mode: drawMode
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            update.logs?.map((log) => log.message).forEach(console.log);
            updateTask(taskId, { progress: 50, status: 'running' });
          }
        },
      });

      updateTask(taskId, { progress: 90, status: 'running' });

      // Показываем результат
      let resultImageUrl;
      if (result.data?.image?.url) {
        resultImageUrl = result.data.image.url;
      } else if (result.data?.url) {
        resultImageUrl = result.data.url;
      } else if (typeof result.data === 'string') {
        resultImageUrl = result.data;
      } else {
        console.log('Full result structure:', JSON.stringify(result, null, 2));
        throw new Error('Не удалось получить результат. Проверьте структуру ответа в консоли.');
      }
      
      setResultUrl(resultImageUrl);
      
      updateTask(taskId, { 
        progress: 100, 
        status: 'completed',
        resultUrl: resultImageUrl
      });
      
      // Обновляем состояние вкладки
      updateTabState(tabId, { resultUrl: resultImageUrl });
    } catch (err) {
      console.error('Ошибка генерации позы:', err);
      let errorMessage = err.message || 'Ошибка при обработке изображения';

      if (err.body?.detail) {
        const details = Array.isArray(err.body.detail)
          ? err.body.detail.map(d => JSON.stringify(d)).join(', ')
          : JSON.stringify(err.body.detail);
        errorMessage = `Ошибка валидации: ${details}`;
      }

      setError(errorMessage);
      updateTask(taskId, { 
        status: 'failed',
        error: errorMessage
      });
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, drawMode, addTask, updateTask, tabId, updateTabState]);

  const handleCopyToClipboard = useCallback(async () => {
    if (!resultUrl) return;

    try {
      // Получаем изображение как blob
      const response = await fetch(resultUrl);
      const blob = await response.blob();

      // Копируем в буфер обмена
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);

      showNotification('Изображение скопировано в буфер обмена!', 'success');
    } catch (err) {
      console.error('Ошибка копирования:', err);
      setError('Ошибка при копировании изображения: ' + (err.message || err));
    }
  }, [resultUrl]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;

    try {
      // Скачиваем изображение
      const response = await fetch(resultUrl);
      const blob = await response.blob();

      const timestamp = generateTimestamp();
      // Используем Tauri dialog для сохранения
      const filePath = await save({
        filters: [{
          name: 'Images',
          extensions: ['png']
        }],
        defaultPath: `image-to-pose-result-${timestamp}.png`
      });

      if (filePath) {
        // Сохраняем файл
        const arrayBuffer = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));
        showNotification('Изображение успешно сохранено!', 'success');
      }
    } catch (err) {
      console.error('Ошибка скачивания:', err);
      setError('Ошибка при сохранении изображения: ' + (err.message || err));
    }
  }, [resultUrl]);

  return (
    <div 
      id={`page-utility-image-to-pose-${tabId}`} 
      className={`page utility-page ${isActive ? 'active' : ''}`}
    >
      <div className="utility-header">
        <h2>Image To Pose</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Генерация позы из изображения с помощью AI
          </p>

          <div className="tool-content">
            <div className="image-selector">
              <div
                ref={dropzoneRef}
                className={`selected-folder ${selectedFile || fileNameRef.current ? 'has-folder' : ''} ${isDragging && isActive ? 'drag-over' : ''}`}
                onClick={isActive ? handleClick : undefined}
                onDragOver={isActive ? handleDragOver : undefined}
                onDragLeave={isActive ? handleDragLeave : undefined}
                onDrop={isActive ? handleDrop : undefined}
                data-dropzone="true"
                data-tab-id={tabId}
              >
                {(selectedFile || fileNameRef.current) ? (
                  <>
                    <span className="folder-path">{selectedFile?.name || fileNameRef.current}</span>
                    <button
                      className="clear-folder-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClear();
                      }}
                      title="Очистить"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <div className="dropzone-placeholder">
                    Перетащите изображение сюда или кликните для выбора
                  </div>
                )}
              </div>
            </div>

            {previewUrl && (
              <div className="preview-section" style={{ marginBottom: '0px' }}>
                <h3>Исходное изображение</h3>
                <div className="image-preview-container">
                  <img src={previewUrl} alt="Preview" />
                </div>
                <p className="file-name">{selectedFile?.name || fileNameRef.current}</p>
              </div>
            )}

            {previewUrl && (
              <div className="settings-control" style={{ marginTop: '0px', marginBottom: '0px' }}>
                <label htmlFor="draw-mode-select" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                  Режим отрисовки
                </label>
                <select
                  id="draw-mode-select"
                  value={drawMode}
                  onChange={(e) => setDrawMode(e.target.value)}
                  disabled={isProcessing}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  {DRAW_MODE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!resultUrl && previewUrl && (
              <button
                id="generatePoseBtn"
                className="btn btn-success"
                disabled={(!selectedFile && !previewUrl) || isProcessing}
                onClick={handleGenerate}
              >
                🎭 Сгенерировать позу
              </button>
            )}

            {isProcessing && (
              <div className="progress">
                <div className="progress-bar"></div>
                <span className="progress-text">Обработка изображения...</span>
              </div>
            )}

            {resultUrl && (
              <div className="result-section" style={{ marginTop: '0px' }}>
                <h3>Результат</h3>
                <div className="image-preview-container">
                  <img src={resultUrl} alt="Result" />
                </div>
                <div style={{ 
                  marginTop: '15px', 
                  padding: '12px', 
                  backgroundColor: 'var(--bg-tertiary)', 
                  borderRadius: '6px',
                  border: '1px solid var(--border)'
                }}>
                  <p style={{ margin: '0 0 8px 0', fontWeight: '500', color: 'var(--text-primary)' }}>
                    💡 Подсказка:
                  </p>
                  <p style={{ margin: '0', fontSize: '0.9em', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    Эту позу можно использовать в <strong>Qwen Edit Plus</strong>. Загрузите позу и персонажа. Промпт: <code style={{ backgroundColor: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '3px' }}>The woman in image 2 adopts the pose from image 1</code>
                  </p>
                </div>
                <button
                  id="downloadBtn"
                  className="btn btn-primary"
                  onClick={handleDownload}
                  style={{ marginTop: '15px' }}
                >
                  ⬇️ Скачать результат
                </button>
                <button
                  id="copyBtn"
                  className="btn btn-secondary"
                  onClick={handleCopyToClipboard}
                  style={{ marginLeft: '10px', marginTop: '15px' }}
                >
                  📋 Копировать в буфер
                </button>
                <button
                  id="clearBtn"
                  className="btn btn-secondary"
                  onClick={handleClear}
                  style={{ marginLeft: '10px', marginTop: '15px' }}
                >
                  Очистить
                </button>
              </div>
            )}

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
