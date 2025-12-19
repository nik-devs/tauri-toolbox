import { useState, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../../contexts/AppContext';
import { invoke, openFolderDialog, openFileDialog } from '../../hooks/useTauri';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { tempDir } from '@tauri-apps/api/path';

export default function WebPToPNG() {
  const { handleBackToTools } = useApp();
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const folderDropzoneRef = useRef(null);
  const fileDropzoneRef = useRef(null);

  // Обработчик выбора папки (для Tauri drag and drop)
  const handleFolderSelect = useCallback(async (path) => {
    if (!path) return;
    
    try {
      const isDir = await invoke('check_path_is_directory', { path });
      if (isDir) {
        setSelectedFolder(path);
        setSelectedFile(null); // Очищаем файл при выборе папки
        setError(null);
        setResult(null);
      } else {
        // Если это файл, берем родительскую папку
        const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
        if (lastSlash > 0) {
          setSelectedFolder(path.substring(0, lastSlash));
          setSelectedFile(null);
          setError(null);
          setResult(null);
        } else {
          setError('Пожалуйста, перетащите папку, а не файл');
        }
      }
    } catch (err) {
      console.error('Ошибка проверки пути:', err);
      setError('Ошибка обработки пути: ' + (err.message || err));
    }
  }, []);

  // Tauri drag and drop для папок
  const { isDragging: isDraggingFolder } = useDragAndDrop(handleFolderSelect);

  // Игнорируем Tauri drag and drop для файлов (используем HTML5)
  useEffect(() => {
    const appWindow = getCurrentWindow();

    if (typeof appWindow.onDragDropEvent === 'function') {
      const unlisten = appWindow.onDragDropEvent((event) => {
        const fileDropzone = fileDropzoneRef.current;
        if (!fileDropzone) return;
        
        const pageElement = fileDropzone.closest('.page');
        if (!pageElement || !pageElement.classList.contains('active')) return;
        
        // Игнорируем Tauri drag and drop для файлов - используем HTML5 API
        if (event.payload.type === 'hover') {
          // Проверяем, есть ли файлы в событии
          if (event.payload.paths && event.payload.paths.length > 0) {
            // Проверяем, является ли это файлом
            const firstPath = event.payload.paths[0];
            invoke('check_path_is_directory', { path: firstPath }).then(isDir => {
              if (!isDir) {
                // Это файл - игнорируем Tauri событие, используем HTML5
                return;
              }
            }).catch(() => {});
          }
        }
      });

      return () => {
        unlisten?.then(fn => fn());
      };
    }
  }, []);

  // HTML5 drag and drop для файлов
  const handleFileDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  }, []);

  const handleFileDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!fileDropzoneRef.current?.contains(e.relatedTarget)) {
      setIsDraggingFile(false);
    }
  }, []);

  const handleFileDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      // Проверяем расширение
      const fileName = file.name.toLowerCase();
      if (!fileName.endsWith('.webp')) {
        setError('Пожалуйста, выберите WebP файл');
        return;
      }
      
      setSelectedFile(file);
      setSelectedFolder(null); // Очищаем папку при выборе файла
      setError(null);
      setResult(null);
    }
  }, []);

  // Обработчик клика на кнопку выбора папки
  const handleSelectFolderClick = useCallback(async () => {
    try {
      const path = await openFolderDialog();
      if (path) {
        handleFolderSelect(path);
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') {
        console.error('Ошибка выбора папки:', err);
        setError('Ошибка выбора папки: ' + (err.message || err));
      }
    }
  }, [handleFolderSelect]);

  // Обработчик клика на дропзону файла
  const handleFileClick = useCallback(async () => {
    try {
      const path = await openFileDialog({
        filters: [{
          name: 'WebP Images',
          extensions: ['webp']
        }]
      });

      if (path) {
        // Читаем файл
        const fileData = await readFile(path);
        const file = new File([fileData], path.split(/[/\\]/).pop(), { type: 'image/webp' });
        setSelectedFile(file);
        setSelectedFolder(null);
        setError(null);
        setResult(null);
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') {
        console.error('Ошибка выбора файла:', err);
        setError('Ошибка выбора файла: ' + (err.message || err));
      }
    }
  }, []);

  const handleClear = useCallback((e) => {
    e.stopPropagation();
    setSelectedFolder(null);
    setSelectedFile(null);
    setResult(null);
    setError(null);
    setShowDeletePrompt(false);
  }, []);

  // Конвертация папки
  const handleConvertFolder = useCallback(async () => {
    if (!selectedFolder) {
      setError('Пожалуйста, выберите папку');
      return;
    }

    setIsConverting(true);
    setResult(null);
    setError(null);
    setShowDeletePrompt(false);

    try {
      const convertResult = await invoke('convert_webp_to_png', {
        folderPath: selectedFolder
      });

      setResult(convertResult);
      if (convertResult.converted > 0) {
        setShowDeletePrompt(true);
      }
    } catch (err) {
      setError('Ошибка конвертации: ' + err);
    } finally {
      setIsConverting(false);
    }
  }, [selectedFolder]);

  // Конвертация одного файла
  const handleConvertFile = useCallback(async () => {
    if (!selectedFile) {
      setError('Пожалуйста, выберите файл');
      return;
    }

    setIsConverting(true);
    setError(null);
    setResult(null);

    try {
      // Сохраняем файл во временное место
      const tempPath = await tempDir();
      const fileName = selectedFile.name;
      // Убираем завершающий слеш если есть и правильно объединяем пути
      const normalizedTempPath = tempPath.replace(/[/\\]$/, '');
      const tempFilePath = `${normalizedTempPath}${normalizedTempPath.includes('\\') ? '\\' : '/'}${fileName}`;
      
      const fileData = await selectedFile.arrayBuffer();
      await writeFile(tempFilePath, new Uint8Array(fileData));

      // Конвертируем файл
      const pngPath = await invoke('convert_single_webp_to_png', {
        filePath: tempFilePath
      });

      // Читаем конвертированный файл
      const pngData = await readFile(pngPath);
      const blob = new Blob([pngData], { type: 'image/png' });
      const url = URL.createObjectURL(blob);

      setResult({ 
        converted: 1, 
        failed: 0, 
        errors: [],
        pngUrl: url,
        pngPath: pngPath
      });
    } catch (err) {
      setError('Ошибка конвертации: ' + err);
    } finally {
      setIsConverting(false);
    }
  }, [selectedFile]);

  const handleDelete = useCallback(async () => {
    if (!selectedFolder) return;

    setDeleting(true);
    try {
      const deleted = await invoke('delete_webp_files', {
        folderPath: selectedFolder
      });
      setShowDeletePrompt(false);
      setResult(prev => ({ ...prev, deleted }));
    } catch (err) {
      setError('Ошибка удаления: ' + err);
    } finally {
      setDeleting(false);
    }
  }, [selectedFolder]);

  // Скачивание одного файла
  const handleDownloadFile = useCallback(async () => {
    if (!result?.pngUrl) return;

    try {
      const response = await fetch(result.pngUrl);
      const blob = await response.blob();

      const fileName = selectedFile?.name.replace(/\.webp$/i, '.png') || 'converted.png';
      const filePath = await save({
        filters: [{
          name: 'PNG Images',
          extensions: ['png']
        }],
        defaultPath: fileName
      });

      if (filePath) {
        const arrayBuffer = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));
        alert('Файл успешно сохранен!');
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') {
        console.error('Ошибка скачивания:', err);
        setError('Ошибка при сохранении файла: ' + (err.message || err));
      }
    }
  }, [result, selectedFile]);

  return (
    <div id="page-utility-webp-to-png" className="page utility-page active">
      <div className="utility-header">
        <button className="back-btn" onClick={handleBackToTools}>
          ← Назад к утилитам
        </button>
        <h2>WebP → PNG Конвертер</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Конвертирует WebP изображения в PNG. Выберите папку для массовой конвертации или один файл для конвертации и скачивания.
          </p>
          
          <div className="tool-content">
            {/* Кнопка выбора папки - показывается когда нет выбранного файла и нет выбранной папки */}
            {!selectedFile && !selectedFolder && (
              <div style={{ marginBottom: '1rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSelectFolderClick}
                  style={{ width: '100%' }}
                >
                  📁 Выберите папку
                </button>
              </div>
            )}

            {/* Дропзона для папки - показывается когда папка выбрана и нет выбранного файла */}
            {!selectedFile && selectedFolder && (
              <div className="folder-selector">
                <div
                  ref={folderDropzoneRef}
                  className={`selected-folder has-folder ${isDraggingFolder ? 'drag-over' : ''}`}
                  onClick={handleSelectFolderClick}
                  data-dropzone="true"
                >
                  <span className="folder-path">{selectedFolder}</span>
                  <button 
                    className="clear-folder-btn" 
                    onClick={handleClear}
                    title="Очистить"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Дропзона для файла - показывается когда нет выбранной папки */}
            {!selectedFolder && (
              <div className="folder-selector">
                <div
                  ref={fileDropzoneRef}
                  className={`selected-folder ${selectedFile ? 'has-folder' : ''} ${isDraggingFile ? 'drag-over' : ''}`}
                  onClick={handleFileClick}
                  onDragOver={handleFileDragOver}
                  onDragLeave={handleFileDragLeave}
                  onDrop={handleFileDrop}
                  data-dropzone="true"
                >
                  {selectedFile ? (
                    <>
                      <span className="folder-path">{selectedFile.name}</span>
                      <button 
                        className="clear-folder-btn" 
                        onClick={handleClear}
                        title="Очистить"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <div className="dropzone-placeholder">
                      Перетащите WebP файл сюда или кликните для выбора
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Кнопка конвертации */}
            {(selectedFolder || selectedFile) && (
              <button
                id="convertBtn"
                className="btn btn-success"
                disabled={isConverting}
                onClick={selectedFolder ? handleConvertFolder : handleConvertFile}
                style={{ width: '100%', marginTop: '1rem' }}
              >
                🔄 Конвертировать
              </button>
            )}
            
            {isConverting && (
              <div className="progress">
                <div className="progress-bar"></div>
                <span className="progress-text">Конвертация...</span>
              </div>
            )}
            
            {error && (
              <div className="results error">
                <div className="result-title" style={{ color: 'var(--error)' }}>
                  Ошибка
                </div>
                <p>{error}</p>
              </div>
            )}
            
            {result && (
              <div className={`results ${result.failed === 0 ? 'success' : 'error'}`}>
                <div className="result-title">Результаты конвертации</div>
                {selectedFile ? (
                  // Результат для одного файла
                  <div>
                    <div className="result-stats">
                      <div className="stat">
                        <span className="stat-label">Конвертировано</span>
                        <span className="stat-value success">{result.converted}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-success"
                      onClick={handleDownloadFile}
                      style={{ width: '100%', marginTop: '1rem' }}
                    >
                      💾 Скачать PNG
                    </button>
                  </div>
                ) : (
                  // Результат для папки
                  <>
                    <div className="result-stats">
                      <div className="stat">
                        <span className="stat-label">Конвертировано</span>
                        <span className="stat-value success">{result.converted}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Ошибок</span>
                        <span className="stat-value error">{result.failed}</span>
                      </div>
                    </div>
                    {result.errors && result.errors.length > 0 && (
                      <div className="errors-list">
                        <h4>Ошибки:</h4>
                        {result.errors.map((err, idx) => (
                          <div key={idx} className="error-item">{err}</div>
                        ))}
                      </div>
                    )}
                    {result.deleted !== undefined && (
                      <p style={{ color: 'var(--success)' }}>
                        ✓ Удалено {result.deleted} WebP файл(ов)
                      </p>
                    )}
                    {showDeletePrompt && (
                      <div className="delete-prompt">
                        <p>Конвертировано {result.converted} файл(ов). Удалить исходные WebP файлы?</p>
                        <div className="delete-buttons">
                          <button
                            className="btn btn-danger"
                            onClick={handleDelete}
                            disabled={deleting}
                          >
                            {deleting ? 'Удаление...' : 'Да, удалить'}
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => setShowDeletePrompt(false)}
                          >
                            Нет, оставить
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
