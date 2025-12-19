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
const MAX_DIMENSION = 1920;
const STATUS_CHECK_INTERVAL = 5000; // 5 секунд
const MAX_STATUS_CHECK_TIME = 10 * 60 * 1000; // 10 минут

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

// Функция для конвертации файла в base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export default function StyleTransfer({ tabId = `style-transfer-${Date.now()}`, isActive = true }) {
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
  const [userPrompt, setUserPrompt] = useState(savedState?.userPrompt || '');
  const [denoisingStrength, setDenoisingStrength] = useState(savedState?.denoisingStrength ?? 0.5);
  const [selectedStyle, setSelectedStyle] = useState(savedState?.selectedStyle || 'Dreamshift');
  const dropzoneRef = useRef(null);
  const currentTaskIdRef = useRef(savedState?.taskId || null);
  const fileNameRef = useRef(savedState?.fileName || null);
  const filePathRef = useRef(savedState?.filePath || null);
  const restoredTabIdRef = useRef(null);
  const statusCheckIntervalRef = useRef(null);
  const statusCheckStartTimeRef = useRef(null);

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
      if (state.resultUrl) {
        setResultUrl(state.resultUrl);
      }
      if (state.userPrompt) {
        setUserPrompt(state.userPrompt);
      }
      if (state.denoisingStrength !== undefined) {
        setDenoisingStrength(state.denoisingStrength);
      }
      if (state.selectedStyle) {
        setSelectedStyle(state.selectedStyle);
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

  // Сохраняем состояние при изменении
  useEffect(() => {
    if (tabId && restoredTabIdRef.current === tabId) {
      updateTabState(tabId, {
        fileName: selectedFile?.name || fileNameRef.current,
        filePath: selectedFile?.path || filePathRef.current,
        previewUrl,
        resultUrl,
        userPrompt,
        denoisingStrength,
        selectedStyle,
        taskId: currentTaskIdRef.current
      });
    }
  }, [selectedFile, previewUrl, resultUrl, userPrompt, denoisingStrength, selectedStyle, tabId, updateTabState]);

  // Очистка интервала при размонтировании
  useEffect(() => {
    return () => {
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
      }
    };
  }, []);

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
    setResultUrl(null);
    setError(null);
    setIsProcessing(false);
    setUserPrompt('');
    setDenoisingStrength(0.5);
    setSelectedStyle('Dreamshift');
    fileNameRef.current = null;
    filePathRef.current = null;
    currentTaskIdRef.current = null;
    if (statusCheckIntervalRef.current) {
      clearInterval(statusCheckIntervalRef.current);
      statusCheckIntervalRef.current = null;
    }
    if (tabId) {
      setTabState(tabId, {
        fileName: null,
        filePath: null,
        previewUrl: null,
        resultUrl: null,
        userPrompt: '',
        denoisingStrength: 0.5,
        selectedStyle: 'Dreamshift',
        taskId: null
      });
    }
  }, [tabId, setTabState]);

  // Функция для проверки статуса задачи
  const checkStatus = useCallback(async (jobId, endpoint, apiKey, taskId) => {
    // Проверяем, не была ли уже остановлена обработка
    if (!statusCheckIntervalRef.current && isProcessing) {
      console.log('Обработка уже остановлена, пропускаем проверку статуса');
      return;
    }
    
    try {
      const response = await fetch(`${endpoint}/status/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        }
      });

      if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
      
      const data = await response.json();
      console.log(`Статус задачи ${jobId}:`, data.status);
      
      if (data.status === 'FAILED') {
        console.log('data', data);
        if (statusCheckIntervalRef.current) {
          clearInterval(statusCheckIntervalRef.current);
          statusCheckIntervalRef.current = null;
        }
        throw new Error(data.error || 'Задача завершилась с ошибкой');
      }
      
      if (data.status === 'COMPLETED') {
        console.log('Задача завершена, обрабатываем результат...');
        // Получаем результат - проверяем разные возможные структуры ответа
        let base64Image = null;
        
        if (data.output) {
          // Проверяем data.output.images
          if (data.output.images && Array.isArray(data.output.images) && data.output.images.length > 0) {
            base64Image = data.output.images[0];
          }
          // Проверяем data.output как массив
          else if (Array.isArray(data.output) && data.output.length > 0) {
            base64Image = data.output[0];
          }
          // Проверяем data.output как строку
          else if (typeof data.output === 'string') {
            base64Image = data.output;
          }
          // Проверяем вложенные структуры
          else if (data.output.data && Array.isArray(data.output.data) && data.output.data.length > 0) {
            base64Image = data.output.data[0];
          }
        }
        
        // Если не нашли в output, проверяем корневой уровень
        if (!base64Image && Array.isArray(data.images) && data.images.length > 0) {
          base64Image = data.images[0];
        }
        
        if (!base64Image && typeof data === 'string') {
          base64Image = data;
        }
        
        if (base64Image) {
          // Убираем префикс data:image если есть
          const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
          
          try {
            // Для больших изображений используем data URL напрямую (быстрее, не блокирует UI)
            updateTask(taskId, { progress: 95, status: 'running' });
            
            // Используем data URL напрямую для отображения
            // Это быстрее для больших изображений, так как не требует конвертации
            const dataUrl = `data:image/png;base64,${cleanBase64}`;
            
            // Обновляем состояние асинхронно через requestAnimationFrame
            await new Promise((resolve) => {
              requestAnimationFrame(() => {
                setResultUrl(dataUrl);
                updateTask(taskId, { 
                  progress: 100, 
                  status: 'completed',
                  resultUrl: dataUrl,
                  resultBase64: cleanBase64
                });
                updateTabState(tabId, { resultUrl: dataUrl });
                
                // Останавливаем интервал проверки статуса
                if (statusCheckIntervalRef.current) {
                  clearInterval(statusCheckIntervalRef.current);
                  statusCheckIntervalRef.current = null;
                  console.log('Интервал проверки статуса остановлен');
                }
                setIsProcessing(false);
                console.log('Обработка завершена успешно');
                resolve();
              });
            });
          } catch (err) {
            console.error('Ошибка обработки изображения:', err);
            throw new Error('Ошибка обработки результата: ' + (err.message || err));
          }
        } else {
          console.error('Структура ответа RunPod:', JSON.stringify(data, null, 2));
          throw new Error('Результат не содержит изображения. Проверьте структуру ответа в консоли.');
        }
      } else if (data.status === 'CANCELLED') {
        throw new Error('Задача была отменена');
      }
      // Если статус PENDING или IN_PROGRESS, продолжаем опрос
    } catch (err) {
      console.error('Ошибка проверки статуса:', err);
      // Останавливаем интервал только если это критическая ошибка
      if (err.message && (err.message.includes('FAILED') || err.message.includes('CANCELLED') || err.message.includes('обработки результата'))) {
        if (statusCheckIntervalRef.current) {
          clearInterval(statusCheckIntervalRef.current);
          statusCheckIntervalRef.current = null;
        }
        setError(err.message || 'Ошибка проверки статуса');
        updateTask(taskId, { 
          status: 'failed',
          error: err.message || 'Ошибка проверки статуса'
        });
        setIsProcessing(false);
      }
      // Для других ошибок (например, сетевых) продолжаем опрос
      throw err;
    }
  }, [tabId, updateTask, updateTabState, isProcessing]);

  const handleStyleTransfer = useCallback(async () => {
    if (!selectedFile && !previewUrl) {
      setError('Пожалуйста, выберите изображение');
      return;
    }
    
    if (!selectedFile) {
      setError('Файл был потерян. Пожалуйста, выберите изображение заново.');
      return;
    }

    if (!userPrompt.trim()) {
      setError('Пожалуйста, введите промпт');
      return;
    }

    // Получаем RunPod настройки из настроек
    let runpodApiKey, runpodEndpoint;
    try {
      const settings = await invoke('load_settings');
      if (!settings || !settings.api_keys) {
        setError('Настройки не найдены. Пожалуйста, добавьте RunPod API ключ и эндпоинт в настройках.');
        return;
      }
      runpodApiKey = settings.api_keys.RunPod;
      runpodEndpoint = settings.api_keys.RunPodEndpoint;
      
      if (!runpodApiKey) {
        setError('RunPod API ключ не найден. Пожалуйста, добавьте его в настройках.');
        return;
      }
      if (!runpodEndpoint) {
        setError('RunPod эндпоинт не найден. Пожалуйста, добавьте его в настройках.');
        return;
      }
      
      // Убираем /run в конце если есть
      runpodEndpoint = runpodEndpoint.replace(/\/run\/?$/, '');
    } catch (err) {
      console.error('Ошибка загрузки настроек:', err);
      setError('Ошибка загрузки настроек. Проверьте RunPod настройки в настройках.');
      return;
    }

    // Создаем задачу
    const taskId = addTask({
      type: 'style-transfer',
      title: `Style Transfer: ${selectedFile.name}`,
      description: `Стилизация изображения ${selectedFile.name}`,
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

      // Изменяем размер изображения если нужно
      const { file: resizedFile, width, height } = await resizeImage(selectedFile, MAX_DIMENSION);
      updateTask(taskId, { progress: 20, status: 'running' });

      // Конвертируем в base64
      const inputImageBase64 = await fileToBase64(resizedFile);
      updateTask(taskId, { progress: 30, status: 'running' });

      // Округляем размеры до целых чисел в меньшую сторону (API требует int, а не float)
      const imageWidth = Math.floor(width);
      const imageHeight = Math.floor(height);

      // Формируем промпты в зависимости от выбранного стиля
      let combinedPrompt, negative;
      
      if (selectedStyle === 'Sexting Department') {
        combinedPrompt = `score_10, score_9_up, score_9, score_8_up, score_7_up, best quality, extremely detailed, highest quality, masterpiece, Expressiveh, source_cartoon, BREAK,Expressiveh, g0thicPXL,${userPrompt},<lora:Expressive_H:0.5>,<lora:incase-ilff-v3-4:0.6>,<lora:princess_xl_v2:0.8>,<lora:g0th1cPXL:0.4>`;
        negative = `score_6, score_5, score_4, censored, (3d:0.5), EasyNegative, monochrome, watermark, censored, worst quality, low quality, normal quality, lowres, bad anatomy, bad hands, signature, watermarks, ugly, imperfect eyes, skewed eyes, unnatural face, unnatural body, error, extra limb, missing limbs, painting by bad-artist`;
      } else {
        // Dreamshift (по умолчанию)
        combinedPrompt = `score_10, score_9_up, score_9, score_8_up, score_7_up, best quality, extremely detailed, highest quality, masterpiece, Expressiveh, source_cartoon, BREAK,Drawn in the style of Summertime Saga, Expressiveh,${userPrompt},<lora:SummertimeSagaXL_Pony:0.8>,<lora:Zankuro_Style_Pony:0.5>,<lora:Expressive_H:0.5>`;
        negative = `score_6, score_5, score_4, censored, (3d:0.5), EasyNegative, monochrome, watermark, censored, worst quality, low quality, normal quality, lowres, bad anatomy, bad hands, signature, watermarks, ugly, imperfect eyes, skewed eyes, unnatural face, unnatural body, error, extra limb, missing limbs, painting by bad-artist`;
      }
      
      const randomSeed = Math.floor(Math.random() * 2147483647);

      // Формируем payload
      const payload = {
        override_settings: { sd_model_checkpoint: 'ponyDiffusionV6XL_v6StartWithThisOne' },
        override_settings_restore_afterwards: true,
        prompt: combinedPrompt,
        negative_prompt: negative,
        seed: randomSeed,
        batch_size: 1,
        steps: 30,
        cfg_scale: 5,
        width: imageWidth,
        height: imageHeight,
        sampler_name: 'Euler a',
        restore_faces: false,
        hr_scale: 1.5,
        hr_sampler_name: 'Euler a',
        hr_second_pass_steps: 20,
        hr_upscaler: '4x_foolhardy_Remacri',
        hr_checkpoint_name: 'ponyDiffusionV6XL_v6StartWithThisOne',
        denoising_strength: denoisingStrength,
        hr_prompt: combinedPrompt,
        hr_negative_prompt: negative,
        enable_hr: true,
        init_images: [inputImageBase64]
      };

      // Удаляем hr настройки для img2img
      delete payload.hr_prompt;
      delete payload.hr_negative_prompt;
      delete payload.enable_hr;
      delete payload.hr_scale;
      delete payload.hr_sampler_name;
      delete payload.hr_second_pass_steps;
      delete payload.hr_upscaler;
      delete payload.hr_checkpoint_name;

      const body = JSON.stringify({
        input: {
          api: {
            method: 'POST',
            endpoint: '/sdapi/v1/img2img',
          },
          payload: payload
        }
      });

      updateTask(taskId, { progress: 40, status: 'running' });

      // Отправляем запрос
      const runpodResponse = await fetch(`${runpodEndpoint}/run`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runpodApiKey}`,
          'Content-Type': 'application/json'
        },
        body: body
      });

      if (!runpodResponse.ok) {
        const errorText = await runpodResponse.text();
        throw new Error(`RunPod API error: ${runpodResponse.status} - ${errorText}`);
      }

      const runpodData = await runpodResponse.json();
      const jobId = runpodData.id;

      if (!jobId) {
        throw new Error('Не удалось получить ID задачи от RunPod');
      }

      updateTask(taskId, { progress: 50, status: 'running' });

      // Начинаем опрос статуса
      statusCheckStartTimeRef.current = Date.now();
      let checkCount = 0;
      statusCheckIntervalRef.current = setInterval(async () => {
        // Проверяем, не была ли уже остановлена обработка
        if (!statusCheckIntervalRef.current) {
          return;
        }
        
        const elapsed = Date.now() - statusCheckStartTimeRef.current;
        if (elapsed > MAX_STATUS_CHECK_TIME) {
          if (statusCheckIntervalRef.current) {
            clearInterval(statusCheckIntervalRef.current);
            statusCheckIntervalRef.current = null;
          }
          setError('Превышено время ожидания (10 минут)');
          updateTask(taskId, { 
            status: 'failed',
            error: 'Превышено время ожидания (10 минут)'
          });
          setIsProcessing(false);
          return;
        }
        
        checkCount++;
        console.log(`Проверка статуса #${checkCount} для задачи ${jobId}`);
        try {
          await checkStatus(jobId, runpodEndpoint, runpodApiKey, taskId);
        } catch (err) {
          console.error('Ошибка в checkStatus:', err);
          // Если произошла ошибка и обработка еще не остановлена, продолжаем опрос
          if (statusCheckIntervalRef.current && err.message && !err.message.includes('COMPLETED')) {
            // Продолжаем опрос только если это не ошибка завершения
            return;
          }
        }
      }, STATUS_CHECK_INTERVAL);

      // Первая проверка сразу
      console.log(`Первая проверка статуса для задачи ${jobId}`);
      await checkStatus(jobId, runpodEndpoint, runpodApiKey, taskId);

    } catch (err) {
      console.error('Ошибка style transfer:', err);
      let errorMessage = err.message || 'Ошибка при обработке изображения';

      setError(errorMessage);
      updateTask(taskId, { 
        status: 'failed',
        error: errorMessage
      });
      
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
        statusCheckIntervalRef.current = null;
      }
    } finally {
      // setIsProcessing будет установлен в false в checkStatus или при ошибке
    }
  }, [selectedFile, userPrompt, denoisingStrength, selectedStyle, addTask, updateTask, tabId, updateTabState, checkStatus]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;

    try {
      // Если у нас есть base64 в задаче, используем его
      const task = currentTaskIdRef.current ? getTask(currentTaskIdRef.current) : null;
      let blob;
      
      if (task?.resultBase64) {
        // Конвертируем base64 в blob
        const response = await fetch(`data:image/png;base64,${task.resultBase64}`);
        blob = await response.blob();
      } else {
        // Скачиваем из URL
        const response = await fetch(resultUrl);
        blob = await response.blob();
      }

      const timestamp = generateTimestamp();
      const filePath = await save({
        filters: [{
          name: 'Images',
          extensions: ['png']
        }],
        defaultPath: `style-transfer-${timestamp}.png`
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
  }, [resultUrl, getTask]);

  return (
    <div 
      id={`page-utility-style-transfer-${tabId}`} 
      className={`page utility-page ${isActive ? 'active' : ''}`}
    >
      <div className="utility-header">
        <h2>Style Transfer</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Стилизация картинки с помощью AI
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
              <>
                <div className="settings-control" style={{ marginTop: '0px', marginBottom: '5px' }}>
                  <label htmlFor="style-select" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                    Стиль
                  </label>
                  <select
                    id="style-select"
                    value={selectedStyle}
                    onChange={(e) => setSelectedStyle(e.target.value)}
                    disabled={isProcessing}
                    className="form-input"
                    style={{ width: '100%' }}
                  >
                    <option value="Dreamshift">Dreamshift</option>
                    <option value="Sexting Department">Sexting Department</option>
                  </select>
                </div>

                <div className="settings-control" style={{ marginTop: '5px', marginBottom: '5px' }}>
                  <label htmlFor="user-prompt-input" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                    Промпт
                  </label>
                  <textarea
                    id="user-prompt-input"
                    className="form-input"
                    placeholder="Введите описание желаемого стиля"
                    value={userPrompt}
                    onChange={(e) => setUserPrompt(e.target.value)}
                    disabled={isProcessing}
                    style={{ width: '100%', minHeight: '60px', resize: 'vertical' }}
                    rows={3}
                  />
                </div>

                <div className="settings-control" style={{ marginTop: '5px', marginBottom: '5px' }}>
                  <label htmlFor="denoising-strength-slider" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                    Сила деноиза: {denoisingStrength.toFixed(1)}
                  </label>
                  <input
                    id="denoising-strength-slider"
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.1"
                    value={denoisingStrength}
                    onChange={(e) => setDenoisingStrength(parseFloat(e.target.value))}
                    disabled={isProcessing}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    <span>0.1</span>
                    <span>1.0</span>
                  </div>
                </div>
              </>
            )}

            {previewUrl && userPrompt.trim() && (
              <button
                id="styleTransferBtn"
                className="btn btn-success"
                disabled={isProcessing}
                onClick={handleStyleTransfer}
              >
                🎨 Применить стиль
              </button>
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
