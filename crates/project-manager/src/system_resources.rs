//! Read-only desktop sampling. No task DB, AMF, user files or network access.
//! Internal line frames are consumed only by Electron's resource collector.
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSample {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub usage_percent: Option<f64>,
    pub dedicated_used_bytes: Option<u64>,
    pub dedicated_total_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSample {
    pub cpu_usage_percent: Option<f64>,
    pub gpus: Vec<GpuSample>,
    pub steam_vr_running: Option<bool>,
}

/// The busiest engine represents one physical GPU; processes sharing the same
/// engine are summed, independent engines are never averaged or added together.
pub fn busiest_engine(samples: &[(String, f64)]) -> Option<f64> {
    let mut engines = std::collections::BTreeMap::<&str, f64>::new();
    for (engine, value) in samples {
        if value.is_finite() && *value >= 0.0 {
            *engines.entry(engine).or_default() += value;
        }
    }
    engines
        .values()
        .copied()
        .reduce(f64::max)
        .map(|n| n.clamp(0.0, 100.0))
}

/// Strip PID and engine type while preserving the adapter LUID and physical
/// node. Linked nodes must not be combined with another node's memory reading.
fn instance_parts(instance: &str) -> Option<(String, Option<String>)> {
    let start = instance.find("luid_")?;
    let suffix = instance[start..].split('#').next()?;
    let (adapter, engine) = match suffix.split_once("_eng_") {
        Some((adapter, engine)) => (adapter, Some(engine.split('_').next()?.to_owned())),
        None => (suffix, None),
    };
    let (_, physical) = adapter.rsplit_once("_phys_")?;
    physical.parse::<u32>().ok()?;
    Some((adapter.to_lowercase(), engine))
}

#[cfg(windows)]
mod native {
    use super::*;
    use windows::{
        core::{w, PCWSTR},
        Win32::{
            Graphics::{
                Direct3D::D3D_FEATURE_LEVEL_11_0,
                Direct3D12::{
                    D3D12CreateDevice, ID3D12Device, D3D12_FEATURE_ARCHITECTURE,
                    D3D12_FEATURE_DATA_ARCHITECTURE,
                },
                Dxgi::{
                    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_REMOTE,
                    DXGI_ADAPTER_FLAG_SOFTWARE,
                },
            },
            System::Performance::*,
        },
    };

    struct Query {
        handle: PDH_HQUERY,
        cpu: PDH_HCOUNTER,
        engines: PDH_HCOUNTER,
        memory: PDH_HCOUNTER,
    }
    impl Drop for Query {
        fn drop(&mut self) {
            unsafe {
                PdhCloseQuery(self.handle);
            }
        }
    }
    impl Query {
        fn open() -> Option<Self> {
            let mut handle = PDH_HQUERY::default();
            if unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut handle) } != 0 {
                return None;
            }
            let add = |path| {
                let mut counter = PDH_HCOUNTER::default();
                unsafe {
                    PdhAddEnglishCounterW(handle, path, 0, &mut counter);
                }
                counter
            };
            let query = Self {
                handle,
                // The total covers all logical processors/processor groups;
                // not a per-socket mean or this sampler's process CPU usage.
                cpu: add(w!("\\Processor Information(_Total)\\% Processor Time")),
                engines: add(w!("\\GPU Engine(*)\\Utilization Percentage")),
                memory: add(w!("\\GPU Adapter Memory(*)\\Dedicated Usage")),
            };
            unsafe {
                PdhCollectQueryData(handle);
            }
            Some(query)
        }
        fn array(counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
            let (mut bytes, mut count) = (0, 0);
            if unsafe {
                PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut bytes, &mut count, None)
            } != PDH_MORE_DATA
                || bytes == 0
                || bytes > 4 * 1024 * 1024
            {
                return vec![];
            }
            // u64 storage provides the alignment required by PDH's value union.
            let mut buffer = vec![0_u64; (bytes as usize).div_ceil(8)];
            let pointer = buffer.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
            if unsafe {
                PdhGetFormattedCounterArrayW(
                    counter,
                    PDH_FMT_DOUBLE,
                    &mut bytes,
                    &mut count,
                    Some(pointer),
                )
            } != 0
                || count as usize
                    > buffer.len() * 8 / std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>()
            {
                return vec![];
            }
            // OS owns all returned pointers and guarantees they refer to this
            // buffer. Copy names/values before the backing allocation is freed.
            unsafe { std::slice::from_raw_parts(pointer, count as usize) }
                .iter()
                .filter_map(|item| {
                    if item.FmtValue.CStatus > 1 {
                        return None;
                    }
                    let value = unsafe { item.FmtValue.Anonymous.doubleValue };
                    if !value.is_finite() || value < 0.0 {
                        return None;
                    }
                    Some((unsafe { item.szName.to_string() }.ok()?, value))
                })
                .collect()
        }
        fn cpu(&self) -> Option<f64> {
            let mut value = PDH_FMT_COUNTERVALUE::default();
            if unsafe { PdhGetFormattedCounterValue(self.cpu, PDH_FMT_DOUBLE, None, &mut value) }
                != 0
                || value.CStatus > 1
            {
                return None;
            }
            let percent = unsafe { value.Anonymous.doubleValue };
            (percent.is_finite() && percent >= 0.0).then(|| percent.min(100.0))
        }
    }

    type AdapterStaticCache = std::collections::HashMap<(String, u64), (&'static str, Option<u64>)>;

    /// Queries static adapter architecture via D3D12 at most once per newly observed
    /// `(AdapterLuid, DedicatedVideoMemory)` pair so periodic refreshes never wake a
    /// sleeping `D3cold` discrete laptop GPU.
    fn adapters(cache: &mut AdapterStaticCache) -> Vec<GpuSample> {
        let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
            return vec![];
        };
        let mut result = vec![];
        let mut seen_keys = std::collections::HashSet::new();
        for index in 0..32 {
            let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
                break;
            };
            let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
                continue;
            };
            if desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 | DXGI_ADAPTER_FLAG_REMOTE.0) as u32 != 0
            {
                continue;
            }
            let id = format!(
                "luid_0x{:08x}_0x{:08x}",
                desc.AdapterLuid.HighPart as u32, desc.AdapterLuid.LowPart
            );
            let dedicated_mem = desc.DedicatedVideoMemory as u64;
            let cache_key = (id.clone(), dedicated_mem);
            seen_keys.insert(cache_key.clone());
            let (kind, dedicated_total_bytes) = *cache.entry(cache_key).or_insert_with(|| {
                let mut device: Option<ID3D12Device> = None;
                let mut architecture = D3D12_FEATURE_DATA_ARCHITECTURE::default();
                let kind =
                    if unsafe { D3D12CreateDevice(&adapter, D3D_FEATURE_LEVEL_11_0, &mut device) }
                        .is_ok()
                        && device.as_ref().is_some_and(|device| unsafe {
                            device
                                .CheckFeatureSupport(
                                    D3D12_FEATURE_ARCHITECTURE,
                                    (&mut architecture as *mut D3D12_FEATURE_DATA_ARCHITECTURE)
                                        .cast(),
                                    std::mem::size_of::<D3D12_FEATURE_DATA_ARCHITECTURE>() as u32,
                                )
                                .is_ok()
                        })
                    {
                        if architecture.UMA.as_bool() {
                            "integrated"
                        } else {
                            "discrete"
                        }
                    } else {
                        "unknown"
                    };
                // UMA reservations are RAM, not a discrete VRAM capacity.
                let dedicated_total_bytes = (kind == "discrete"
                    && dedicated_mem > 0
                    && device
                        .as_ref()
                        .is_some_and(|device| unsafe { device.GetNodeCount() } == 1))
                .then_some(dedicated_mem);
                (kind, dedicated_total_bytes)
            });
            let length = desc
                .Description
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(desc.Description.len());
            result.push(GpuSample {
                id,
                name: String::from_utf16_lossy(&desc.Description[..length]),
                kind,
                usage_percent: None,
                dedicated_used_bytes: None,
                dedicated_total_bytes,
            });
        }
        cache.retain(|key, _| seen_keys.contains(key));
        result
    }

    const STEAMVR_PROCESS_NAMES: &[&str] = &["vrserver.exe", "vrmonitor.exe", "vrcompositor.exe"];

    fn observe_steamvr_running() -> Option<bool> {
        crate::play_session::os::running_from_candidates(STEAMVR_PROCESS_NAMES)
            .ok()
            .map(|running| !running.is_empty())
    }

    pub struct Sampler {
        query: Option<Query>,
        adapter_cache: AdapterStaticCache,
        adapters: Vec<GpuSample>,
        ticks: u32,
    }
    impl Default for Sampler {
        fn default() -> Self {
            let mut adapter_cache = AdapterStaticCache::new();
            let adapters = adapters(&mut adapter_cache);
            Self {
                query: Query::open(),
                adapter_cache,
                adapters,
                ticks: 0,
            }
        }
    }
    impl Sampler {
        pub fn sample(&mut self) -> ResourceSample {
            self.ticks += 1;
            if self.ticks.is_multiple_of(15) {
                self.adapters = adapters(&mut self.adapter_cache);
                if self.query.is_none() {
                    self.query = Query::open();
                }
            }
            let steam_vr_running = observe_steamvr_running();
            let Some(query) = &self.query else {
                return ResourceSample {
                    cpu_usage_percent: None,
                    gpus: vec![],
                    steam_vr_running,
                };
            };
            if unsafe { PdhCollectQueryData(query.handle) } != 0 {
                self.query = None;
                return ResourceSample {
                    cpu_usage_percent: None,
                    gpus: vec![],
                    steam_vr_running,
                };
            }
            let mut engines = std::collections::BTreeMap::<String, Vec<(String, f64)>>::new();
            for (instance, percent) in Query::array(query.engines) {
                if let Some((gpu, Some(engine))) = instance_parts(&instance) {
                    engines.entry(gpu).or_default().push((engine, percent));
                }
            }
            let mut memory = std::collections::BTreeMap::new();
            for (instance, bytes) in Query::array(query.memory) {
                if let Some((gpu, None)) = instance_parts(&instance) {
                    memory.insert(gpu, bytes as u64);
                }
            }
            let ids: std::collections::BTreeSet<_> =
                engines.keys().chain(memory.keys()).cloned().collect();
            let gpus = ids
                .into_iter()
                .filter_map(|id| {
                    let (luid, _) = id.rsplit_once("_phys_")?;
                    let adapter = self.adapters.iter().find(|adapter| adapter.id == luid)?;
                    let linked = engines
                        .keys()
                        .chain(memory.keys())
                        .any(|other| other != &id && other.starts_with(&format!("{luid}_phys_")));
                    Some(GpuSample {
                        id: id.clone(),
                        name: adapter.name.clone(),
                        kind: adapter.kind,
                        usage_percent: engines.get(&id).and_then(|values| busiest_engine(values)),
                        dedicated_used_bytes: (adapter.kind == "discrete")
                            .then(|| memory.get(&id).copied())
                            .flatten(),
                        // An adapter-wide capacity is not a linked node's capacity.
                        dedicated_total_bytes: (!linked)
                            .then_some(adapter.dedicated_total_bytes)
                            .flatten(),
                    })
                })
                .collect();
            ResourceSample {
                cpu_usage_percent: query.cpu(),
                gpus,
                steam_vr_running,
            }
        }
    }
}

#[cfg(windows)]
pub use native::Sampler;

#[cfg(not(windows))]
#[derive(Default)]
pub struct Sampler;
#[cfg(not(windows))]
impl Sampler {
    pub fn sample(&mut self) -> ResourceSample {
        ResourceSample {
            cpu_usage_percent: None,
            gpus: vec![],
            steam_vr_running: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn processes_share_an_engine_but_independent_engines_are_not_averaged() {
        assert_eq!(
            busiest_engine(&[("0".into(), 40.0), ("0".into(), 30.0), ("1".into(), 10.0)]),
            Some(70.0)
        );
        assert_eq!(
            busiest_engine(&[("0".into(), 100.0), ("1".into(), 100.0)]),
            Some(100.0)
        );
        assert_eq!(busiest_engine(&[("0".into(), f64::NAN)]), None);
    }
    #[test]
    fn physical_nodes_and_engine_numbers_are_preserved_without_pid_or_type() {
        let id = "luid_0x00000000_0x00001234_phys_1";
        assert_eq!(
            instance_parts(&format!("pid_42_{id}_eng_3_engtype_3D")),
            Some((id.into(), Some("3".into())))
        );
        assert_eq!(instance_parts(id), Some((id.into(), None)));
        assert_eq!(instance_parts("unrecognized"), None);
    }
    #[test]
    fn resource_sample_serializes_steam_vr_running_in_camel_case() {
        let json = serde_json::to_value(ResourceSample {
            cpu_usage_percent: Some(12.5),
            gpus: vec![],
            steam_vr_running: Some(true),
        })
        .expect("serialize ResourceSample");
        assert_eq!(json["steamVrRunning"], serde_json::json!(true));
    }
}
