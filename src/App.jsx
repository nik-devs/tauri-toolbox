import { useEffect } from 'react';
import { AppProvider, useApp } from './contexts/AppContext';
import { TasksProvider } from './contexts/TasksContext';
import { TabsStateProvider } from './contexts/TabsStateContext';
import Navigation from './components/Navigation';
import ToolsPage from './pages/ToolsPage';
import AIPage from './pages/AIPage';
import SettingsPage from './pages/SettingsPage';
import TasksPage from './pages/TasksPage';
import WebPToPNG from './components/utilities/WebPToPNG';
import LoopVideo from './components/utilities/LoopVideo';
import ReverseVideo from './components/utilities/ReverseVideo';
import ExtractSound from './components/utilities/ExtractSound';
import OverlaySoundOnVideo from './components/utilities/OverlaySoundOnVideo';
import Upscale from './components/utilities/Upscale';
import RemoveBackground from './components/utilities/RemoveBackground';
import FrameToFrameVideo from './components/utilities/FrameToFrameVideo';
import VideoUpscale from './components/utilities/VideoUpscale';
import CameraControl from './components/utilities/CameraControl';
import QwenEditPlus from './components/utilities/QwenEditPlus';
import NanoEditPro from './components/utilities/NanoEditPro';
import ImageToPose from './components/utilities/ImageToPose';
import StyleTransfer from './components/utilities/StyleTransfer';
import ImageTags from './components/utilities/ImageTags';
import { setWindowTitle, checkForUpdates } from './hooks/useTauri';

function AppContent() {
  const { currentPage, activeUtility, aiTabs } = useApp();

  useEffect(() => {
    setWindowTitle();
    checkForUpdates(false);
  }, []);

  // Рендерим только активные компоненты
  const renderContent = () => {
    // Обычные утилиты
    if (activeUtility === 'webp-to-png') return <WebPToPNG />;
    if (activeUtility === 'loop-video') return <LoopVideo />;
    if (activeUtility === 'reverse-video') return <ReverseVideo />;
    if (activeUtility === 'extract-sound') return <ExtractSound />;
    if (activeUtility === 'overlay-sound') return <OverlaySoundOnVideo />;

    // Страницы
    if (currentPage === 'tools' && !activeUtility) {
      return <ToolsPage />;
    }

    if (currentPage === 'ai') {
      const activeTab = aiTabs.find(t => t.active);
      
      // Если есть активная вкладка - показываем её и все остальные (скрытые)
      if (activeTab) {
        return (
          <>
            {aiTabs.map(tab => {
              if (tab.utilityId === 'upscale') {
                return (
                  <Upscale 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'remove-background') {
                return (
                  <RemoveBackground 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'frame-to-frame-video') {
                return (
                  <FrameToFrameVideo 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'video-upscale') {
                return (
                  <VideoUpscale 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'camera-control') {
                return (
                  <CameraControl 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'qwen-edit-plus') {
                return (
                  <QwenEditPlus 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'nano-edit-pro') {
                return (
                  <NanoEditPro 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'image-to-pose') {
                return (
                  <ImageToPose 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'style-transfer') {
                return (
                  <StyleTransfer 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              if (tab.utilityId === 'image-tags') {
                return (
                  <ImageTags 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={tab.active}
                  />
                );
              }
              return null;
            })}
          </>
        );
      } else {
        // Нет активных вкладок - показываем галерею AI
        // Но все равно рендерим неактивные вкладки (скрытые)
        return (
          <>
            <AIPage />
            {aiTabs.map(tab => {
              if (tab.utilityId === 'upscale') {
                return (
                  <Upscale 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'remove-background') {
                return (
                  <RemoveBackground 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'frame-to-frame-video') {
                return (
                  <FrameToFrameVideo 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'video-upscale') {
                return (
                  <VideoUpscale 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'camera-control') {
                return (
                  <CameraControl 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'qwen-edit-plus') {
                return (
                  <QwenEditPlus 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'nano-edit-pro') {
                return (
                  <NanoEditPro 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'image-to-pose') {
                return (
                  <ImageToPose 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'style-transfer') {
                return (
                  <StyleTransfer 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              if (tab.utilityId === 'image-tags') {
                return (
                  <ImageTags 
                    key={tab.id} 
                    tabId={tab.id}
                    isActive={false}
                  />
                );
              }
              return null;
            })}
          </>
        );
      }
    }

    if (currentPage === 'settings') {
      return <SettingsPage />;
    }

    if (currentPage === 'tasks') {
      return <TasksPage />;
    }

    return null;
  };

  return (
    <div className="app-container">
      <Navigation />
      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <TasksProvider>
      <TabsStateProvider>
        <AppProvider>
          <AppContent />
        </AppProvider>
      </TabsStateProvider>
    </TasksProvider>
  );
}
