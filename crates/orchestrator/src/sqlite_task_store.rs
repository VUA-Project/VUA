//! SQLite authority for recoverable tasks.
//!
//! This store replaces the transitional JSONL journal and StateFile rather
//! than importing either format. Task state and its corresponding event are
//! committed in one transaction. Callers may publish the returned event only
//! after this method returns successfully.

use crate::{AppErrorV1, ProjectIdentity, TaskEventKind, TaskState};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const SQLITE_TASK_FORMAT_VERSION: &str = "0.1";
const SQLITE_MIGRATION_VERSION: i64 = 2;

const MIGRATION_001: &str =
    include_str!("../../../schemas/orchestrator-task-store/v0.1/001_initial.sql");
const MIGRATION_002: &str = include_str!(
    "../../../schemas/orchestrator-task-store/v0.1/002_production_domain_records.sql"
);

#[derive(Debug)]
pub enum SqliteStoreError {
    Database(rusqlite::Error),
    Json(serde_json::Error),
    UnsupportedFormat(String),
    RevisionConflict {
        task_id: String,
        expected: u64,
    },
    UnknownTask(String),
    TerminalTask(String),
    InvalidTransition {
        task_id: String,
        from: TaskState,
        to: TaskState,
    },
    IdempotencyConflict {
        command_kind: String,
        idempotency_key: String,
    },
    LeaseHeld {
        project_identity: String,
        owner_instance_id: String,
        generation: u64,
        recovery_required: bool,
    },
    LeaseFenceMismatch {
        project_identity: String,
        expected_generation: u64,
    },
    LeaseInspectionRequired(String),
    CorruptValue {
        field: &'static str,
        value: String,
    },
}

impl std::fmt::Display for SqliteStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "SQLite task store failed: {error}"),
            Self::Json(error) => write!(formatter, "SQLite task JSON failed: {error}"),
            Self::UnsupportedFormat(version) => {
                write!(formatter, "unsupported SQLite task format {version}")
            }
            Self::RevisionConflict { task_id, expected } => write!(
                formatter,
                "task {task_id} no longer has expected revision {expected}"
            ),
            Self::UnknownTask(task_id) => write!(formatter, "unknown task {task_id}"),
            Self::TerminalTask(task_id) => write!(formatter, "task {task_id} is terminal"),
            Self::InvalidTransition { task_id, from, to } => {
                write!(formatter, "task {task_id} cannot transition from {from} to {to}")
            }
            Self::IdempotencyConflict {
                command_kind,
                idempotency_key,
            } => write!(
                formatter,
                "idempotency key {idempotency_key} was reused for a different {command_kind} request"
            ),
            Self::LeaseHeld {
                project_identity,
                owner_instance_id,
                generation,
                recovery_required,
            } => write!(
                formatter,
                "project {project_identity} is held by {owner_instance_id} at generation {generation} (recovery required: {recovery_required})"
            ),
            Self::LeaseFenceMismatch {
                project_identity,
                expected_generation,
            } => write!(
                formatter,
                "project {project_identity} no longer has lease generation {expected_generation}"
            ),
            Self::LeaseInspectionRequired(project_identity) => write!(
                formatter,
                "project {project_identity} requires inspection before lease release or takeover"
            ),
            Self::CorruptValue { field, value } => {
                write!(formatter, "invalid persisted {field}: {value}")
            }
        }
    }
}

impl std::error::Error for SqliteStoreError {}

impl From<rusqlite::Error> for SqliteStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

impl From<serde_json::Error> for SqliteStoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewTask {
    pub task_id: String,
    pub correlation_id: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredTask {
    pub task_id: String,
    pub correlation_id: String,
    pub state: TaskState,
    pub revision: u64,
    pub cancel_requested: bool,
    pub error: Option<AppErrorV1>,
    pub result: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredTaskEvent {
    pub task_id: String,
    pub revision: u64,
    pub kind: TaskEventKind,
    pub state: TaskState,
    pub occurred_at: String,
    pub correlation_id: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IdempotentTaskAcceptance {
    Accepted {
        task: Box<StoredTask>,
        event: Box<StoredTaskEvent>,
    },
    Replayed {
        task_id: String,
        response: Value,
    },
}

/// Private durable command inputs used by operation-specific recovery readers.
pub struct IdempotentTaskRecord {
    pub idempotency_key: String,
    pub request_fingerprint: String,
    pub task_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredCancellationOutcome {
    Requested,
    AlreadyRequested,
    AlreadyTerminal,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCancellationResult {
    pub task_id: String,
    pub revision: u64,
    pub state: TaskState,
    pub outcome: StoredCancellationOutcome,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IdempotentCancellation {
    Applied {
        result: StoredCancellationResult,
        event: Option<Box<StoredTaskEvent>>,
    },
    Replayed(StoredCancellationResult),
}

#[derive(Debug, Clone, PartialEq)]
pub enum TaskMutation {
    Transition {
        state: TaskState,
        payload: Value,
    },
    Progress {
        payload: Value,
    },
    RequestCancellation {
        payload: Value,
    },
    Complete {
        state: TaskState,
        error: Option<AppErrorV1>,
        result: Option<Value>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectMutationLease {
    pub project_identity: ProjectIdentity,
    pub generation: u64,
    pub owner_instance_id: String,
    pub task_id: String,
    pub acquired_at: String,
    pub heartbeat_at: String,
    pub recovery_required: bool,
    pub recovery_marked_at: Option<String>,
    pub inspection_id: Option<String>,
}

pub struct SqliteTaskStore {
    path: Option<PathBuf>,
    connection: Mutex<Connection>,
}

impl SqliteTaskStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SqliteStoreError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                SqliteStoreError::Database(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
            })?;
        }
        let connection = Connection::open(&path)?;
        let store = Self {
            path: Some(path),
            connection: Mutex::new(connection),
        };
        store.configure_and_migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, SqliteStoreError> {
        let store = Self {
            path: None,
            connection: Mutex::new(Connection::open_in_memory()?),
        };
        store.configure_and_migrate()?;
        Ok(store)
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    fn configure_and_migrate(&self) -> Result<(), SqliteStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        if self.path.is_some() {
            let mode: String =
                connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
            if !mode.eq_ignore_ascii_case("wal") {
                connection.pragma_update(None, "journal_mode", "WAL")?;
            }
        }
        connection.pragma_update(None, "synchronous", "FULL")?;

        let migration: i64 =
            connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if migration > SQLITE_MIGRATION_VERSION {
            return Err(SqliteStoreError::UnsupportedFormat(format!(
                "migration-{migration}"
            )));
        }
        if migration == 0 {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(MIGRATION_001)?;
            transaction.pragma_update(None, "user_version", 1)?;
            transaction.commit()?;
        }
        if migration < 2 {
            // M3/T1: the production domain identity registry. Existing v1
            // databases carry no domain records, so the new table starts
            // empty and no data migration is needed.
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(MIGRATION_002)?;
            transaction.pragma_update(None, "user_version", SQLITE_MIGRATION_VERSION)?;
            transaction.commit()?;
        }
        let format: String = connection
            .query_row(
                "SELECT value FROM vua_metadata WHERE key = 'format_version'",
                [],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| SqliteStoreError::UnsupportedFormat("missing".into()))?;
        if format != SQLITE_TASK_FORMAT_VERSION {
            return Err(SqliteStoreError::UnsupportedFormat(format));
        }
        Ok(())
    }

    pub fn accept_task(
        &self,
        task: &NewTask,
    ) -> Result<(StoredTask, StoredTaskEvent), SqliteStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let accepted = insert_task(&transaction, task)?;
        let event = insert_event(
            &transaction,
            task,
            1,
            TaskEventKind::Accepted,
            TaskState::Queued,
            &Value::Null,
        )?;
        transaction.commit()?;
        Ok((accepted, event))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn accept_idempotent_task(
        &self,
        command_kind: &str,
        idempotency_key: &str,
        request_fingerprint: &str,
        task: &NewTask,
        response: &Value,
    ) -> Result<IdempotentTaskAcceptance, SqliteStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior: Option<(String, String, String)> = transaction
            .query_row(
                "SELECT request_fingerprint, task_id, response_json
                 FROM command_idempotency
                 WHERE command_kind = ?1 AND idempotency_key = ?2",
                params![command_kind, idempotency_key],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((prior_fingerprint, task_id, response_json)) = prior {
            if prior_fingerprint != request_fingerprint {
                return Err(SqliteStoreError::IdempotencyConflict {
                    command_kind: command_kind.into(),
                    idempotency_key: idempotency_key.into(),
                });
            }
            return Ok(IdempotentTaskAcceptance::Replayed {
                task_id,
                response: serde_json::from_str(&response_json)?,
            });
        }

        let stored_task = insert_task(&transaction, task)?;
        let event = insert_event(
            &transaction,
            task,
            1,
            TaskEventKind::Accepted,
            TaskState::Queued,
            &Value::Null,
        )?;
        transaction.execute(
            "INSERT INTO command_idempotency(
                command_kind, idempotency_key, request_fingerprint,
                task_id, response_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                command_kind,
                idempotency_key,
                request_fingerprint,
                task.task_id,
                serde_json::to_string(response)?,
                task.occurred_at,
            ],
        )?;
        transaction.commit()?;
        Ok(IdempotentTaskAcceptance::Accepted {
            task: Box::new(stored_task),
            event: Box::new(event),
        })
    }

    pub fn idempotent_tasks(&self, command_kind: &str) -> Result<Vec<IdempotentTaskRecord>, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement = connection.prepare("SELECT idempotency_key,request_fingerprint,task_id FROM command_idempotency WHERE command_kind=?1 ORDER BY idempotency_key")?;
        let rows = statement.query_map([command_kind], |row| Ok(IdempotentTaskRecord { idempotency_key: row.get(0)?, request_fingerprint: row.get(1)?, task_id: row.get(2)? }))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn mutate_task(
        &self,
        task_id: &str,
        expected_revision: u64,
        occurred_at: &str,
        mutation: TaskMutation,
    ) -> Result<Option<StoredTaskEvent>, SqliteStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = select_task(&transaction, task_id)?
            .ok_or_else(|| SqliteStoreError::UnknownTask(task_id.into()))?;
        if matches!(mutation, TaskMutation::RequestCancellation { .. })
            && (current.cancel_requested || current.state.is_terminal())
        {
            return Ok(None);
        }
        if current.revision != expected_revision {
            return Err(SqliteStoreError::RevisionConflict {
                task_id: task_id.into(),
                expected: expected_revision,
            });
        }
        if current.state.is_terminal() {
            return Err(SqliteStoreError::TerminalTask(task_id.into()));
        }

        let revision = expected_revision + 1;
        let (kind, state, payload, cancel_requested, error, result) = match mutation {
            TaskMutation::Transition { state, payload } => {
                if state.is_terminal() || !can_transition(current.state, state) {
                    return Err(SqliteStoreError::InvalidTransition {
                        task_id: task_id.into(),
                        from: current.state,
                        to: state,
                    });
                }
                (
                    TaskEventKind::StateChanged,
                    state,
                    payload,
                    None,
                    None,
                    None,
                )
            }
            TaskMutation::Progress { payload } => (
                TaskEventKind::Progress,
                current.state,
                payload,
                None,
                None,
                None,
            ),
            TaskMutation::RequestCancellation { payload } => (
                TaskEventKind::CancelRequested,
                current.state,
                payload,
                Some(true),
                None,
                None,
            ),
            TaskMutation::Complete {
                state,
                error,
                result,
            } => {
                if !state.is_terminal() {
                    return Err(SqliteStoreError::CorruptValue {
                        field: "completion state",
                        value: state.to_string(),
                    });
                }
                if !can_transition(current.state, state) {
                    return Err(SqliteStoreError::InvalidTransition {
                        task_id: task_id.into(),
                        from: current.state,
                        to: state,
                    });
                }
                let payload = match (&error, &result) {
                    (Some(error), _) => serde_json::to_value(error)?,
                    (None, Some(result)) => result.clone(),
                    (None, None) => Value::Null,
                };
                (
                    TaskEventKind::Completed,
                    state,
                    payload,
                    None,
                    error,
                    result,
                )
            }
        };

        let changed = transaction.execute(
            "UPDATE tasks SET
                state = ?1,
                revision = ?2,
                cancel_requested = COALESCE(?3, cancel_requested),
                error_json = COALESCE(?4, error_json),
                result_json = COALESCE(?5, result_json),
                updated_at = ?6
             WHERE task_id = ?7 AND revision = ?8",
            params![
                state_name(state),
                to_i64(revision)?,
                cancel_requested.map(i64::from),
                error.as_ref().map(serde_json::to_string).transpose()?,
                result.as_ref().map(serde_json::to_string).transpose()?,
                occurred_at,
                task_id,
                to_i64(expected_revision)?,
            ],
        )?;
        if changed != 1 {
            return Err(SqliteStoreError::RevisionConflict {
                task_id: task_id.into(),
                expected: expected_revision,
            });
        }
        let new_task = NewTask {
            task_id: task_id.into(),
            correlation_id: current.correlation_id,
            occurred_at: occurred_at.into(),
        };
        let event = insert_event(&transaction, &new_task, revision, kind, state, &payload)?;
        transaction.commit()?;
        Ok(Some(event))
    }

    pub fn request_cancellation_idempotent(
        &self,
        command_id: &str,
        request_fingerprint: &str,
        task_id: &str,
        observed_revision: Option<u64>,
        occurred_at: &str,
    ) -> Result<IdempotentCancellation, SqliteStoreError> {
        const COMMAND_KIND: &str = "task.requestCancellation";
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior: Option<(String, String)> = transaction
            .query_row(
                "SELECT request_fingerprint, response_json
                 FROM command_idempotency
                 WHERE command_kind = ?1 AND idempotency_key = ?2",
                params![COMMAND_KIND, command_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((prior_fingerprint, response_json)) = prior {
            if prior_fingerprint != request_fingerprint {
                return Err(SqliteStoreError::IdempotencyConflict {
                    command_kind: COMMAND_KIND.into(),
                    idempotency_key: command_id.into(),
                });
            }
            return Ok(IdempotentCancellation::Replayed(serde_json::from_str(
                &response_json,
            )?));
        }

        let current = select_task(&transaction, task_id)?
            .ok_or_else(|| SqliteStoreError::UnknownTask(task_id.into()))?;
        let (result, event) = if current.state.is_terminal() {
            (
                StoredCancellationResult {
                    task_id: task_id.into(),
                    revision: current.revision,
                    state: current.state,
                    outcome: StoredCancellationOutcome::AlreadyTerminal,
                },
                None,
            )
        } else if current.cancel_requested {
            (
                StoredCancellationResult {
                    task_id: task_id.into(),
                    revision: current.revision,
                    state: current.state,
                    outcome: StoredCancellationOutcome::AlreadyRequested,
                },
                None,
            )
        } else {
            let revision = current.revision + 1;
            let changed = transaction.execute(
                "UPDATE tasks SET cancel_requested = 1, revision = ?1, updated_at = ?2
                 WHERE task_id = ?3 AND revision = ?4 AND cancel_requested = 0",
                params![
                    to_i64(revision)?,
                    occurred_at,
                    task_id,
                    to_i64(current.revision)?,
                ],
            )?;
            if changed != 1 {
                return Err(SqliteStoreError::RevisionConflict {
                    task_id: task_id.into(),
                    expected: current.revision,
                });
            }
            let payload = match observed_revision {
                Some(observed_revision) => serde_json::json!({
                    "commandId": command_id,
                    "observedRevision": observed_revision,
                }),
                None => serde_json::json!({ "commandId": command_id }),
            };
            let event = insert_event(
                &transaction,
                &NewTask {
                    task_id: task_id.into(),
                    correlation_id: current.correlation_id,
                    occurred_at: occurred_at.into(),
                },
                revision,
                TaskEventKind::CancelRequested,
                current.state,
                &payload,
            )?;
            (
                StoredCancellationResult {
                    task_id: task_id.into(),
                    revision,
                    state: current.state,
                    outcome: StoredCancellationOutcome::Requested,
                },
                Some(Box::new(event)),
            )
        };
        transaction.execute(
            "INSERT INTO command_idempotency(
                command_kind, idempotency_key, request_fingerprint,
                task_id, response_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                COMMAND_KIND,
                command_id,
                request_fingerprint,
                task_id,
                serde_json::to_string(&result)?,
                occurred_at,
            ],
        )?;
        transaction.commit()?;
        Ok(IdempotentCancellation::Applied { result, event })
    }

    pub fn acquire_project_lease(
        &self,
        project_identity: &ProjectIdentity,
        owner_instance_id: &str,
        task_id: &str,
        acquired_at: &str,
    ) -> Result<ProjectMutationLease, SqliteStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = select_lease(&transaction, project_identity)? {
            if existing.owner_instance_id == owner_instance_id && existing.task_id == task_id {
                return Ok(existing);
            }
            return Err(SqliteStoreError::LeaseHeld {
                project_identity: project_identity.to_string(),
                owner_instance_id: existing.owner_instance_id,
                generation: existing.generation,
                recovery_required: existing.recovery_required,
            });
        }
        let generation: i64 = transaction.query_row(
            "INSERT INTO project_lease_generations(project_identity, generation)
             VALUES (?1, 1)
             ON CONFLICT(project_identity) DO UPDATE SET generation = generation + 1
             RETURNING generation",
            [project_identity.as_str()],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO project_mutation_leases(
                project_identity, generation, owner_instance_id, task_id,
                acquired_at, heartbeat_at, recovery_required
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0)",
            params![
                project_identity.as_str(),
                generation,
                owner_instance_id,
                task_id,
                acquired_at
            ],
        )?;
        let lease = select_lease(&transaction, project_identity)?
            .expect("lease was inserted in this transaction");
        transaction.commit()?;
        Ok(lease)
    }

    pub fn heartbeat_project_lease(
        &self,
        project_identity: &ProjectIdentity,
        owner_instance_id: &str,
        generation: u64,
        heartbeat_at: &str,
    ) -> Result<(), SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let changed = connection.execute(
            "UPDATE project_mutation_leases SET heartbeat_at = ?1
             WHERE project_identity = ?2 AND owner_instance_id = ?3
               AND generation = ?4 AND recovery_required = 0",
            params![
                heartbeat_at,
                project_identity.as_str(),
                owner_instance_id,
                to_i64(generation)?,
            ],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(SqliteStoreError::LeaseFenceMismatch {
                project_identity: project_identity.to_string(),
                expected_generation: generation,
            })
        }
    }

    pub fn mark_owner_interrupted(
        &self,
        owner_instance_id: &str,
        marked_at: &str,
    ) -> Result<usize, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        Ok(connection.execute(
            "UPDATE project_mutation_leases
             SET recovery_required = 1, recovery_marked_at = ?1
             WHERE owner_instance_id = ?2 AND recovery_required = 0",
            params![marked_at, owner_instance_id],
        )?)
    }

    pub fn mark_other_owners_interrupted(
        &self,
        current_owner_instance_id: &str,
        marked_at: &str,
    ) -> Result<usize, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        Ok(connection.execute(
            "UPDATE project_mutation_leases
             SET recovery_required = 1, recovery_marked_at = ?1
             WHERE owner_instance_id <> ?2 AND recovery_required = 0",
            params![marked_at, current_owner_instance_id],
        )?)
    }

    pub fn takeover_project_lease_after_inspect(
        &self,
        project_identity: &ProjectIdentity,
        expected_generation: u64,
        new_owner_instance_id: &str,
        new_task_id: &str,
        inspection_id: &str,
        taken_at: &str,
    ) -> Result<ProjectMutationLease, SqliteStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = select_lease(&transaction, project_identity)?.ok_or_else(|| {
            SqliteStoreError::LeaseFenceMismatch {
                project_identity: project_identity.to_string(),
                expected_generation,
            }
        })?;
        if existing.generation != expected_generation {
            return Err(SqliteStoreError::LeaseFenceMismatch {
                project_identity: project_identity.to_string(),
                expected_generation,
            });
        }
        if !existing.recovery_required || inspection_id.trim().is_empty() {
            return Err(SqliteStoreError::LeaseInspectionRequired(
                project_identity.to_string(),
            ));
        }
        let next_generation: i64 = transaction.query_row(
            "UPDATE project_lease_generations SET generation = generation + 1
             WHERE project_identity = ?1 RETURNING generation",
            [project_identity.as_str()],
            |row| row.get(0),
        )?;
        transaction.execute(
            "UPDATE project_mutation_leases SET
                generation = ?1, owner_instance_id = ?2, task_id = ?3,
                acquired_at = ?4, heartbeat_at = ?4, recovery_required = 0,
                recovery_marked_at = NULL, inspection_id = ?5
             WHERE project_identity = ?6 AND generation = ?7",
            params![
                next_generation,
                new_owner_instance_id,
                new_task_id,
                taken_at,
                inspection_id,
                project_identity.as_str(),
                to_i64(expected_generation)?,
            ],
        )?;
        let lease = select_lease(&transaction, project_identity)?
            .expect("lease remains present after takeover");
        transaction.commit()?;
        Ok(lease)
    }

    pub fn release_project_lease(
        &self,
        project_identity: &ProjectIdentity,
        owner_instance_id: &str,
        generation: u64,
    ) -> Result<(), SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        if let Some(existing) = select_lease(&connection, project_identity)? {
            if existing.recovery_required {
                return Err(SqliteStoreError::LeaseInspectionRequired(
                    project_identity.to_string(),
                ));
            }
        }
        let changed = connection.execute(
            "DELETE FROM project_mutation_leases
             WHERE project_identity = ?1 AND owner_instance_id = ?2 AND generation = ?3",
            params![
                project_identity.as_str(),
                owner_instance_id,
                to_i64(generation)?
            ],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(SqliteStoreError::LeaseFenceMismatch {
                project_identity: project_identity.to_string(),
                expected_generation: generation,
            })
        }
    }

    pub fn project_lease(
        &self,
        project_identity: &ProjectIdentity,
    ) -> Result<Option<ProjectMutationLease>, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        select_lease(&connection, project_identity)
    }

    pub fn project_leases(&self) -> Result<Vec<ProjectMutationLease>, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let identities: Vec<String> = {
            let mut statement = connection.prepare(
                "SELECT project_identity FROM project_mutation_leases ORDER BY project_identity",
            )?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut leases = Vec::with_capacity(identities.len());
        for identity in identities {
            let identity = ProjectIdentity::from_persisted(identity).map_err(|_| {
                SqliteStoreError::CorruptValue {
                    field: "project identity",
                    value: "invalid digest".into(),
                }
            })?;
            if let Some(lease) = select_lease(&connection, &identity)? {
                leases.push(lease);
            }
        }
        Ok(leases)
    }

    pub fn task(&self, task_id: &str) -> Result<Option<StoredTask>, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        select_task(&connection, task_id)
    }

    pub fn tasks(&self) -> Result<Vec<StoredTask>, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement = connection.prepare(
            "SELECT task_id, correlation_id, state, revision, cancel_requested,
                    error_json, result_json, created_at, updated_at
             FROM tasks ORDER BY created_at, task_id",
        )?;
        let rows = statement.query_map([], row_to_task)?;
        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(decode_task(row?)?);
        }
        Ok(tasks)
    }

    pub fn events_after(
        &self,
        task_id: &str,
        revision: u64,
    ) -> Result<Vec<StoredTaskEvent>, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement = connection.prepare(
            "SELECT task_id, revision, kind, state, occurred_at, correlation_id, payload_json
             FROM task_events
             WHERE task_id = ?1 AND revision > ?2
             ORDER BY revision",
        )?;
        let rows = statement.query_map(params![task_id, to_i64(revision)?], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        let mut events = Vec::new();
        for row in rows {
            let (task_id, revision, kind, state, occurred_at, correlation_id, payload) = row?;
            events.push(StoredTaskEvent {
                task_id,
                revision: to_u64(revision, "event revision")?,
                kind: parse_event_kind(&kind)?,
                state: parse_state(&state)?,
                occurred_at,
                correlation_id,
                payload: serde_json::from_str(&payload)?,
            });
        }
        Ok(events)
    }

    pub fn application_revision(&self) -> Result<u64, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let revision: i64 = connection.query_row(
            "SELECT COALESCE(MAX(event_id), 0) FROM task_events",
            [],
            |row| row.get(0),
        )?;
        to_u64(revision, "application revision")
    }

    /// Put one production domain record (inspection/plan) into the
    /// registry. Idempotent per domain id — replays keep the original.
    ///
    /// Why failed runs have no row here (batch 156, observation B): the
    /// registry binds STABLE domain identities for the downstream
    /// reference-resolution chain only (kind closed set frozen at
    /// `('inspection', 'plan')` in schema 002). A failed stage completes via
    /// the `persist_task_error` path — no document, no domain identity, and
    /// nothing downstream could ever reference — so issuing no row is the
    /// honest bookkeeping, not an omission. Build records (any status,
    /// failed included) are equally absent BY DESIGN: they are
    /// identity-addressed in the BuildRecordStore (records/*.json) and read
    /// directly by id (`record.get`, handoff admission); see the
    /// BuildRecordStore doc for the full ruling.
    pub fn put_domain_record(
        &self,
        domain_id: &str,
        kind: &str,
        task_id: &str,
        document_json: &str,
        binding_json: &str,
        created_at: &str,
    ) -> Result<(), SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        connection.execute(
            "INSERT INTO production_domain_records(
                domain_id, kind, task_id, document_json, binding_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(domain_id) DO NOTHING",
            params![domain_id, kind, task_id, document_json, binding_json, created_at],
        )?;
        Ok(())
    }

    /// Read one domain record: (kind, task_id, document, binding).
    pub fn domain_record(
        &self,
        domain_id: &str,
    ) -> Result<Option<(String, String, Value, Value)>, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let row = connection
            .query_row(
                "SELECT kind, task_id, document_json, binding_json
                 FROM production_domain_records WHERE domain_id = ?1",
                [domain_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        row.map(|(kind, task_id, document, binding)| {
            Ok((
                kind,
                task_id,
                serde_json::from_str(&document)?,
                serde_json::from_str(&binding)?,
            ))
        })
        .transpose()
        .map_err(|error: serde_json::Error| SqliteStoreError::Json(error))
    }

    pub fn checkpoint(&self) -> Result<(), SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    }

    #[cfg(test)]
    fn pragma_i64(&self, name: &str) -> Result<i64, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        Ok(connection.pragma_query_value(None, name, |row| row.get(0))?)
    }

    #[cfg(test)]
    fn pragma_string(&self, name: &str) -> Result<String, SqliteStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        Ok(connection.pragma_query_value(None, name, |row| row.get(0))?)
    }
}

fn insert_task(
    transaction: &Transaction<'_>,
    task: &NewTask,
) -> Result<StoredTask, SqliteStoreError> {
    transaction.execute(
        "INSERT INTO tasks(
            task_id, correlation_id, state, revision, cancel_requested, created_at, updated_at
         ) VALUES (?1, ?2, 'queued', 1, 0, ?3, ?3)",
        params![task.task_id, task.correlation_id, task.occurred_at],
    )?;
    Ok(StoredTask {
        task_id: task.task_id.clone(),
        correlation_id: task.correlation_id.clone(),
        state: TaskState::Queued,
        revision: 1,
        cancel_requested: false,
        error: None,
        result: None,
        created_at: task.occurred_at.clone(),
        updated_at: task.occurred_at.clone(),
    })
}

fn insert_event(
    transaction: &Transaction<'_>,
    task: &NewTask,
    revision: u64,
    kind: TaskEventKind,
    state: TaskState,
    payload: &Value,
) -> Result<StoredTaskEvent, SqliteStoreError> {
    transaction.execute(
        "INSERT INTO task_events(
            task_id, revision, kind, state, occurred_at, correlation_id, payload_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            task.task_id,
            to_i64(revision)?,
            event_kind_name(kind),
            state_name(state),
            task.occurred_at,
            task.correlation_id,
            serde_json::to_string(payload)?,
        ],
    )?;
    Ok(StoredTaskEvent {
        task_id: task.task_id.clone(),
        revision,
        kind,
        state,
        occurred_at: task.occurred_at.clone(),
        correlation_id: task.correlation_id.clone(),
        payload: payload.clone(),
    })
}

type TaskRow = (
    String,
    String,
    String,
    i64,
    i64,
    Option<String>,
    Option<String>,
    String,
    String,
);

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
    ))
}

fn decode_task(row: TaskRow) -> Result<StoredTask, SqliteStoreError> {
    let (
        task_id,
        correlation_id,
        state,
        revision,
        cancel_requested,
        error,
        result,
        created_at,
        updated_at,
    ) = row;
    Ok(StoredTask {
        task_id,
        correlation_id,
        state: parse_state(&state)?,
        revision: to_u64(revision, "task revision")?,
        cancel_requested: cancel_requested != 0,
        error: error.map(|json| serde_json::from_str(&json)).transpose()?,
        result: result.map(|json| serde_json::from_str(&json)).transpose()?,
        created_at,
        updated_at,
    })
}

fn select_task(
    connection: &Connection,
    task_id: &str,
) -> Result<Option<StoredTask>, SqliteStoreError> {
    let row = connection
        .query_row(
            "SELECT task_id, correlation_id, state, revision, cancel_requested,
                    error_json, result_json, created_at, updated_at
             FROM tasks WHERE task_id = ?1",
            [task_id],
            row_to_task,
        )
        .optional()?;
    row.map(decode_task).transpose()
}

fn select_lease(
    connection: &Connection,
    project_identity: &ProjectIdentity,
) -> Result<Option<ProjectMutationLease>, SqliteStoreError> {
    let row = connection
        .query_row(
            "SELECT project_identity, generation, owner_instance_id, task_id,
                    acquired_at, heartbeat_at, recovery_required,
                    recovery_marked_at, inspection_id
             FROM project_mutation_leases WHERE project_identity = ?1",
            [project_identity.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .optional()?;
    row.map(
        |(
            project_identity,
            generation,
            owner_instance_id,
            task_id,
            acquired_at,
            heartbeat_at,
            recovery_required,
            recovery_marked_at,
            inspection_id,
        )| {
            Ok(ProjectMutationLease {
                project_identity: ProjectIdentity::from_persisted(project_identity).map_err(
                    |_| SqliteStoreError::CorruptValue {
                        field: "project identity",
                        value: "invalid digest".into(),
                    },
                )?,
                generation: to_u64(generation, "lease generation")?,
                owner_instance_id,
                task_id,
                acquired_at,
                heartbeat_at,
                recovery_required: recovery_required != 0,
                recovery_marked_at,
                inspection_id,
            })
        },
    )
    .transpose()
}

fn state_name(state: TaskState) -> &'static str {
    match state {
        TaskState::Queued => "queued",
        TaskState::Preparing => "preparing",
        TaskState::Running => "running",
        TaskState::WaitingForInput => "waiting_for_input",
        TaskState::Paused => "paused",
        TaskState::Succeeded => "succeeded",
        TaskState::SucceededWithWarnings => "succeeded_with_warnings",
        TaskState::Failed => "failed",
        TaskState::Cancelled => "cancelled",
    }
}

fn parse_state(value: &str) -> Result<TaskState, SqliteStoreError> {
    match value {
        "queued" => Ok(TaskState::Queued),
        "preparing" => Ok(TaskState::Preparing),
        "running" => Ok(TaskState::Running),
        "waiting_for_input" => Ok(TaskState::WaitingForInput),
        "paused" => Ok(TaskState::Paused),
        "succeeded" => Ok(TaskState::Succeeded),
        "succeeded_with_warnings" => Ok(TaskState::SucceededWithWarnings),
        "failed" => Ok(TaskState::Failed),
        "cancelled" => Ok(TaskState::Cancelled),
        _ => Err(SqliteStoreError::CorruptValue {
            field: "task state",
            value: value.into(),
        }),
    }
}

fn event_kind_name(kind: TaskEventKind) -> &'static str {
    match kind {
        TaskEventKind::Accepted => "accepted",
        TaskEventKind::StateChanged => "state_changed",
        TaskEventKind::Progress => "progress",
        TaskEventKind::CancelRequested => "cancel_requested",
        TaskEventKind::Completed => "completed",
        // Never persisted today (persistence failing is what emits it), but
        // mapped symmetrically so any future store path round-trips.
        TaskEventKind::PersistenceFailed => "persistence_failed",
    }
}

fn parse_event_kind(value: &str) -> Result<TaskEventKind, SqliteStoreError> {
    match value {
        "accepted" => Ok(TaskEventKind::Accepted),
        "state_changed" => Ok(TaskEventKind::StateChanged),
        "progress" => Ok(TaskEventKind::Progress),
        "cancel_requested" => Ok(TaskEventKind::CancelRequested),
        "completed" => Ok(TaskEventKind::Completed),
        "persistence_failed" => Ok(TaskEventKind::PersistenceFailed),
        _ => Err(SqliteStoreError::CorruptValue {
            field: "task event kind",
            value: value.into(),
        }),
    }
}

fn can_transition(from: TaskState, to: TaskState) -> bool {
    use TaskState::*;
    if from.is_terminal() {
        return false;
    }
    matches!(
        (from, to),
        (Queued, Preparing)
            | (Preparing, Running)
            | (Running, WaitingForInput)
            | (Running, Paused)
            | (WaitingForInput, Running)
            | (Paused, Running)
            | (Running, Succeeded)
            | (Running, SucceededWithWarnings)
            | (Running, Failed)
            | (WaitingForInput, Failed)
            | (Paused, Failed)
            | (Queued, Cancelled)
            | (Preparing, Cancelled)
            | (Running, Cancelled)
            | (WaitingForInput, Cancelled)
            | (Paused, Cancelled)
    )
}

fn to_i64(value: u64) -> Result<i64, SqliteStoreError> {
    i64::try_from(value).map_err(|_| SqliteStoreError::CorruptValue {
        field: "revision",
        value: value.to_string(),
    })
}

fn to_u64(value: i64, field: &'static str) -> Result<u64, SqliteStoreError> {
    u64::try_from(value).map_err(|_| SqliteStoreError::CorruptValue {
        field,
        value: value.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str) -> NewTask {
        NewTask {
            task_id: id.into(),
            correlation_id: format!("corr-{id}"),
            occurred_at: "2026-09-02T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn migration_creates_explicit_format_and_full_durability() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        assert_eq!(store.pragma_i64("synchronous").unwrap(), 2);
        let connection = store.connection.lock().unwrap();
        let format: String = connection
            .query_row(
                "SELECT value FROM vua_metadata WHERE key = 'format_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(format, "0.1");
    }

    #[test]
    fn state_and_event_commit_together_with_monotonic_revisions() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        let (accepted, accepted_event) = store.accept_task(&task("one")).unwrap();
        assert_eq!(accepted.revision, 1);
        assert_eq!(accepted_event.revision, 1);
        store
            .mutate_task(
                "one",
                1,
                "2026-09-02T00:00:01.000Z",
                TaskMutation::Transition {
                    state: TaskState::Preparing,
                    payload: Value::Null,
                },
            )
            .unwrap()
            .unwrap();
        store
            .mutate_task(
                "one",
                2,
                "2026-09-02T00:00:02.000Z",
                TaskMutation::Progress {
                    payload: serde_json::json!({"completed": 1}),
                },
            )
            .unwrap()
            .unwrap();
        let current = store.task("one").unwrap().unwrap();
        assert_eq!(current.state, TaskState::Preparing);
        assert_eq!(current.revision, 3);
        let events = store.events_after("one", 0).unwrap();
        assert_eq!(
            events
                .iter()
                .map(|event| event.revision)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn cancellation_is_idempotent_at_the_task_boundary() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        store.accept_task(&task("cancel")).unwrap();
        store
            .mutate_task(
                "cancel",
                1,
                "2026-09-02T00:00:01.000Z",
                TaskMutation::RequestCancellation {
                    payload: Value::Null,
                },
            )
            .unwrap()
            .unwrap();
        let current = store.task("cancel").unwrap().unwrap();
        assert!(current.cancel_requested);
        let replay = store
            .mutate_task(
                "cancel",
                current.revision,
                "2026-09-02T00:00:02.000Z",
                TaskMutation::RequestCancellation {
                    payload: Value::Null,
                },
            )
            .unwrap();
        assert_eq!(replay, None);
        assert_eq!(store.events_after("cancel", 0).unwrap().len(), 2);
    }

    #[test]
    fn command_idempotency_replays_same_request_and_rejects_key_reuse() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        let response = serde_json::json!({"taskId": "idempotent"});
        let first = store
            .accept_idempotent_task(
                "assembly.execute",
                "key-1",
                "sha256:a",
                &task("idempotent"),
                &response,
            )
            .unwrap();
        assert!(matches!(first, IdempotentTaskAcceptance::Accepted { .. }));
        let replay = store
            .accept_idempotent_task(
                "assembly.execute",
                "key-1",
                "sha256:a",
                &task("unused"),
                &response,
            )
            .unwrap();
        assert_eq!(
            replay,
            IdempotentTaskAcceptance::Replayed {
                task_id: "idempotent".into(),
                response,
            }
        );
        assert!(matches!(
            store.accept_idempotent_task(
                "assembly.execute",
                "key-1",
                "sha256:different",
                &task("unused-2"),
                &Value::Null,
            ),
            Err(SqliteStoreError::IdempotencyConflict { .. })
        ));
        assert_eq!(store.tasks().unwrap().len(), 1);
    }

    #[test]
    fn restart_exposes_nonterminal_tasks_for_inspection() {
        let path = std::env::temp_dir().join(format!(
            "vua-sqlite-restart-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = SqliteTaskStore::open(&path).unwrap();
            store.accept_task(&task("interrupted")).unwrap();
            store
                .mutate_task(
                    "interrupted",
                    1,
                    "2026-09-02T00:00:01.000Z",
                    TaskMutation::Transition {
                        state: TaskState::Preparing,
                        payload: Value::Null,
                    },
                )
                .unwrap()
                .unwrap();
            store
                .mutate_task(
                    "interrupted",
                    2,
                    "2026-09-02T00:00:02.000Z",
                    TaskMutation::Transition {
                        state: TaskState::Running,
                        payload: Value::Null,
                    },
                )
                .unwrap()
                .unwrap();
        }
        let reopened = SqliteTaskStore::open(&path).unwrap();
        let recovered = reopened.task("interrupted").unwrap().unwrap();
        assert_eq!(recovered.state, TaskState::Running);
        assert_eq!(recovered.revision, 3);
        reopened.checkpoint().unwrap();
        drop(reopened);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn file_store_uses_wal_and_full_synchronous_mode() {
        let path = std::env::temp_dir().join(format!(
            "vua-sqlite-pragmas-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = SqliteTaskStore::open(&path).unwrap();
        assert_eq!(
            store
                .pragma_string("journal_mode")
                .unwrap()
                .to_ascii_lowercase(),
            "wal"
        );
        assert_eq!(store.pragma_i64("synchronous").unwrap(), 2);
        store.checkpoint().unwrap();
        drop(store);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn authoritative_store_rejects_illegal_state_jump() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        store.accept_task(&task("jump")).unwrap();
        assert!(matches!(
            store.mutate_task(
                "jump",
                1,
                "2026-09-02T00:00:01.000Z",
                TaskMutation::Transition {
                    state: TaskState::Running,
                    payload: Value::Null,
                },
            ),
            Err(SqliteStoreError::InvalidTransition { .. })
        ));
        assert_eq!(store.task("jump").unwrap().unwrap().revision, 1);
        assert_eq!(store.events_after("jump", 0).unwrap().len(), 1);
    }

    #[test]
    fn failed_event_insert_rolls_back_the_task_state_transaction() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute_batch(
                    "CREATE TRIGGER reject_task_events
                     BEFORE INSERT ON task_events
                     BEGIN
                       SELECT RAISE(ABORT, 'simulated event failure');
                     END;",
                )
                .unwrap();
        }
        assert!(store.accept_task(&task("atomic")).is_err());
        assert!(store.task("atomic").unwrap().is_none());
    }

    #[test]
    fn cancellation_command_replays_from_sqlite_after_restart() {
        let path = std::env::temp_dir().join(format!(
            "vua-sqlite-cancel-command-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = SqliteTaskStore::open(&path).unwrap();
            store.accept_task(&task("command-cancel")).unwrap();
            let first = store
                .request_cancellation_idempotent(
                    "cancel-command-1",
                    "sha256:request-a",
                    "command-cancel",
                    Some(1),
                    "2026-09-02T00:00:01.000Z",
                )
                .unwrap();
            assert!(matches!(
                first,
                IdempotentCancellation::Applied {
                    result: StoredCancellationResult {
                        revision: 2,
                        outcome: StoredCancellationOutcome::Requested,
                        ..
                    },
                    event: Some(_),
                }
            ));
            store.checkpoint().unwrap();
        }

        let reopened = SqliteTaskStore::open(&path).unwrap();
        let replay = reopened
            .request_cancellation_idempotent(
                "cancel-command-1",
                "sha256:request-a",
                "command-cancel",
                Some(1),
                "2026-09-02T00:00:02.000Z",
            )
            .unwrap();
        assert!(matches!(
            replay,
            IdempotentCancellation::Replayed(StoredCancellationResult {
                revision: 2,
                outcome: StoredCancellationOutcome::Requested,
                ..
            })
        ));
        assert_eq!(
            reopened
                .events_after("command-cancel", 0)
                .unwrap()
                .iter()
                .filter(|event| event.kind == TaskEventKind::CancelRequested)
                .count(),
            1
        );
        assert!(matches!(
            reopened.request_cancellation_idempotent(
                "cancel-command-1",
                "sha256:different",
                "command-cancel",
                Some(1),
                "2026-09-02T00:00:03.000Z",
            ),
            Err(SqliteStoreError::IdempotencyConflict { .. })
        ));
        reopened.checkpoint().unwrap();
        drop(reopened);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn project_lease_requires_inspect_and_fences_the_interrupted_owner() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        let project_identity = ProjectIdentity::from_test_label("project-opaque-1");
        store.accept_task(&task("lease-old-task")).unwrap();
        store.accept_task(&task("lease-new-task")).unwrap();
        let first = store
            .acquire_project_lease(
                &project_identity,
                "provider-old",
                "lease-old-task",
                "2026-09-02T00:00:00.000Z",
            )
            .unwrap();
        assert_eq!(first.generation, 1);
        store
            .heartbeat_project_lease(
                &project_identity,
                "provider-old",
                1,
                "2026-09-02T00:00:01.000Z",
            )
            .unwrap();
        assert_eq!(
            store
                .mark_owner_interrupted("provider-old", "2026-09-02T00:01:00.000Z")
                .unwrap(),
            1
        );

        // Time is diagnostic only: another owner cannot acquire, and the old
        // owner cannot heartbeat or release a recovery-required lease.
        assert!(matches!(
            store.acquire_project_lease(
                &project_identity,
                "provider-new",
                "lease-new-task",
                "2030-01-01T00:00:00.000Z",
            ),
            Err(SqliteStoreError::LeaseHeld {
                recovery_required: true,
                ..
            })
        ));
        assert!(matches!(
            store.heartbeat_project_lease(
                &project_identity,
                "provider-old",
                1,
                "2030-01-01T00:00:00.000Z",
            ),
            Err(SqliteStoreError::LeaseFenceMismatch { .. })
        ));
        assert!(matches!(
            store.release_project_lease(&project_identity, "provider-old", 1),
            Err(SqliteStoreError::LeaseInspectionRequired(_))
        ));

        let taken = store
            .takeover_project_lease_after_inspect(
                &project_identity,
                1,
                "provider-new",
                "lease-new-task",
                "inspection-1",
                "2026-09-02T00:02:00.000Z",
            )
            .unwrap();
        assert_eq!(taken.generation, 2);
        assert_eq!(taken.inspection_id.as_deref(), Some("inspection-1"));
        assert!(!taken.recovery_required);
        assert!(matches!(
            store.release_project_lease(&project_identity, "provider-old", 1),
            Err(SqliteStoreError::LeaseFenceMismatch { .. })
        ));
        store
            .release_project_lease(&project_identity, "provider-new", 2)
            .unwrap();
        let third = store
            .acquire_project_lease(
                &project_identity,
                "provider-new",
                "lease-new-task",
                "2026-09-02T00:03:00.000Z",
            )
            .unwrap();
        assert_eq!(third.generation, 3);
    }

    /// Registry ruling pin (batch 156, observation B): the
    /// production_domain_records kind closed set is exactly the
    /// reference-resolution chain (inspection, plan). A build record — of
    /// any terminal status, failed included — is NOT a registry kind: build
    /// records live only in the BuildRecordStore (records/*.json),
    /// identity-addressed and read directly by id (`record.get`, handoff
    /// admission). The CHECK constraint pins the ruling so a future "the
    /// failed run is missing its registry row" reading cannot grow a build
    /// kind here.
    #[test]
    fn domain_record_registry_accepts_chain_kinds_and_rejects_build_kind() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        store.accept_task(&task("one")).unwrap();
        store
            .put_domain_record(
                "insp-1",
                "inspection",
                "one",
                "{}",
                "{}",
                "2026-09-02T00:00:03.000Z",
            )
            .unwrap();
        store
            .put_domain_record("plan-1", "plan", "one", "{}", "{}", "2026-09-02T00:00:04.000Z")
            .unwrap();
        let error = store
            .put_domain_record(
                "build-1",
                "build",
                "one",
                "{}",
                "{}",
                "2026-09-02T00:00:05.000Z",
            )
            .unwrap_err();
        assert!(
            matches!(error, SqliteStoreError::Database(_)),
            "CHECK constraint must refuse a build kind, got {error:?}"
        );
        assert!(store.domain_record("build-1").unwrap().is_none());
    }
}
