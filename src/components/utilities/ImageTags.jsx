import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile } from '@tauri-apps/plugin-fs';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';

const MAX_FILE_SIZE_FOR_RESIZE = 5 * 1024 * 1024; // 5MB
const RESIZE_MAX_DIMENSION = 1024;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp'
};

// Функция для изменения размера изображения
const resizeImage = (file, maxDimension) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Если изображение больше maxDimension по большей стороне, уменьшаем
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Не удалось создать изображение'));
            return;
          }
          const resizedFile = new File([blob], file.name, { type: file.type });
          resolve({ file: resizedFile, width, height });
        }, file.type || 'image/png', 0.95);
      };

      img.onerror = () => reject(new Error('Ошибка загрузки изображения'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
};

// Функция для конвертации файла в base64 data URI
const fileToDataUri = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result;
      resolve(dataUri);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export default function ImageTags({ tabId = `image-tags-${Date.now()}`, isActive = true }) {
  const { getTabState, updateTabState, setTabState } = useTabsState();
  const { addTask, updateTask } = useTasks();
  const { getTask } = useTasks();
  
  const savedState = getTabState(tabId);
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(savedState?.previewUrl || null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tags, setTags] = useState(savedState?.tags || null);
  const [russianTags, setRussianTags] = useState(savedState?.russianTags || null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dropzoneRef = useRef(null);
  const currentTaskIdRef = useRef(savedState?.taskId || null);
  const fileNameRef = useRef(savedState?.fileName || null);
  const filePathRef = useRef(savedState?.filePath || null);
  const restoredTabIdRef = useRef(null);

  // Восстанавливаем состояние при монтировании или смене tabId
  useEffect(() => {
    if (restoredTabIdRef.current === tabId) return;
    restoredTabIdRef.current = tabId;
    
    const restoreState = async () => {
      const state = getTabState(tabId);
      if (!state) return;
      
      if (state.previewUrl) {
        setPreviewUrl(state.previewUrl);
      }
      if (state.tags) {
        setTags(state.tags);
      }
      if (state.russianTags) {
        setRussianTags(state.russianTags);
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
      
      if (state.taskId) {
        const task = getTask(state.taskId);
        if (task) {
          if (task.status === 'running') {
            setIsProcessing(true);
          }
          if (task.status === 'completed' && task.tags) {
            setTags(task.tags);
            setIsProcessing(false);
          }
          if (task.status === 'failed') {
            setError(task.error || 'Ошибка выполнения задачи');
            setIsProcessing(false);
          }
        }
      }
      
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

  // Подписываемся на изменения задачи
  const { tasks } = useTasks();
  useEffect(() => {
    if (!currentTaskIdRef.current) return;
    
    const task = tasks.find(t => t.id === currentTaskIdRef.current);
    if (!task) return;
    
    if (task.status === 'running' && !isProcessing) {
      setIsProcessing(true);
    } else if (task.status === 'completed' && task.tags && tags !== task.tags) {
      setTags(task.tags);
      setIsProcessing(false);
      updateTabState(tabId, { tags: task.tags });
    } else if (task.status === 'failed' && !error) {
      setError(task.error || 'Ошибка выполнения задачи');
      setIsProcessing(false);
    } else if (task.status !== 'running' && isProcessing) {
      setIsProcessing(false);
    }
  }, [tasks, isProcessing, tags, error, tabId, updateTabState]);

  // Сортируем теги по confidence от большего к меньшему
  const sortedTags = useMemo(() => {
    if (!tags || tags.length === 0) return [];
    return [...tags].sort((a, b) => b.confidence - a.confidence);
  }, [tags]);

  // Сохраняем состояние при изменении
  useEffect(() => {
    if (tabId && restoredTabIdRef.current === tabId) {
      updateTabState(tabId, {
        fileName: selectedFile?.name || fileNameRef.current,
        filePath: selectedFile?.path || filePathRef.current,
        previewUrl,
        tags,
        russianTags,
        taskId: currentTaskIdRef.current
      });
    }
  }, [selectedFile, previewUrl, tags, russianTags, tabId, updateTabState]);

  const handleFileSelect = useCallback(async (file) => {
    if (!file) return;

    if (!file.type?.startsWith('image/')) {
      const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')).toLowerCase() : '';
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        setError('Пожалуйста, выберите файл изображения');
        return;
      }
    }

    setSelectedFile(file);
    fileNameRef.current = file.name;
    filePathRef.current = file.path;
    setError(null);
    setTags(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target.result);
    };
    reader.readAsDataURL(file);
  }, []);

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

      handleFileSelect(fileObj);
    } catch (err) {
      console.error('Ошибка обработки файла:', err);
      setError('Ошибка обработки файла: ' + (err.message || err));
    }
  }, [handleFileSelect]);

  // Drag and drop через Tauri
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
    setTags(null);
    setRussianTags(null);
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
        tags: null,
        russianTags: null,
        taskId: null
      });
    }
  }, [tabId, setTabState]);

  const handleGenerateTags = useCallback(async () => {
    if (!selectedFile && !previewUrl) {
      setError('Пожалуйста, выберите изображение');
      return;
    }
    
    if (!selectedFile) {
      setError('Файл был потерян. Пожалуйста, выберите изображение заново.');
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
      type: 'image-tags',
      title: `Image Tags: ${selectedFile.name}`,
      description: `Генерация тегов для изображения ${selectedFile.name}`,
      status: 'running',
      progress: 0,
      tabId: tabId
    });
    currentTaskIdRef.current = taskId;
    updateTabState(tabId, { taskId });

    setIsProcessing(true);
    setError(null);
    setTags(null);

    try {
      updateTask(taskId, { progress: 10, status: 'running' });

      // Проверяем размер файла и уменьшаем если нужно
      let fileToProcess = selectedFile;
      if (selectedFile.size > MAX_FILE_SIZE_FOR_RESIZE) {
        updateTask(taskId, { progress: 20, status: 'running', description: 'Уменьшение размера изображения...' });
        const { file: resizedFile } = await resizeImage(selectedFile, RESIZE_MAX_DIMENSION);
        fileToProcess = resizedFile;
        console.log(`Изображение уменьшено с ${selectedFile.size} до ${resizedFile.size} байт`);
      }

      updateTask(taskId, { progress: 30, status: 'running', description: 'Подготовка изображения...' });

      // Конвертируем в base64 data URI
      const imageDataUri = await fileToDataUri(fileToProcess);
      
      updateTask(taskId, { progress: 50, status: 'running', description: 'Отправка запроса к API...' });

      // Вызываем Replicate API через Tauri команду (обход CORS)
      const result = await invoke('replicate_run', {
        request: {
          model: "pengdaqian2020/image-tagger:5a3e65f223fe2291679a6c3c812ddb278aa6d43bbcf118c09530b4309aaac00e",
          input: {
            image: imageDataUri,
            score_general_threshold: 0.2,
            score_character_threshold: 0.7
          },
          api_key: replicateKey
        }
      });

      updateTask(taskId, { progress: 90, status: 'running', description: 'Обработка результатов...' });

      // Получаем output из результата
      const output = result.output;

      // Проверяем формат ответа
      if (!Array.isArray(output)) {
        throw new Error('Неожиданный формат ответа от Replicate API');
      }

      // Сохраняем теги в оригинальном порядке (как вернуло API)
      setTags(output);
      updateTabState(tabId, { tags: output });
      
      // Делаем запрос на перевод тегов на русский
      updateTask(taskId, { progress: 95, status: 'running', description: 'Перевод тегов на русский...' });
      
      try {
        // Формируем строку тегов через запятую
        const tagsString = output.map(tag => tag.tag).join(', ');
        const translationPrompt = `Переведи на русский не меняя порядок и количество запятых:\n${tagsString}`;
        
        // Вызываем Replicate API для перевода
        const translationResult = await invoke('replicate_run', {
          request: {
            model: "xai/grok-4",
            input: {
              top_p: 1,
              prompt: translationPrompt,
              max_tokens: 2048,
              temperature: 0.1,
              presence_penalty: 0,
              frequency_penalty: 0
            },
            api_key: replicateKey
          }
        });
        
        // Получаем переведенную строку
        let translatedString = '';
        if (Array.isArray(translationResult.output)) {
          translatedString = translationResult.output.join('');
        } else if (typeof translationResult.output === 'string') {
          translatedString = translationResult.output;
        }
        
        // Парсим переведенные теги (разделяем по запятым и убираем пробелы)
        const translatedTagsArray = translatedString
          .split(',')
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0);
        
        // Создаем массив объектов с русскими переводами, сопоставляя по порядку
        const tagsWithRussian = output.map((tag, index) => ({
          ...tag,
          russian: translatedTagsArray[index] || tag.tag
        }));
        
        // Сохраняем русские переводы
        setRussianTags(tagsWithRussian);
        updateTabState(tabId, { russianTags: tagsWithRussian });
      } catch (translationErr) {
        console.error('Ошибка перевода тегов:', translationErr);
        // Не прерываем выполнение, просто не показываем перевод
      }
      
      updateTask(taskId, { 
        progress: 100, 
        status: 'completed',
        tags: output
      });
      
      setIsProcessing(false);

    } catch (err) {
      console.error('Ошибка генерации тегов:', err);
      let errorMessage = err.message || 'Ошибка при генерации тегов';

      setError(errorMessage);
      updateTask(taskId, { 
        status: 'failed',
        error: errorMessage
      });
      setIsProcessing(false);
    }
  }, [selectedFile, addTask, updateTask, tabId, updateTabState]);

  return (
    <div 
      id={`page-utility-image-tags-${tabId}`} 
      className={`page utility-page ${isActive ? 'active' : ''}`}
    >
      <div className="utility-header">
        <h2>Image Tags</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Генерация тегов для изображения с помощью AI
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
              <div className="preview-section" style={{ marginBottom: '20px' }}>
                <h3>Исходное изображение</h3>
                <div className="image-preview-container">
                  <img src={previewUrl} alt="Preview" />
                </div>
                <p className="file-name">{selectedFile?.name || fileNameRef.current}</p>
              </div>
            )}

            {previewUrl && !tags && (
              <button
                className="btn btn-success"
                disabled={isProcessing}
                onClick={handleGenerateTags}
              >
                🏷️ Генерировать теги
              </button>
            )}

            {isProcessing && (
              <div className="progress">
                <div className="progress-bar"></div>
                <span className="progress-text">Обработка изображения...</span>
              </div>
            )}

            {sortedTags && sortedTags.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <h3>Теги</h3>
                
                {/* Блок тегов через запятую */}
                <div style={{ 
                  marginBottom: '20px', 
                  padding: '15px', 
                  backgroundColor: 'var(--bg-secondary)', 
                  borderRadius: '8px',
                  wordWrap: 'break-word'
                }}>
                  <strong>Все теги:</strong>
                  <div style={{ marginTop: '10px', lineHeight: '1.6' }}>
                    {tags.map((tag, index) => (
                      <span key={index}>
                        {tag.tag}
                        {index < tags.length - 1 && ', '}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Блок русских тегов */}
                {russianTags && russianTags.length > 0 && (
                  <div style={{ 
                    marginBottom: '20px', 
                    padding: '15px', 
                    backgroundColor: 'var(--bg-secondary)', 
                    borderRadius: '8px',
                    wordWrap: 'break-word'
                  }}>
                    <strong>Все теги (русский):</strong>
                    <div style={{ marginTop: '10px', lineHeight: '1.6' }}>
                      {russianTags.map((tag, index) => (
                        <span key={index}>
                          {tag.russian || tag.tag}
                          {index < russianTags.length - 1 && ', '}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Таблица тегов */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ 
                    width: '100%', 
                    borderCollapse: 'collapse',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '8px',
                    overflow: 'hidden'
                  }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <th style={{ 
                          padding: '12px', 
                          textAlign: 'left', 
                          borderBottom: '2px solid var(--border-color)',
                          fontWeight: '600'
                        }}>
                          Тег
                        </th>
                        <th style={{ 
                          padding: '12px', 
                          textAlign: 'left', 
                          borderBottom: '2px solid var(--border-color)',
                          fontWeight: '600',
                          width: '40%'
                        }}>
                          Вес (confidence)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTags.map((tag, index) => {
                        // Находим русский перевод для этого тега
                        const russianTag = russianTags?.find(rt => rt.tag === tag.tag);
                        const russianText = russianTag?.russian || null;
                        
                        return (
                        <tr 
                          key={index}
                          style={{ 
                            borderBottom: index < sortedTags.length - 1 ? '1px solid var(--border-color)' : 'none'
                          }}
                        >
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span>{tag.tag}</span>
                              {russianText && russianText !== tag.tag && (
                                <span style={{ 
                                  color: 'var(--text-secondary)', 
                                  opacity: 0.6,
                                  fontSize: '0.9em'
                                }}>
                                  ({russianText})
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ 
                            padding: '10px 12px'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ 
                                flex: 1,
                                height: '20px',
                                backgroundColor: 'var(--bg-tertiary)',
                                borderRadius: '10px',
                                overflow: 'hidden',
                                position: 'relative'
                              }}>
                                <div style={{
                                  height: '100%',
                                  width: `${tag.confidence * 100}%`,
                                  backgroundColor: tag.confidence > 0.8 
                                    ? 'var(--success)' 
                                    : tag.confidence > 0.5 
                                    ? 'var(--accent)' 
                                    : 'var(--error)',
                                  transition: 'width 0.3s ease',
                                  borderRadius: '10px'
                                }} />
                              </div>
                              <span style={{ 
                                fontFamily: 'monospace',
                                fontSize: '0.9em',
                                minWidth: '50px',
                                textAlign: 'right'
                              }}>
                                {(tag.confidence * 100).toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <button
                  className="btn btn-secondary"
                  onClick={handleClear}
                  style={{ marginTop: '15px' }}
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

