import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext(null);

// AI utilities open as tabs. The task `type` equals the utilityId, so a task in
// the global list can reopen its tab via these maps.
const AI_UTILITY_TITLES = {
  'upscale': 'Upscale',
  'remove-background': 'Remove Background',
  'frame-to-frame-video': 'Frame To Frame Video',
  'video-upscale': 'Video Upscale',
  'camera-control': 'Camera Control',
  'qwen-edit-plus': 'Qwen Edit Plus',
  'nano-edit-pro': 'Nano Edit Pro',
  'image-to-pose': 'Image To Pose',
  'style-transfer': 'Style Transfer',
  'image-tags': 'Image Tags',
  'h3-fl2va': 'H3 Text/Image→Video',
  'h3-ref2va': 'H3 Reference→Video',
};
export function isAiUtilityId(id) {
  return Object.prototype.hasOwnProperty.call(AI_UTILITY_TITLES, id);
}
export function aiUtilityTitle(id) {
  return AI_UTILITY_TITLES[id] || id;
}

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
    if (isAiUtilityId(utilityId)) {
      // Для AI утилит создаем вкладку
      const tabId = `ai-tab-${utilityId}-${Date.now()}`;
      const tab = { id: tabId, utilityId, title: aiUtilityTitle(utilityId), active: true };
      setAiTabs(prev => [...prev.map(t => ({ ...t, active: false })), tab]);
      setCurrentPage('ai');
    } else {
      // Для обычных утилит - стандартное поведение
      setActiveUtility(utilityId);
      setCurrentPage('tools');
    }
  }, []);

  // Reopen (or focus) a tab from the global task list. If the tab still exists
  // it's just activated; if it was closed, it's recreated with the SAME tabId
  // so the component restores its state from the in-memory tab-state store.
  const openTaskTab = useCallback((tabId, utilityId) => {
    if (!tabId || !isAiUtilityId(utilityId)) return;
    setAiTabs(prev => {
      if (prev.some(t => t.id === tabId)) {
        return prev.map(t => ({ ...t, active: t.id === tabId }));
      }
      const deactivated = prev.map(t => ({ ...t, active: false }));
      return [...deactivated, { id: tabId, utilityId, title: aiUtilityTitle(utilityId), active: true }];
    });
    setCurrentPage('ai');
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
    handleBackToTools,
    openTaskTab
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
