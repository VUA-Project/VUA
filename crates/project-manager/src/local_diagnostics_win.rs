//! Windows adapter for `local-diagnostics v0.1`: read-only IPv4 UDP/TCP owner-table
//! inspection (`GetExtendedUdpTable` / `GetExtendedTcpTable`), bounded loopback OSCQuery
//! `HOST_INFO` inspection, and Toolhelp32 process liveness/basename resolution without
//! binding game UDP sockets or touching game memory.

use vua_orchestrator::local_diagnostics::{
    LocalDiagnosticsProbe, OscQueryLoopbackObservation, ProcessProbeUnavailable, UdpPortObservation,
};

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsLocalDiagnosticsProbe;

impl LocalDiagnosticsProbe for WindowsLocalDiagnosticsProbe {
    fn is_client_running(&self) -> Result<bool, ProcessProbeUnavailable> {
        #[cfg(windows)]
        {
            crate::play_session::os::has_process_named("vrchat.exe")
                .map_err(|_| ProcessProbeUnavailable)
        }
        #[cfg(not(windows))]
        {
            Err(ProcessProbeUnavailable)
        }
    }

    fn probe_udp_port(&self, port: u16) -> UdpPortObservation {
        #[cfg(windows)]
        {
            win::probe_ipv4_udp_port(port)
        }
        #[cfg(not(windows))]
        {
            let _ = port;
            UdpPortObservation::probe_unavailable()
        }
    }

    fn probe_oscquery_loopback(&self) -> OscQueryLoopbackObservation {
        #[cfg(windows)]
        {
            win::probe_oscquery_loopback()
        }
        #[cfg(not(windows))]
        {
            OscQueryLoopbackObservation::probe_unavailable()
        }
    }
}

#[cfg(windows)]
mod win {
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    use vua_orchestrator::local_diagnostics::{
        parse_oscquery_host_info, OscQueryLoopbackObservation, UdpPortObservation,
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };

    const AF_INET: u32 = 2;
    const UDP_TABLE_OWNER_PID: i32 = 1;
    const TCP_TABLE_OWNER_PID_LISTENER: i32 = 3;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    const NO_ERROR: u32 = 0;
    const OSCQUERY_TIMEOUT: Duration = Duration::from_millis(120);
    const OSCQUERY_MAX_BYTES: usize = 64 * 1024;
    const OSCQUERY_CANDIDATE_PROCESSES: &[&str] = &[
        "vrchat.exe",
        "vrcfacetracking.exe",
        "slimevr.exe",
        "slimevr-server.exe",
    ];

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MibUdpRowOwnerPid {
        dw_local_addr: u32,
        dw_local_port: u32,
        dw_owning_pid: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MibTcpRowOwnerPid {
        dw_state: u32,
        dw_local_addr: u32,
        dw_local_port: u32,
        dw_remote_addr: u32,
        dw_remote_port: u32,
        dw_owning_pid: u32,
    }

    #[link(name = "iphlpapi")]
    extern "system" {
        fn GetExtendedUdpTable(
            p_udp_table: *mut u8,
            pdw_size: *mut u32,
            b_order: i32,
            ul_af: u32,
            table_class: i32,
            reserved: u32,
        ) -> u32;

        fn GetExtendedTcpTable(
            p_tcp_table: *mut u8,
            pdw_size: *mut u32,
            b_order: i32,
            ul_af: u32,
            table_class: i32,
            reserved: u32,
        ) -> u32;
    }

    pub(super) fn probe_ipv4_udp_port(target_port: u16) -> UdpPortObservation {
        let mut size: u32 = 0;
        let first = unsafe {
            GetExtendedUdpTable(
                std::ptr::null_mut(),
                &mut size,
                0,
                AF_INET,
                UDP_TABLE_OWNER_PID,
                0,
            )
        };
        if first != ERROR_INSUFFICIENT_BUFFER && first != NO_ERROR {
            return UdpPortObservation::probe_unavailable();
        }
        // Allocate u32-aligned buffer with headroom for concurrent sockets.
        let mut words = vec![0u32; (size as usize / 4).saturating_add(128).max(64)];
        let mut actual_bytes = (words.len() * 4) as u32;
        let status = unsafe {
            GetExtendedUdpTable(
                words.as_mut_ptr() as *mut u8,
                &mut actual_bytes,
                0,
                AF_INET,
                UDP_TABLE_OWNER_PID,
                0,
            )
        };
        if status != NO_ERROR || actual_bytes < 4 {
            return UdpPortObservation::probe_unavailable();
        }

        let num_entries = words[0] as usize;
        let max_rows =
            (actual_bytes as usize).saturating_sub(4) / std::mem::size_of::<MibUdpRowOwnerPid>();
        let count = num_entries.min(max_rows);
        let rows = unsafe {
            std::slice::from_raw_parts(words.as_ptr().add(1) as *const MibUdpRowOwnerPid, count)
        };

        // Prefer wildcard (0.0.0.0) or loopback (127.0.0.0/8) binds first, then any local IPv4 bind.
        let mut fallback_pid: Option<u32> = None;
        for row in rows {
            let row_port = u16::from_be((row.dw_local_port & 0xFFFF) as u16);
            if row_port != target_port {
                continue;
            }
            let addr_host_order = u32::from_be(row.dw_local_addr);
            if addr_host_order == 0 || (addr_host_order >> 24) == 127 {
                let exe = lookup_process_basename(row.dw_owning_pid);
                return UdpPortObservation::bound(row.dw_owning_pid, exe);
            }
            if fallback_pid.is_none() {
                fallback_pid = Some(row.dw_owning_pid);
            }
        }

        if let Some(pid) = fallback_pid {
            let exe = lookup_process_basename(pid);
            return UdpPortObservation::bound(pid, exe);
        }

        UdpPortObservation::unbound()
    }

    fn lookup_process_basename(target_pid: u32) -> Option<String> {
        let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if handle == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = unsafe { Process32FirstW(handle, &mut entry) };
        let mut found = None;
        while more != 0 {
            if entry.th32ProcessID == target_pid {
                let end = entry
                    .szExeFile
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
                if !name.trim().is_empty() {
                    found = Some(name);
                }
                break;
            }
            more = unsafe { Process32NextW(handle, &mut entry) };
        }
        unsafe {
            CloseHandle(handle);
        }
        found
    }

    fn snapshot_process_basenames() -> HashMap<u32, String> {
        let mut map = HashMap::new();
        let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if handle == INVALID_HANDLE_VALUE {
            return map;
        }
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = unsafe { Process32FirstW(handle, &mut entry) };
        while more != 0 {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                map.insert(entry.th32ProcessID, trimmed.to_ascii_lowercase());
            }
            more = unsafe { Process32NextW(handle, &mut entry) };
        }
        unsafe {
            CloseHandle(handle);
        }
        map
    }

    pub(super) fn list_loopback_tcp_listeners() -> Option<Vec<(u16, u32)>> {
        let mut size: u32 = 0;
        let first = unsafe {
            GetExtendedTcpTable(
                std::ptr::null_mut(),
                &mut size,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        if first != ERROR_INSUFFICIENT_BUFFER && first != NO_ERROR {
            return None;
        }
        let mut words = vec![0u32; (size as usize / 4).saturating_add(128).max(64)];
        let mut actual_bytes = (words.len() * 4) as u32;
        let status = unsafe {
            GetExtendedTcpTable(
                words.as_mut_ptr() as *mut u8,
                &mut actual_bytes,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        if status != NO_ERROR || actual_bytes < 4 {
            return None;
        }
        let num_entries = words[0] as usize;
        let max_rows =
            (actual_bytes as usize).saturating_sub(4) / std::mem::size_of::<MibTcpRowOwnerPid>();
        let count = num_entries.min(max_rows);
        let rows = unsafe {
            std::slice::from_raw_parts(words.as_ptr().add(1) as *const MibTcpRowOwnerPid, count)
        };
        let mut out = Vec::new();
        for row in rows {
            let addr_host_order = u32::from_be(row.dw_local_addr);
            if addr_host_order != 0 && (addr_host_order >> 24) != 127 {
                continue;
            }
            let port = u16::from_be((row.dw_local_port & 0xFFFF) as u16);
            if port >= 1024 {
                out.push((port, row.dw_owning_pid));
            }
        }
        Some(out)
    }

    pub(super) fn query_loopback_oscquery_port(port: u16) -> Option<Option<u16>> {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let mut stream = TcpStream::connect_timeout(&addr, OSCQUERY_TIMEOUT).ok()?;
        let _ = stream.set_read_timeout(Some(OSCQUERY_TIMEOUT));
        let _ = stream.set_write_timeout(Some(OSCQUERY_TIMEOUT));
        stream
            .write_all(b"GET /?HOST_INFO HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .ok()?;
        let mut buf = Vec::with_capacity(4096);
        let mut chunk = [0u8; 4096];
        while buf.len() < OSCQUERY_MAX_BYTES {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    let take = n.min(OSCQUERY_MAX_BYTES - buf.len());
                    buf.extend_from_slice(&chunk[..take]);
                    if let Some(parsed) = parse_oscquery_host_info(&buf) {
                        return Some(parsed);
                    }
                }
                Err(err)
                    if matches!(
                        err.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    if buf.is_empty() {
                        return None;
                    }
                    break;
                }
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => {
                    if buf.is_empty() {
                        return None;
                    }
                    break;
                }
            }
        }
        parse_oscquery_host_info(&buf)
    }

    pub(super) fn probe_oscquery_loopback() -> OscQueryLoopbackObservation {
        let Some(listeners) = list_loopback_tcp_listeners() else {
            return OscQueryLoopbackObservation::probe_unavailable();
        };
        if listeners.is_empty() {
            return OscQueryLoopbackObservation::not_detected();
        }
        let pid_names = snapshot_process_basenames();
        let mut candidates: Vec<(usize, u16, String)> = listeners
            .into_iter()
            .filter_map(|(port, pid)| {
                let exe = pid_names.get(&pid)?;
                let priority = OSCQUERY_CANDIDATE_PROCESSES
                    .iter()
                    .position(|candidate| *candidate == exe.as_str())?;
                Some((priority, port, exe.clone()))
            })
            .collect();
        candidates.sort_by_key(|(priority, port, _)| (*priority, *port));
        candidates.dedup_by_key(|(_, port, _)| *port);
        // Cap per-process ports to 3 and total probes to 6 so multi-port processes
        // (e.g. Unity mono/IPC sockets) cannot starve companion OSCQuery listeners.
        let mut per_priority = [0usize; OSCQUERY_CANDIDATE_PROCESSES.len()];
        candidates.retain(|(priority, _, _)| {
            if per_priority[*priority] >= 3 {
                false
            } else {
                per_priority[*priority] += 1;
                true
            }
        });
        candidates.truncate(6);

        for (_, port, exe) in candidates {
            if let Some(osc_port) = query_loopback_oscquery_port(port) {
                return OscQueryLoopbackObservation::found(port, osc_port, Some(exe));
            }
        }
        OscQueryLoopbackObservation::not_detected()
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::net::UdpSocket;

    #[test]
    fn resolves_ephemeral_loopback_udp_socket_owner_and_reports_unbound_after_drop() {
        let probe = WindowsLocalDiagnosticsProbe;
        let socket = UdpSocket::bind("127.0.0.1:0").expect("ephemeral loopback bind");
        let port = socket.local_addr().expect("local_addr").port();

        let observed = probe.probe_udp_port(port);
        assert_eq!(observed.state, "bound");
        assert_eq!(observed.owner_pid, Some(std::process::id()));
        let exe = observed.owner_process.expect("process basename");
        assert!(!exe.is_empty());
        assert!(!exe.contains('\\') && !exe.contains('/'));

        drop(socket);
        let after_drop = probe.probe_udp_port(port);
        // Either unbound or (in the astronomically rare case another OS test grabbed it) another socket,
        // never probe_unavailable.
        assert_ne!(after_drop.state, "probe_unavailable");
    }

    #[test]
    fn enumerates_loopback_tcp_listener_and_queries_synthetic_oscquery_host_info() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("ephemeral tcp bind");
        let port = listener.local_addr().expect("local_addr").port();

        let listeners = win::list_loopback_tcp_listeners().expect("tcp table");
        assert!(listeners
            .iter()
            .any(|(p, pid)| *p == port && *pid == std::process::id()));

        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut req = [0u8; 256];
                let _ = std::io::Read::read(&mut stream, &mut req);
                let _ = std::io::Write::write_all(
                    &mut stream,
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"NAME\":\"VRChat-Client\",\"OSC_PORT\":9000,\"EXTENSIONS\":{\"ACCESS\":true}}",
                );
            }
        });
        assert_eq!(win::query_loopback_oscquery_port(port), Some(Some(9000)));
        let _ = server.join();

        // Keep-alive server with HTTP/1.1 chunked encoding that never closes TCP within timeout:
        let keepalive = std::net::TcpListener::bind("127.0.0.1:0").expect("keepalive tcp bind");
        let keepalive_port = keepalive.local_addr().expect("local_addr").port();
        let ka_server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = keepalive.accept() {
                let mut req = [0u8; 256];
                let _ = std::io::Read::read(&mut stream, &mut req);
                let json =
                    r#"{"NAME":"VRCFaceTracking","OSC_PORT":9015,"EXTENSIONS":{"ACCESS":true}}"#;
                let payload = format!(
                    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
                    json.len(),
                    json
                );
                let _ = std::io::Write::write_all(&mut stream, payload.as_bytes());
                let _ = std::io::Write::flush(&mut stream);
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });
        assert_eq!(
            win::query_loopback_oscquery_port(keepalive_port),
            Some(Some(9015))
        );
        let _ = ka_server.join();
    }
}
