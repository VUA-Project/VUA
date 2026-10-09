//! Process entry helpers shared by the host and the optional AMF executable.
use std::io::BufReader;
use std::path::PathBuf;

pub fn database_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut arguments = std::env::args_os().skip(1);
    match (arguments.next(), arguments.next(), arguments.next()) {
        (Some(flag), Some(path), None) if flag == "--database" => {
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err("Provider database path must be absolute".into());
            }
            Ok(path)
        }
        _ => Err("usage: provider --database <absolute-path>".into()),
    }
}

pub fn legacy_database() -> Option<PathBuf> {
    std::env::var_os("VUA_LEGACY_TASK_DB").map(PathBuf::from)
}

// The reader thread needs Send; StdinLock is not Send on Windows.
#[cfg(windows)]
pub fn stdin_reader() -> BufReader<std::fs::File> {
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE};
    let handle = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    if handle.is_null() {
        eprintln!("VUA provider: no stdin handle available");
        std::process::exit(1);
    }
    unsafe { BufReader::new(std::fs::File::from_raw_handle(handle)) }
}

#[cfg(not(windows))]
pub fn stdin_reader() -> BufReader<std::io::Stdin> {
    BufReader::new(std::io::stdin())
}
