import { createContext, useContext, useState, useCallback } from 'react';

const TabsStateContext = createContext(null);

// Глобальное хранилище состояния вкладок (вне React для сохранения при размонтировании)
const tabsStateStore = new Map();

export function TabsStateProvider({ children }) {
  const [tabsState, setTabsState] = useState(new Map());

  const getTabState = useCallback((tabId) => {
    return tabsStateStore.get(tabId) || null;
  }, []);

  const setTabState = useCallback((tabId, state) => {
    tabsStateStore.set(tabId, state);
    // Обновляем React состояние для триггера ре-рендера
    setTabsState(new Map(tabsStateStore));
  }, []);

  const updateTabState = useCallback((tabId, updates) => {
    const currentState = tabsStateStore.get(tabId) || {};
    const newState = { ...currentState, ...updates };
    tabsStateStore.set(tabId, newState);
    setTabsState(new Map(tabsStateStore));
  }, []);

  const clearTabState = useCallback((tabId) => {
    tabsStateStore.delete(tabId);
    setTabsState(new Map(tabsStateStore));
  }, []);

  const value = {
    getTabState,
    setTabState,
    updateTabState,
    clearTabState
  };

  return <TabsStateContext.Provider value={value}>{children}</TabsStateContext.Provider>;
}

export function useTabsState() {
  const context = useContext(TabsStateContext);
  if (!context) {
    throw new Error('useTabsState must be used within TabsStateProvider');
  }
  return context;
}

// Экспортируем store для использования вне React
export { tabsStateStore };
