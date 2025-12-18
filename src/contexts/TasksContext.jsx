import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const TasksContext = createContext(null);

// Глобальное хранилище задач (вне React для независимости от UI)
const tasksStore = {
  tasks: new Map(),
  listeners: new Set(),
  
  addTask(task) {
    const id = task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const taskWithId = { ...task, id, status: 'pending', createdAt: Date.now() };
    this.tasks.set(id, taskWithId);
    this.notifyListeners();
    return id;
  },
  
  updateTask(id, updates) {
    const task = this.tasks.get(id);
    if (task) {
      const updated = { ...task, ...updates, updatedAt: Date.now() };
      this.tasks.set(id, updated);
      this.notifyListeners();
    }
  },
  
  removeTask(id) {
    this.tasks.delete(id);
    this.notifyListeners();
  },
  
  getTask(id) {
    return this.tasks.get(id);
  },
  
  getAllTasks() {
    return Array.from(this.tasks.values());
  },
  
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },
  
  notifyListeners() {
    this.listeners.forEach(listener => listener(this.getAllTasks()));
  }
};

export function TasksProvider({ children }) {
  const [tasks, setTasks] = useState([]);
  const subscriptionRef = useRef(null);

  // Подписываемся на изменения задач
  useEffect(() => {
    subscriptionRef.current = tasksStore.subscribe((newTasks) => {
      setTasks(newTasks);
    });
    // Инициализируем с текущими задачами
    setTasks(tasksStore.getAllTasks());
    
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current();
      }
    };
  }, []);

  const addTask = useCallback((task) => {
    return tasksStore.addTask(task);
  }, []);

  const updateTask = useCallback((id, updates) => {
    tasksStore.updateTask(id, updates);
  }, []);

  const removeTask = useCallback((id) => {
    tasksStore.removeTask(id);
  }, []);

  const getTask = useCallback((id) => {
    return tasksStore.getTask(id);
  }, []);

  const value = {
    tasks,
    addTask,
    updateTask,
    removeTask,
    getTask
  };

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks() {
  const context = useContext(TasksContext);
  if (!context) {
    throw new Error('useTasks must be used within TasksProvider');
  }
  return context;
}

// Экспортируем store для использования вне React компонентов
export { tasksStore };
