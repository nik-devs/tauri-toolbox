import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { useTabsState } from '../../contexts/TabsStateContext';
import { useTasks } from '../../contexts/TasksContext';
import { generateTimestamp } from '../../utils/fileUtils';
import { showNotification } from '../../utils/notifications';
import {
  ASPECT_PRESETS, DEFAULT_ASPECT, MAX_SECONDS, FPS, secondsToFrames,
  UNET, LORAS, buildWorkflow, runpodRunVideo, grokBuildPrompt,
} from '../../utils/h3';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.heic', '.heif'];
const DIALOG_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif'];
const MIME_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp', '.heic': 'image/heic', '.heif': 'image/heif' };
const HEIC_EXTS = ['.heic', '.heif'];

function isHeic(name, mime) {
  const ext = name ? name.substring(name.lastIndexOf('.')).toLowerCase() : '';
  return HEIC_EXTS.includes(ext) || /heic|heif/i.test(mime || '');
}

// The worker's Pillow can't read HEIC; WKWebView decodes it natively, so we
// re-encode any HEIC/HEIF to PNG in-app via canvas before upload.
async function blobToPng(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Не удалось декодировать HEIC'));
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const dataUri = canvas.toDataURL('image/png');
    return { dataUri, base64: dataUri.split(',')[1] || '' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const TOOL_META = {
  fl2va: {
    title: 'MiniMax H3 — Text/Image → Video',
    endpointKey: 'Fl2vaEndpoint',
    maxImages: 2,
    imagesHint: 'Опционально: 1–2 кадра. Первый — стартовый кадр, второй — финальный. Без кадров — чистый text-to-video.',
  },
  ref2va: {
    title: 'MiniMax H3 — Reference → Video',
    endpointKey: 'Ref2vaEndpoint',
    maxImages: 3,
    imagesHint: 'Опционально: до 3 референс-изображений (Image 1, Image 2 …). Всё необязательно — можно и без референсов.',
  },
};

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default function H3VideoTool({ tool, tabId = `h3-${tool}-${Date.now()}`, isActive = true }) {
  const meta = TOOL_META[tool];
  const { getTabState, updateTabState, setTabState } = useTabsState();
  const { addTask, updateTask, tasks } = useTasks();

  const saved = getTabState(tabId) || {};
  const [description, setDescription] = useState(saved.description || '');
  const [generatedPrompt, setGeneratedPrompt] = useState(saved.generatedPrompt || '');
  const [aspect, setAspect] = useState(saved.aspect || DEFAULT_ASPECT);
  const [durationSeconds, setDurationSeconds] = useState(saved.durationSeconds ?? 5);
  const [enabledLoras, setEnabledLoras] = useState(saved.enabledLoras || {});
  const [visionEnabled, setVisionEnabled] = useState(saved.visionEnabled || false);
  const [images, setImages] = useState([]); // {name, mime, base64, dataUri}
  const [isDragging, setIsDragging] = useState(false);
  const dropzoneRef = useRef(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [resultUrl, setResultUrl] = useState(saved.resultUrl || null);
  const [error, setError] = useState(null);
  const currentTaskIdRef = useRef(saved.taskId || null);
  const abortRef = useRef(null);

  // Persist form state (not the in-memory image bytes).
  useEffect(() => {
    updateTabState(tabId, {
      description, generatedPrompt, aspect, durationSeconds, enabledLoras, visionEnabled,
      resultUrl, taskId: currentTaskIdRef.current,
    });
  }, [description, generatedPrompt, aspect, durationSeconds, enabledLoras, visionEnabled, resultUrl, tabId, updateTabState]);

  // Sync with background task.
  useEffect(() => {
    if (!currentTaskIdRef.current) return;
    const task = tasks.find((t) => t.id === currentTaskIdRef.current);
    if (!task) return;
    if (task.status === 'completed' && task.resultUrl && resultUrl !== task.resultUrl) {
      setResultUrl(task.resultUrl);
      setIsProcessing(false);
    } else if (task.status === 'failed' && !error) {
      setError(task.error || 'Ошибка задачи');
      setIsProcessing(false);
    }
  }, [tasks, resultUrl, error]);

  const frames = secondsToFrames(durationSeconds);
  const realSeconds = (frames / FPS);

  const loadSettings = useCallback(async () => {
    try { return await invoke('load_settings'); } catch { return { api_keys: {} }; }
  }, []);

  const addImage = useCallback((img) => {
    setError(null);
    setImages((prev) => {
      if (prev.length >= meta.maxImages) {
        setError(`Максимум ${meta.maxImages} изобр. для этого инструмента`);
        return prev;
      }
      return [...prev, img];
    });
  }, [meta.maxImages]);

  // From a browser File (drag-drop): keep bytes in memory; HEIC → PNG.
  const addFromFile = useCallback(async (file) => {
    const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (!file.type?.startsWith('image/') && !IMAGE_EXTENSIONS.includes(ext)) {
      setError('Поддерживаются только изображения'); return;
    }
    try {
      const baseName = (file.name || `image${ext || '.png'}`);
      if (isHeic(baseName, file.type)) {
        const { dataUri, base64 } = await blobToPng(file);
        addImage({ name: baseName.replace(/\.(heic|heif)$/i, '.png'), mime: 'image/png', base64, dataUri });
        return;
      }
      const dataUri = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = (e) => resolve(e.target.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      addImage({ name: baseName, mime: file.type || MIME_TYPES[ext] || 'image/png', base64: dataUri.split(',')[1] || '', dataUri });
    } catch (err) {
      setError('Ошибка обработки файла: ' + (err.message || err));
    }
  }, [addImage]);

  // From a filesystem path (file dialog): read bytes; HEIC → PNG.
  const addFromPath = useCallback(async (path) => {
    const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) { setError('Поддерживаются только изображения'); return; }
    const bytes = await readFile(path);
    const name = path.split(/[/\\]/).pop();
    if (isHeic(name, '')) {
      const { dataUri, base64 } = await blobToPng(new Blob([bytes], { type: 'image/heic' }));
      addImage({ name: name.replace(/\.(heic|heif)$/i, '.png'), mime: 'image/png', base64, dataUri });
      return;
    }
    const mime = MIME_TYPES[ext] || 'image/png';
    const base64 = bytesToBase64(bytes);
    addImage({ name, mime, base64, dataUri: `data:${mime};base64,${base64}` });
  }, [addImage]);

  const handleAttach = useCallback(async () => {
    try {
      const path = await openFileDialog({ filters: [{ name: 'Images', extensions: DIALOG_EXTENSIONS }] });
      if (path) await addFromPath(path);
    } catch (err) {
      if (err !== 'User cancelled the dialog') setError('Ошибка выбора файла: ' + (err.message || err));
    }
  }, [addFromPath]);

  const handleDragOver = useCallback((e) => { if (!isActive) return; e.preventDefault(); e.stopPropagation(); setIsDragging(true); }, [isActive]);
  const handleDragLeave = useCallback((e) => {
    if (!isActive) return; e.preventDefault(); e.stopPropagation();
    if (!dropzoneRef.current?.contains(e.relatedTarget)) setIsDragging(false);
  }, [isActive]);
  const handleDrop = useCallback((e) => {
    if (!isActive) return; e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    files.forEach((f) => addFromFile(f));
  }, [isActive, addFromFile]);

  const handleRemoveImage = useCallback((i) => setImages((prev) => prev.filter((_, idx) => idx !== i)), []);

  const toggleLora = useCallback((id) => setEnabledLoras((p) => ({ ...p, [id]: !p[id] })), []);

  // Attached images, renamed to stable ref filenames for the worker upload.
  const readImages = useCallback(async () => images.map((img, i) => {
    const ext = img.name.substring(img.name.lastIndexOf('.')) || '.png';
    return { name: `ref${i}${ext}`, base64: img.base64, dataUri: img.dataUri };
  }), [images]);

  const handleBuildPrompt = useCallback(async () => {
    if (!description.trim()) { setError('Введите описание сцены'); return; }
    setIsBuilding(true); setError(null);
    try {
      const settings = await loadSettings();
      const visionImgs = visionEnabled ? (await readImages()).map((x) => x.dataUri) : [];
      const prompt = await grokBuildPrompt({ tool, description, settings, enabledLoras, images: visionImgs });
      setGeneratedPrompt(prompt);
    } catch (err) {
      setError('Grok: ' + (err.message || String(err)));
    } finally {
      setIsBuilding(false);
    }
  }, [description, visionEnabled, enabledLoras, tool, loadSettings, readImages]);

  const handleGenerate = useCallback(async () => {
    const finalPrompt = (generatedPrompt || description).trim();
    if (!finalPrompt) { setError('Нужен промпт или описание'); return; }

    const settings = await loadSettings();
    const ak = settings.api_keys || {};
    const endpoint = ak[meta.endpointKey];
    const apiKey = ak.RunPod;
    if (!endpoint) { setError('Не задан эндпоинт для этого инструмента (в настройках).'); return; }
    if (!apiKey) { setError('Не задан ключ RunPod в настройках.'); return; }

    const preset = ASPECT_PRESETS.find((p) => p.id === aspect) || ASPECT_PRESETS[0];
    const loraFiles = LORAS.filter((l) => enabledLoras[l.id]).flatMap((l) => l.files);

    // Attach images. fl2va: first → first_frame, second → last_frame.
    // ref2va: all (up to 3) → ref_image_0..N.
    const uploaded = await readImages();
    const inputImages = uploaded.map((u) => ({ name: u.name, image: u.base64 }));

    const workflow = buildWorkflow({
      tool,
      unetFile: UNET[tool],
      prompt: finalPrompt,
      width: preset.width, height: preset.height,
      length: frames, steps: 20,
      seed: Math.floor(Math.random() * 2 ** 31),
      firstFrameName: tool === 'fl2va' ? uploaded[0]?.name : undefined,
      lastFrameName: tool === 'fl2va' ? uploaded[1]?.name : undefined,
      refImageNames: tool === 'ref2va' ? uploaded.map((u) => u.name) : [],
      loras: loraFiles,
    });

    const taskId = addTask({ type: `h3-${tool}`, title: `${meta.title}`, status: 'running', progress: 0, tabId });
    currentTaskIdRef.current = taskId;
    setIsProcessing(true); setError(null); setResultUrl(null); setProgressText('Отправка…');
    abortRef.current = new AbortController();

    try {
      const b64 = await runpodRunVideo({
        endpoint, apiKey, workflow,
        images: inputImages.length ? inputImages : undefined,
        signal: abortRef.current.signal,
        onProgress: (pct, text) => { setProgressText(text); updateTask(taskId, { progress: pct, status: 'running' }); },
      });
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: 'video/mp4' }));
      setResultUrl(url);
      updateTask(taskId, { progress: 100, status: 'completed', resultUrl: url });
    } catch (err) {
      const msg = err.message || String(err);
      setError(msg);
      updateTask(taskId, { status: 'failed', error: msg });
    } finally {
      setIsProcessing(false);
    }
  }, [generatedPrompt, description, aspect, durationSeconds, enabledLoras, images, tool, meta, frames, addTask, updateTask, tabId, loadSettings, readImages]);

  const handleCancel = useCallback(() => { abortRef.current?.abort(); setIsProcessing(false); }, []);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const blob = await (await fetch(resultUrl)).blob();
      const filePath = await save({ filters: [{ name: 'Videos', extensions: ['mp4'] }], defaultPath: `h3-${tool}-${generateTimestamp()}.mp4` });
      if (filePath) {
        await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
        showNotification('Видео сохранено', 'success');
      }
    } catch (err) {
      setError('Ошибка сохранения: ' + (err.message || err));
    }
  }, [resultUrl, tool]);

  const handleClear = useCallback(() => {
    setDescription(''); setGeneratedPrompt(''); setImages([]); setResultUrl(null); setError(null);
    setEnabledLoras({}); setVisionEnabled(false); setAspect(DEFAULT_ASPECT); setDurationSeconds(5);
    currentTaskIdRef.current = null;
    setTabState(tabId, {});
  }, [tabId, setTabState]);

  return (
    <div id={`page-utility-h3-${tool}-${tabId}`} className={`page utility-page ${isActive ? 'active' : ''}`}>
      <div className="utility-header"><h2>{meta.title}</h2></div>
      <div className="utility-content">
        <div className="tool-card">
          <p className="tool-description">
            Видео со звуком через MiniMax H3. Опиши сцену на любом языке — Grok соберёт английский промпт.
          </p>

          {/* Описание */}
          <div className="settings-control" style={{ marginTop: 10 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>Описание сцены (любой язык)</label>
            <textarea className="form-input" rows={3} value={description} disabled={isProcessing}
              onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', resize: 'vertical' }}
              placeholder="Например: брюнетка в летнем платье сидит на стоге сена, тёплый закатный свет, щебет птиц" />
          </div>

          {/* Прикреплённые материалы */}
          <div className="settings-control" style={{ marginTop: 12 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Материалы (опционально)</label>
            <p style={{ fontSize: '0.8em', color: 'var(--text-secondary)', marginBottom: 8 }}>{meta.imagesHint}</p>
            <div
              ref={dropzoneRef}
              className={`selected-folder ${images.length > 0 ? 'has-folder' : ''} ${isDragging && isActive ? 'drag-over' : ''}`}
              onClick={isActive && !isProcessing ? handleAttach : undefined}
              onDragOver={isActive ? handleDragOver : undefined}
              onDragLeave={isActive ? handleDragLeave : undefined}
              onDrop={isActive ? handleDrop : undefined}
              data-dropzone="true"
            >
              <div className="dropzone-placeholder">
                {images.length >= meta.maxImages
                  ? `Достигнут максимум (${meta.maxImages})`
                  : `Перетащите изображение сюда или кликните для выбора (до ${meta.maxImages})`}
              </div>
            </div>
            {images.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                {images.map((img, i) => (
                  <div key={i} style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 6, padding: 6 }}>
                    <img src={img.dataUri} alt={`ref ${i + 1}`} style={{ maxWidth: 120, maxHeight: 120, display: 'block' }} />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {tool === 'fl2va' ? (i === 0 ? 'Start frame' : i === 1 ? 'End frame' : `Image ${i + 1}`) : `Image ${i + 1}`}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); handleRemoveImage(i); }} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,0,0,0.8)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {images.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '0.9em' }}>
                <input type="checkbox" checked={visionEnabled} onChange={(e) => setVisionEnabled(e.target.checked)} disabled={isProcessing} />
                Grok смотрит на приложенные материалы (vision) при сборке промпта
              </label>
            )}
          </div>

          {/* Лоры */}
          <div className="settings-control" style={{ marginTop: 12 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>LoRA</label>
            {LORAS.map((l) => (
              <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9em', marginBottom: 4 }}>
                <input type="checkbox" checked={!!enabledLoras[l.id]} onChange={() => toggleLora(l.id)} disabled={isProcessing} />
                {l.label}
              </label>
            ))}
            <p style={{ fontSize: '0.78em', color: 'var(--text-secondary)' }}>
              Включённая лора добавляет свои правила промптинга в инструкцию Grok (текст — в настройках).
            </p>
          </div>

          {/* Grok build */}
          <div className="settings-control" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleBuildPrompt} disabled={isBuilding || isProcessing || !description.trim()}>
              {isBuilding ? '⏳ Grok собирает…' : (generatedPrompt ? '🔁 Пересобрать промпт (Grok)' : '✨ Build prompt (Grok)')}
            </button>
          </div>
          {generatedPrompt && (
            <div className="settings-control" style={{ marginTop: 10 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Промпт для H3 (можно править)</label>
              <textarea className="form-input" rows={5} value={generatedPrompt} disabled={isProcessing}
                onChange={(e) => setGeneratedPrompt(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
            </div>
          )}

          {/* Формат + длительность */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <div className="settings-control" style={{ flex: '1 1 240px' }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Формат / размер</label>
              <select className="form-input" value={aspect} onChange={(e) => setAspect(e.target.value)} disabled={isProcessing}>
                {ASPECT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="settings-control" style={{ flex: '1 1 240px' }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Длительность: {realSeconds.toFixed(1)} сек ({frames} кадров)
              </label>
              <input type="range" min="1" max={MAX_SECONDS} step="0.5" value={durationSeconds}
                onChange={(e) => setDurationSeconds(parseFloat(e.target.value))} disabled={isProcessing} style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: 'var(--text-secondary)' }}>
                <span>1 сек</span><span>{MAX_SECONDS} сек (макс. модели)</span>
              </div>
            </div>
          </div>

          {!resultUrl && (
            <button className="btn btn-success" style={{ marginTop: 14 }} onClick={handleGenerate} disabled={isProcessing || (!generatedPrompt && !description.trim())}>
              🎬 Сгенерировать видео
            </button>
          )}

          {isProcessing && (
            <div className="progress" style={{ marginTop: 12 }}>
              <div className="progress-bar"></div>
              <span className="progress-text">{progressText || 'Генерация…'}</span>
              <button className="btn btn-secondary" onClick={handleCancel} style={{ marginLeft: 10 }}>Отмена</button>
            </div>
          )}

          {resultUrl && (
            <div className="result-section" style={{ marginTop: 14 }}>
              <h3>Результат</h3>
              <div className="video-preview-container">
                <video src={resultUrl} controls style={{ maxWidth: '100%', maxHeight: 500 }} />
              </div>
              <button className="btn btn-primary" onClick={handleDownload}>⬇️ Скачать видео</button>
              <button className="btn btn-secondary" onClick={handleClear} style={{ marginLeft: 10 }}>Очистить</button>
            </div>
          )}

          {error && <div className="error-message" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
