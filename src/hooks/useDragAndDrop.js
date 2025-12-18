import { useState, useCallback, useEffect } from 'react';
import { invoke } from './useTauri';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useDragAndDrop(onDrop) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDroppedPath = useCallback(async (path) => {
    try {
      const isDir = await invoke('check_path_is_directory', { path });
      if (isDir) {
        onDrop?.(path);
      } else {
        // Если это файл, берем родительскую папку
        const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
        if (lastSlash > 0) {
          onDrop?.(path.substring(0, lastSlash));
        }
      }
    } catch (error) {
      console.error('Ошибка проверки пути:', error);
    }
  }, [onDrop]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    
    // Tauri drag and drop
    if (typeof appWindow.onDragDropEvent === 'function') {
      const unlisten = appWindow.onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          setIsDragging(false);
          const paths = event.payload.paths;
          if (paths && Array.isArray(paths) && paths.length > 0) {
            handleDroppedPath(paths[0]);
          }
        } else if (event.payload.type === 'hover') {
          setIsDragging(true);
        } else if (event.payload.type === 'cancel') {
          setIsDragging(false);
        }
      });

      return () => {
        unlisten?.then(fn => fn());
      };
    }
  }, [handleDroppedPath]);

  return { isDragging };
}
