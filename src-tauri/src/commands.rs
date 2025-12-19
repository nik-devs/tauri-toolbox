use std::fs;
use std::path::{Path, PathBuf};
use image::io::Reader as ImageReader;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversionResult {
    pub converted: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn convert_webp_to_png(folder_path: String) -> Result<ConversionResult, String> {
    let path = Path::new(&folder_path);
    
    if !path.exists() {
        return Err("Папка не существует".to_string());
    }
    
    if !path.is_dir() {
        return Err("Указанный путь не является папкой".to_string());
    }
    
    let mut result = ConversionResult {
        converted: 0,
        failed: 0,
        errors: Vec::new(),
    };
    
    // Находим все webp файлы
    let webp_files: Vec<PathBuf> = fs::read_dir(path)
        .map_err(|e| format!("Ошибка чтения папки: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension()?.to_str()?;
                if ext.eq_ignore_ascii_case("webp") {
                    Some(path)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    
    // Конвертируем каждый файл
    for webp_path in &webp_files {
        match convert_single_file(webp_path) {
            Ok(_) => result.converted += 1,
            Err(e) => {
                result.failed += 1;
                result.errors.push(format!(
                    "{}: {}",
                    webp_path.file_name().unwrap_or_default().to_string_lossy(),
                    e
                ));
            }
        }
    }
    
    Ok(result)
}

fn convert_single_file(webp_path: &Path) -> Result<(), String> {
    // Читаем webp файл
    let img = ImageReader::open(webp_path)
        .map_err(|e| format!("Ошибка открытия файла: {}", e))?
        .decode()
        .map_err(|e| format!("Ошибка декодирования: {}", e))?;
    
    // Создаем путь для png файла
    let mut png_path = webp_path.to_path_buf();
    png_path.set_extension("png");
    
    // Сохраняем как png
    img.save(&png_path)
        .map_err(|e| format!("Ошибка сохранения PNG: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn convert_single_webp_to_png(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    
    if !path.exists() {
        return Err("Файл не существует".to_string());
    }
    
    if !path.is_file() {
        return Err("Указанный путь не является файлом".to_string());
    }
    
    // Проверяем расширение
    if let Some(ext) = path.extension() {
        if !ext.eq_ignore_ascii_case("webp") {
            return Err("Файл не является WebP изображением".to_string());
        }
    } else {
        return Err("Файл не имеет расширения".to_string());
    }
    
    // Конвертируем файл
    convert_single_file(path)?;
    
    // Возвращаем путь к созданному PNG файлу
    let mut png_path = path.to_path_buf();
    png_path.set_extension("png");
    
    Ok(png_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_webp_files(folder_path: String) -> Result<usize, String> {
    let path = Path::new(&folder_path);
    
    if !path.exists() || !path.is_dir() {
        return Err("Папка не существует".to_string());
    }
    
    let mut deleted = 0;
    
    // Находим и удаляем все webp файлы
    let entries = fs::read_dir(path)
        .map_err(|e| format!("Ошибка чтения папки: {}", e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("Ошибка чтения записи: {}", e))?;
        let file_path = entry.path();
        
        if file_path.is_file() {
            if let Some(ext) = file_path.extension() {
                if ext.eq_ignore_ascii_case("webp") {
                    if let Err(e) = fs::remove_file(&file_path) {
                        return Err(format!("Ошибка удаления файла {:?}: {}", file_path, e));
                    }
                    deleted += 1;
                }
            }
        }
    }
    
    Ok(deleted)
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Settings {
    pub api_keys: Option<ApiKeys>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ApiKeys {
    #[serde(rename = "FAL")]
    pub fal: Option<String>,
    #[serde(rename = "Replicate")]
    pub replicate: Option<String>,
    #[serde(rename = "HF")]
    pub hf: Option<String>,
    #[serde(rename = "GPT")]
    pub gpt: Option<String>,
    #[serde(rename = "Grok")]
    pub grok: Option<String>,
}

fn get_settings_path() -> Result<PathBuf, String> {
    // Используем стандартную папку конфигурации пользователя
    let home_dir = dirs::home_dir()
        .ok_or("Не удалось получить домашнюю папку")?;
    let config_dir = home_dir.join(".toolbox");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Ошибка создания папки конфигурации: {}", e))?;
    Ok(config_dir.join("settings.json"))
}

#[tauri::command]
pub async fn save_settings(settings: Settings) -> Result<(), String> {
    let settings_path = get_settings_path()?;
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Ошибка сериализации настроек: {}", e))?;
    fs::write(&settings_path, json)
        .map_err(|e| format!("Ошибка записи настроек: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn load_settings() -> Result<Settings, String> {
    let settings_path = get_settings_path()?;
    
    if !settings_path.exists() {
        return Ok(Settings::default());
    }
    
    let json = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Ошибка чтения настроек: {}", e))?;
    let settings: Settings = serde_json::from_str(&json)
        .map_err(|e| format!("Ошибка парсинга настроек: {}", e))?;
    Ok(settings)
}

#[tauri::command]
pub async fn check_path_is_directory(path: String) -> Result<bool, String> {
    let path = Path::new(&path);
    Ok(path.exists() && path.is_dir())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplicateRunRequest {
    pub model: String,
    pub input: serde_json::Value,
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplicateRunResponse {
    pub output: serde_json::Value,
}

#[tauri::command]
pub async fn replicate_run(request: ReplicateRunRequest) -> Result<ReplicateRunResponse, String> {
    let client = reqwest::Client::new();
    
    // Создаем prediction
    let prediction_url = "https://api.replicate.com/v1/predictions";
    let prediction_response = client
        .post(prediction_url)
        .header("Authorization", format!("Token {}", request.api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "version": request.model,
            "input": request.input
        }))
        .send()
        .await
        .map_err(|e| format!("Ошибка создания prediction: {}", e))?;
    
    if !prediction_response.status().is_success() {
        let error_text = prediction_response.text().await.unwrap_or_default();
        return Err(format!("Ошибка API: {}", error_text));
    }
    
    let prediction: serde_json::Value = prediction_response
        .json()
        .await
        .map_err(|e| format!("Ошибка парсинга ответа: {}", e))?;
    
    let prediction_id = prediction["id"]
        .as_str()
        .ok_or("Не удалось получить ID prediction")?;
    
    let get_url = format!("https://api.replicate.com/v1/predictions/{}", prediction_id);
    
    // Ждем завершения prediction
    let output = loop {
        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
        
        let status_response = client
            .get(&get_url)
            .header("Authorization", format!("Token {}", request.api_key))
            .send()
            .await
            .map_err(|e| format!("Ошибка проверки статуса: {}", e))?;
        
        if !status_response.status().is_success() {
            let error_text = status_response.text().await.unwrap_or_default();
            return Err(format!("Ошибка проверки статуса: {}", error_text));
        }
        
        let status_data: serde_json::Value = status_response
            .json()
            .await
            .map_err(|e| format!("Ошибка парсинга статуса: {}", e))?;
        
        let status = status_data["status"]
            .as_str()
            .ok_or("Не удалось получить статус")?;
        
        match status {
            "succeeded" => {
                break status_data["output"].clone();
            }
            "failed" | "canceled" => {
                let error = status_data["error"]
                    .as_str()
                    .unwrap_or("Неизвестная ошибка");
                return Err(format!("Prediction failed: {}", error));
            }
            "starting" | "processing" => {
                // Продолжаем ждать
            }
            _ => {
                return Err(format!("Неизвестный статус: {}", status));
            }
        }
    };
    
    Ok(ReplicateRunResponse {
        output,
    })
}

