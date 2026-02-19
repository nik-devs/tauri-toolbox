import { useState, useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { save } from '@tauri-apps/plugin-dialog';
import { showNotification } from '../../utils/notifications';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac'];

export default function OverlaySoundOnVideo() {
  const { handleBackToTools } = useApp();
  const [videoPath, setVideoPath] = useState(null);
  const [audioPath, setAudioPath] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  const handleSelectVideo = useCallback(async () => {
    try {
      const path = await openFileDialog({
        filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }]
      });
      if (path) {
        setVideoPath(path);
        setError(null);
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') setError(err?.message || 'Ошибка выбора файла');
    }
  }, []);

  const handleSelectAudio = useCallback(async () => {
    try {
      const path = await openFileDialog({
        filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
      });
      if (path) {
        setAudioPath(path);
        setError(null);
      }
    } catch (err) {
      if (err !== 'User cancelled the dialog') setError(err?.message || 'Ошибка выбора файла');
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (!videoPath) {
      setError('Выберите видеофайл');
      return;
    }
    if (!audioPath) {
      setError('Выберите аудиофайл');
      return;
    }
    let outputPath;
    try {
      outputPath = await save({
        filters: [{ name: 'Video', extensions: ['mp4'] }],
        defaultPath: (videoPath.replace(/\.[^.]+$/, '') || 'output') + '_with_audio.mp4'
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
      await invoke('ffmpeg_overlay_sound', {
        videoPath,
        audioPath,
        outputPath
      });
      showNotification(`Файл сохранён: ${outputPath}`, 'success');
    } catch (err) {
      setError(err?.message || err || 'Ошибка ffmpeg');
    } finally {
      setIsProcessing(false);
    }
  }, [videoPath, audioPath]);

  const handleClear = useCallback(() => {
    setVideoPath(null);
    setAudioPath(null);
    setError(null);
  }, []);

  return (
    <div id="page-utility-overlay-sound" className="page utility-page active">
      <div className="utility-header">
        <button className="back-btn" onClick={handleBackToTools}>← Назад к утилитам</button>
        <h2>Наложить звук на видео</h2>
      </div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Замена или добавление аудиодорожки к видео. Видео копируется без перекодирования, звук конвертируется в AAC.
          </p>
          <div className="tool-content">
            <div className="folder-selector" style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>Видео</label>
              <div
                className={`selected-folder ${videoPath ? 'has-folder' : ''}`}
                onClick={handleSelectVideo}
                style={{ cursor: 'pointer' }}
              >
                {videoPath ? (
                  <>
                    <span className="folder-path">{videoPath.split(/[/\\]/).pop()}</span>
                    <button type="button" className="clear-folder-btn" onClick={(e) => { e.stopPropagation(); setVideoPath(null); setError(null); }} title="Очистить">✕</button>
                  </>
                ) : (
                  <div className="dropzone-placeholder">Выберите видео</div>
                )}
              </div>
            </div>
            <div className="folder-selector">
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>Аудио</label>
              <div
                className={`selected-folder ${audioPath ? 'has-folder' : ''}`}
                onClick={handleSelectAudio}
                style={{ cursor: 'pointer' }}
              >
                {audioPath ? (
                  <>
                    <span className="folder-path">{audioPath.split(/[/\\]/).pop()}</span>
                    <button type="button" className="clear-folder-btn" onClick={(e) => { e.stopPropagation(); setAudioPath(null); setError(null); }} title="Очистить">✕</button>
                  </>
                ) : (
                  <div className="dropzone-placeholder">Выберите аудио (WAV, MP3 и т.д.)</div>
                )}
              </div>
            </div>
            {videoPath && audioPath && (
              <button
                className="btn btn-primary"
                disabled={isProcessing}
                onClick={handleRun}
                style={{ width: '100%', marginTop: '1rem' }}
              >
                {isProcessing ? 'Обработка...' : 'Наложить звук'}
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
