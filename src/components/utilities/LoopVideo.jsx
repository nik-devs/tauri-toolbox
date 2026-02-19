import { useState, useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { showNotification } from '../../utils/notifications';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];

function outputPathForLoop(inputPath) {
  const lastDot = inputPath.lastIndexOf('.');
  const base = lastDot > 0 ? inputPath.slice(0, lastDot) : inputPath;
  const ext = lastDot > 0 ? inputPath.slice(lastDot) : '.mp4';
  return `${base}_loop${ext}`;
}

export default function LoopVideo() {
  const { handleBackToTools } = useApp();
  const [inputPath, setInputPath] = useState(null);
  const [mode, setMode] = useState('duration');
  const [duration, setDuration] = useState('03:00:00');
  const [loopCount, setLoopCount] = useState(3);
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
    if (mode === 'duration' && !duration?.trim()) {
      setError('Укажите длительность (например 03:00:00 или 1:30)');
      return;
    }
    if (mode === 'loops' && (!loopCount || loopCount < 1)) {
      setError('Укажите количество циклов (≥ 1)');
      return;
    }
    const outputPath = outputPathForLoop(inputPath);
    setIsProcessing(true);
    setError(null);
    try {
      await invoke('ffmpeg_loop_video', {
        inputPath,
        outputPath,
        mode,
        duration: mode === 'duration' ? duration.trim() : null,
        loopCount: mode === 'loops' ? loopCount : null
      });
      showNotification(`Файл сохранён: ${outputPath}`, 'success');
    } catch (err) {
      setError(err?.message || err || 'Ошибка ffmpeg');
    } finally {
      setIsProcessing(false);
    }
  }, [inputPath, mode, duration, loopCount]);

  const handleClear = useCallback(() => {
    setInputPath(null);
    setDuration('03:00:00');
    setLoopCount(3);
    setError(null);
  }, []);

  return (
    <div id="page-utility-loop-video" className="page utility-page active">
      <div className="utility-header">
        <button className="back-btn" onClick={handleBackToTools}>← Назад к утилитам</button>
        <h2>Зациклить видео</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Зацикливание видео: по длительности или по количеству циклов. Выходной файл — с суффиксом _loop в той же папке.
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
              <>
                <div className="settings-control" style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Режим</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    disabled={isProcessing}
                    className="form-input"
                    style={{ width: '100%' }}
                  >
                    <option value="duration">По длительности</option>
                    <option value="loops">По количеству циклов</option>
                  </select>
                </div>
                {mode === 'duration' && (
                  <div className="settings-control" style={{ marginTop: '0.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Длительность (чч:мм:сс или мм:сс)</label>
                    <input
                      type="text"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      disabled={isProcessing}
                      placeholder="03:00:00"
                      className="form-input"
                      style={{ width: '100%' }}
                    />
                  </div>
                )}
                {mode === 'loops' && (
                  <div className="settings-control" style={{ marginTop: '0.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Количество циклов</label>
                    <input
                      type="number"
                      min={1}
                      value={loopCount}
                      onChange={(e) => setLoopCount(parseInt(e.target.value, 10) || 1)}
                      disabled={isProcessing}
                      className="form-input"
                      style={{ width: '100%' }}
                    />
                  </div>
                )}
                <button
                  className="btn btn-primary"
                  disabled={isProcessing}
                  onClick={handleRun}
                  style={{ width: '100%', marginTop: '1rem' }}
                >
                  {isProcessing ? 'Обработка...' : 'Зациклить'}
                </button>
              </>
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
