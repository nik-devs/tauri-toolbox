import { useState, useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { save } from '@tauri-apps/plugin-dialog';
import { showNotification } from '../../utils/notifications';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'];

export default function ExtractSound() {
  const { handleBackToTools } = useApp();
  const [inputPath, setInputPath] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  const handleSelectFile = useCallback(async () => {
    try {
      const path = await openFileDialog({
        filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }]
      });
      if (path) {
        setInputPath(path);
        setError(null);
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') setError(err?.message || 'Ошибка выбора файла');
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (!inputPath) {
      setError('Выберите видеофайл');
      return;
    }
    let outputPath;
    try {
      outputPath = await save({
        filters: [{ name: 'WAV', extensions: ['wav'] }],
        defaultPath: inputPath.replace(/\.[^.]+$/, '') + '.wav'
      });
    } catch (err) {
      if (err === 'User cancelled the dialog' || err?.message?.includes('cancel')) return;
      setError(err?.message || 'Ошибка выбора файла сохранения');
      return;
    }
    if (!outputPath) return;
    setIsProcessing(true);
    setError(null);
    try {
      await invoke('ffmpeg_extract_sound', { inputPath, outputPath });
      showNotification(`Звук сохранён: ${outputPath}`, 'success');
    } catch (err) {
      setError(err?.message || err || 'Ошибка ffmpeg');
    } finally {
      setIsProcessing(false);
    }
  }, [inputPath]);

  const handleClear = useCallback(() => {
    setInputPath(null);
    setError(null);
  }, []);

  return (
    <div id="page-utility-extract-sound" className="page utility-page active">
      <div className="utility-header">
        <button className="back-btn" onClick={handleBackToTools}>← Назад к утилитам</button>
        <h2>Извлечь звук из видео</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Извлечение аудиодорожки из видео в WAV (PCM 16-bit).
          </p>
          <div className="tool-content">
            <div className="folder-selector">
              <div
                className={`selected-folder ${inputPath ? 'has-folder' : ''}`}
                onClick={handleSelectFile}
                style={{ cursor: 'pointer' }}
              >
                {inputPath ? (
                  <>
                    <span className="folder-path">{inputPath.split(/[/\\]/).pop()}</span>
                    <button type="button" className="clear-folder-btn" onClick={(e) => { e.stopPropagation(); handleClear(); }} title="Очистить">✕</button>
                  </>
                ) : (
                  <div className="dropzone-placeholder">Выберите видеофайл</div>
                )}
              </div>
            </div>
            {inputPath && (
              <button
                className="btn btn-primary"
                disabled={isProcessing}
                onClick={handleRun}
                style={{ width: '100%', marginTop: '1rem' }}
              >
                {isProcessing ? 'Обработка...' : 'Извлечь звук'}
              </button>
            )}
            {error && (
              <div className="results error" style={{ marginTop: '1rem' }}>
                <div className="result-title" style={{ color: 'var(--error)' }}>Ошибка</div>
                <p>{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
