import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';
import { generateTimestamp } from '../../utils/fileUtils';
import { showNotification } from '../../utils/notifications';

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
  const [images, setImages] = useState(() => {
    const savedImages = [];
    if (savedState?.startPreviewUrl) {
      savedImages.push({
        previewUrl: savedState.startPreviewUrl,
        name: savedState.startFileName || 'start.jpg',
        path: savedState.startFilePath,
        file: null
      });
    }
    if (savedState?.endPreviewUrl) {
      savedImages.push({
        previewUrl: savedState.endPreviewUrl,
        name: savedState.endFileName || 'end.jpg',
        path: savedState.endFilePath,
        file: null
      });
    }
    return savedImages;
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(savedState?.resultUrl || null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedImageIndex, setDraggedImageIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [durationSeconds, setDurationSeconds] = useState(savedState?.durationSeconds ?? 3);
  const [prompt, setPrompt] = useState(savedState?.prompt ?? 'animate');
  const dropzoneRef = useRef(null);
  const currentTaskIdRef = useRef(savedState?.taskId || null);
  const restoredTabIdRef = useRef(null);

  // Восстанавливаем состояние при монтировании или смене tabId
  useEffect(() => {
    if (restoredTabIdRef.current === tabId) return;
    restoredTabIdRef.current = tabId;
    
    const restoreState = async () => {
      const state = getTabState(tabId);
      if (!state) return;
      
      if (state.resultUrl) {
        setResultUrl(state.resultUrl);
      }
      if (state.taskId) {
        currentTaskIdRef.current = state.taskId;
      }
      if (state.durationSeconds !== undefined) {
        setDurationSeconds(state.durationSeconds);
      }
      if (state.prompt) {
        setPrompt(state.prompt);
      }
      
      // Восстанавливаем файлы
      const restoredImages = [];
      if (state.startFilePath && state.startPreviewUrl) {
        try {
          const fileData = await readFile(state.startFilePath);
          const fileName = state.startFileName || state.startFilePath.split(/[/\\]/).pop();
          const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
          const mimeType = MIME_TYPES[ext] || 'image/png';
          
          const blob = new Blob([fileData], { type: mimeType });
          const fileObj = new File([blob], fileName, { type: mimeType });
          fileObj.path = state.startFilePath;
          
          restoredImages.push({
            previewUrl: state.startPreviewUrl,
            name: fileName,
            path: state.startFilePath,
            file: fileObj
          });
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
          
          restoredImages.push({
            previewUrl: state.endPreviewUrl,
            name: fileName,
            path: state.endFilePath,
            file: fileObj
          });
        } catch (err) {
          console.error('Не удалось восстановить end файл:', err);
        }
      }
      
      if (restoredImages.length > 0) {
        setImages(restoredImages);
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
      const startImage = images[0];
      const endImage = images[1];
      updateTabState(tabId, {
        startFileName: startImage?.name || null,
        endFileName: endImage?.name || null,
        startFilePath: startImage?.path || null,
        endFilePath: endImage?.path || null,
        startPreviewUrl: startImage?.previewUrl || null,
        endPreviewUrl: endImage?.previewUrl || null,
        resultUrl,
        durationSeconds,
        prompt,
        taskId: currentTaskIdRef.current
      });
    }
  }, [images, resultUrl, durationSeconds, prompt, tabId, updateTabState]);

  const handleFileSelect = useCallback(async (file) => {
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

    if (images.length >= 2) {
      setError('Максимум 2 изображения. Удалите одно перед добавлением нового.');
      return;
    }

    setError(null);
    setResultUrl(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const newImage = {
        previewUrl: e.target.result,
        name: file.name,
        path: file.path,
        file: file
      };
      setImages(prev => [...prev, newImage]);
    };
    reader.readAsDataURL(file);
  }, [images.length]);

  const handleDroppedFile = useCallback(async (path) => {
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

      await handleFileSelect(fileObj);
    } catch (err) {
      console.error('Ошибка обработки файла:', err);
      setError('Ошибка обработки файла: ' + (err.message || err));
    }
  }, [handleFileSelect]);

  // Tauri drag and drop отключен в конфигурации для использования HTML5 API

  // HTML5 drag and drop
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

  const handleDrop = useCallback(async (e) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Проверяем, не перетаскиваем ли мы изображение для изменения порядка
    if (draggedImageIndex !== null) {
      return; // Это перетаскивание для изменения порядка, не обрабатываем здесь
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      // Обрабатываем все файлы, но максимум 2
      for (let i = 0; i < Math.min(files.length, 2 - images.length); i++) {
        await handleFileSelect(files[i]);
      }
      if (files.length > 2 - images.length) {
        setError(`Загружено максимальное количество изображений (2). Остальные файлы проигнорированы.`);
      }
    }
  }, [handleFileSelect, isActive, images.length, draggedImageIndex]);

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

  const handleRemoveImage = useCallback((index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setResultUrl(null);
  }, []);

  const handleImageDragStart = useCallback((e, index) => {
    setDraggedImageIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.dropEffect = 'move';
    // Устанавливаем пустые данные, чтобы браузер не пытался перетащить изображение
    e.dataTransfer.setData('text/plain', '');
  }, []);

  const handleImageDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (draggedImageIndex !== null && draggedImageIndex !== index) {
      setDragOverIndex(index);
    }
  }, [draggedImageIndex]);

  const handleImageDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Проверяем, что мы действительно покинули элемент
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverIndex(null);
    }
  }, []);

  const handleImageDrop = useCallback((e, dropIndex) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedImageIndex === null || draggedImageIndex === dropIndex) {
      setDraggedImageIndex(null);
      setDragOverIndex(null);
      return;
    }

    setImages(prev => {
      const newImages = [...prev];
      const draggedImage = newImages[draggedImageIndex];
      newImages.splice(draggedImageIndex, 1);
      newImages.splice(dropIndex, 0, draggedImage);
      return newImages;
    });

    setDraggedImageIndex(null);
    setDragOverIndex(null);
  }, [draggedImageIndex]);

  const handleImageDragEnd = useCallback(() => {
    setDraggedImageIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleClear = useCallback(() => {
    setImages([]);
    setResultUrl(null);
    setError(null);
    setIsProcessing(false);
    setDurationSeconds(3);
    setPrompt('animate');
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
  }, [tabId, setTabState]);

  // Конвертируем файл в base64 data URI
  const fileToDataUri = useCallback(async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUri = reader.result;
        resolve(dataUri);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (images.length < 2) {
      setError('Пожалуйста, загрузите 2 изображения');
      return;
    }

    if (!prompt || prompt.trim() === '') {
      setError('Пожалуйста, введите описание перехода (prompt)');
      return;
    }

    const startFile = images[0].file;
    const endFile = images[1].file;

    if (!startFile || !endFile) {
      setError('Ошибка: файлы изображений не найдены');
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
  }, [images, durationSeconds, prompt, addTask, updateTask, tabId, updateTabState, fileToDataUri]);

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
        defaultPath: `frame-to-frame-video-${timestamp}.mp4`
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
              <div
                ref={dropzoneRef}
                className={`selected-folder ${images.length > 0 ? 'has-folder' : ''} ${isDragging && isActive ? 'drag-over' : ''}`}
                onClick={isActive ? handleClick : undefined}
                onDragOver={isActive ? handleDragOver : undefined}
                onDragLeave={isActive ? handleDragLeave : undefined}
                onDrop={isActive ? handleDrop : undefined}
                data-dropzone="true"
                data-tab-id={tabId}
              >
                {images.length > 0 ? (
                  <div className="dropzone-placeholder">
                    Загрузить еще изображение (максимум 2)
                  </div>
                ) : (
                  <div className="dropzone-placeholder">
                    Перетащите изображения сюда или кликните для выбора (максимум 2)
                  </div>
                )}
              </div>
            </div>

            {images.length > 0 && (
              <div className="images-list" style={{ marginTop: '20px' }}>
                <h3 style={{ marginBottom: '15px' }}>Загруженные изображения:</h3>
                <div 
                  style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}
                  onDragOver={(e) => {
                    // Если перетаскиваем файл извне, не обрабатываем здесь
                    if (draggedImageIndex === null && e.dataTransfer.types.includes('Files')) {
                      return;
                    }
                    // Если перетаскиваем изображение для изменения порядка, предотвращаем всплытие
                    if (draggedImageIndex !== null) {
                      e.stopPropagation();
                    }
                  }}
                >
                  {images.map((image, index) => (
                    <div
                      key={index}
                      draggable={true}
                      onDragStart={(e) => handleImageDragStart(e, index)}
                      onDragOver={(e) => handleImageDragOver(e, index)}
                      onDragLeave={handleImageDragLeave}
                      onDrop={(e) => handleImageDrop(e, index)}
                      onDragEnd={handleImageDragEnd}
                      style={{
                        position: 'relative',
                        border: draggedImageIndex === index ? '2px solid var(--accent)' : dragOverIndex === index ? '2px dashed var(--accent)' : '2px solid var(--border)',
                        borderRadius: '8px',
                        padding: '10px',
                        backgroundColor: dragOverIndex === index ? 'rgba(74, 158, 255, 0.1)' : 'var(--bg-tertiary)',
                        cursor: 'move',
                        opacity: draggedImageIndex === index ? 0.5 : 1,
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ position: 'relative' }}>
                        <img 
                          src={image.previewUrl} 
                          alt={`Frame ${index + 1}`}
                          draggable={false}
                          style={{ maxWidth: '200px', maxHeight: '200px', display: 'block', pointerEvents: 'none' }}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveImage(index);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute',
                            top: '5px',
                            right: '5px',
                            background: 'rgba(255, 0, 0, 0.8)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '24px',
                            height: '24px',
                            cursor: 'pointer',
                            fontSize: '16px',
                            lineHeight: '20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'auto',
                            zIndex: 10
                          }}
                          title="Удалить"
                        >
                          ✕
                        </button>
                      </div>
                      <p style={{ marginTop: '8px', fontSize: '12px', textAlign: 'center', fontWeight: '500' }}>
                        {index === 0 ? 'Start Frame' : 'End Frame'}
                      </p>
                      <p style={{ marginTop: '4px', fontSize: '11px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {image.name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {images.length >= 2 && (
              <>
                <div className="settings-control" style={{ marginTop: '20px', marginBottom: '10px' }}>
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
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="settings-control" style={{ marginTop: '5px', marginBottom: '20px' }}>
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
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', color: 'var(--text-secondary)', marginTop: '5px', width: '100%' }}>
                    <span>0.5 сек</span>
                    <span>10 сек</span>
                  </div>
                </div>
              </>
            )}

            {!resultUrl && images.length >= 2 && (
              <button
                id="generateVideoBtn"
                className="btn btn-success"
                disabled={!prompt || prompt.trim() === '' || isProcessing}
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
