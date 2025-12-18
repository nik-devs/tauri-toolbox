import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp'
};

export default function FrameToFrameVideo({ tabId = `frame-to-frame-${Date.now()}`, isActive = true }) {
  const { getTabState, updateTabState, setTabState } = useTabsState();
  const { addTask, updateTask } = useTasks();
  
  const { getTask } = useTasks();
  
  // Получаем состояние для этой конкретной вкладки
  const savedState = getTabState(tabId);
  
  // Инициализируем состояние из сохраненных данных
  const [startFile, setStartFile] = useState(null);
  const [endFile, setEndFile] = useState(null);
  const [startPreviewUrl, setStartPreviewUrl] = useState(savedState?.startPreviewUrl || null);
  const [endPreviewUrl, setEndPreviewUrl] = useState(savedState?.endPreviewUrl || null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(savedState?.resultUrl || null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedOverDropzone, setDraggedOverDropzone] = useState(null); // 'start' | 'end' | null
  const [durationSeconds, setDurationSeconds] = useState(savedState?.durationSeconds ?? 3);
  const [prompt, setPrompt] = useState(savedState?.prompt ?? 'animate');
  const startDropzoneRef = useRef(null);
  const endDropzoneRef = useRef(null);
  const currentTaskIdRef = useRef(savedState?.taskId || null);
  const startFileNameRef = useRef(savedState?.startFileName || null);
  const endFileNameRef = useRef(savedState?.endFileName || null);
  const startFilePathRef = useRef(savedState?.startFilePath || null);
  const endFilePathRef = useRef(savedState?.endFilePath || null);
  const restoredTabIdRef = useRef(null);

  // Восстанавливаем состояние при монтировании или смене tabId
  useEffect(() => {
    if (restoredTabIdRef.current === tabId) return;
    restoredTabIdRef.current = tabId;
    
    const restoreState = async () => {
      const state = getTabState(tabId);
      if (!state) return;
      
      if (state.startPreviewUrl) {
        setStartPreviewUrl(state.startPreviewUrl);
      }
      if (state.endPreviewUrl) {
        setEndPreviewUrl(state.endPreviewUrl);
      }
      if (state.resultUrl) {
        setResultUrl(state.resultUrl);
      }
      if (state.startFileName) {
        startFileNameRef.current = state.startFileName;
      }
      if (state.endFileName) {
        endFileNameRef.current = state.endFileName;
      }
      if (state.startFilePath) {
        startFilePathRef.current = state.startFilePath;
      }
      if (state.endFilePath) {
        endFilePathRef.current = state.endFilePath;
      }
      if (state.taskId) {
        currentTaskIdRef.current = state.taskId;
      }
      if (state.durationSeconds !== undefined) {
        setDurationSeconds(state.durationSeconds);
      }
      
      if (state.taskId) {
        const task = getTask(state.taskId);
        if (task) {
          if (task.status === 'running') {
            setIsProcessing(true);
          }
          if (task.status === 'completed' && task.resultUrl) {
            setResultUrl(task.resultUrl);
            setIsProcessing(false);
          }
          if (task.status === 'failed') {
            setError(task.error || 'Ошибка выполнения задачи');
            setIsProcessing(false);
          }
        }
      }
      
      // Восстанавливаем файлы
      if (state.startFilePath && state.startPreviewUrl) {
        try {
          const fileData = await readFile(state.startFilePath);
          const fileName = state.startFileName || state.startFilePath.split(/[/\\]/).pop();
          const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
          const mimeType = MIME_TYPES[ext] || 'image/png';
          
          const blob = new Blob([fileData], { type: mimeType });
          const fileObj = new File([blob], fileName, { type: mimeType });
          fileObj.path = state.startFilePath;
          
          setStartFile(fileObj);
        } catch (err) {
          console.error('Не удалось восстановить start файл:', err);
        }
      }
      
      if (state.endFilePath && state.endPreviewUrl) {
        try {
          const fileData = await readFile(state.endFilePath);
          const fileName = state.endFileName || state.endFilePath.split(/[/\\]/).pop();
          const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
          const mimeType = MIME_TYPES[ext] || 'image/png';
          
          const blob = new Blob([fileData], { type: mimeType });
          const fileObj = new File([blob], fileName, { type: mimeType });
          fileObj.path = state.endFilePath;
          
          setEndFile(fileObj);
        } catch (err) {
          console.error('Не удалось восстановить end файл:', err);
        }
      }
    };
    
    restoreState();
  }, [tabId, getTabState, getTask]);

  // Подписываемся на изменения задачи
  const { tasks } = useTasks();
  useEffect(() => {
    if (!currentTaskIdRef.current) return;
    
    const task = tasks.find(t => t.id === currentTaskIdRef.current);
    if (!task) return;
    
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

  // Сохраняем состояние
  useEffect(() => {
    if (tabId && restoredTabIdRef.current === tabId) {
      updateTabState(tabId, {
        startFileName: startFile?.name || startFileNameRef.current,
        endFileName: endFile?.name || endFileNameRef.current,
        startFilePath: startFile?.path || startFilePathRef.current,
        endFilePath: endFile?.path || endFilePathRef.current,
        startPreviewUrl,
        endPreviewUrl,
        resultUrl,
        durationSeconds,
        prompt,
        taskId: currentTaskIdRef.current
      });
    }
  }, [startFile, endFile, startPreviewUrl, endPreviewUrl, resultUrl, durationSeconds, prompt, tabId, updateTabState]);

  const handleFileSelect = useCallback(async (file, isStart) => {
    if (!file) return;

    if (!file.type?.startsWith('image/')) {
      const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')).toLowerCase() : '';
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        setError('Пожалуйста, выберите файл изображения');
        return;
      }
    }

    if (file.size > MAX_FILE_SIZE) {
      setError(`Файл слишком большой. Максимальный размер: 20MB. Ваш файл: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }

    if (isStart) {
      setStartFile(file);
      startFileNameRef.current = file.name;
      startFilePathRef.current = file.path;
    } else {
      setEndFile(file);
      endFileNameRef.current = file.name;
      endFilePathRef.current = file.path;
    }
    
    setError(null);
    if (isStart) {
      setResultUrl(null);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (isStart) {
        setStartPreviewUrl(e.target.result);
      } else {
        setEndPreviewUrl(e.target.result);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDroppedFile = useCallback(async (path, isStart) => {
    try {
      const isDir = await invoke('check_path_is_directory', { path }).catch(() => false);
      if (isDir) {
        return;
      }

      const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        setError('Пожалуйста, выберите файл изображения');
        return;
      }

      const fileData = await readFile(path);
      const fileName = path.split(/[/\\]/).pop();
      const mimeType = MIME_TYPES[ext] || 'image/png';

      const blob = new Blob([fileData], { type: mimeType });
      const fileObj = new File([blob], fileName, { type: mimeType });
      fileObj.path = path;

      await handleFileSelect(fileObj, isStart);
    } catch (err) {
      console.error('Ошибка обработки файла:', err);
      setError('Ошибка обработки файла: ' + (err.message || err));
    }
  }, [handleFileSelect]);

  // Drag and drop через Tauri (только для активной вкладки)
  // Используем один глобальный обработчик, но проверяем активность вкладки
  useEffect(() => {
    if (!isActive) return; // Не регистрируем обработчик для неактивных вкладок
    
    const appWindow = getCurrentWindow();

    if (typeof appWindow.onDragDropEvent === 'function') {
      const unlisten = appWindow.onDragDropEvent((event) => {
        // Проверяем, что эта вкладка все еще активна
        if (!isActive) return;
        
        // Проверяем, что dropzone этой вкладки видим
        const startDropzone = startDropzoneRef.current;
        const endDropzone = endDropzoneRef.current;
        if (!startDropzone && !endDropzone) return;
        
        // Проверяем, что родительский элемент (страница) активен
        const pageElement = startDropzone?.closest('.page') || endDropzone?.closest('.page');
        if (!pageElement || !pageElement.classList.contains('active')) return;
        
        if (event.payload.type === 'drop') {
          setIsDragging(false);
          const paths = event.payload.paths;
          if (paths && Array.isArray(paths) && paths.length > 0) {
            // Определяем, над каким dropzone был drop
            // Используем draggedOverDropzone, который устанавливается через HTML5 drag events
            let isStart;
            if (draggedOverDropzone === 'start') {
              isStart = true;
            } else if (draggedOverDropzone === 'end') {
              isStart = false;
            } else {
              // Если draggedOverDropzone не определен (Tauri drag из проводника),
              // проверяем, над каким dropzone находится курсор в момент drop
              // Используем document.elementFromPoint с координатами из события, если доступны
              // Или проверяем, какой dropzone активен (имеет класс drag-over)
              const startDropzoneEl = startDropzoneRef.current;
              const endDropzoneEl = endDropzoneRef.current;
              
              // Проверяем, есть ли координаты в событии
              if (event.payload.x !== undefined && event.payload.y !== undefined) {
                const elementUnderCursor = document.elementFromPoint(event.payload.x, event.payload.y);
                if (elementUnderCursor) {
                  if (startDropzoneEl && startDropzoneEl.contains(elementUnderCursor)) {
                    isStart = true;
                  } else if (endDropzoneEl && endDropzoneEl.contains(elementUnderCursor)) {
                    isStart = false;
                  } else {
                    // Fallback: проверяем, какой dropzone находится выше
                    if (startDropzoneEl && endDropzoneEl) {
                      const startRect = startDropzoneEl.getBoundingClientRect();
                      const endRect = endDropzoneEl.getBoundingClientRect();
                      isStart = startRect.top < endRect.top;
                    } else {
                      isStart = !startFile && !startFileNameRef.current;
                    }
                  }
                } else {
                  // Fallback: проверяем, какой dropzone находится выше
                  if (startDropzoneEl && endDropzoneEl) {
                    const startRect = startDropzoneEl.getBoundingClientRect();
                    const endRect = endDropzoneEl.getBoundingClientRect();
                    isStart = startRect.top < endRect.top;
                  } else {
                    isStart = !startFile && !startFileNameRef.current;
                  }
                }
              } else {
                // Если координаты недоступны, используем draggedOverDropzone из HTML5 событий
                // или fallback логику
                if (startDropzoneEl && endDropzoneEl) {
                  const startRect = startDropzoneEl.getBoundingClientRect();
                  const endRect = endDropzoneEl.getBoundingClientRect();
                  isStart = startRect.top < endRect.top;
                } else {
                  isStart = !startFile && !startFileNameRef.current;
                }
              }
            }
            handleDroppedFile(paths[0], isStart);
            setDraggedOverDropzone(null);
          }
        } else if (event.payload.type === 'hover') {
          setIsDragging(true);
        } else if (event.payload.type === 'cancel') {
          setIsDragging(false);
          setDraggedOverDropzone(null);
        }
      });

      return () => {
        unlisten?.then(fn => fn());
      };
    }
  }, [handleDroppedFile, isActive, draggedOverDropzone, startFile]);

  const handleDragOver = useCallback((e, isStart) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDraggedOverDropzone(isStart ? 'start' : 'end');
  }, [isActive]);

  const handleDragLeave = useCallback((e) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    const dropzone = e.currentTarget;
    if (!dropzone.contains(e.relatedTarget)) {
      setIsDragging(false);
      setDraggedOverDropzone(null);
    }
  }, [isActive]);

  const handleDrop = useCallback((e, isStart) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDraggedOverDropzone(null);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0], isStart);
    }
  }, [handleFileSelect, isActive]);

  const handleClick = useCallback(async (isStart) => {
    try {
      const path = await openFileDialog({
        filters: [{
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
        }]
      });

      if (path) {
        await handleDroppedFile(path, isStart);
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') {
        console.error('Ошибка выбора файла:', err);
        setError('Ошибка выбора файла: ' + (err.message || err));
      }
    }
  }, [handleDroppedFile]);

  const handleClear = useCallback(() => {
    setStartFile(null);
    setEndFile(null);
    setStartPreviewUrl(null);
    setEndPreviewUrl(null);
    setResultUrl(null);
    setError(null);
    setIsProcessing(false);
    setDurationSeconds(3);
    startFileNameRef.current = null;
    endFileNameRef.current = null;
    startFilePathRef.current = null;
    endFilePathRef.current = null;
    currentTaskIdRef.current = null;
    if (tabId) {
      setTabState(tabId, {
        startFileName: null,
        endFileName: null,
        startFilePath: null,
        endFilePath: null,
            startPreviewUrl: null,
            endPreviewUrl: null,
            resultUrl: null,
            durationSeconds: 3,
            prompt: 'animate',
            taskId: null
          });
        }
        setPrompt('animate');
      }, [tabId, setTabState]);

  // Конвертируем файл в base64 data URI с правильным MIME типом
  const fileToDataUri = useCallback(async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Используем правильный MIME тип для изображения
        // FileReader.readAsDataURL уже создает правильный data URI с MIME типом
        // Но мы можем использовать его напрямую или переформатировать
        const dataUri = reader.result; // Уже содержит data:image/...;base64,...
        resolve(dataUri);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!startFile || !endFile) {
      setError('Пожалуйста, выберите оба изображения (начальное и конечное)');
      return;
    }

    if (!prompt || prompt.trim() === '') {
      setError('Пожалуйста, введите описание перехода (prompt)');
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
      type: 'frame-to-frame-video',
      title: `Frame To Frame: ${startFile.name} → ${endFile.name}`,
      description: `Генерация видео между изображениями`,
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
      // Проверяем размеры файлов
      if (startFile.size > MAX_FILE_SIZE) {
        throw new Error(`Начальное изображение слишком большое. Максимальный размер: 20MB. Ваш файл: ${(startFile.size / 1024 / 1024).toFixed(2)}MB`);
      }

      if (endFile.size > MAX_FILE_SIZE) {
        throw new Error(`Конечное изображение слишком большое. Максимальный размер: 20MB. Ваш файл: ${(endFile.size / 1024 / 1024).toFixed(2)}MB`);
      }

      updateTask(taskId, { progress: 10, status: 'running' });

      // Конвертируем файлы в base64 data URI
      const startImageDataUri = await fileToDataUri(startFile);
      const endImageDataUri = await fileToDataUri(endFile);
      
      updateTask(taskId, { progress: 30, status: 'running' });

      // Вызываем Replicate API через Tauri команду (обход CORS)
      const result = await invoke('replicate_run', {
        request: {
          //model: "lucataco/wan-2.2-first-last-frame:6e49cb82c7656ef0cd4a272f74eb7e0866edadf8a916149b1023fb21d2f74158",
          model: "lucataco/wan-2.2-first-last-frame:003fd8a38ff17cb6022c3117bb90f7403cb632062ba2b098710738d116847d57",
          input: {
            start_image: startImageDataUri,
            end_image: endImageDataUri,
            prompt: prompt.trim(),
            negative_prompt: "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走,过曝，",
            duration_seconds: durationSeconds,
            num_inference_steps: 8,
            guidance_scale: 1,
            guidance_scale_2: 1,
            shift: 8,
            seed: 0
          },
          api_key: replicateKey
        }
      });

      updateTask(taskId, { progress: 90, status: 'running' });

      // Получаем output из результата
      const output = result.output;

      // Replicate возвращает URL видео (может быть строкой или массивом)
      let videoUrl;
      if (Array.isArray(output)) {
        videoUrl = output[0];
      } else if (typeof output === 'string') {
        videoUrl = output;
      } else if (output && typeof output === 'object' && output.url) {
        videoUrl = output.url;
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
      console.error('Ошибка генерации видео:', err);
      let errorMessage = err.message || 'Ошибка при генерации видео';

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
  }, [startFile, endFile, durationSeconds, prompt, addTask, updateTask, tabId, updateTabState, fileToDataUri]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;

    try {
      // Скачиваем видео
      const response = await fetch(resultUrl);
      const blob = await response.blob();

      // Используем Tauri dialog для сохранения
      const filePath = await save({
        filters: [{
          name: 'Videos',
          extensions: ['mp4']
        }],
        defaultPath: 'frame-to-frame-video.mp4'
      });

      if (filePath) {
        // Сохраняем файл
        const arrayBuffer = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));
        alert('Видео успешно сохранено!');
      }
    } catch (err) {
      console.error('Ошибка скачивания:', err);
      setError('Ошибка при сохранении видео: ' + (err.message || err));
    }
  }, [resultUrl]);

  return (
    <div 
      id={`page-utility-frame-to-frame-${tabId}`} 
      className={`page utility-page ${isActive ? 'active' : ''}`}
    >
      <div className="utility-header">
        <h2>Frame To Frame Video</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Генерация плавного видео-перехода между двумя изображениями с помощью AI
          </p>

          <div className="tool-content">
            <div className="image-selector">
              <div className="image-selector-row">
                <div className="image-selector-item">
                  <label>Начальное изображение</label>
                  <div
                    ref={startDropzoneRef}
                    className={`selected-folder ${startFile || startFileNameRef.current ? 'has-folder' : ''} ${isDragging && isActive ? 'drag-over' : ''}`}
                    onClick={isActive ? () => handleClick(true) : undefined}
                    onDragOver={isActive ? (e) => handleDragOver(e, true) : undefined}
                    onDragLeave={isActive ? handleDragLeave : undefined}
                    onDrop={isActive ? (e) => handleDrop(e, true) : undefined}
                    data-dropzone="true"
                    data-tab-id={tabId}
                  >
                    {(startFile || startFileNameRef.current) ? (
                      <>
                        <span className="folder-path">{startFile?.name || startFileNameRef.current}</span>
                        <button
                          className="clear-folder-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setStartFile(null);
                            setStartPreviewUrl(null);
                            startFileNameRef.current = null;
                            startFilePathRef.current = null;
                          }}
                          title="Очистить"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <div className="dropzone-placeholder">
                        Перетащите начальное изображение или кликните для выбора
                      </div>
                    )}
                  </div>
                </div>

                <div className="image-selector-item">
                  <label>Конечное изображение</label>
                  <div
                    ref={endDropzoneRef}
                    className={`selected-folder ${endFile || endFileNameRef.current ? 'has-folder' : ''} ${isDragging && isActive ? 'drag-over' : ''}`}
                    onClick={isActive ? () => handleClick(false) : undefined}
                    onDragOver={isActive ? (e) => handleDragOver(e, false) : undefined}
                    onDragLeave={isActive ? handleDragLeave : undefined}
                    onDrop={isActive ? (e) => handleDrop(e, false) : undefined}
                    data-dropzone="true"
                    data-tab-id={tabId}
                  >
                    {(endFile || endFileNameRef.current) ? (
                      <>
                        <span className="folder-path">{endFile?.name || endFileNameRef.current}</span>
                        <button
                          className="clear-folder-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEndFile(null);
                            setEndPreviewUrl(null);
                            endFileNameRef.current = null;
                            endFilePathRef.current = null;
                          }}
                          title="Очистить"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <div className="dropzone-placeholder">
                        Перетащите конечное изображение или кликните для выбора
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {(startPreviewUrl || endPreviewUrl) && (
              <div className="preview-section">
                <h3>Исходные изображения</h3>
                <div className="image-preview-container" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                  {startPreviewUrl && (
                    <div>
                      <h4>Начальное</h4>
                      <img src={startPreviewUrl} alt="Start Preview" style={{ maxWidth: '300px', maxHeight: '300px' }} />
                      <p className="file-name">{startFile?.name || startFileNameRef.current}</p>
                    </div>
                  )}
                  {endPreviewUrl && (
                    <div>
                      <h4>Конечное</h4>
                      <img src={endPreviewUrl} alt="End Preview" style={{ maxWidth: '300px', maxHeight: '300px' }} />
                      <p className="file-name">{endFile?.name || endFileNameRef.current}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(startFile || endFile) && (
              <>
                <div className="settings-control" style={{ marginTop: '20px', marginBottom: '20px' }}>
                  <label htmlFor="prompt-input" style={{ display: 'block', marginBottom: '10px', fontWeight: '500' }}>
                    Описание перехода (prompt) <span style={{ color: 'red' }}>*</span>
                  </label>
                  <input
                    id="prompt-input"
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={isProcessing}
                    placeholder="Например: animate, smooth transition, fade"
                    style={{ width: '100%', maxWidth: '500px', padding: '8px', fontSize: '14px' }}
                  />
                </div>

                <div className="settings-control" style={{ marginTop: '20px', marginBottom: '20px' }}>
                  <label htmlFor="duration-slider" style={{ display: 'block', marginBottom: '10px', fontWeight: '500' }}>
                    Длительность видео: {durationSeconds.toFixed(1)} сек
                  </label>
                  <input
                    id="duration-slider"
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.1"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(parseFloat(e.target.value))}
                    disabled={isProcessing}
                    style={{ width: '100%', maxWidth: '500px' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', color: '#666', marginTop: '5px', maxWidth: '500px' }}>
                    <span>0.5 сек</span>
                    <span>10 сек</span>
                  </div>
                </div>
              </>
            )}

            {!resultUrl && (
              <button
                id="generateVideoBtn"
                className="btn btn-success"
                disabled={!startFile || !endFile || !prompt || prompt.trim() === '' || isProcessing}
                onClick={handleGenerate}
              >
                🎬 Сгенерировать видео
              </button>
            )}

            {isProcessing && (
              <div className="progress">
                <div className="progress-bar"></div>
                <span className="progress-text">Генерация видео...</span>
              </div>
            )}

            {resultUrl && (
              <div className="result-section">
                <h3>Результат</h3>
                <div className="video-preview-container">
                  <video 
                    src={resultUrl} 
                    controls 
                    style={{ maxWidth: '100%', maxHeight: '500px' }}
                  >
                    Ваш браузер не поддерживает видео.
                  </video>
                </div>
                <button
                  id="downloadBtn"
                  className="btn btn-primary"
                  onClick={handleDownload}
                >
                  ⬇️ Скачать видео
                </button>
                <button
                  id="clearBtn"
                  className="btn btn-secondary"
                  onClick={handleClear}
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
