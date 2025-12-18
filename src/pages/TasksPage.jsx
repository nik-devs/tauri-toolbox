import { useTasks } from '../contexts/TasksContext';

const STATUS_LABELS = {
  pending: '⏳ Ожидание',
  running: '🔄 Выполняется',
  completed: '✅ Завершено',
  failed: '❌ Ошибка',
  cancelled: '🚫 Отменено'
};

const STATUS_COLORS = {
  pending: 'var(--text-secondary)',
  running: 'var(--primary)',
  completed: 'var(--success)',
  failed: 'var(--error)',
  cancelled: 'var(--text-secondary)'
};

export default function TasksPage() {
  const { tasks, removeTask } = useTasks();

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleString('ru-RU');
  };

  const formatDuration = (task) => {
    if (!task.createdAt) return '—';
    if (task.status === 'running' && task.updatedAt) {
      const duration = Math.floor((Date.now() - task.createdAt) / 1000);
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    if (task.updatedAt && task.status !== 'running') {
      const duration = Math.floor((task.updatedAt - task.createdAt) / 1000);
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    return '—';
  };

  return (
    <div id="page-tasks" className="page active">
      <div className="settings-container">
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>📋 Задачи</h3>
            <p className="section-description">
              {tasks.length === 0 
                ? 'Нет активных задач' 
                : `Всего задач: ${tasks.length}`
              }
            </p>
          </div>
          <div className="settings-section-content">
            {tasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                <p>Нет задач для отображения</p>
              </div>
            ) : (
              <div className="tasks-list">
                {tasks
                  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                  .map(task => (
                    <div key={task.id} className="task-item">
                      <div className="task-header">
                        <div className="task-title">
                          <span style={{ 
                            color: STATUS_COLORS[task.status] || STATUS_COLORS.pending,
                            marginRight: '0.5rem'
                          }}>
                            {STATUS_LABELS[task.status] || 'Неизвестно'}
                          </span>
                          <span>{task.title || task.type || 'Задача'}</span>
                        </div>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => removeTask(task.id)}
                          title="Удалить задачу"
                        >
                          ✕
                        </button>
                      </div>
                      {task.description && (
                        <div className="task-description">{task.description}</div>
                      )}
                      <div className="task-meta">
                        <span>Создано: {formatDate(task.createdAt)}</span>
                        {task.updatedAt && task.updatedAt !== task.createdAt && (
                          <span>Обновлено: {formatDate(task.updatedAt)}</span>
                        )}
                        <span>Длительность: {formatDuration(task)}</span>
                      </div>
                      {task.error && (
                        <div className="task-error" style={{ 
                          color: 'var(--error)', 
                          marginTop: '0.5rem',
                          padding: '0.5rem',
                          backgroundColor: 'var(--error-bg, rgba(255, 0, 0, 0.1))',
                          borderRadius: '4px'
                        }}>
                          Ошибка: {task.error}
                        </div>
                      )}
                      {task.progress !== undefined && task.status === 'running' && (
                        <div className="task-progress" style={{ marginTop: '0.5rem' }}>
                          <div className="progress">
                            <div 
                              className="progress-bar" 
                              style={{ width: `${task.progress}%` }}
                            ></div>
                          </div>
                          <span className="progress-text">{task.progress}%</span>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
