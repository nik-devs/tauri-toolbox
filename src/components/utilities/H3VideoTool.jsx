import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, openFileDialog } from '../../hooks/useTauri';
import { readFile, writeFile, remove } from '@tauri-apps/plugin-fs';
import { tempDir, join } from '@tauri-apps/api/path';
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
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
const MIME_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp', '.heic': 'image/heic', '.heif': 'image/heif' };

function extOf(name) { return name ? name.substring(name.lastIndexOf('.')).toLowerCase() : ''; }
function kindOf(name, mime) {
  const ext = extOf(name);
  if (IMAGE_EXTENSIONS.includes(ext) || (mime || '').startsWith('image/')) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext) || (mime || '').startsWith('video/')) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext) || (mime || '').startsWith('audio/')) return 'audio';
  return null;
}

// Normalize any input image to a compact JPEG: downscale to maxDim (RunPod caps
// the /run body at 10 MiB, and the worker center-crops to ≤1344×768 anyway, so
// a 12 MP iPhone photo is pointless) and re-encode. WKWebView decodes HEIC
// natively, so this also handles HEIC/HEIF — no lossless PNG blow-up.
async function normalizeImage(blob, { maxDim = 1600, quality = 0.9 } = {}) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Не удалось декодировать изображение (HEIC?)'));
      im.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // flatten alpha for JPEG
    ctx.drawImage(img, 0, 0, w, h);
    const dataUri = canvas.toDataURL('image/jpeg', quality);
    return { dataUri, base64: dataUri.split(',')[1] || '' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const TOOL_META = {
  fl2va: {
    title: 'MiniMax H3 — Text/Image → Video',
    endpointKey: 'Fl2vaEndpoint',
    kinds: ['image'],
    limits: { image: 2 },
    dialogExtensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif'],
    imagesHint: 'Опционально: 1–2 кадра. Первый — стартовый кадр, второй — финальный. Без кадров — чистый text-to-video.',
  },
  ref2va: {
    title: 'MiniMax H3 — Reference → Video',
    endpointKey: 'Ref2vaEndpoint',
    kinds: ['image', 'video', 'audio'],
    limits: { image: 3, video: 3, audio: 3 },
    dialogExtensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif', 'mp4', 'mov', 'webm', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
    imagesHint: 'Опционально: до 3 картинок + до 3 видео (со своим звуком) + до 3 аудио. Всё необязательно.',
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
  // {kind, name, mime, base64, dataUri?} — kept in tab state so materials
  // survive tab switches / remounts (the store is an in-memory Map).
  const [images, setImages] = useState(saved.images || []);
  const [isDragging, setIsDragging] = useState(false);
  const dropzoneRef = useRef(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [resultUrl, setResultUrl] = useState(saved.resultUrl || null);
  const [error, setError] = useState(null);
  const currentTaskIdRef = useRef(saved.taskId || null);
  const abortRef = useRef(null);
  const resumedRef = useRef(false);

  // Persist full form state incl. attached materials, so nothing is lost on
  // tab switch / remount. base64 lives in the in-memory Map (no storage quota).
  useEffect(() => {
    updateTabState(tabId, {
      description, generatedPrompt, aspect, durationSeconds, enabledLoras, visionEnabled,
      images, resultUrl, taskId: currentTaskIdRef.current,
    });
  }, [description, generatedPrompt, aspect, durationSeconds, enabledLoras, visionEnabled, images, resultUrl, tabId, updateTabState]);

  // Reconnect to an in-flight/finished RunPod job after a remount so the video
  // isn't lost when the tab was switched away mid-generation.
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const jid = saved.runpodJobId;
    if (!jid || saved.resultUrl) return;
    (async () => {
      let settings;
      try { settings = await invoke('load_settings'); } catch { return; }
      const ak = settings?.api_keys || {};
      const endpoint = ak[meta.endpointKey];
      const apiKey = ak.RunPod;
      if (!endpoint || !apiKey) return;
      setIsProcessing(true); setError(null); setProgressText('Восстановление задачи…');
      abortRef.current = new AbortController();
      try {
        const b64 = await runpodRunVideo({
          endpoint, apiKey, resumeJobId: jid, signal: abortRef.current.signal,
          onProgress: (pct, text) => setProgressText(text),
        });
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([arr], { type: 'video/mp4' }));
        setResultUrl(url);
        updateTabState(tabId, { runpodJobId: null, resultUrl: url });
      } catch (err) {
        setError('Не удалось восстановить задачу (возможно, истёк срок хранения результата): ' + (err.message || err));
        updateTabState(tabId, { runpodJobId: null });
      } finally {
        setIsProcessing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // items: {kind:'image'|'video'|'audio', name, mime, base64, dataUri?}
  const addMedia = useCallback((item) => {
    setError(null);
    setImages((prev) => {
      const limit = meta.limits[item.kind] || 0;
      if (!meta.kinds.includes(item.kind)) {
        setError('Этот инструмент не принимает такой тип файла'); return prev;
      }
      if (prev.filter((m) => m.kind === item.kind).length >= limit) {
        setError(`Максимум ${limit} (${item.kind}) для этого инструмента`); return prev;
      }
      return [...prev, item];
    });
  }, [meta.kinds, meta.limits]);

  const renameToJpg = (name) => name.replace(/\.[^.]+$/, '') + '.jpg';

  // From a browser File (drag-drop). Images → compact JPEG; video/audio kept raw
  // in memory (shrunk via ffmpeg at generation time).
  const addFromFile = useCallback(async (file) => {
    const kind = kindOf(file.name, file.type);
    if (!kind) { setError('Неподдерживаемый тип файла'); return; }
    try {
      const name = file.name || `file${extOf(file.name) || ''}`;
      if (kind === 'image') {
        const { dataUri, base64 } = await normalizeImage(file);
        addMedia({ kind, name: renameToJpg(name), mime: 'image/jpeg', base64, dataUri });
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      addMedia({ kind, name, mime: file.type || MIME_TYPES[extOf(name)] || '', base64: bytesToBase64(bytes) });
    } catch (err) {
      setError('Ошибка обработки файла: ' + (err.message || err));
    }
  }, [addMedia]);

  // From a filesystem path (file dialog).
  const addFromPath = useCallback(async (path) => {
    const kind = kindOf(path, '');
    if (!kind) { setError('Неподдерживаемый тип файла'); return; }
    const bytes = await readFile(path);
    const name = path.split(/[/\\]/).pop();
    if (kind === 'image') {
      const mime = MIME_TYPES[extOf(name)] || 'image/jpeg';
      const { dataUri, base64 } = await normalizeImage(new Blob([bytes], { type: mime }));
      addMedia({ kind, name: renameToJpg(name), mime: 'image/jpeg', base64, dataUri });
      return;
    }
    addMedia({ kind, name, mime: MIME_TYPES[extOf(name)] || '', base64: bytesToBase64(bytes) });
  }, [addMedia]);

  const handleAttach = useCallback(async () => {
    try {
      const path = await openFileDialog({ filters: [{ name: 'Media', extensions: meta.dialogExtensions }] });
      if (path) await addFromPath(path);
    } catch (err) {
      if (err !== 'User cancelled the dialog') setError('Ошибка выбора файла: ' + (err.message || err));
    }
  }, [addFromPath, meta.dialogExtensions]);

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

  // Images (already normalized to compact JPEG), with stable ref filenames.
  const collectImages = useCallback(() => images.filter((m) => m.kind === 'image').map((m, i) => ({
    name: `ref${i}.jpg`, base64: m.base64, dataUri: m.dataUri,
  })), [images]);

  // Shrink a video/audio item via ffmpeg (keeps it under RunPod's 10 MiB body)
  // and return the compact clip as base64. Uses temp files, cleaned up after.
  const shrinkToBase64 = useCallback(async (item, kind) => {
    const dir = await tempDir();
    const ext = item.name.substring(item.name.lastIndexOf('.')) || (kind === 'video' ? '.mp4' : '.m4a');
    const inPath = await join(dir, `h3in_${Date.now()}_${Math.floor(performance.now())}${ext}`);
    const bin = atob(item.base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await writeFile(inPath, arr);
    let outPath;
    try {
      outPath = await invoke('ffmpeg_shrink_media', { inputPath: inPath, kind });
      return bytesToBase64(await readFile(outPath));
    } finally {
      try { await remove(inPath); } catch { /* ignore */ }
      try { if (outPath) await remove(outPath); } catch { /* ignore */ }
    }
  }, []);

  const handleBuildPrompt = useCallback(async () => {
    if (!description.trim()) { setError('Введите описание сцены'); return; }
    setIsBuilding(true); setError(null);
    try {
      const settings = await loadSettings();
      const visionImgs = visionEnabled ? collectImages().map((x) => x.dataUri).filter(Boolean) : [];
      const prompt = await grokBuildPrompt({ tool, description, settings, enabledLoras, images: visionImgs });
      setGeneratedPrompt(prompt);
    } catch (err) {
      setError('Grok: ' + (err.message || String(err)));
    } finally {
      setIsBuilding(false);
    }
  }, [description, visionEnabled, enabledLoras, tool, loadSettings, collectImages]);

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

    const taskId = addTask({ type: `h3-${tool}`, title: `${meta.title}`, status: 'running', progress: 0, tabId });
    currentTaskIdRef.current = taskId;
    setIsProcessing(true); setError(null); setResultUrl(null); setProgressText('Подготовка материалов…');
    abortRef.current = new AbortController();

    // fl2va: images → first/last frame. ref2va: images → ref_image_N (uploaded),
    // videos/audios → ffmpeg-shrunk base64 embedded in the workflow.
    const imgs = collectImages();
    const inputImages = imgs.map((u) => ({ name: u.name, image: u.base64 }));
    let refVideosB64 = [];
    let refAudiosB64 = [];
    if (tool === 'ref2va') {
      try {
        for (const m of images.filter((m) => m.kind === 'video')) refVideosB64.push(await shrinkToBase64(m, 'video'));
        for (const m of images.filter((m) => m.kind === 'audio')) refAudiosB64.push(await shrinkToBase64(m, 'audio'));
      } catch (err) {
        setError('Ошибка обработки видео/аудио: ' + (err.message || err));
        setIsProcessing(false);
        updateTask(taskId, { status: 'failed', error: String(err.message || err) });
        return;
      }
    }

    const workflow = buildWorkflow({
      tool,
      unetFile: UNET[tool],
      prompt: finalPrompt,
      width: preset.width, height: preset.height,
      length: frames, steps: 20,
      seed: Math.floor(Math.random() * 2 ** 31),
      firstFrameName: tool === 'fl2va' ? imgs[0]?.name : undefined,
      lastFrameName: tool === 'fl2va' ? imgs[1]?.name : undefined,
      refImageNames: tool === 'ref2va' ? imgs.map((u) => u.name) : [],
      refVideosB64, refAudiosB64,
      loras: loraFiles,
    });

    try {
      const b64 = await runpodRunVideo({
        endpoint, apiKey, workflow,
        images: inputImages.length ? inputImages : undefined,
        signal: abortRef.current.signal,
        // Persist the RunPod job id so the result survives a tab switch / reset:
        // on remount the tool reconnects to this job and pulls the video.
        onJob: (jid) => updateTabState(tabId, { runpodJobId: jid }),
        onProgress: (pct, text) => { setProgressText(text); updateTask(taskId, { progress: pct, status: 'running' }); },
      });
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: 'video/mp4' }));
      setResultUrl(url);
      updateTabState(tabId, { runpodJobId: null, resultUrl: url });
      updateTask(taskId, { progress: 100, status: 'completed', resultUrl: url });
    } catch (err) {
      const msg = err.message || String(err);
      setError(msg);
      updateTabState(tabId, { runpodJobId: null });
      updateTask(taskId, { status: 'failed', error: msg });
    } finally {
      setIsProcessing(false);
    }
  }, [generatedPrompt, description, aspect, durationSeconds, enabledLoras, images, tool, meta, frames, addTask, updateTask, updateTabState, tabId, loadSettings, collectImages, shrinkToBase64]);

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
                {tool === 'fl2va'
                  ? 'Перетащите изображение сюда или кликните (до 2 кадров)'
                  : 'Перетащите картинки / видео / аудио или кликните (по 3 каждого)'}
              </div>
            </div>
            {images.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                {images.map((m, i) => {
                  const label = m.kind === 'image'
                    ? (tool === 'fl2va' ? (i === 0 ? 'Start frame' : 'End frame') : 'Image')
                    : (m.kind === 'video' ? '🎬 Video' : '🎵 Audio');
                  return (
                    <div key={i} style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 6, padding: 6, width: 132 }}>
                      {m.kind === 'image' ? (
                        <img src={m.dataUri} alt={m.name} style={{ maxWidth: 120, maxHeight: 120, display: 'block' }} />
                      ) : (
                        <div style={{ width: 120, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, background: 'var(--bg-tertiary)', borderRadius: 4 }}>
                          {m.kind === 'video' ? '🎬' : '🎵'}
                        </div>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>{label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); handleRemoveImage(i); }} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,0,0,0.8)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer' }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            {images.some((m) => m.kind === 'image') && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '0.9em' }}>
                <input type="checkbox" checked={visionEnabled} onChange={(e) => setVisionEnabled(e.target.checked)} disabled={isProcessing} />
                Grok смотрит на приложенные картинки (vision) при сборке промпта
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

          {/* Всегда доступна — можно поправить промпт/материалы/параметры и
              перегенерить, не сбрасывая форму через «Очистить». */}
          <button className="btn btn-success" style={{ marginTop: 14 }} onClick={handleGenerate} disabled={isProcessing || (!generatedPrompt && !description.trim())}>
            {resultUrl ? '🔁 Сгенерировать заново' : '🎬 Сгенерировать видео'}
          </button>

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
