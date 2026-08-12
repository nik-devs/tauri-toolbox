use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use image::io::Reader as ImageReader;
use serde::{Deserialize, Serialize};

/// Находит исполняемый файл ffmpeg.
///
/// GUI-приложения на macOS запускаются с урезанным PATH (`/usr/bin:/bin:...`),
/// в который не входят каталоги Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`),
/// поэтому типовые расположения проверяем явно, а уже потом падаем на PATH.
fn ffmpeg_path() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let candidates: &[&str] = &[
        "/opt/homebrew/bin/ffmpeg", // Apple Silicon (Homebrew)
        "/usr/local/bin/ffmpeg",    // Intel (Homebrew) / ручная установка
        "/opt/local/bin/ffmpeg",    // MacPorts
    ];
    #[cfg(not(target_os = "macos"))]
    let candidates: &[&str] = &[];

    for candidate in candidates {
        if Path::new(candidate).exists() {
            return Ok((*candidate).to_string());
        }
    }

    // Фолбэк: ffmpeg из PATH (работает на Windows и при запуске из терминала).
    if Command::new("ffmpeg").arg("-version").output().is_ok() {
        return Ok("ffmpeg".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Err("ffmpeg не найден. Установите его командой: brew install ffmpeg".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("ffmpeg не найден. Убедитесь, что ffmpeg установлен и доступен в PATH".to_string())
    }
}

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
    #[serde(rename = "RunPod")]
    pub runpod: Option<String>,
    #[serde(rename = "RunPodEndpoint")]
    pub runpod_endpoint: Option<String>,
    // MiniMax H3 serverless endpoints (video + audio). Empty ⇒ the tool is hidden.
    #[serde(rename = "Fl2vaEndpoint")]
    pub fl2va_endpoint: Option<String>,
    #[serde(rename = "Ref2vaEndpoint")]
    pub ref2va_endpoint: Option<String>,
    // User-authored prompt guidance injected into the Grok "build prompt" call.
    #[serde(rename = "Fl2vaExamples")]
    pub fl2va_examples: Option<String>,
    #[serde(rename = "Ref2vaExamples")]
    pub ref2va_examples: Option<String>,
    #[serde(rename = "LoraHmpussyInstr")]
    pub lora_hmpussy_instr: Option<String>,
    #[serde(rename = "LoraRidingInstr")]
    pub lora_riding_instr: Option<String>,
    // Custom line prepended as the first line of BOTH the Grok system prompt
    // and the user message. Whatever the user puts here, verbatim.
    #[serde(rename = "GrokPrepend")]
    pub grok_prepend: Option<String>,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct GrokChatRequest {
    pub system: String,
    pub user: String,
    pub api_key: String,
    #[serde(default)]
    pub model: Option<String>,
    /// Optional image data URIs (data:image/...;base64,...) for vision input.
    #[serde(default)]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GrokChatResponse {
    pub content: String,
}

/// Direct x.ai chat/completions call (run from Rust to avoid browser CORS).
/// Returns the assistant message content. Model defaults to grok-4.5.
#[tauri::command]
pub async fn grok_chat(request: GrokChatRequest) -> Result<GrokChatResponse, String> {
    let client = reqwest::Client::new();
    let model = request.model.unwrap_or_else(|| "grok-4.5".to_string());

    // User message: plain string, or a multimodal content array when images are
    // attached (OpenAI/x.ai vision format: text part + image_url parts).
    let user_content: serde_json::Value = match &request.images {
        Some(imgs) if !imgs.is_empty() => {
            let mut parts = vec![serde_json::json!({ "type": "text", "text": request.user })];
            for uri in imgs {
                parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": { "url": uri }
                }));
            }
            serde_json::Value::Array(parts)
        }
        _ => serde_json::Value::String(request.user.clone()),
    };

    let response = client
        .post("https://api.x.ai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", request.api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": request.system },
                { "role": "user", "content": user_content }
            ],
            "temperature": 0.7
        }))
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к x.ai: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Ошибка x.ai API ({}): {}", status, error_text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Ошибка парсинга ответа x.ai: {}", e))?;

    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Не удалось извлечь ответ из x.ai")?
        .to_string();

    Ok(GrokChatResponse { content })
}

/// Transcode a reference video/audio into a compact clip so it fits inside
/// RunPod's 10 MiB /run body when embedded as base64. Reference conditioning
/// doesn't need HD, so we downscale (512px short side, 24fps, 6s) / re-encode
/// audio (96k, 15s). Returns the path of the shrunk file in the temp dir.
#[tauri::command]
pub async fn ffmpeg_shrink_media(input_path: String, kind: String) -> Result<String, String> {
    let ff = ffmpeg_path()?;
    let uniq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ext = if kind == "video" { "mp4" } else { "m4a" };
    let out = std::env::temp_dir().join(format!("h3ref_{}.{}", uniq, ext));
    let out_s = out.to_string_lossy().to_string();

    let mut cmd = Command::new(&ff);
    cmd.arg("-y").arg("-i").arg(&input_path);
    if kind == "video" {
        cmd.args([
            "-t", "6",
            "-vf", "scale='if(gt(iw,ih),-2,512)':'if(gt(iw,ih),512,-2)'",
            "-r", "24",
            "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
        ]);
    } else {
        cmd.args(["-t", "15", "-vn", "-c:a", "aac", "-b:a", "96k"]);
    }
    cmd.arg(&out_s);

    let status = cmd.status().map_err(|e| format!("Ошибка запуска ffmpeg: {}", e))?;
    if !status.success() {
        return Err("ffmpeg не смог перекодировать референс".to_string());
    }
    Ok(out_s)
}

/// Зацикливание видео: по длительности (-t) или по количеству циклов (-stream_loop N).
/// mode: "duration" | "loops"
/// duration: например "03:00:00" или "1:30", только для mode "duration"
/// loop_count: число циклов, только для mode "loops"
#[tauri::command]
pub async fn ffmpeg_loop_video(
    input_path: String,
    output_path: String,
    mode: String,
    duration: Option<String>,
    loop_count: Option<u32>,
) -> Result<(), String> {
    let (mode, duration, loop_count) = (mode.clone(), duration.clone(), loop_count);
    let input_path = input_path.clone();
    let output_path = output_path.clone();
    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(ffmpeg_path()?);
        match mode.as_str() {
            "duration" => {
                let t = duration.as_deref().ok_or("Укажите длительность (например 03:00:00)")?;
                cmd.args(["-y", "-stream_loop", "-1", "-i", &input_path, "-t", t, "-c", "copy", &output_path]);
            }
            "loops" => {
                let n = loop_count.ok_or("Укажите количество циклов")?;
                if n == 0 {
                    return Err("Количество циклов должно быть больше 0".to_string());
                }
                // ffmpeg -stream_loop N даёт (1 + N) воспроизведений; для ровно n циклов передаём n - 1
                let stream_loop = n - 1;
                cmd.args([
                    "-y",
                    "-stream_loop",
                    &stream_loop.to_string(),
                    "-i",
                    &input_path,
                    "-c",
                    "copy",
                    &output_path,
                ]);
            }
            _ => return Err("Режим должен быть duration или loops".to_string()),
        }
        let status = cmd.status().map_err(|e| format!("Ошибка запуска ffmpeg: {}", e))?;
        if !status.success() {
            return Err("ffmpeg завершился с ошибкой".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Задача ffmpeg: {}", e))?
}

/// Реверс видео (и аудио).
#[tauri::command]
pub async fn ffmpeg_reverse_video(input_path: String, output_path: String) -> Result<(), String> {
    let (input_path, output_path) = (input_path.clone(), output_path.clone());
    tokio::task::spawn_blocking(move || {
        let status = Command::new(ffmpeg_path()?)
            .args([
                "-i",
                &input_path,
                "-vf",
                "reverse",
                "-af",
                "areverse",
                "-y",
                &output_path,
            ])
            .status()
            .map_err(|e| format!("Ошибка запуска ffmpeg: {}", e))?;
        if !status.success() {
            return Err("ffmpeg завершился с ошибкой".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Задача ffmpeg: {}", e))?
}

/// Извлечение звука из видео в WAV (pcm_s16le).
#[tauri::command]
pub async fn ffmpeg_extract_sound(input_path: String, output_path: String) -> Result<(), String> {
    let (input_path, output_path) = (input_path.clone(), output_path.clone());
    tokio::task::spawn_blocking(move || {
        let status = Command::new(ffmpeg_path()?)
            .args([
                "-i",
                &input_path,
                "-vn",
                "-c:a",
                "pcm_s16le",
                "-y",
                &output_path,
            ])
            .status()
            .map_err(|e| format!("Ошибка запуска ffmpeg: {}", e))?;
        if !status.success() {
            return Err("ffmpeg завершился с ошибкой".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Задача ffmpeg: {}", e))?
}

/// Наложение звука на видео. Видео без звука или заменяем дорожку.
#[tauri::command]
pub async fn ffmpeg_overlay_sound(
    video_path: String,
    audio_path: String,
    output_path: String,
) -> Result<(), String> {
    let (video_path, audio_path, output_path) =
        (video_path.clone(), audio_path.clone(), output_path.clone());
    tokio::task::spawn_blocking(move || {
        let status = Command::new(ffmpeg_path()?)
            .args([
                "-i",
                &video_path,
                "-i",
                &audio_path,
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-y",
                &output_path,
            ])
            .status()
            .map_err(|e| format!("Ошибка запуска ffmpeg: {}", e))?;
        if !status.success() {
            return Err("ffmpeg завершился с ошибкой".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Задача ffmpeg: {}", e))?
}

