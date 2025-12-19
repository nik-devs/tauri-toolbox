import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';
import { generateTimestamp } from '../../utils/fileUtils';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_IMAGES = 10; // Максимум изображений
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp'
};

const ASPECT_RATIO_OPTIONS = [
  { value: 'match_input_image', label: 'Соответствует входному изображению' },
  { value: '1:1', label: '1:1 (Квадрат)' },
  { value: '16:9', label: '16:9 (Широкий)' },
  { value: '9:16', label: '9:16 (Вертикальный)' }
];

export default function QwenEditPlus({ tabId = `qwen-edit-plus-${Date.now()}`, isActive = true }) {
  const { getTabState, updateTabState, setTabState } = useTabsState();
  const { addTask, updateTask } = useTasks();
  const { getTask } = useTasks();
  
  const savedState = getTabState(tabId);
  
  const [images, setImages] = useState(() => {
    const savedImages = [];
    if (savedState?.images) {
      savedImages.push(...savedState.images);
    }
    return savedImages;
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(savedState?.resultUrl || null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedImageIndex, setDraggedImageIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [prompt, setPrompt] = useState(savedState?.prompt ?? '');
  const [aspectRatio, setAspectRatio] = useState(savedState?.aspectRatio ?? 'match_input_image');
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
      if (state.prompt !== undefined) {
        setPrompt(state.prompt);
      }
      if (state.aspectRatio) {
        setAspectRatio(state.aspectRatio);
      }
      
      // Восстанавливаем файлы
      if (state.images && state.images.length > 0) {
        const restoredImages = [];
        for (const imgState of state.images) {
          if (imgState.path && imgState.previewUrl) {
            try {
              const fileData = await readFile(imgState.path);
              const fileName = imgState.name || imgState.path.split(/[/\\]/).pop();
              const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
              const mimeType = MIME_TYPES[ext] || 'image/png';
              
              const blob = new Blob([fileData], { type: mimeType });
              const fileObj = new File([blob], fileName, { type: mimeType });
              fileObj.path = imgState.path;
              
              restoredImages.push({
                previewUrl: imgState.previewUrl,
                name: fileName,
                path: imgState.path,
                file: fileObj
              });
            } catch (err) {
              console.error('Ошибка восстановления файла:', err);
            }
          }
        }
        setImages(restoredImages);
      }
    };
    
    restoreState();
  }, [tabId, getTabState]);

  // Сохраняем состояние при изменении
  useEffect(() => {
    if (!tabId) return;
    
    const imagesToSave = images.map(img => ({
      previewUrl: img.previewUrl,
      name: img.name,
      path: img.path
    }));
    
    updateTabState(tabId, {
      images: imagesToSave,
      prompt,
      aspectRatio,
      resultUrl,
      taskId: currentTaskIdRef.current
    });
  }, [images, prompt, aspectRatio, resultUrl, tabId, updateTabState]);

  // Игнорируем Tauri drag and drop для файлов (используем HTML5)
  useEffect(() => {
    if (!isActive) return;
    
    const window = getCurrentWindow();
    const unlisten = window.onDragDropEvent((event) => {
      // Игнорируем события Tauri для этого компонента
      // HTML5 drag and drop будет обрабатывать файлы
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [isActive]);

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

    if (images.length >= MAX_IMAGES) {
      setError(`Максимум ${MAX_IMAGES} изображений. Удалите одно перед добавлением нового.`);
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
      // Обрабатываем все файлы, но максимум MAX_IMAGES
      for (let i = 0; i < Math.min(files.length, MAX_IMAGES - images.length); i++) {
        await handleFileSelect(files[i]);
      }
      if (files.length > MAX_IMAGES - images.length) {
        setError(`Загружено максимальное количество изображений (${MAX_IMAGES}). Остальные файлы проигнорированы.`);
      }
    }
  }, [handleFileSelect, isActive, images.length, draggedImageIndex]);

  const handleClick = useCallback(async () => {
    try {
      const paths = await openFileDialog({
        filters: [{
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
        }],
        multiple: true
      });

      if (paths && paths.length > 0) {
        for (let i = 0; i < Math.min(paths.length, MAX_IMAGES - images.length); i++) {
          await handleDroppedFile(paths[i]);
        }
        if (paths.length > MAX_IMAGES - images.length) {
          setError(`Загружено максимальное количество изображений (${MAX_IMAGES}). Остальные файлы проигнорированы.`);
        }
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') {
        console.error('Ошибка выбора файла:', err);
        setError('Ошибка выбора файла: ' + (err.message || err));
      }
    }
  }, [handleDroppedFile, images.length]);

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
    setPrompt('');
    setAspectRatio('match_input_image');
    currentTaskIdRef.current = null;
    if (tabId) {
      setTabState(tabId, {
        images: [],
        prompt: '',
        aspectRatio: 'match_input_image',
        resultUrl: null,
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
    if (images.length === 0) {
      setError('Пожалуйста, загрузите хотя бы одно изображение');
      return;
    }

    if (!prompt || prompt.trim() === '') {
      setError('Пожалуйста, введите промпт');
      return;
    }

    const imageFiles = images.map(img => img.file).filter(Boolean);

    if (imageFiles.length === 0) {
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
      type: 'qwen-edit-plus',
      title: 'Qwen Edit Plus',
      description: 'Редактирование изображений с помощью Qwen Edit Plus',
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

      updateTask(taskId, { progress: 10, status: 'running' });

      // Конвертируем все файлы в base64 data URI
      const imageDataUris = await Promise.all(imageFiles.map(file => fileToDataUri(file)));
      
      updateTask(taskId, { progress: 30, status: 'running' });

      // Вызываем Replicate API через Tauri команду (обход CORS)
      const result = await invoke('replicate_run', {
        request: {
          model: "qwen/qwen-image-edit-plus",
          input: {
            image: imageDataUris,
            prompt: prompt.trim(),
            go_fast: true,
            aspect_ratio: aspectRatio,
            output_format: "png",
            output_quality: 95,
            disable_safety_checker: true
          },
          api_key: replicateKey
        }
      });

      updateTask(taskId, { progress: 90, status: 'running' });

      // Получаем output из результата
      const output = result.output;

      // Replicate возвращает URL изображения (может быть строкой или массивом)
      let imageUrl;
      if (Array.isArray(output)) {
        imageUrl = output[0];
      } else if (typeof output === 'string') {
        imageUrl = output;
      } else if (output && typeof output === 'object' && output.url) {
        imageUrl = output.url;
      } else {
        throw new Error('Неожиданный формат ответа от Replicate API');
      }
      
      if (!imageUrl) {
        throw new Error('Не удалось получить URL изображения из ответа API');
      }
      
      setResultUrl(imageUrl);
      
      updateTask(taskId, { 
        progress: 100, 
        status: 'completed',
        resultUrl: imageUrl
      });
      
      updateTabState(tabId, { resultUrl: imageUrl });
    } catch (err) {
      console.error('Ошибка генерации:', err);
      let errorMessage = err.message || 'Ошибка при генерации изображения';

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
      if (currentTaskIdRef.current) {
        updateTask(currentTaskIdRef.current, { 
          status: 'failed',
          error: errorMessage
        });
      }
    } finally {
      setIsProcessing(false);
    }
  }, [images, prompt, aspectRatio, addTask, updateTask, tabId, updateTabState, fileToDataUri]);

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
        defaultPath: `qwen-edit-plus-result-${timestamp}.png`
      });

      if (filePath) {
        // Сохраняем файл
        const arrayBuffer = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));
        alert('Изображение успешно сохранено!');
      }
    } catch (err) {
      console.error('Ошибка скачивания:', err);
      setError('Ошибка при сохранении изображения: ' + (err.message || err));
    }
  }, [resultUrl]);

  // Автоматическое изменение размера textarea
  const textareaRef = useRef(null);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [prompt]);

  return (
    <div 
      id={`page-utility-qwen-edit-plus-${tabId}`} 
      className={`page utility-page ${isActive ? 'active' : ''}`}
    >
      <div className="utility-header">
        <h2>Qwen Edit Plus</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Редактирование изображений с помощью AI модели Qwen Edit Plus
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
                    Загрузить еще изображение (максимум {MAX_IMAGES})
                  </div>
                ) : (
                  <div className="dropzone-placeholder">
                    Перетащите изображения сюда или кликните для выбора (максимум {MAX_IMAGES})
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
                          alt={`Image ${index + 1}`}
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
                            zIndex: 10
                          }}
                          title="Удалить"
                        >
                          ✕
                        </button>
                      </div>
                      <p style={{ marginTop: '8px', fontSize: '11px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {image.name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {images.length > 0 && (
              <>
                <div className="settings-control" style={{ marginTop: '5px', marginBottom: '0px' }}>
                  <label htmlFor="prompt-input" style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                    Промпт <span style={{ color: 'red' }}>*</span>
                  </label>
                  <textarea
                    ref={textareaRef}
                    id="prompt-input"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={isProcessing}
                    placeholder="Опишите, что нужно изменить в изображении"
                    className="form-input"
                    style={{ 
                      width: '100%', 
                      minHeight: '60px',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      fontSize: '14px',
                      padding: '10px',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      outline: 'none'
                    }}
                  />
                </div>

                <div className="settings-control" style={{ marginTop: '0px', marginBottom: '5px' }}>
                  <label htmlFor="aspect-ratio-select" style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                    Соотношение сторон
                  </label>
                  <select
                    id="aspect-ratio-select"
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    disabled={isProcessing}
                    className="form-input"
                    style={{ width: '100%' }}
                  >
                    {ASPECT_RATIO_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={isProcessing || !prompt.trim()}
                  className="btn btn-primary"
                  style={{ marginTop: '5px' }}
                >
                  {isProcessing ? 'Генерация...' : 'Применить Qwen Edit Plus'}
                </button>
              </>
            )}

            {error && (
              <div className="error-message" style={{ marginTop: '20px', color: 'var(--error)', padding: '10px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
                {error}
              </div>
            )}

            {resultUrl && (
              <div style={{ marginTop: '30px' }}>
                <h3 style={{ marginBottom: '15px' }}>Результат:</h3>
                <div style={{ marginBottom: '15px' }}>
                  <img 
                    src={resultUrl} 
                    alt="Результат" 
                    style={{ maxWidth: '100%', maxHeight: '600px', borderRadius: '8px', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <button 
                    onClick={handleDownload} 
                    className="btn btn-primary"
                    style={{ marginRight: '10px' }}
                  >
                    ⬇️ Скачать результат
                  </button>
                  <button 
                    onClick={handleClear} 
                    className="btn btn-secondary"
                    style={{ marginLeft: '10px' }}
                  >
                    Очистить
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
