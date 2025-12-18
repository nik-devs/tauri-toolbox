import { useApp } from '../contexts/AppContext';

export default function ToolsPage() {
  const { handleOpenUtility } = useApp();
  
  const utilities = [
    {
      id: 'webp-to-png',
      icon: '🖼️',
      title: 'WebP → PNG Конвертер',
      description: 'Конвертирует все WebP изображения в PNG в выбранной папке'
    }
  ];

  return (
    <div id="page-tools" className="page active">
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
