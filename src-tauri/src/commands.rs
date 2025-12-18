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

