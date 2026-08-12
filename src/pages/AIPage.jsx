import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { invoke } from '../hooks/useTauri';

export default function AIPage() {
  const { handleOpenUtility } = useApp();

  // H3 tools are shown only when their endpoint URL is configured in Settings.
  const [h3Endpoints, setH3Endpoints] = useState({ fl2va: false, ref2va: false });
  useEffect(() => {
    (async () => {
      try {
        const s = await invoke('load_settings');
        const ak = s?.api_keys || {};
        setH3Endpoints({
          fl2va: !!(ak.Fl2vaEndpoint && ak.Fl2vaEndpoint.trim()),
          ref2va: !!(ak.Ref2vaEndpoint && ak.Ref2vaEndpoint.trim()),
        });
      } catch { /* settings missing — keep both hidden */ }
    })();
  }, []);

  const utilities = [
    {
      id: 'upscale',
      icon: '🔍',
      title: 'Upscale',
      description: 'Увеличение разрешения изображений с помощью AI'
    },
    {
      id: 'remove-background',
      icon: '✂️',
      title: 'Remove Background',
      description: 'Удаление фона изображений с помощью AI'
    },
    {
      id: 'frame-to-frame-video',
      icon: '🎬',
      title: 'Frame To Frame Video',
      description: 'Генерация плавного видео-перехода между двумя изображениями'
    },
    {
      id: 'video-upscale',
      icon: '📹',
      title: 'Video Upscale',
      description: 'Увеличение разрешения и FPS видео с помощью AI'
    },
    {
      id: 'camera-control',
      icon: '🎥',
      title: 'Camera Control',
      description: 'Изменение угла камеры и перспективы изображения'
    },
    {
      id: 'qwen-edit-plus',
      icon: '🎨',
      title: 'Qwen Edit Plus',
      description: 'Редактирование изображений с помощью AI модели Qwen Edit Plus'
    },
    {
      id: 'nano-edit-pro',
      icon: '🍌',
      title: 'Nano Edit Pro',
      description: 'Редактирование изображений с Nano Banana Pro (fal.ai)'
    },
    {
      id: 'image-to-pose',
      icon: '🎭',
      title: 'Image To Pose',
      description: 'Генерация позы из изображения с помощью AI'
    },
    {
      id: 'style-transfer',
      icon: '🎨',
      title: 'Style Transfer',
      description: 'Стилизация картинки с помощью AI'
    },
    {
      id: 'image-tags',
      icon: '🏷️',
      title: 'Image Tags',
      description: 'Генерация тегов для изображения с помощью AI'
    },
    ...(h3Endpoints.fl2va ? [{
      id: 'h3-fl2va',
      icon: '🎞️',
      title: 'H3 Text/Image → Video',
      description: 'MiniMax H3: видео со звуком из текста и опциональных кадров'
    }] : []),
    ...(h3Endpoints.ref2va ? [{
      id: 'h3-ref2va',
      icon: '🎞️',
      title: 'H3 Reference → Video',
      description: 'MiniMax H3: видео со звуком по референс-материалам'
    }] : [])
  ];

  return (
    <div id="page-ai" className="page active">
      <div className="tools-gallery">
        {utilities.map(utility => (
          <div key={utility.id} className="utility-card" data-utility={utility.id}>
            <div className="utility-icon">{utility.icon}</div>
            <h3 className="utility-title">{utility.title}</h3>
            <p className="utility-description">{utility.description}</p>
            <button 
              className="btn btn-primary utility-open-btn" 
              onClick={() => handleOpenUtility(utility.id)}
            >
              Открыть
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
