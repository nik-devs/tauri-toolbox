import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';
import { generateTimestamp } from '../../utils/fileUtils';
import { showNotification } from '../../utils/notifications';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB для видео
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'];
const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/mp4'
};

export default function VideoUpscale({ tabId = `video-upscale-${Date.now()}`, isActive = true }) {
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
  const [targetFps, setTargetFps] = useState(savedState?.targetFps ?? 60);
  const [targetResolution, setTargetResolution] = useState(savedState?.targetResolution ?? '1080p');
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
      if (state.fileName) {
        fileNameRef.current = state.fileName;
      }
      if (state.filePath) {
        filePathRef.current = state.filePath;
      }
      if (state.taskId) {
        currentTaskIdRef.current = state.taskId;
      }
      if (state.targetFps !== undefined) {
        setTargetFps(state.targetFps);
      }
      if (state.targetResolution) {
        setTargetResolution(state.targetResolution);
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
          const mimeType = MIME_TYPES[ext] || 'video/mp4';
          
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
        targetFps,
        targetResolution,
        taskId: currentTaskIdRef.current
      });
    }
  }, [selectedFile, previewUrl, resultUrl, targetFps, targetResolution, tabId, updateTabState]);

  const handleFileSelect = useCallback(async (file) => {
    if (!file) return;

    // Проверяем тип файла
    if (!file.type?.startsWith('video/')) {
      const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')).toLowerCase() : '';
      if (!VIDEO_EXTENSIONS.includes(ext)) {
        setError('Пожалуйста, выберите файл видео');
        return;
      }
    }

    // Проверяем размер файла
    if (file.size > MAX_FILE_SIZE) {
      setError(`Файл слишком большой. Максимальный размер: 100MB. Ваш файл: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
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
      if (!VIDEO_EXTENSIONS.includes(ext)) {
        setError('Пожалуйста, выберите файл видео');
        return;
      }

      // Читаем файл через Tauri FS plugin
      const fileData = await readFile(path);
      const fileName = path.split(/[/\\]/).pop();
      const mimeType = MIME_TYPES[ext] || 'video/mp4';

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
          name: 'Videos',
          extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v']
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
    fileNameRef.current = null;
    filePathRef.current = null;
    currentTaskIdRef.current = null;
    if (tabId) {
      setTabState(tabId, {
        fileName: null,
        filePath: null,
        previewUrl: null,
        resultUrl: null,
        targetFps: 60,
        targetResolution: '1080p',
        taskId: null
      });
    }
    setTargetFps(60);
    setTargetResolution('1080p');
  }, [tabId, setTabState]);

  // Конвертируем файл в base64 data URI
  const fileToDataUri = useCallback(async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUri = reader.result; // Уже содержит data:video/...;base64,...
        resolve(dataUri);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleUpscale = useCallback(async () => {
    if (!selectedFile && !previewUrl) {
      setError('Пожалуйста, выберите видео');
      return;
    }
    
    if (!selectedFile) {
      setError('Файл был потерян. Пожалуйста, выберите видео заново.');
      return;
    }

    // Получаем Replicate API ключ из настроек
    let replicateKey;
    try {
      const settings = await invoke('load_settings');
      if (!settings || !settings.api_keys || !settings.api_keys.Replicate) {
        setError('Replicate API ключ не найден. Пожалуйста, добавьте его в настройках.');
        return;
      }
      replicateKey = settings.api_keys.Replicate;
    } catch (err) {
      console.error('Ошибка загрузки настроек:', err);
      setError('Ошибка загрузки настроек. Проверьте Replicate API ключ в настройках.');
      return;
    }

    // Создаем задачу
    const taskId = addTask({
      type: 'video-upscale',
      title: `Video Upscale: ${selectedFile.name}`,
      description: `Апскейл видео ${selectedFile.name}`,
      status: 'running',
      progress: 0,
      tabId: tabId
    });
    currentTaskIdRef.current = taskId;
    updateTabState(tabId, { taskId });

    setIsProcessing(true);
    setError(null);
    setResultUrl(null);

    try {
      // Проверяем размер файла
      if (selectedFile.size > MAX_FILE_SIZE) {
        throw new Error(`Файл слишком большой. Максимальный размер: 100MB. Ваш файл: ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`);
      }

      updateTask(taskId, { progress: 10, status: 'running' });

      // Конвертируем файл в base64 data URI
      const videoDataUri = await fileToDataUri(selectedFile);
      
      updateTask(taskId, { progress: 30, status: 'running' });

      // Вызываем Replicate API через Tauri команду (обход CORS)
      const result = await invoke('replicate_run', {
        request: {
          model: "topazlabs/video-upscale",
          input: {
            video: videoDataUri,
            target_fps: targetFps,
            target_resolution: targetResolution
          },
          api_key: replicateKey
        }
      });

      updateTask(taskId, { progress: 90, status: 'running' });

      // Получаем output из результата
      const output = result.output;

      // Replicate возвращает URL видео (может быть строкой или объектом)
      let videoUrl;
      if (typeof output === 'string') {
        videoUrl = output;
      } else if (output && typeof output === 'object') {
        // Если output - объект с методом url() или свойством url
        if (typeof output.url === 'function') {
          videoUrl = output.url();
        } else if (output.url) {
          videoUrl = output.url;
        } else if (Array.isArray(output) && output.length > 0) {
          videoUrl = output[0];
        }
      } else if (Array.isArray(output) && output.length > 0) {
        videoUrl = output[0];
      } else {
        throw new Error('Неожиданный формат ответа от Replicate API');
      }
      
      if (!videoUrl) {
        throw new Error('Не удалось получить URL видео из ответа API');
      }
      
      setResultUrl(videoUrl);
      
      updateTask(taskId, { 
        progress: 100, 
        status: 'completed',
        resultUrl: videoUrl
      });
      
      updateTabState(tabId, { resultUrl: videoUrl });
    } catch (err) {
      console.error('Ошибка апскейла видео:', err);
      let errorMessage = err.message || 'Ошибка при апскейле видео';

      // Обработка различных форматов ошибок Replicate
      if (err.response?.data?.detail) {
        const details = Array.isArray(err.response.data.detail)
          ? err.response.data.detail.map(d => JSON.stringify(d)).join(', ')
          : JSON.stringify(err.response.data.detail);
        errorMessage = `Ошибка валидации: ${details}`;
      } else if (err.message && err.message.includes('401')) {
        errorMessage = 'Неверный API ключ Replicate. Проверьте ключ в настройках.';
      } else if (err.message && err.message.includes('429')) {
        errorMessage = 'Превышен лимит запросов к Replicate API. Попробуйте позже.';
      }

      setError(errorMessage);
      updateTask(taskId, { 
        status: 'failed',
        error: errorMessage
      });
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, targetFps, targetResolution, addTask, updateTask, tabId, updateTabState, fileToDataUri]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;

    try {
      // Скачиваем видео
      const response = await fetch(resultUrl);
      const blob = await response.blob();

      const timestamp = generateTimestamp();
      // Используем Tauri dialog для сохранения
      const filePath = await save({
        filters: [{
          name: 'Videos',
          extensions: ['mp4']
        }],
        defaultPath: `upscaled-video-${timestamp}.mp4`
      });

      if (filePath) {
        // Сохраняем файл
        const arrayBuffer = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));
        showNotification('Видео успешно сохранено!', 'success');
      }
    } catch (err) {
      console.error('Ошибка скачивания:', err);
      setError('Ошибка при сохранении видео: ' + (err.message || err));
    }
  }, [resultUrl]);

  return (
    <div 
      id={`page-utility-video-upscale-${tabId}`} 
      className={`page utility-page ${isActive ? 'active' : ''}`}
    >
      <div className="utility-header">
        <h2>Video Upscale</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Увеличение разрешения и FPS видео с помощью AI
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
                    Перетащите видео сюда или кликните для выбора
                  </div>
                )}
              </div>
            </div>

            {previewUrl && (
              <div className="preview-section">
                <h3>Исходное видео</h3>
                <div className="image-preview-container">
                  <video src={previewUrl} controls style={{ maxWidth: '100%', maxHeight: '400px' }} />
                </div>
                <p className="file-name">{selectedFile?.name || fileNameRef.current}</p>
              </div>
            )}

            {(selectedFile || fileNameRef.current) && (
              <div className="settings-section" style={{ marginTop: '20px' }}>
                <div style={{ marginBottom: '15px' }}>
                  <label htmlFor="target-fps" style={{ display: 'block', marginBottom: '5px' }}>
                    Target FPS:
                  </label>
                  <select
                    id="target-fps"
                    value={targetFps}
                    onChange={(e) => setTargetFps(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px' }}
                  >
                    <option value="30">30</option>
                    <option value="60">60</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="target-resolution" style={{ display: 'block', marginBottom: '5px' }}>
                    Target Resolution:
                  </label>
                  <select
                    id="target-resolution"
                    value={targetResolution}
                    onChange={(e) => setTargetResolution(e.target.value)}
                    style={{ width: '100%', padding: '8px' }}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                    <option value="4k">4k</option>
                  </select>
                </div>
              </div>
            )}

            {(selectedFile || previewUrl) && (
              <button
                id="upscaleBtn"
                className="btn btn-success"
                disabled={(!selectedFile && !previewUrl) || isProcessing}
                onClick={handleUpscale}
              >
                {resultUrl ? '🔁 Увеличить заново' : '🎬 Увеличить разрешение'}
              </button>
            )}

            {isProcessing && (
              <div className="progress">
                <div className="progress-bar"></div>
                <span className="progress-text">Обработка видео...</span>
              </div>
            )}

            {resultUrl && (
              <div className="result-section">
                <h3>Результат</h3>
                <div className="image-preview-container">
                  <video src={resultUrl} controls style={{ maxWidth: '100%', maxHeight: '400px' }} />
                </div>
                <button
                  id="downloadBtn"
                  className="btn btn-primary"
                  onClick={handleDownload}
                >
                  ⬇️ Скачать результат
                </button>
                <button
                  id="clearBtn"
                  className="btn btn-secondary"
                  onClick={handleClear}
                  style={{ marginLeft: '10px' }}
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
