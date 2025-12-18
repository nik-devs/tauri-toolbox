import { invoke as invokeCore } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getName, getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';

export const invoke = invokeCore || (window.__TAURI__?.core?.invoke);

export function useTauriInvoke() {
  return invoke;
}

export async function openFolderDialog() {
  try {
    const path = await open({
      directory: true,
      multiple: false,
      title: 'Выберите папку'
    });
    return path;
  } catch (error) {
    console.error('Ошибка выбора папки:', error);
    throw error;
  }
}

export async function openFileDialog(options = {}) {
  try {
    const path = await open({
      multiple: false,
      ...options
    });
    return path;
  } catch (error) {
    console.error('Ошибка выбора файла:', error);
    throw error;
  }
}

export async function getAppInfo() {
  try {
    const [name, version] = await Promise.all([getName(), getVersion()]);
    return { name, version };
  } catch (error) {
    console.error('Ошибка получения информации о приложении:', error);
    return { name: 'Toolbox', version: 'unknown' };
  }
}

export async function setWindowTitle() {
  try {
    const { name, version } = await getAppInfo();
    const appWindow = getCurrentWindow();
    await appWindow.setTitle(`${name} v${version}`);
  } catch (error) {
    console.error('Ошибка при установке заголовка окна:', error);
  }
}

export async function checkForUpdates(showNotification = false) {
  try {
    console.log('Проверка обновлений...');
    const update = await check();
    console.log('Результат проверки:', update);
    if (update?.available) {
      console.log('Найдено обновление:', update.version);
      return update;
    } else {
      console.log('Обновления не найдены');
      return null;
    }
  } catch (error) {
    console.error('Ошибка при проверке обновлений:', error);
    return null;
  }
}
