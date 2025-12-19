// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|_app| {
            // Проверка обновлений будет происходить автоматически через плагин
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::convert_webp_to_png,
            commands::convert_single_webp_to_png,
            commands::delete_webp_files,
            commands::save_settings,
            commands::load_settings,
            commands::check_path_is_directory,
            commands::replicate_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

