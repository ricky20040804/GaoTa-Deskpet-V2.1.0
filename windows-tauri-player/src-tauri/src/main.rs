#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, State, WebviewWindow,
};

const ACTIONS: [&str; 4] = ["idle", "run", "happy", "rest"];
const BOTTOM_MARGIN: i32 = 16;
const CHAT_WIDTH: u32 = 420;
const CHAT_HEIGHT: u32 = 520;

#[derive(Default)]
struct RuntimeState {
    chat_history: Mutex<Vec<ChatMessage>>,
    drag_offset: Mutex<Option<(f64, f64)>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SizePreset {
    label: String,
    pixels: u32,
}

#[derive(Clone, Serialize, Deserialize)]
struct DoubaoConfig {
    #[serde(rename = "baseURL")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "modelID")]
    model_id: String,
    #[serde(rename = "systemPrompt")]
    system_prompt: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Settings {
    size: String,
    doubao: DoubaoConfig,
}

#[derive(Clone, Serialize, Deserialize)]
struct DoubaoConfigPayload {
    #[serde(rename = "baseURL")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "modelID")]
    model_id: String,
    #[serde(rename = "systemPrompt")]
    system_prompt: String,
    #[serde(rename = "isConfigured")]
    is_configured: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PetLibrary {
    custom_pet_dir: String,
    candidate_dirs: Vec<String>,
    videos: std::collections::HashMap<String, String>,
    missing_actions: Vec<String>,
}

#[derive(Deserialize)]
struct SaveDoubaoConfig {
    #[serde(rename = "baseURL")]
    base_url: Option<String>,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    #[serde(rename = "modelID")]
    model_id: Option<String>,
    #[serde(rename = "systemPrompt")]
    system_prompt: Option<String>,
}

#[derive(Serialize)]
struct ChatResult {
    ok: bool,
    text: Option<String>,
    error: Option<String>,
}

fn default_doubao() -> DoubaoConfig {
    DoubaoConfig {
        base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
        api_key: String::new(),
        model_id: String::new(),
        system_prompt: "你是豆包，是桌面宠物里的 AI 助手。请用自然、友好的中文与用户对话，并优先给出直接、有帮助的回答。".to_string(),
    }
}

fn default_settings() -> Settings {
    Settings {
        size: "large".to_string(),
        doubao: default_doubao(),
    }
}

fn size_pixels(size: &str) -> u32 {
    match size {
        "small" => 100,
        "medium" => 150,
        _ => 200,
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法读取设置目录：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建设置目录：{error}"))?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    let Ok(path) = settings_path(app) else {
        return default_settings();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return default_settings();
    };
    let mut settings: Settings = serde_json::from_str(&raw).unwrap_or_else(|_| default_settings());
    if !matches!(settings.size.as_str(), "large" | "medium" | "small") {
        settings.size = "large".to_string();
    }
    settings
}

fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("无法序列化设置：{error}"))?;
    fs::write(path, raw).map_err(|error| format!("无法保存设置：{error}"))
}

fn load_doubao_config(app: &AppHandle) -> DoubaoConfig {
    let mut config = load_settings(app).doubao;
    if let Ok(value) = std::env::var("ARK_BASE_URL").or_else(|_| std::env::var("DOUBAO_BASE_URL")) {
        config.base_url = value;
    }
    if let Ok(value) = std::env::var("ARK_API_KEY").or_else(|_| std::env::var("DOUBAO_API_KEY")) {
        config.api_key = value;
    }
    if let Ok(value) = std::env::var("ARK_MODEL").or_else(|_| std::env::var("DOUBAO_MODEL")) {
        config.model_id = value;
    }
    if let Ok(value) = std::env::var("DOUBAO_SYSTEM_PROMPT") {
        config.system_prompt = value;
    }
    config
}

fn is_doubao_configured(config: &DoubaoConfig) -> bool {
    !config.api_key.trim().is_empty() && !config.model_id.trim().is_empty()
}

fn current_window_size(app: &AppHandle) -> u32 {
    size_pixels(&load_settings(app).size)
}

fn downloads_dir(app: &AppHandle) -> PathBuf {
    match app.path().download_dir() {
        Ok(path) => path,
        Err(_) => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    }
}

fn candidate_pet_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let downloads = downloads_dir(app);
    vec![
        downloads.join("custompet"),
        downloads.join("custom_pet"),
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("custompet")
            .join("generated")
            .join("current"),
    ]
}

fn find_action_video(directory: &Path, action: &str) -> Option<PathBuf> {
    [
        directory.join(format!("{action}.mp4")),
        directory.join(format!("{action}.mov")),
        directory.join("hevc").join(format!("{action}.mov")),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn work_area(window: &WebviewWindow) -> Option<(i32, i32, u32, u32)> {
    let monitor = window.current_monitor().ok().flatten()?;
    let area = monitor.work_area();
    Some((
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
    ))
}

fn clamp(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn clamp_to_work_area(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> (i32, i32) {
    let Some((area_x, area_y, area_width, area_height)) = work_area(window) else {
        return (x, y);
    };
    let max_x = area_x + area_width as i32 - width as i32;
    let max_y = area_y + area_height as i32 - height as i32;
    (clamp(x, area_x, max_x), clamp(y, area_y, max_y))
}

fn clamp_manual_drag(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    pet_size: u32,
) -> (i32, i32) {
    let Some((area_x, area_y, area_width, area_height)) = work_area(window) else {
        return (x, y);
    };
    let min_visible = pet_size.min(80).max((pet_size as f32 * 0.6) as u32) as i32;
    let min_x = area_x - width as i32 + min_visible;
    let max_x = area_x + area_width as i32 - min_visible;
    let min_y = area_y - height as i32 + min_visible;
    let max_y = area_y + area_height as i32 - min_visible;
    (clamp(x, min_x, max_x), clamp(y, min_y, max_y))
}

fn set_window_bounds(window: &WebviewWindow, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    window
        .set_size(Size::Physical(PhysicalSize::new(width, height)))
        .map_err(|error| format!("无法调整窗口大小：{error}"))?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| format!("无法移动窗口：{error}"))
}

fn apply_window_mode(window: &WebviewWindow, app: &AppHandle, open: bool) -> Result<(), String> {
    let pet_size = current_window_size(app);
    let old_pos = window
        .outer_position()
        .map_err(|error| format!("无法读取窗口位置：{error}"))?;
    let old_size = window
        .outer_size()
        .map_err(|error| format!("无法读取窗口大小：{error}"))?;
    let next_width = if open { CHAT_WIDTH.max(pet_size) } else { pet_size };
    let next_height = if open { CHAT_HEIGHT } else { pet_size };
    let target = clamp_to_work_area(
        window,
        old_pos.x + old_size.width as i32 - next_width as i32,
        old_pos.y + old_size.height as i32 - next_height as i32,
        next_width,
        next_height,
    );
    set_window_bounds(window, target.0, target.1, next_width, next_height)
}

fn move_to_bottom_window(window: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    let pet_size = current_window_size(app);
    let Some((area_x, area_y, area_width, area_height)) = work_area(window) else {
        return Ok(());
    };
    let x = area_x + area_width as i32 - pet_size as i32 - 32;
    let y = area_y + area_height as i32 - pet_size as i32 - BOTTOM_MARGIN;
    let target = clamp_to_work_area(window, x, y, pet_size, pet_size);
    set_window_bounds(window, target.0, target.1, pet_size, pet_size)
}

fn open_in_explorer(path: PathBuf) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开文件夹：{error}"))
}

#[tauri::command]
fn get_videos(app: AppHandle) -> PetLibrary {
    let candidate_dirs = candidate_pet_dirs(&app);
    let existing_dirs: Vec<PathBuf> = candidate_dirs
        .iter()
        .filter(|path| path.exists())
        .cloned()
        .collect();
    let custom_pet_dir = existing_dirs
        .first()
        .cloned()
        .unwrap_or_else(|| candidate_dirs[0].clone());
    let mut videos = std::collections::HashMap::new();

    for action in ACTIONS {
        if let Some(video) = existing_dirs
            .iter()
            .find_map(|directory| find_action_video(directory, action))
        {
            videos.insert(action.to_string(), path_string(&video));
        }
    }

    let missing_actions = ACTIONS
        .into_iter()
        .filter(|action| !videos.contains_key(*action))
        .map(str::to_string)
        .collect();

    PetLibrary {
        custom_pet_dir: path_string(&custom_pet_dir),
        candidate_dirs: candidate_dirs.iter().map(|path| path_string(path)).collect(),
        videos,
        missing_actions,
    }
}

#[tauri::command]
fn get_size(app: AppHandle) -> u32 {
    current_window_size(&app)
}

#[tauri::command]
fn set_size(size: String, app: AppHandle, window: WebviewWindow) -> Result<u32, String> {
    if !matches!(size.as_str(), "large" | "medium" | "small") {
        return Err("不支持这个窗口大小。".to_string());
    }
    let mut settings = load_settings(&app);
    settings.size = size;
    save_settings(&app, &settings)?;
    apply_window_mode(&window, &app, false)?;
    Ok(current_window_size(&app))
}

#[tauri::command]
fn set_chat_open(open: bool, app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    apply_window_mode(&window, &app, open)
}

#[tauri::command]
fn return_bottom(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    move_to_bottom_window(&window, &app)
}

#[tauri::command]
fn move_by(delta_x: f64, delta_y: f64, app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let pet_size = current_window_size(&app);
    let pos = window
        .outer_position()
        .map_err(|error| format!("无法读取窗口位置：{error}"))?;
    let target = clamp_to_work_area(
        &window,
        pos.x + delta_x.round() as i32,
        pos.y + delta_y.round() as i32,
        pet_size,
        pet_size,
    );
    window
        .set_position(Position::Physical(PhysicalPosition::new(target.0, target.1)))
        .map_err(|error| format!("无法移动窗口：{error}"))
}

#[tauri::command]
fn drag_start(screen_x: f64, screen_y: f64, state: State<RuntimeState>, window: WebviewWindow) -> Result<(), String> {
    let pos = window
        .outer_position()
        .map_err(|error| format!("无法读取窗口位置：{error}"))?;
    *state
        .drag_offset
        .lock()
        .map_err(|_| "拖动状态被占用。".to_string())? = Some((screen_x - pos.x as f64, screen_y - pos.y as f64));
    Ok(())
}

#[tauri::command]
fn drag_move(
    screen_x: f64,
    screen_y: f64,
    app: AppHandle,
    state: State<RuntimeState>,
    window: WebviewWindow,
) -> Result<(), String> {
    let Some((offset_x, offset_y)) = *state
        .drag_offset
        .lock()
        .map_err(|_| "拖动状态被占用。".to_string())?
    else {
        return Ok(());
    };
    let pet_size = current_window_size(&app);
    let size = window
        .outer_size()
        .map_err(|error| format!("无法读取窗口大小：{error}"))?;
    let target = clamp_manual_drag(
        &window,
        (screen_x - offset_x).round() as i32,
        (screen_y - offset_y).round() as i32,
        size.width,
        size.height,
        pet_size,
    );
    window
        .set_position(Position::Physical(PhysicalPosition::new(target.0, target.1)))
        .map_err(|error| format!("无法移动窗口：{error}"))
}

#[tauri::command]
fn drag_end(state: State<RuntimeState>) -> Result<(), String> {
    *state
        .drag_offset
        .lock()
        .map_err(|_| "拖动状态被占用。".to_string())? = None;
    Ok(())
}

#[tauri::command]
fn get_doubao_config(app: AppHandle) -> DoubaoConfigPayload {
    let config = load_doubao_config(&app);
    DoubaoConfigPayload {
        is_configured: is_doubao_configured(&config),
        base_url: config.base_url,
        api_key: config.api_key,
        model_id: config.model_id,
        system_prompt: config.system_prompt,
    }
}

#[tauri::command]
fn save_doubao_config(
    config: SaveDoubaoConfig,
    app: AppHandle,
    state: State<RuntimeState>,
) -> Result<DoubaoConfigPayload, String> {
    let mut settings = load_settings(&app);
    settings.doubao = DoubaoConfig {
        base_url: config
            .base_url
            .unwrap_or_else(|| default_doubao().base_url)
            .trim()
            .to_string(),
        api_key: config.api_key.unwrap_or_default().trim().to_string(),
        model_id: config.model_id.unwrap_or_default().trim().to_string(),
        system_prompt: config
            .system_prompt
            .unwrap_or_else(|| default_doubao().system_prompt)
            .trim()
            .to_string(),
    };
    if settings.doubao.base_url.is_empty() {
        settings.doubao.base_url = default_doubao().base_url;
    }
    if settings.doubao.system_prompt.is_empty() {
        settings.doubao.system_prompt = default_doubao().system_prompt;
    }
    save_settings(&app, &settings)?;
    state
        .chat_history
        .lock()
        .map_err(|_| "聊天记录状态被占用。".to_string())?
        .clear();
    Ok(DoubaoConfigPayload {
        is_configured: is_doubao_configured(&settings.doubao),
        base_url: settings.doubao.base_url,
        api_key: settings.doubao.api_key,
        model_id: settings.doubao.model_id,
        system_prompt: settings.doubao.system_prompt,
    })
}

fn normalized_request_url(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.ends_with("/chat/completions") {
        Some(trimmed.to_string())
    } else {
        Some(format!("{}/chat/completions", trimmed.trim_end_matches('/')))
    }
}

#[tauri::command]
async fn send_chat(
    message: String,
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<ChatResult, String> {
    let text = message.trim().to_string();
    if text.is_empty() {
        return Ok(ChatResult {
            ok: false,
            text: None,
            error: Some("请输入要发送的内容。".to_string()),
        });
    }

    let config = load_doubao_config(&app);
    if !is_doubao_configured(&config) {
        return Ok(ChatResult {
            ok: false,
            text: None,
            error: Some("豆包还没有配置完成。请先打开“豆包 API 设置”，至少填写 API Key 和 Endpoint / Model。".to_string()),
        });
    }
    let Some(url) = normalized_request_url(&config.base_url) else {
        return Ok(ChatResult {
            ok: false,
            text: None,
            error: Some(format!("Doubao Base URL 无效：{}", config.base_url)),
        });
    };

    let messages = {
        let mut history = match state.chat_history.lock() {
            Ok(history) => history,
            Err(_) => {
                return Ok(ChatResult {
                    ok: false,
                    text: None,
                    error: Some("聊天记录状态被占用。".to_string()),
                });
            }
        };
        history.push(ChatMessage {
            role: "user".to_string(),
            content: text,
        });

        let mut messages = Vec::new();
        if !config.system_prompt.trim().is_empty() {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: config.system_prompt.clone(),
            });
        }
        let start = history.len().saturating_sub(16);
        messages.extend_from_slice(&history[start..]);
        messages
    };

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .bearer_auth(&config.api_key)
        .json(&serde_json::json!({
            "model": config.model_id,
            "messages": messages,
            "stream": false
        }))
        .send()
        .await;

    let Ok(response) = response else {
        return Ok(ChatResult {
            ok: false,
            text: None,
            error: Some("豆包请求失败，请检查网络。".to_string()),
        });
    };
    let status = response.status();
    let raw = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(ChatResult {
            ok: false,
            text: None,
            error: Some(format!("豆包返回了错误：\n{}", raw)),
        });
    }

    let decoded: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => {
            return Ok(ChatResult {
                ok: false,
                text: None,
                error: Some("豆包返回成功，但内容格式无法解析。".to_string()),
            });
        }
    };
    let reply = decoded["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if reply.is_empty() {
        return Ok(ChatResult {
            ok: false,
            text: None,
            error: Some("豆包返回成功，但回复内容为空。".to_string()),
        });
    }
    if let Ok(mut history) = state.chat_history.lock() {
        history.push(ChatMessage {
            role: "assistant".to_string(),
            content: reply.clone(),
        });
    }
    Ok(ChatResult {
        ok: true,
        text: Some(reply),
        error: None,
    })
}

#[tauri::command]
fn open_current_resource_dir(app: AppHandle) -> Result<(), String> {
    let library = get_videos(app);
    open_in_explorer(PathBuf::from(library.custom_pet_dir))
}

#[tauri::command]
fn open_downloads_dir(app: AppHandle) -> Result<(), String> {
    open_in_explorer(downloads_dir(&app))
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            get_videos,
            get_size,
            set_size,
            set_chat_open,
            return_bottom,
            move_by,
            drag_start,
            drag_move,
            drag_end,
            get_doubao_config,
            save_doubao_config,
            send_chat,
            open_current_resource_dir,
            open_downloads_dir,
            quit_app
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = move_to_bottom_window(&window, app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running GaoTa Deskpet");
}
