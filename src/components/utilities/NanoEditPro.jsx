import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';
import { generateTimestamp } from '../../utils/fileUtils';
import { showNotification } from '../../utils/notifications';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_IMAGES = 10;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp'
};

// fal-ai/nano-banana-pro/edit aspect_ratio enum
const ASPECT_RATIO_OPTIONS = [
  { value: 'auto', label: 'Авто (по входному изображению)' },
  { value: '1:1', label: '1:1 (Квадрат)' },
  { value: '16:9', label: '16:9 (Широкий)' },
  { value: '9:16', label: '9:16 (Вертикальный)' },
  { value: '21:9', label: '21:9' },
  { value: '3:2', label: '3:2' },
  { value: '4:3', label: '4:3' },
  { value: '5:4', label: '5:4' },
  { value: '4:5', label: '4:5' },
  { value: '3:4', label: '3:4' },
  { value: '2:3', label: '2:3' }
];

const FAL_MODEL = 'fal-ai/nano-banana-pro/edit';
const RESOLUTION_OPTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' }
];
const FIXED_INPUT = {
  output_format: 'png',
  safety_tolerance: '6'
};

export default function NanoEditPro({ tabId = `nano-edit-pro-${Date.now()}`, isActive = true }) {
  const { getTabState, updateTabState, setTabState } = useTabsState();
  const { addTask, updateTask } = useTasks();

  const savedState = getTabState(tabId);

  const [images, setImages] = useState(() => {
    const savedImages = [];
    if (savedState?.images) savedImages.push(...savedState.images);
    return savedImages;
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(savedState?.resultUrl || null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedImageIndex, setDraggedImageIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [prompt, setPrompt] = useState(savedState?.prompt ?? '');
  const [aspectRatio, setAspectRatio] = useState(savedState?.aspectRatio ?? '16:9');
  const [resolution, setResolution] = useState(savedState?.resolution ?? '2K');
  const dropzoneRef = useRef(null);
  const currentTaskIdRef = useRef(savedState?.taskId || null);
  const restoredTabIdRef = useRef(null);
  // Реф с актуальным стейтом для сохранения при размонтировании (уход на Задачи и т.д.)
  const stateToSaveRef = useRef(null);

  // Всегда держим в рефе последний стейт, чтобы сохранить его при unmount
  stateToSaveRef.current = {
    images: images.map(img => ({ previewUrl: img.previewUrl, name: img.name, path: img.path })),
    prompt,
    aspectRatio,
    resolution,
    resultUrl,
    taskId: currentTaskIdRef.current
  };

  useEffect(() => {
    if (restoredTabIdRef.current === tabId) return;
    restoredTabIdRef.current = tabId;
    const state = getTabState(tabId);
    if (!state) return;
    if (state.resultUrl) setResultUrl(state.resultUrl);
    if (state.taskId) currentTaskIdRef.current = state.taskId;
    if (state.prompt !== undefined) setPrompt(state.prompt);
    if (state.aspectRatio) setAspectRatio(state.aspectRatio);
    if (state.resolution) setResolution(state.resolution);
    if (state.images?.length) {
      const restore = async () => {
        const restoredImages = [];
        for (const imgState of state.images) {
          if (!imgState.path || !imgState.previewUrl) continue;
          try {
            const fileData = await readFile(imgState.path);
            const fileName = imgState.name || imgState.path.split(/[/\\]/).pop();
            const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
            const mimeType = MIME_TYPES[ext] || 'image/png';
            const blob = new Blob([fileData], { type: mimeType });
            const fileObj = new File([blob], fileName, { type: mimeType });
            fileObj.path = imgState.path;
            restoredImages.push({ previewUrl: imgState.previewUrl, name: fileName, path: imgState.path, file: fileObj });
          } catch (err) {
            console.error('Ошибка восстановления файла:', err);
          }
        }
        setImages(restoredImages);
      };
      restore();
    } else if (state.images && state.images.length === 0) {
      setImages([]);
    }
  }, [tabId, getTabState]);

  useEffect(() => {
    if (!tabId) return;
    const state = stateToSaveRef.current;
    if (state) updateTabState(tabId, state);
    return () => {
      if (tabId && stateToSaveRef.current) {
        updateTabState(tabId, stateToSaveRef.current);
      }
    };
  }, [images, prompt, aspectRatio, resolution, resultUrl, tabId, updateTabState]);

  useEffect(() => {
    if (!isActive) return;
    const window = getCurrentWindow();
    const unlisten = window.onDragDropEvent(() => {});
    return () => unlisten.then(fn => fn());
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
      setError(`Файл слишком большой. Максимум: 20MB. Ваш: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }
    if (images.length >= MAX_IMAGES) {
      setError(`Максимум ${MAX_IMAGES} изображений. Удалите одно перед добавлением.`);
      return;
    }
    setError(null);
    setResultUrl(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImages(prev => [...prev, { previewUrl: e.target.result, name: file.name, path: file.path, file }]);
    };
    reader.readAsDataURL(file);
  }, [images.length]);

  const handleDroppedFile = useCallback(async (path) => {
    try {
      const isDir = await invoke('check_path_is_directory', { path }).catch(() => false);
      if (isDir) return;
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
    if (!dropzoneRef.current?.contains(e.relatedTarget)) setIsDragging(false);
  }, [isActive]);

  const handleDrop = useCallback(async (e) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (draggedImageIndex !== null) return;
    const files = Array.from(e.dataTransfer.files);
    for (let i = 0; i < Math.min(files.length, MAX_IMAGES - images.length); i++) {
      await handleFileSelect(files[i]);
    }
    if (files.length > MAX_IMAGES - images.length) {
      setError(`Загружено макс. ${MAX_IMAGES} изображений. Остальные проигнорированы.`);
    }
  }, [handleFileSelect, isActive, images.length, draggedImageIndex]);

  const handleClick = useCallback(async () => {
    try {
      const paths = await openFileDialog({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }],
        multiple: true
      });
      if (paths?.length) {
        for (let i = 0; i < Math.min(paths.length, MAX_IMAGES - images.length); i++) {
          await handleDroppedFile(paths[i]);
        }
        if (paths.length > MAX_IMAGES - images.length) {
          setError(`Загружено макс. ${MAX_IMAGES} изображений. Остальные проигнорированы.`);
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
    e.dataTransfer.setData('text/plain', '');
  }, []);

  const handleImageDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (draggedImageIndex !== null && draggedImageIndex !== index) setDragOverIndex(index);
  }, [draggedImageIndex]);

  const handleImageDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
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
      const [dragged] = newImages.splice(draggedImageIndex, 1);
      newImages.splice(dropIndex, 0, dragged);
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
    setAspectRatio('16:9');
    setResolution('2K');
    currentTaskIdRef.current = null;
    if (tabId) {
      setTabState(tabId, { images: [], prompt: '', aspectRatio: '16:9', resolution: '2K', resultUrl: null, taskId: null });
    }
  }, [tabId, setTabState]);

  const handleGenerate = useCallback(async () => {
    if (images.length === 0) {
      setError('Пожалуйста, загрузите хотя бы одно изображение');
      return;
    }
    if (!prompt?.trim()) {
      setError('Пожалуйста, введите промпт');
      return;
    }
    const imageFiles = images.map(img => img.file).filter(Boolean);
    if (imageFiles.length === 0) {
      setError('Ошибка: файлы изображений не найдены');
      return;
    }

    let falKey;
    try {
      const settings = await invoke('load_settings');
      if (!settings?.api_keys?.FAL) {
        setError('FAL API ключ не найден. Добавьте его в настройках.');
        return;
      }
      falKey = settings.api_keys.FAL;
    } catch (err) {
      console.error('Ошибка загрузки настроек:', err);
      setError('Ошибка загрузки настроек. Проверьте FAL API ключ в настройках.');
      return;
    }

    const taskId = addTask({
      type: 'nano-edit-pro',
      title: 'Nano Edit Pro',
      description: 'Редактирование изображений с Nano Banana Pro',
      status: 'running',
      progress: 0,
      tabId
    });
    currentTaskIdRef.current = taskId;
    updateTabState(tabId, { taskId });
    setIsProcessing(true);
    setError(null);
    setResultUrl(null);

    try {
      const { fal } = await import('@fal-ai/client');
      fal.config({ credentials: falKey });

      updateTask(taskId, { progress: 10, status: 'running' });
      const imageUrls = await Promise.all(imageFiles.map(file => fal.storage.upload(file)));
      updateTask(taskId, { progress: 40, status: 'running' });

      const result = await fal.subscribe(FAL_MODEL, {
        input: {
          prompt: prompt.trim(),
          image_urls: imageUrls,
          aspect_ratio: aspectRatio,
          resolution,
          ...FIXED_INPUT
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === 'IN_PROGRESS') {
            updateTask(taskId, { progress: 60, status: 'running' });
          }
        }
      });

      updateTask(taskId, { progress: 90, status: 'running' });

      const outputImages = result.data?.images;
      if (!outputImages?.length || !outputImages[0]?.url) {
        throw new Error('Не удалось получить изображение из ответа API');
      }
      const imageUrl = outputImages[0].url;
      setResultUrl(imageUrl);
      updateTask(taskId, { progress: 100, status: 'completed', resultUrl: imageUrl });
      updateTabState(tabId, { resultUrl: imageUrl });
    } catch (err) {
      console.error('Ошибка генерации:', err);
      let errorMessage = err.message || 'Ошибка при генерации изображения';
      if (err.body?.detail) {
        const details = Array.isArray(err.body.detail)
          ? err.body.detail.map(d => JSON.stringify(d)).join(', ')
          : JSON.stringify(err.body.detail);
        errorMessage = `Ошибка API: ${details}`;
      }
      setError(errorMessage);
      if (currentTaskIdRef.current) {
        updateTask(currentTaskIdRef.current, { status: 'failed', error: errorMessage });
      }
    } finally {
      setIsProcessing(false);
    }
  }, [images, prompt, aspectRatio, resolution, addTask, updateTask, tabId, updateTabState]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const response = await fetch(resultUrl);
      const blob = await response.blob();
      const timestamp = generateTimestamp();
      const filePath = await save({
        filters: [{ name: 'Images', extensions: ['png'] }],
        defaultPath: `nano-edit-pro-result-${timestamp}.png`
      });
      if (filePath) {
        await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
        showNotification('Изображение успешно сохранено!', 'success');
      }
    } catch (err) {
      console.error('Ошибка скачивания:', err);
      setError('Ошибка при сохранении: ' + (err.message || err));
    }
  }, [resultUrl]);

  const textareaRef = useRef(null);
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [prompt]);

  return (
    <div
      id={`page-utility-nano-edit-pro-${tabId}`}
      className={`page utility-page ${isActive ? 'active' : ''}`}
    >
      <div className="utility-header">
        <h2>Nano Edit Pro</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Редактирование изображений с помощью Nano Banana Pro (fal.ai)
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
                <div className="dropzone-placeholder">
                  {images.length > 0
                    ? `Загрузить ещё (максимум ${MAX_IMAGES})`
                    : `Перетащите изображения сюда или кликните (максимум ${MAX_IMAGES})`}
                </div>
              </div>
            </div>

            {images.length > 0 && (
              <div className="images-list" style={{ marginTop: '20px' }}>
                <h3 style={{ marginBottom: '15px' }}>Загруженные изображения:</h3>
                <div
                  style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}
                  onDragOver={(e) => {
                    if (draggedImageIndex === null && e.dataTransfer.types.includes('Files')) return;
                    if (draggedImageIndex !== null) e.stopPropagation();
                  }}
                >
                  {images.map((image, index) => (
                    <div
                      key={index}
                      draggable
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
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRemoveImage(index); }}
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute', top: '5px', right: '5px',
                            background: 'rgba(255, 0, 0, 0.8)', color: 'white', border: 'none', borderRadius: '50%',
                            width: '24px', height: '24px', cursor: 'pointer', fontSize: '16px', lineHeight: '20px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10
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
                  <label htmlFor="nano-prompt-input" style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                    Промпт <span style={{ color: 'red' }}>*</span>
                  </label>
                  <textarea
                    ref={textareaRef}
                    id="nano-prompt-input"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={isProcessing}
                    placeholder="Опишите, что нужно изменить в изображении"
                    className="form-input"
                    style={{
                      width: '100%', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit', fontSize: '14px',
                      padding: '10px', border: '1px solid var(--border)', borderRadius: '4px',
                      backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none'
                    }}
                  />
                </div>
                <div className="settings-control" style={{ marginTop: '0px', marginBottom: '5px' }}>
                  <label htmlFor="nano-aspect-select" style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                    Соотношение сторон
                  </label>
                  <select
                    id="nano-aspect-select"
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    disabled={isProcessing}
                    className="form-input"
                    style={{ width: '100%' }}
                  >
                    {ASPECT_RATIO_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="settings-control" style={{ marginTop: '0px', marginBottom: '5px' }}>
                  <label htmlFor="nano-resolution-select" style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                    Разрешение
                  </label>
                  <select
                    id="nano-resolution-select"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    disabled={isProcessing}
                    className="form-input"
                    style={{ width: '100%' }}
                  >
                    {RESOLUTION_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isProcessing || !prompt.trim()}
                  className="btn btn-primary"
                  style={{ marginTop: '5px' }}
                >
                  {isProcessing ? 'Генерация...' : 'Применить Nano Edit Pro'}
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
                  <button onClick={handleDownload} className="btn btn-primary" style={{ marginRight: '10px' }}>
                    ⬇️ Скачать результат
                  </button>
                  <button onClick={handleClear} className="btn btn-secondary" style={{ marginLeft: '10px' }}>
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
