use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use walkdir::WalkDir;

static SEARCH_CANCELLED: AtomicBool = AtomicBool::new(false);

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileNodeInfo {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    extension: Option<String>,
}

#[tauri::command]
fn read_directory(path: &str) -> Result<Vec<FileNodeInfo>, String> {
    let mut entries = Vec::new();
    let dir_path = Path::new(path);

    if !dir_path.exists() || !dir_path.is_dir() {
        return Err(format!("Path {} does not exist or is not a directory", path));
    }

    match fs::read_dir(dir_path) {
        Ok(read_dir) => {
            for entry in read_dir.flatten() {
                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue, // Skip if we can't get metadata (e.g., permissions)
                };
                
                let is_dir = metadata.is_dir();
                let file_name = entry.file_name().to_string_lossy().to_string();
                let file_path = entry.path().to_string_lossy().to_string();
                let size = metadata.len();
                let extension = entry.path().extension().map(|e| e.to_string_lossy().to_string());
                
                entries.push(FileNodeInfo {
                    name: file_name,
                    path: file_path,
                    is_dir,
                    size,
                    extension,
                });
            }
            
            // Sort items: Directories appear first, alphabetical
            entries.sort_by(|a, b| {
                b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
            });
            
            Ok(entries)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }
    
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_path(old_path: &str, new_name: &str) -> Result<(), String> {
    let old_p = Path::new(old_path);
    if !old_p.exists() {
        return Err("Path does not exist".to_string());
    }
    
    let parent = old_p.parent().ok_or("Cannot rename root".to_string())?;
    let new_p = parent.join(new_name);
    
    if new_p.exists() {
        return Err("A file with the new name already exists".to_string());
    }
    
    fs::rename(old_p, new_p).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_path(source_path: &str, target_dir: &str) -> Result<(), String> {
    let source = Path::new(source_path);
    let target = Path::new(target_dir);
    
    if !source.exists() {
        return Err("Source path does not exist".to_string());
    }
    if !target.exists() || !target.is_dir() {
        return Err("Target directory does not exist or is not a directory".to_string());
    }
    
    let file_name = source.file_name().ok_or("Invalid source path".to_string())?;
    
    // Handle duplicate names by appending ' - Copy'
    let mut dest_name = file_name.to_owned();
    let mut dest = target.join(&dest_name);
    let mut counter = 1;
    
    while dest.exists() {
        let name_str = file_name.to_string_lossy();
        if source.is_dir() {
            dest_name = std::ffi::OsString::from(format!("{} - Copy ({})", name_str, counter));
        } else {
            if let Some(ext_idx) = name_str.rfind('.') {
                let name = &name_str[..ext_idx];
                let ext = &name_str[ext_idx..];
                dest_name = std::ffi::OsString::from(format!("{} - Copy ({}){}", name, counter, ext));
            } else {
                dest_name = std::ffi::OsString::from(format!("{} - Copy ({})", name_str, counter));
            }
        }
        dest = target.join(&dest_name);
        counter += 1;
    }
    
    if source.is_dir() {
        copy_dir_all(&source, &dest).map_err(|e| e.to_string())
    } else {
        fs::copy(&source, &dest).map_err(|e| e.to_string()).map(|_| ())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RootDrive {
    path: String,
    label: String,
}

#[tauri::command]
fn get_system_roots() -> Result<Vec<RootDrive>, String> {
    let mut roots = Vec::new();

    #[cfg(windows)]
    {
        // Add typical windows drives
        let paths = ["C:\\", "D:\\", "E:\\", "F:\\", "G:\\"];
        for p in paths {
            if Path::new(p).exists() {
                roots.push(RootDrive {
                    path: p.to_string(),
                    label: format!("Drive ({})", &p[0..2]),
                });
            }
        }
    }
    
    #[cfg(not(windows))]
    {
        // For Unix-like systems, just provide root
        roots.push(RootDrive {
            path: "/".to_string(),
            label: "Root (/)".to_string(),
        });
    }

    // Attempt to add Desktop
    if let Some(user_dirs) = directories::UserDirs::new() {
        if let Some(desktop_path) = user_dirs.desktop_dir() {
            if desktop_path.exists() {
                roots.push(RootDrive {
                    path: desktop_path.to_string_lossy().to_string(),
                    label: "Desktop".to_string(),
                });
            }
        }
        
        // Let's also add Documents as a bonus often-used folder
        if let Some(doc_path) = user_dirs.document_dir() {
            if doc_path.exists() {
                roots.push(RootDrive {
                    path: doc_path.to_string_lossy().to_string(),
                    label: "Documents".to_string(),
                });
            }
        }
    }

    // Fallback if truly empty (unlikely but safe)
    if roots.is_empty() {
        roots.push(RootDrive {
            path: "C:\\".to_string(),
            label: "Fallback Root".to_string(),
        });
    }

    Ok(roots)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    path: String,
    name: String,
    is_dir: bool,
    parent_path: String,
}

#[tauri::command]
fn cancel_search() {
    SEARCH_CANCELLED.store(true, Ordering::Relaxed);
}

#[tauri::command]
async fn search_files(
    query: String,
    filter: Option<String>,
    window: tauri::Window
) -> Result<Vec<SearchResult>, String> {
    // Reset cancel flag
    SEARCH_CANCELLED.store(false, Ordering::Relaxed);

    let query_lower = query.to_lowercase();
    let filter_mode = filter.unwrap_or_else(|| "all".to_string()).to_lowercase();
    
    let roots_info = get_system_roots().unwrap_or_else(|_| {
        vec![RootDrive { path: "C:\\".to_string(), label: "Fallback".to_string() }]
    });

    let mut results = Vec::new();
    let max_results = 200;
    
    #[derive(Clone, Serialize)]
    struct ProgressPayload {
        scanned_count: usize,
        current_path: String,
    }

    let mut scanned = 0;

    'outer: for root_info in roots_info {
        let root = Path::new(&root_info.path);
        
        for entry in WalkDir::new(root)
            .max_depth(5)
            .into_iter()
            .filter_map(Result::ok) 
        {
            // Check cancellation
            if SEARCH_CANCELLED.load(Ordering::Relaxed) {
                break 'outer;
            }

            let file_name = entry.file_name().to_string_lossy().to_lowercase();
            let is_dir = entry.file_type().is_dir();
            scanned += 1;

            if scanned % 100 == 0 {
                let _ = tauri::Emitter::emit(&window, "search-progress", ProgressPayload {
                    scanned_count: scanned,
                    current_path: entry.path().to_string_lossy().to_string(),
                });
            }

            // Apply filter
            match filter_mode.as_str() {
                "dirs" => { if !is_dir { continue; } },
                "files" => { if is_dir { continue; } },
                "all" => {},
                ext => {
                    // Filter by extension (e.g. ".pdf")
                    if is_dir { continue; }
                    let entry_ext = entry.path().extension()
                        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                        .unwrap_or_default();
                    if entry_ext != ext { continue; }
                }
            }

            if file_name.contains(&query_lower) {
                let parent = entry.path().parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                results.push(SearchResult {
                    path: entry.path().to_string_lossy().to_string(),
                    name: entry.file_name().to_string_lossy().to_string(),
                    is_dir,
                    parent_path: parent,
                });
                
                if results.len() >= max_results {
                    break 'outer;
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
async fn system_open(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use std::ffi::OsStr;
        
        let path_wide: Vec<u16> = OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            // ShellExecuteW is the direct Win32 API to open files. 
            // It's much faster than spawning a new explorer.exe process.
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                0 as windows_sys::Win32::Foundation::HWND,
                std::ptr::null(),
                path_wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
            );
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(cmd)
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
async fn move_path(source_path: String, target_dir: String) -> Result<(), String> {
    let source = Path::new(&source_path);
    let target = Path::new(&target_dir);
    
    if !source.exists() {
        return Err("Source path does not exist".to_string());
    }
    if !target.exists() || !target.is_dir() {
        return Err("Target directory does not exist or is not a directory".to_string());
    }
    
    let file_name = source.file_name().ok_or("Invalid source path".to_string())?;
    let dest = target.join(file_name);
    
    if dest.exists() {
        return Err(format!("A file named '{}' already exists in the target directory", file_name.to_string_lossy()));
    }
    
    // Try rename first (works for same-drive moves)
    match fs::rename(&source, &dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            // Cross-drive: copy then delete
            if source.is_dir() {
                copy_dir_all(&source, &dest).map_err(|e| e.to_string())?;
                fs::remove_dir_all(&source).map_err(|e| e.to_string())?;
            } else {
                fs::copy(&source, &dest).map_err(|e| e.to_string())?;
                fs::remove_file(&source).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
    }
}

#[tauri::command]
async fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Open the parent directory
        let parent = Path::new(&path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_directory,
            delete_path,
            rename_path,
            copy_path,
            get_system_roots,
            search_files,
            system_open,
            move_path,
            reveal_in_explorer,
            cancel_search
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
