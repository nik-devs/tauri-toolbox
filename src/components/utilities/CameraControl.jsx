import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';
import { generateTimestamp } from '../../utils/fileUtils';
import { showNotification } from '../../utils/notifications';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp'
};

// Базовые параметры (неизменны)
const BASE_PARAMS = {
  guidance_scale: 1,
  num_inference_steps: 6,
  acceleration: "regular",
  negative_prompt: " ",
  enable_safety_checker: false,
  output_format: "png",
  num_images: 1,
  lora_scale: 1.25
};

// Значения для Rotate Right-Left
const ROTATE_VALUES = [-90, -45, 0, 45, 90];

// Значения для Move Forward → Close-Up
const MOVE_FORWARD_VALUES = [0, 5, 10];

// Значения для Vertical Angle (Bird ⬄ Worm)
const VERTICAL_ANGLE_VALUES = [-1, 0, 1];

export default function CameraControl({ tabId = `camera-control-${Date.now()}`, isActive = true }) {
  const { getTabState, updateTabState, setTabState } = useTabsState();
  const { addTask, updateTask } = useTasks();
  const { getTask } = useTasks();
  
  const savedState = getTabState(tabId);
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(savedState?.previewUrl || null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(savedState?.resultUrl || null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Параметры слайдеров
  const [rotateValue, setRotateValue] = useState(savedState?.rotateValue ?? 0);
  const [moveForward, setMoveForward] = useState(savedState?.moveForward ?? 0);
  const [verticalAngle, setVerticalAngle] = useState(savedState?.verticalAngle ?? 0);
  const [wideAngleLens, setWideAngleLens] = useState(savedState?.wideAngleLens ?? false);
  
  const dropzoneRef = useRef(null);
  const currentTaskIdRef = useRef(savedState?.taskId || null);
  const fileNameRef = useRef(savedState?.fileName || null);
  const filePathRef = useRef(savedState?.filePath || null);
  const restoredTabIdRef = useRef(null);

  useEffect(() => {
    if (restoredTabIdRef.current === tabId) return;
    restoredTabIdRef.current = tabId;
    
    const restoreState = async () => {
      const state = getTabState(tabId);
      if (!state) return;
      
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
      if (state.rotateValue !== undefined) {
        setRotateValue(state.rotateValue);
      }
      if (state.moveForward !== undefined) {
        setMoveForward(state.moveForward);
      }
      if (state.verticalAngle !== undefined) {
        setVerticalAngle(state.verticalAngle);
      }
      if (state.wideAngleLens !== undefined) {
        setWideAngleLens(state.wideAngleLens);
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

  useEffect(() => {
    if (tabId && restoredTabIdRef.current === tabId) {
      updateTabState(tabId, {
        fileName: selectedFile?.name || fileNameRef.current,
        filePath: selectedFile?.path || filePathRef.current,
        previewUrl,
        resultUrl,
        taskId: currentTaskIdRef.current,
        rotateValue,
        moveForward,
        verticalAngle,
        wideAngleLens
      });
    }
  }, [selectedFile, previewUrl, resultUrl, rotateValue, moveForward, verticalAngle, wideAngleLens, tabId, updateTabState]);

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
      setError(`Файл слишком большой. Максимальный размер: 5MB. Ваш файл: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }

    setSelectedFile(file);
    fileNameRef.current = file.name;
    filePathRef.current = file.path;
    setError(null);
    setResultUrl(null);

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
    setResultUrl(null);
    setError(null);
    setIsProcessing(false);
    fileNameRef.current = null;
    filePathRef.current = null;
    currentTaskIdRef.current = null;
    setRotateValue(0);
    setMoveForward(0);
    setVerticalAngle(0);
    if (tabId) {
      setTabState(tabId, {
        fileName: null,
        filePath: null,
        previewUrl: null,
        resultUrl: null,
        taskId: null,
        rotateValue: 0,
        moveForward: 0,
        verticalAngle: 0
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

    const taskId = addTask({
      type: 'camera-control',
      title: `Camera Control: ${selectedFile.name}`,
      description: `Изменение угла камеры для ${selectedFile.name}`,
      status: 'running',
      progress: 0,
      tabId: tabId
    });
    currentTaskIdRef.current = taskId;
    updateTabState(tabId, { taskId });

    const { fal } = await import('@fal-ai/client');

    fal.config({
      credentials: falKey
    });

    setIsProcessing(true);
    setError(null);
    setResultUrl(null);

    try {
      if (selectedFile.size > MAX_FILE_SIZE) {
        throw new Error(`Файл слишком большой. Максимальный размер: 5MB. Ваш файл: ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`);
      }

      updateTask(taskId, { progress: 10, status: 'running' });

      const imageUrl = await fal.storage.upload(selectedFile);
      console.log('Uploaded image URL:', imageUrl);
      updateTask(taskId, { progress: 30, status: 'running' });

      const result = await fal.subscribe("fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles", {
        input: {
          image_urls: [imageUrl],
          rotate_right_left: rotateValue,
          move_forward: moveForward,
          vertical_angle: verticalAngle,
          wide_angle_lens: wideAngleLens,
          ...BASE_PARAMS
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

      // Результат может быть массивом изображений или одним изображением
      let resultImageUrl;
      if (result.data?.images && Array.isArray(result.data.images) && result.data.images.length > 0) {
        resultImageUrl = result.data.images[0].url || result.data.images[0];
      } else if (result.data?.image?.url) {
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
      
      updateTabState(tabId, { resultUrl: resultImageUrl });
    } catch (err) {
      console.error('Ошибка генерации:', err);
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
  }, [selectedFile, rotateValue, moveForward, verticalAngle, wideAngleLens, addTask, updateTask, tabId, updateTabState]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;

    try {
      const response = await fetch(resultUrl);
      const blob = await response.blob();

      const timestamp = generateTimestamp();
      const filePath = await save({
        filters: [{
          name: 'Images',
          extensions: ['png']
        }],
        defaultPath: `camera-control-result-${timestamp}.png`
      });

      if (filePath) {
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
      id={`page-utility-camera-control-${tabId}`} 
      className={`page utility-page ${isActive ? 'active' : ''}`}
    >
      <div className="utility-header">
        <h2>Camera Control</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Изменение угла камеры и перспективы изображения с помощью AI
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
              <div className="preview-section">
                <h3>Исходное изображение</h3>
                <div className="image-preview-container">
                  <img src={previewUrl} alt="Preview" />
                </div>
                <p className="file-name">{selectedFile?.name || fileNameRef.current}</p>
              </div>
            )}

            {previewUrl && (
              <>
                <div className="preview-section">
                  <div className="settings-control">
                    <label htmlFor="rotate-slider" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontWeight: '500' }}>
                      <span>Rotate Right-Left</span>
                      <span style={{ fontSize: '0.9em', color: 'var(--text-primary)', fontWeight: '500' }}>{rotateValue}°</span>
                    </label>
                    <input
                      type="range"
                      id="rotate-slider"
                      min="-90"
                      max="90"
                      step="45"
                      value={rotateValue}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        // Привязываем к ближайшему жесткому значению
                        const closest = ROTATE_VALUES.reduce((prev, curr) => 
                          Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
                        );
                        setRotateValue(closest);
                      }}
                      disabled={isProcessing}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div className="settings-control" style={{ marginTop: '15px' }}>
                    <label htmlFor="move-forward-slider" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontWeight: '500' }}>
                      <span>Move Forward → Close-Up</span>
                      <span style={{ fontSize: '0.9em', color: 'var(--text-primary)', fontWeight: '500' }}>{moveForward}</span>
                    </label>
                    <input
                      type="range"
                      id="move-forward-slider"
                      min="0"
                      max="10"
                      step="5"
                      value={moveForward}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        // Привязываем к ближайшему жесткому значению
                        const closest = MOVE_FORWARD_VALUES.reduce((prev, curr) => 
                          Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
                        );
                        setMoveForward(closest);
                      }}
                      disabled={isProcessing}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div className="settings-control" style={{ marginTop: '15px' }}>
                    <label htmlFor="vertical-angle-slider" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontWeight: '500' }}>
                      <span>Vertical Angle (Bird ⬄ Worm)</span>
                      <span style={{ fontSize: '0.9em', color: 'var(--text-primary)', fontWeight: '500' }}>{verticalAngle}</span>
                    </label>
                    <input
                      type="range"
                      id="vertical-angle-slider"
                      min="-1"
                      max="1"
                      step="1"
                      value={verticalAngle}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        // Привязываем к ближайшему жесткому значению
                        const closest = VERTICAL_ANGLE_VALUES.reduce((prev, curr) => 
                          Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
                        );
                        setVerticalAngle(closest);
                      }}
                      disabled={isProcessing}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div className="settings-control" style={{ marginTop: '15px' }}>
                    <label htmlFor="wide-angle-lens-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        id="wide-angle-lens-checkbox"
                        checked={wideAngleLens}
                        onChange={(e) => setWideAngleLens(e.target.checked)}
                        disabled={isProcessing}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <span>Wide-Angle Lens</span>
                    </label>
                  </div>
                </div>

                <button
                  id="generateBtn"
                  className="btn btn-success"
                  disabled={isProcessing}
                  onClick={handleGenerate}
                  style={{ marginTop: '5px' }}
                >
                  🎥 Применить Camera Control
                </button>
              </>
            )}

            {isProcessing && (
              <div className="progress">
                <div className="progress-bar"></div>
                <span className="progress-text">Обработка изображения...</span>
              </div>
            )}

            {resultUrl && (
              <div className="result-section">
                <h3>Результат</h3>
                <div className="image-preview-container">
                  <img src={resultUrl} alt="Result" />
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
