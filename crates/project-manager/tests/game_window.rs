//! Game-window observation tests: synthetic process/window fixtures only —
//! zero real window interaction in CI (the same discipline as the EAC
//! probe); the real-machine observation is the explicitly ignored manual
//! test. Shapes are pinned by
//! `schemas/game-window-observe/v0.1/observation.schema.json` and validated
//! here, including the state <=> window consistency law.

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

use vua_orchestrator::FixedClock;
use vua_project_manager::game_window::{
    observe_game_window, GameWindowSource, GameWindowState, RectPhysical, TopLevelWindowFact,
    GAME_WINDOW_OBSERVE_SCHEMA_VERSION,
};

fn clock() -> FixedClock {
    FixedClock::new(&["2026-10-08T04:30:00.000Z"])
}

/// A synthetic machine view: a vrchat.exe pid list, a top-level window
/// table, and the foreground owner — structurally representative, no real
/// window interaction.
struct FixtureSource {
    pids: Vec<u32>,
    windows: Vec<TopLevelWindowFact>,
    foreground: Option<u32>,
    fail: bool,
}

impl FixtureSource {
    fn of(pids: Vec<u32>, windows: Vec<TopLevelWindowFact>, foreground: Option<u32>) -> Self {
        Self {
            pids,
            windows,
            foreground,
            fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            pids: Vec::new(),
            windows: Vec::new(),
            foreground: None,
            fail: true,
        }
    }
}

impl GameWindowSource for FixtureSource {
    fn vrchat_pids(&self) -> std::io::Result<Vec<u32>> {
        if self.fail {
            return Err(std::io::Error::other("enumeration refused (fixture)"));
        }
        Ok(self.pids.clone())
    }

    fn top_level_windows(&self) -> std::io::Result<Vec<TopLevelWindowFact>> {
        if self.fail {
            return Err(std::io::Error::other("enumeration refused (fixture)"));
        }
        Ok(self.windows.clone())
    }

    fn foreground_pid(&self) -> Option<u32> {
        self.foreground
    }
}

#[allow(clippy::too_many_arguments)]
fn window(
    hwnd: u64,
    pid: u32,
    visible: bool,
    iconic: bool,
    tool: bool,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> TopLevelWindowFact {
    TopLevelWindowFact {
        hwnd,
        pid,
        visible,
        iconic,
        tool,
        rect: RectPhysical {
            x,
            y,
            width,
            height,
        },
    }
}

fn read_repo_json(relative: &str) -> Value {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let path = Path::new(manifest_dir).join("../..").join(relative);
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// Compiles one $defs entry of the schema with the full $defs re-attached,
/// so nested $ref targets resolve (same compilation shape as the
/// editor-verify wire test).
fn sub_schema_validator(def: &str) -> jsonschema::Validator {
    let schema = read_repo_json("schemas/game-window-observe/v0.1/observation.schema.json");
    let defs = schema.get("$defs").expect("schema has $defs").clone();
    let sub = defs.get(def).expect("sub schema exists").clone();
    let combined = json!({ "allOf": [sub], "$defs": defs });
    jsonschema::validator_for(&combined).unwrap()
}

fn observation_validator() -> jsonschema::Validator {
    sub_schema_validator("observation")
}

fn violations(validator: &jsonschema::Validator, instance: &Value) -> Vec<String> {
    validator
        .iter_errors(instance)
        .map(|error| format!("{}: {error}", error.instance_path()))
        .collect()
}

fn serialized(observation: &vua_project_manager::game_window::GameWindowObservationV01) -> Value {
    let value = serde_json::to_value(observation).unwrap();
    let problems = violations(&observation_validator(), &value);
    assert!(problems.is_empty(), "violations: {problems:#?}");
    value
}

#[test]
fn no_vrchat_process_reports_absent_without_a_window() {
    let source = FixtureSource::of(Vec::new(), Vec::new(), None);
    let observation = observe_game_window(&source, &clock()).unwrap();

    assert_eq!(observation.state, GameWindowState::Absent);
    assert_eq!(observation.window, None);
    let value = serialized(&observation);
    assert_eq!(value["schemaVersion"], GAME_WINDOW_OBSERVE_SCHEMA_VERSION);
    assert_eq!(value["capturedAt"], "2026-10-08T04:30:00.000Z");
    assert_eq!(value["state"], "absent");
    assert_eq!(value["window"], Value::Null);
}

#[test]
fn a_process_without_a_usable_window_reports_waiting() {
    // Visible=false, tool-window, and zero-area candidates never select.
    let source = FixtureSource::of(
        vec![41_224],
        vec![
            window(100, 41_224, false, false, false, 0, 0, 1280, 720),
            window(101, 41_224, true, false, true, 0, 0, 1280, 720),
            window(102, 41_224, true, false, false, 0, 0, 0, 0),
        ],
        None,
    );
    let observation = observe_game_window(&source, &clock()).unwrap();

    assert_eq!(observation.state, GameWindowState::Waiting);
    assert_eq!(observation.window, None);
    let value = serialized(&observation);
    assert_eq!(value["state"], "waiting");
    assert_eq!(value["window"], Value::Null);
}

#[test]
fn the_largest_usable_window_is_selected_with_a_stable_session_id() {
    let source = FixtureSource::of(
        vec![41_224],
        vec![
            // An unrelated process's window never competes.
            window(50, 900, true, false, false, 0, 0, 4000, 4000),
            window(100, 41_224, true, false, false, 10, 20, 1280, 720),
            window(101, 41_224, true, false, false, 0, 0, 3840, 2160),
        ],
        None,
    );
    let observation = observe_game_window(&source, &clock()).unwrap();

    assert_eq!(observation.state, GameWindowState::Ready);
    let facts = observation.window.as_ref().expect("ready carries a window");
    assert_eq!(facts.session_id, "41224:101");
    assert_eq!(
        facts.rect_physical,
        RectPhysical {
            x: 0,
            y: 0,
            width: 3840,
            height: 2160
        }
    );
    assert!(!facts.minimized);
    assert!(!facts.foreground);

    let value = serialized(&observation);
    assert_eq!(value["state"], "ready");
    assert_eq!(value["window"]["sessionId"], "41224:101");
    assert_eq!(value["window"]["rectPhysical"]["width"], 3840);
}

#[test]
fn area_ties_break_on_the_lowest_hwnd() {
    let source = FixtureSource::of(
        vec![41_224],
        vec![
            window(200, 41_224, true, false, false, 0, 0, 100, 100),
            window(150, 41_224, true, false, false, 500, 500, 100, 100),
        ],
        None,
    );
    let observation = observe_game_window(&source, &clock()).unwrap();
    let facts = observation.window.expect("ready carries a window");
    assert_eq!(facts.session_id, "41224:150");
    assert_eq!(facts.rect_physical.x, 500);
}

#[test]
fn foreground_means_the_foreground_owner_is_any_vrchat_pid() {
    // The foreground owner is the game itself.
    let foreground = FixtureSource::of(
        vec![41_224],
        vec![window(100, 41_224, true, false, false, 0, 0, 1920, 1080)],
        Some(41_224),
    );
    let observation = observe_game_window(&foreground, &clock()).unwrap();
    assert!(observation.window.as_ref().unwrap().foreground);

    // The foreground owner is an unrelated process: game context inactive.
    let background = FixtureSource::of(
        vec![41_224],
        vec![window(100, 41_224, true, false, false, 0, 0, 1920, 1080)],
        Some(900),
    );
    let observation = observe_game_window(&background, &clock()).unwrap();
    assert!(!observation.window.as_ref().unwrap().foreground);

    // No foreground window at all (locked console): honestly false.
    let none = FixtureSource::of(
        vec![41_224],
        vec![window(100, 41_224, true, false, false, 0, 0, 1920, 1080)],
        None,
    );
    let observation = observe_game_window(&none, &clock()).unwrap();
    assert!(!observation.window.as_ref().unwrap().foreground);
}

#[test]
fn the_minimized_fact_passes_through_from_is_iconic() {
    let source = FixtureSource::of(
        vec![41_224],
        vec![window(100, 41_224, true, true, false, 0, 0, 1920, 1080)],
        None,
    );
    let observation = observe_game_window(&source, &clock()).unwrap();
    let facts = observation.window.as_ref().expect("ready carries a window");
    assert!(facts.minimized);
    let value = serialized(&observation);
    assert_eq!(value["window"]["minimized"], true);
}

#[test]
fn the_schema_rejects_a_ready_state_with_a_null_window() {
    let ready_without_window = json!({
        "schemaVersion": GAME_WINDOW_OBSERVE_SCHEMA_VERSION,
        "capturedAt": "2026-10-08T04:30:00.000Z",
        "state": "ready",
        "window": Value::Null,
    });
    let problems = violations(&observation_validator(), &ready_without_window);
    assert!(
        !problems.is_empty(),
        "ready with a null window must fail schema validation"
    );

    // The mirror violation: absent/waiting must not carry a window.
    let absent_with_window = json!({
        "schemaVersion": GAME_WINDOW_OBSERVE_SCHEMA_VERSION,
        "capturedAt": "2026-10-08T04:30:00.000Z",
        "state": "absent",
        "window": {
            "sessionId": "41224:100",
            "rectPhysical": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
            "minimized": false,
            "foreground": false,
        },
    });
    let problems = violations(&observation_validator(), &absent_with_window);
    assert!(
        !problems.is_empty(),
        "absent with a window must fail schema validation"
    );
}

#[test]
fn the_params_face_is_an_empty_closed_set() {
    let schema = read_repo_json("schemas/game-window-observe/v0.1/observation.schema.json");
    let validator = jsonschema::validator_for(&schema).unwrap();
    assert!(violations(&validator, &json!({})).is_empty());
    assert!(!violations(&validator, &json!({"follow": true})).is_empty());
}

#[test]
fn enumeration_failure_is_an_error_never_a_clean_bill() {
    let result = observe_game_window(&FixtureSource::failing(), &clock());
    assert!(result.is_err());
}

/// Real-machine observation: explicitly ignored; run locally with
/// `cargo test -p vua-project-manager --test game_window -- --ignored` on a
/// Windows machine. Output goes to stdout for the evidence record; the
/// observation is read-only — nothing is focused, moved, written to, or
/// injected.
#[test]
#[ignore = "real-machine observation: requires a Windows desktop session; CI runs synthetic fixtures only"]
fn real_machine_observation_matches_the_schema() {
    let observation = observe_game_window(
        &vua_project_manager::game_window::os_source::WindowsGameWindowSource,
        &clock(),
    )
    .expect("Windows enumeration succeeds");
    let problems = violations(
        &observation_validator(),
        &serde_json::to_value(&observation).unwrap(),
    );
    assert!(problems.is_empty(), "violations: {problems:#?}");
    println!(
        "real-machine game-window observation: state={:?} window={:?}",
        observation.state, observation.window
    );
}
