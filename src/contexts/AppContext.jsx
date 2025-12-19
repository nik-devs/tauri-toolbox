import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [currentPage, setCurrentPage] = useState('tools');
  const [activeUtility, setActiveUtility] = useState(null);
  const [aiTabs, setAiTabs] = useState([]);

  const handlePageChange = useCallback((page) => {
    setCurrentPage(page);
    setActiveUtility(null);
    // Деактивируем все вкладки при переходе на любую страницу
    setAiTabs(prev => prev.map(tab => ({ ...tab, active: false })));
  }, []);

  const handleOpenUtility = useCallback((utilityId) => {
    const isAiUtility = utilityId === 'upscale' || utilityId === 'remove-background' || utilityId === 'frame-to-frame-video' || utilityId === 'video-upscale';
    
    if (isAiUtility) {
      // Для AI утилит создаем вкладку
      const tabId = `ai-tab-${utilityId}-${Date.now()}`;
      const getTitle = (id) => {
        if (id === 'upscale') return 'Upscale';
        if (id === 'remove-background') return 'Remove Background';
        if (id === 'frame-to-frame-video') return 'Frame To Frame Video';
        if (id === 'video-upscale') return 'Video Upscale';
        return id;
      };
      const tab = {
        id: tabId,
        utilityId,
        title: getTitle(utilityId),
        active: true
      };
      
      setAiTabs(prev => {
        // Деактивируем все предыдущие вкладки
        const updated = prev.map(t => ({ ...t, active: false }));
        return [...updated, tab];
      });
      setCurrentPage('ai');
    } else {
      // Для обычных утилит - стандартное поведение
      setActiveUtility(utilityId);
      setCurrentPage('tools');
    }
  }, []);

  const handleTabClick = useCallback((tabId) => {
    setAiTabs(prev => prev.map(tab => ({
      ...tab,
      active: tab.id === tabId
    })));
    setCurrentPage('ai');
  }, []);

  const handleCloseTab = useCallback((tabId) => {
    setAiTabs(prev => {
      const updated = prev.filter(tab => tab.id !== tabId);
      const wasActive = prev.find(t => t.id === tabId)?.active;
      
      if (wasActive && updated.length > 0) {
        // Активируем последнюю вкладку
        const lastTab = updated[updated.length - 1];
        lastTab.active = true;
      }
      
      return updated;
    });
  }, []);

  const handleBackToTools = useCallback(() => {
    setActiveUtility(null);
    setCurrentPage('tools');
  }, []);

  const value = {
    currentPage,
    activeUtility,
    aiTabs,
    handlePageChange,
    handleOpenUtility,
    handleTabClick,
    handleCloseTab,
    handleBackToTools
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
