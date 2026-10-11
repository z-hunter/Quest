use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);
static APPEND_LOCK: Mutex<()> = Mutex::new(());

pub fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
  let parent = path.parent().ok_or_else(|| {
    io::Error::new(io::ErrorKind::InvalidInput, "Target path has no parent directory")
  })?;
  let file_name = path.file_name().ok_or_else(|| {
    io::Error::new(io::ErrorKind::InvalidInput, "Target path has no file name")
  })?;
  let (temp_path, mut file) = loop {
    let mut temp_name = file_name.to_os_string();
    temp_name.push(format!(".tmp-{}-{}", std::process::id(), TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed)));
    let candidate = parent.join(temp_name);
    match OpenOptions::new().write(true).create_new(true).open(&candidate) {
      Ok(file) => break (candidate, file),
      Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
      Err(error) => return Err(error),
    }
  };

  let result = (|| {
    file.write_all(content)?;
    file.flush()?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp_path, path)
  })();

  if result.is_err() {
    let _ = fs::remove_file(&temp_path);
  }
  result
}

pub fn append(path: &Path, content: &[u8]) -> io::Result<()> {
  let _lock = APPEND_LOCK
    .lock()
    .map_err(|_| io::Error::other("Append lock was poisoned"))?;
  OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)?
    .write_all(content)
}

#[cfg(test)]
mod tests {
  use super::atomic_write;
  use std::fs;
  use std::path::PathBuf;
  use std::sync::atomic::{AtomicU64, Ordering};

  static TEST_ID: AtomicU64 = AtomicU64::new(0);

  fn test_path() -> PathBuf {
    std::env::temp_dir().join(format!("quest-atomic-write-{}-{}", std::process::id(), TEST_ID.fetch_add(1, Ordering::Relaxed)))
  }

  #[test]
  fn replaces_existing_file() {
    let dir = test_path();
    fs::create_dir_all(&dir).unwrap();
    let target = dir.join("save.json");
    fs::write(&target, b"old").unwrap();

    atomic_write(&target, b"new").unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn failed_replace_preserves_original_and_cleans_temp() {
    let dir = test_path();
    fs::create_dir_all(&dir).unwrap();
    let target = dir.join("save.json");
    fs::write(&target, b"old").unwrap();
    let invalid_target = dir.join("occupied");
    fs::create_dir(&invalid_target).unwrap();
    fs::write(invalid_target.join("keep"), b"original").unwrap();

    assert!(atomic_write(&invalid_target, b"new").is_err());

    assert_eq!(fs::read(&target).unwrap(), b"old");
    assert_eq!(fs::read(invalid_target.join("keep")).unwrap(), b"original");
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn appends_lines_and_reports_io_errors() {
    let dir = test_path();
    fs::create_dir_all(&dir).unwrap();
    let target = dir.join("events.jsonl");

    super::append(&target, b"first\n").unwrap();
    super::append(&target, b"second\n").unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"first\nsecond\n");
    assert!(super::append(&dir.join("missing/file.jsonl"), b"line\n").is_err());
    fs::remove_dir_all(dir).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn failed_replace_preserves_locked_existing_file_and_cleans_temp() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    let dir = test_path();
    fs::create_dir_all(&dir).unwrap();
    let target = dir.join("save.json");
    fs::write(&target, b"original").unwrap();
    let _locked = OpenOptions::new()
      .read(true)
      .write(true)
      .share_mode(0)
      .open(&target)
      .unwrap();

    assert!(atomic_write(&target, b"replacement").is_err());

    drop(_locked);
    assert_eq!(fs::read(&target).unwrap(), b"original");
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    fs::remove_dir_all(dir).unwrap();
  }
}
