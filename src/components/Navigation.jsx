import { useApp } from '../contexts/AppContext';
import { useTasks } from '../contexts/TasksContext';
import { useTabsState } from '../contexts/TabsStateContext';

export default function Navigation() {
  const { currentPage, aiTabs, handlePageChange, handleTabClick, handleCloseTab } = useApp();
  const { tasks } = useTasks();
  const { getTabState } = useTabsState();
  
  // Получаем статус задачи для вкладки
  const getTabStatus = (tabId) => {
    const tabState = getTabState(tabId);
    if (!tabState?.taskId) return null;
    
    const task = tasks.find(t => t.id === tabState.taskId);
    if (!task) return null;
    
    return {
      status: task.status,
      progress: task.progress
    };
  };

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <button 
          className={`toolbar-btn ${currentPage === 'tools' ? 'active' : ''}`}
          onClick={() => handlePageChange('tools')}
        >
          Утилиты
        </button>
        <button 
          className={`toolbar-btn ${currentPage === 'ai' && !aiTabs.some(t => t.active) ? 'active' : ''}`}
          onClick={() => handlePageChange('ai')}
        >
          AI
        </button>
        <div className="toolbar-tabs" id="aiTabsContainer">
          {aiTabs.map(tab => {
            const tabStatus = getTabStatus(tab.id);
            const statusIcon = tabStatus?.status === 'running' ? '🔄' : 
                              tabStatus?.status === 'completed' ? '✅' :
                              tabStatus?.status === 'failed' ? '❌' : null;
            
            // Вкладка активна только если она помечена как активная И мы на странице AI
            const isTabActive = tab.active && currentPage === 'ai';
            
            return (
              <button
                key={tab.id}
                className={`toolbar-tab ${isTabActive ? 'active' : ''}`}
                onClick={() => handleTabClick(tab.id)}
                title={tabStatus ? `Статус: ${tabStatus.status}, Прогресс: ${tabStatus.progress || 0}%` : ''}
              >
                {statusIcon && <span className="toolbar-tab-status">{statusIcon}</span>}
                <span>{tab.title}</span>
                {tabStatus?.status === 'running' && (
                  <span className="toolbar-tab-progress" style={{ 
                    fontSize: '0.7rem', 
                    marginLeft: '0.25rem',
                    opacity: 0.7 
                  }}>
                    {tabStatus.progress || 0}%
                  </span>
                )}
                <button 
                  className="toolbar-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                >
                  ✕
                </button>
              </button>
            );
          })}
        </div>
      </div>
      <div className="toolbar-right">
        <button 
          className={`toolbar-btn ${currentPage === 'tasks' ? 'active' : ''}`}
          onClick={() => handlePageChange('tasks')}
        >
          Задачи
        </button>
        <button 
          className={`toolbar-btn ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => handlePageChange('settings')}
        >
          Настройки
        </button>
      </div>
    </header>
  );
}
