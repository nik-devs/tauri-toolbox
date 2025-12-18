import { useState, useCallback, useRef } from 'react';
import { useApp } from '../../contexts/AppContext';
import { invoke, openFolderDialog } from '../../hooks/useTauri';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export default function WebPToPNG() {
  const { handleBackToTools } = useApp();
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dropzoneRef = useRef(null);

  const handleFolderSelect = useCallback(async (path) => {
    if (!path) return;
    
    try {
      const isDir = await invoke('check_path_is_directory', { path });
      if (isDir) {
        setSelectedFolder(path);
        setError(null);
      } else {
        // Если это файл, берем родительскую папку
        const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
        if (lastSlash > 0) {
          setSelectedFolder(path.substring(0, lastSlash));
          setError(null);
        } else {
          setError('Пожалуйста, перетащите папку, а не файл');
        }
      }
    } catch (err) {
      console.error('Ошибка проверки пути:', err);
      setError('Ошибка обработки пути: ' + (err.message || err));
    }
  }, []);

  const { isDragging } = useDragAndDrop(handleFolderSelect);

  const handleClick = useCallback(async (e) => {
    if (e.target.closest('.clear-folder-btn') || e.target.closest('.folder-path')) {
      return;
    }
    
    try {
      const path = await openFolderDialog();
      if (path) {
        handleFolderSelect(path);
      }
    } catch (err) {
      console.error('Ошибка выбора папки:', err);
      setError('Ошибка выбора папки: ' + (err.message || err));
    }
  }, [handleFolderSelect]);

  const handleClear = useCallback((e) => {
    e.stopPropagation();
    setSelectedFolder(null);
    setResult(null);
    setError(null);
    setShowDeletePrompt(false);
  }, []);

  const handleConvert = useCallback(async () => {
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
            Конвертирует все WebP изображения в PNG в выбранной папке
          </p>
          
          <div className="tool-content">
            <div className="folder-selector">
              <div
                ref={dropzoneRef}
                className={`selected-folder ${selectedFolder ? 'has-folder' : ''} ${isDragging ? 'drag-over' : ''}`}
                onClick={handleClick}
                data-dropzone="true"
              >
                {selectedFolder ? (
                  <>
                    <span className="folder-path">{selectedFolder}</span>
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
                    Перетащите папку сюда или кликните для выбора
                  </div>
                )}
              </div>
            </div>
            
            <button
              id="convertBtn"
              className="btn btn-success"
              disabled={!selectedFolder || isConverting}
              onClick={handleConvert}
            >
              🔄 Конвертировать
            </button>
            
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
