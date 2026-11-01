use std::fs::{self, File};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_fs::FsExt;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Extractions gardées pour rouvrir vite un document, et pour une autre fenêtre encore ouverte dessus.
const KEEP_OPENED: Duration = Duration::from_secs(7 * 24 * 3600);
const OPENED_DIR: &str = "opened";
const PENDING_DIR: &str = "pending";
const COMPLETE: &str = ".complete";
const ZIP32_LIMIT: u64 = 0xFFFF_FFFF;

/// Fichier .ubz ou .iwb passé en argument (double-clic dans l'explorateur) : on autorise sa lecture.
#[tauri::command]
fn launch_file(app: tauri::AppHandle) -> Option<String> {
    let path = std::env::args().skip(1).find(|a| {
        let a = a.to_lowercase();
        a.ends_with(".ubz") || a.ends_with(".iwb")
    })?;
    let _ = app.fs_scope().allow_file(&path);
    Some(path)
}

/// Dossier d'une session ou d'un média : ses fichiers (sans les sous-dossiers) deviennent lisibles et inscriptibles.
#[tauri::command]
fn allow_media_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&dir, false)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&dir, false)
        .map_err(|e| e.to_string())
}

fn allow_tree(app: &tauri::AppHandle, dir: &Path) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(dir, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(dir, true)
        .map_err(|e| e.to_string())
}

fn cache_subdir(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Où écrire un média converti ou déposé, qui n'a pas encore de fichier.
#[tauri::command]
fn media_cache_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = cache_subdir(&app, PENDING_DIR)?;
    allow_tree(&app, &dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[derive(Deserialize)]
struct MediaEntry {
    name: String,
    path: String,
}

fn write_ubz(part: &Path, tmp: &Path, media: &[MediaEntry]) -> Result<(), Box<dyn std::error::Error>> {
    let mut zip = ZipWriter::new(File::create(tmp)?);
    let mut pages = ZipArchive::new(File::open(part)?)?;
    for i in 0..pages.len() {
        zip.raw_copy_file(pages.by_index_raw(i)?)?;
    }
    for m in media {
        let mut source = File::open(&m.path)?;
        let size = source.metadata()?.len();
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .large_file(size >= ZIP32_LIMIT);
        zip.start_file(m.name.as_str(), options)?;
        io::copy(&mut source, &mut zip)?;
    }
    zip.finish()?.sync_all()?;
    Ok(())
}

/// Ajoute les médias au zip des pages, puis remplace la cible d'un seul coup : une erreur laisse l'ancien fichier intact.
#[tauri::command(async)]
fn ubz_finish(part: String, target: String, media: Vec<MediaEntry>) -> Result<(), String> {
    let tmp = format!("{target}.tmp");
    let result = write_ubz(Path::new(&part), Path::new(&tmp), &media)
        .map_err(|e| e.to_string())
        .and_then(|()| fs::rename(&tmp, &target).map_err(|e| e.to_string()));
    let _ = fs::remove_file(&part);
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[derive(Serialize)]
struct OpenedUbz {
    dir: String,
    files: Vec<String>,
}

fn extract(path: &Path, dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let mut archive = ZipArchive::new(File::open(path)?)?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        // Jamais hors du dossier, quels que soient les noms contenus dans le fichier
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let out = dir.join(name);
        if entry.is_dir() {
            fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        io::copy(&mut entry, &mut File::create(&out)?)?;
    }
    Ok(())
}

fn list_files(root: &Path, dir: &Path, out: &mut Vec<String>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            list_files(root, &path, out)?;
        } else if path.file_name().is_some_and(|n| n != COMPLETE) {
            let rel = path.strip_prefix(root).map_err(io::Error::other)?;
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

/// Extrait un .ubz dans le cache ; le même fichier, inchangé, n'est pas extrait deux fois.
#[tauri::command(async)]
fn ubz_open(app: tauri::AppHandle, path: String) -> Result<OpenedUbz, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let mut hash = DefaultHasher::new();
    path.hash(&mut hash);
    meta.len().hash(&mut hash);
    meta.modified().map_err(|e| e.to_string())?.hash(&mut hash);
    let dir = cache_subdir(&app, OPENED_DIR)?.join(format!("{:016x}", hash.finish()));
    let complete = dir.join(COMPLETE);
    if !complete.exists() {
        // Une extraction interrompue ne doit pas passer pour complète
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        extract(Path::new(&path), &dir).map_err(|e| {
            let _ = fs::remove_dir_all(&dir);
            format!("Ce fichier n'est pas un document valide : {e}")
        })?;
    }
    fs::write(&complete, b"").map_err(|e| e.to_string())?; // sa date marque le dernier usage
    allow_tree(&app, &dir)?;
    let mut files = Vec::new();
    list_files(&dir, &dir, &mut files).map_err(|e| e.to_string())?;
    Ok(OpenedUbz {
        dir: dir.to_string_lossy().into_owned(),
        files,
    })
}

/// Retire ce qui n'a pas servi depuis longtemps ; un fichier encore utilisé par une autre fenêtre est protégé par sa date.
fn clean_cache(app: &tauri::AppHandle) {
    for name in [OPENED_DIR, PENDING_DIR] {
        let Ok(root) = cache_subdir(app, name) else {
            continue;
        };
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let marker = if path.is_dir() { path.join(COMPLETE) } else { path.clone() };
            let age = fs::metadata(&marker)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| SystemTime::now().duration_since(t).ok());
            // Sans date lisible : extraction interrompue, à retirer
            if age.is_none_or(|a| a > KEEP_OPENED) {
                let _ = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || clean_cache(&handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_file,
            allow_media_dir,
            media_cache_dir,
            ubz_finish,
            ubz_open
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
