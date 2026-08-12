import { useState, useEffect, useCallback } from 'react';
import { invoke } from '../hooks/useTauri';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { save, open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { showNotification } from '../utils/notifications';

const API_KEYS = {
  FAL: 'apiKeyFAL',
  Replicate: 'apiKeyReplicate',
  HF: 'apiKeyHF',
  GPT: 'apiKeyGPT',
  Grok: 'apiKeyGrok',
  RunPod: 'apiKeyRunPod',
  RunPodEndpoint: 'apiEndpointRunPod',
  Fl2vaEndpoint: 'apiEndpointFl2va',
  Ref2vaEndpoint: 'apiEndpointRef2va'
};

// Fields rendered as text inputs (not masked as passwords).
const TEXT_FIELDS = new Set(['RunPodEndpoint', 'Fl2vaEndpoint', 'Ref2vaEndpoint']);

// Multiline settings: user-authored prompt guidance fed to Grok for the H3
// video tools, plus a custom line prepended to every Grok call.
const TEXTAREAS = {
  GrokPrepend: {
    label: 'Grok: первая строка (в system и в user)',
    placeholder: 'Строка, которая вставляется первой строкой в инструкцию и в сообщение пользователя'
  },
  Fl2vaExamples: {
    label: 'fl2va: примеры / правила промптинга',
    placeholder: 'Примеры и правила, которые Grok должен учитывать для fl2va'
  },
  Ref2vaExamples: {
    label: 'ref2va: примеры / правила промптинга',
    placeholder: 'Примеры и правила для reference-to-video (Image 1 / Video 1 …)'
  },
  LoraHmpussyInstr: {
    label: 'LoRA HMPussy: инструкция для Grok',
    placeholder: 'Триггеры, strength, что ставить в начало, примеры — применяется, когда лора включена'
  },
  LoraRidingInstr: {
    label: 'LoRA Riding POV: инструкция для Grok',
    placeholder: 'Триггеры, формат шаблона, примеры — применяется, когда лора включена'
  }
};

const ALL_FIELDS = [...Object.keys(API_KEYS), ...Object.keys(TEXTAREAS)];

export default function SettingsPage() {
  const [apiKeys, setApiKeys] = useState(() =>
    ALL_FIELDS.reduce((acc, k) => ({ ...acc, [k]: '' }), {})
  );
  const [appVersion, setAppVersion] = useState('Загрузка...');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

  useEffect(() => {
    loadApiKeys();
    loadAppVersion();
  }, []);

  const loadApiKeys = useCallback(async () => {
    try {
      const settings = await invoke('load_settings');
      if (settings && settings.api_keys) {
        setApiKeys(prev => ({
          ...prev,
          ...settings.api_keys
        }));
      }
    } catch (error) {
      console.log('Настройки не найдены, используем значения по умолчанию');
    }
  }, []);

  const loadAppVersion = useCallback(async () => {
    try {
      const version = await getVersion();
      setAppVersion(`v${version}`);
    } catch (error) {
      console.error('Ошибка при загрузке версии:', error);
      setAppVersion('Ошибка загрузки');
    }
  }, []);

  const handleKeyChange = useCallback((key, value) => {
    setApiKeys(prev => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const handleSave = useCallback(async () => {
    const keys = {};
    ALL_FIELDS.forEach(key => {
      if (apiKeys[key]?.trim()) {
        keys[key] = apiKeys[key].trim();
      }
    });

    try {
      await invoke('save_settings', {
        settings: {
          api_keys: keys
        }
      });
      showNotification('Ключи успешно сохранены', 'success');
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      showNotification('Ошибка сохранения ключей', 'error');
    }
  }, [apiKeys]);

  const handleExport = useCallback(async () => {
    const keys = {};
    ALL_FIELDS.forEach(key => {
      if (apiKeys[key]?.trim()) {
        keys[key] = apiKeys[key].trim();
      }
    });

    try {
      const filePath = await save({
        defaultPath: 'toolbox-api-keys.json',
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }]
      });

      if (filePath) {
        await writeTextFile(filePath, JSON.stringify(keys, null, 2));
        showNotification('Ключи успешно экспортированы', 'success');
      }
    } catch (error) {
      console.error('Ошибка экспорта:', error);
      showNotification('Ошибка экспорта ключей', 'error');
    }
  }, [apiKeys]);

  const handleImport = useCallback(async () => {
    try {
      const filePath = await open({
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }],
        multiple: false
      });

      if (filePath) {
        const content = await readTextFile(filePath);
        const keys = JSON.parse(content);

        // Заполняем поля
        setApiKeys(prev => ({
          ...prev,
          ...keys
        }));

        // Автоматически сохраняем после импорта
        await invoke('save_settings', {
          settings: {
            api_keys: keys
          }
        });
        showNotification('Ключи успешно импортированы и сохранены', 'success');
      }
    } catch (error) {
      console.error('Ошибка импорта:', error);
      showNotification('Ошибка импорта ключей', 'error');
    }
  }, []);

  const handleCheckUpdates = useCallback(async () => {
    setIsCheckingUpdates(true);

    try {
      const update = await check();
      if (update?.available) {
        const message = `Доступна новая версия: ${update.version}\nТекущая версия: ${appVersion}\n\nХотите установить обновление сейчас?`;

        if (confirm(message)) {
          await update.downloadAndInstall(
            (chunkLength, contentLength) => {
              console.log(`Загружено: ${chunkLength}/${contentLength || 0}`);
            },
            () => {
              console.log('Установка обновления...');
            }
          );
          showNotification('Обновление установлено. Приложение будет перезапущено.', 'success');
        }
      } else {
        showNotification('Обновления не найдены. У вас установлена последняя версия.', 'success');
      }
    } catch (error) {
      console.error('Ошибка при проверке обновлений:', error);
      showNotification('Ошибка при проверке обновлений: ' + (error.message || String(error)), 'error');
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [appVersion]);

  return (
    <div id="page-settings" className="page active">
      <div className="settings-container">
        {/* Секция: О приложении */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>ℹ️ О приложении</h3>
          </div>
          <div className="settings-section-content">
            <div className="app-info">
              <div className="info-row">
                <span className="info-label">Версия:</span>
                <span className="info-value" id="currentVersion">{appVersion}</span>
              </div>
              <button
                id="checkUpdatesBtn"
                type="button"
                className="btn btn-primary"
                onClick={handleCheckUpdates}
                disabled={isCheckingUpdates}
              >
                {isCheckingUpdates ? '⏳ Проверка...' : '🔄 Проверить обновления'}
              </button>
            </div>
          </div>
        </div>

        {/* Секция: Ключи API */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>🔑 Ключи API</h3>
            <p className="section-description">Все поля необязательны к заполнению</p>
          </div>
          <div className="settings-section-content">
            {Object.keys(API_KEYS).map(key => (
              <div key={key} className="form-group">
                <label htmlFor={API_KEYS[key]}>{key}</label>
                <input
                  type={TEXT_FIELDS.has(key) ? 'text' : 'password'}
                  id={API_KEYS[key]}
                  className="form-input"
                  placeholder={TEXT_FIELDS.has(key) ? 'Введите URL эндпоинта' : `Введите ключ ${key}`}
                  value={apiKeys[key] || ''}
                  onChange={(e) => handleKeyChange(key, e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            ))}

            {/* MiniMax H3 / Grok: пользовательские тексты промптинга */}
            <div className="settings-section-header" style={{ marginTop: '20px' }}>
              <h3 style={{ fontSize: '1em' }}>🎬 H3 промптинг (Grok)</h3>
              <p className="section-description">
                Тексты, которые Grok использует при сборке промптов. Всё необязательно.
              </p>
            </div>
            {Object.keys(TEXTAREAS).map(key => (
              <div key={key} className="form-group">
                <label htmlFor={`ta-${key}`}>{TEXTAREAS[key].label}</label>
                <textarea
                  id={`ta-${key}`}
                  className="form-input"
                  rows={key === 'GrokPrepend' ? 2 : 5}
                  placeholder={TEXTAREAS[key].placeholder}
                  value={apiKeys[key] || ''}
                  onChange={(e) => handleKeyChange(key, e.target.value)}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
            ))}

            <div className="form-actions">
              <button
                id="exportKeysBtn"
                type="button"
                className="btn btn-secondary"
                onClick={handleExport}
              >
                📤 Экспорт JSON
              </button>
              <button
                id="importKeysBtn"
                type="button"
                className="btn btn-secondary"
                onClick={handleImport}
              >
                📥 Импорт JSON
              </button>
              <button
                id="saveKeysBtn"
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
              >
                💾 Сохранить
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
