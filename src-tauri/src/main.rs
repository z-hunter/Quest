#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
struct FileListItem {
  name: String,
  #[serde(rename = "isDir")]
  is_dir: bool,
}

fn project_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let _ = app;
  if let Ok(explicit_root) = std::env::var("QUEST_PROJECT_ROOT") {
    let explicit_path = PathBuf::from(explicit_root);
    if explicit_path.exists() {
      return Ok(explicit_path);
    }
  }

  #[cfg(debug_assertions)]
  {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest_dir.parent() {
      return Ok(parent.to_path_buf());
    }
  }

  #[cfg(not(debug_assertions))]
  {
    if let Ok(exe_path) = std::env::current_exe() {
      if let Some(parent) = exe_path.parent() {
        return Ok(parent.to_path_buf());
      }
    }
  }

  Err("Failed to determine project root.".into())
}

fn sanitize_relative_path(raw: &str) -> Result<PathBuf, String> {
  let path = Path::new(raw);
  if path.is_absolute() {
    return Err("Absolute paths are not allowed.".into());
  }

  let mut clean = PathBuf::new();
  for component in path.components() {
    match component {
      Component::Normal(part) => clean.push(part),
      Component::CurDir => {}
      Component::ParentDir => {
        return Err("Parent-directory segments are not allowed.".into());
      }
      Component::Prefix(_) | Component::RootDir => {
        return Err("Unsupported path segment.".into());
      }
    }
  }

  if clean.as_os_str().is_empty() {
    return Err("Path cannot be empty.".into());
  }

  Ok(clean)
}

fn resolve_project_path(app: &tauri::AppHandle, raw: &str) -> Result<PathBuf, String> {
  let root = project_root(app)?;
  let clean = sanitize_relative_path(raw)?;
  Ok(root.join(clean))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
  let parent = path
    .parent()
    .ok_or_else(|| "Target path has no parent directory.".to_string())?;
  fs::create_dir_all(parent).map_err(|error| format!("Failed to create parent directory: {error}"))
}

fn ensure_file(path: &Path, content: &str) -> Result<(), String> {
  if path.exists() {
    return Ok(());
  }

  ensure_parent_dir(path)?;
  fs::write(path, content).map_err(|error| format!("Failed to create file: {error}"))
}

fn open_with_system(target: &Path) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  let mut command = {
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/C", "start", "", target.to_string_lossy().as_ref()]);
    cmd
  };

  #[cfg(target_os = "macos")]
  let mut command = {
    let mut cmd = std::process::Command::new("open");
    cmd.arg(target);
    cmd
  };

  #[cfg(all(unix, not(target_os = "macos")))]
  let mut command = {
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(target);
    cmd
  };

  command
    .spawn()
    .map_err(|error| format!("Failed to open path in system shell: {error}"))?;
  Ok(())
}

#[tauri::command]
fn list_project_files(app: tauri::AppHandle, path: String) -> Result<Vec<FileListItem>, String> {
  let target = resolve_project_path(&app, &path)?;
  if !target.exists() {
    return Ok(Vec::new());
  }

  let mut items = Vec::new();
  let entries =
    fs::read_dir(target).map_err(|error| format!("Failed to read directory contents: {error}"))?;

  for entry in entries {
    let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
    let file_type = entry
      .file_type()
      .map_err(|error| format!("Failed to determine directory entry type: {error}"))?;
    items.push(FileListItem {
      name: entry.file_name().to_string_lossy().to_string(),
      is_dir: file_type.is_dir(),
    });
  }

  items.sort_by(|left, right| match (left.is_dir, right.is_dir) {
    (true, false) => std::cmp::Ordering::Less,
    (false, true) => std::cmp::Ordering::Greater,
    _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
  });

  Ok(items)
}

#[tauri::command]
fn ensure_project_file(
  app: tauri::AppHandle,
  path: String,
  content: Option<String>,
) -> Result<(), String> {
  let target = resolve_project_path(&app, &path)?;
  ensure_file(&target, content.unwrap_or_else(|| "{}".to_string()).as_str())
}

#[tauri::command]
fn save_project_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
  let target = resolve_project_path(&app, &path)?;
  ensure_parent_dir(&target)?;
  fs::write(target, content).map_err(|error| format!("Failed to write file: {error}"))
}

#[tauri::command]
fn read_project_file(
  app: tauri::AppHandle,
  path: String,
  content: Option<String>,
) -> Result<String, String> {
  let target = resolve_project_path(&app, &path)?;
  ensure_file(&target, content.unwrap_or_else(|| "{}".to_string()).as_str())?;
  fs::read_to_string(target).map_err(|error| format!("Failed to read file: {error}"))
}

#[tauri::command]
fn open_project_file(
  app: tauri::AppHandle,
  path: String,
  content: Option<String>,
) -> Result<(), String> {
  let target = resolve_project_path(&app, &path)?;
  ensure_file(&target, content.unwrap_or_else(|| "{}".to_string()).as_str())?;
  open_with_system(&target)
}

#[tauri::command]
fn delete_project_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let target = resolve_project_path(&app, &path)?;
  if !target.exists() {
    return Ok(());
  }

  fs::remove_file(target).map_err(|error| format!("Failed to delete file: {error}"))
}

#[tauri::command]
fn open_project_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let target = resolve_project_path(&app, &path)?;
  if !target.exists() {
    fs::create_dir_all(&target)
      .map_err(|error| format!("Failed to create target directory before opening it: {error}"))?;
  }
  open_with_system(&target)
}

#[tauri::command]
fn read_project_file_existing(app: tauri::AppHandle, path: String) -> Result<String, String> {
  let target = resolve_project_path(&app, &path)?;
  fs::read_to_string(target).map_err(|error| format!("Failed to read file: {error}"))
}

#[tauri::command]
fn read_project_file_base64(app: tauri::AppHandle, path: String) -> Result<String, String> {
  let target = resolve_project_path(&app, &path)?;
  let bytes = fs::read(target).map_err(|error| format!("Failed to read file bytes: {error}"))?;
  use base64::{Engine as _, engine::general_purpose::STANDARD};
  Ok(STANDARD.encode(&bytes))
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      list_project_files,
      ensure_project_file,
      save_project_file,
      read_project_file,
      read_project_file_existing,
      read_project_file_base64,
      open_project_file,
      delete_project_file,
      open_project_folder
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

