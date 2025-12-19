import { useApp } from '../contexts/AppContext';

export default function AIPage() {
  const { handleOpenUtility } = useApp();
  
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
    }
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
