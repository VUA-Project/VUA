//! Minimal task runtime (E-S0): durable acceptance, monotonic revisions,
//! cooperative cancel at safe boundaries, optional timeouts, and restart
//! recovery through the versioned journal.
//!
//! Discipline enforced here (agile plan §2):
//! - A task is "accepted" only after the journal durably records the
//!   acceptance (ORC-STA-006, ORC-IPC-008).
//! - Every task event carries a monotonic per-task `revision`; consumers that
//!   see gaps must re-query a snapshot (ORC-STA-003..005).
//! - Cancellation is cooperative: a request is distinguishable from a
//!   completed cancellation (ORC-CON-006); jobs observe it at safe boundaries.
//! - Every externally visible state is one of the nine task states (ORC §7.2).
//!
//! # 中文逐段讲解（E-S0 审阅）
//!
//! 运行时是引擎的"心脏"：所有长时间操作（装包、装配、烘焙）都以任务形式
//! 跑在这里。四个参与方：**调用者**（submit 后拿回执）、**job 闭包**
//! （真正干活，跑在独立线程）、**journal**（黑匣子）、**订阅者**
//! （前端，收事件流）。
//!
//!
//! 数据结构：
//! `TaskRecord`（私有）——每个任务的内存台账：当前九态、revision、
//! `cancel_requested`（取消请求标志，原子布尔）、`warned`（job 是否
//! 报告过警告，决定成功映射成 succeeded 还是 succeeded_with_warnings）、
//! `poisoned`（journal 写坏后的"污染"标记：磁盘坏了就别再假装一切
//! 正常，停止继续转换并等待恢复检查）。
//! `TaskSnapshot`（公开）——外部能看到的任务视图，就是台账的只读
//! 投影。**外部永远拿不到 TaskRecord 本体**，这是"单一写入者"
//! （ORC-STA-001）的物理保证。
//! `TaskJob` —— job 的类型：一个一次性的闭包，参数是 `TaskContext`
//! （干活时跟运行时对话的手柄），返回 `TaskExit`：要么 `Done(结果)`，
//! 要么 `Cancelled`（"我看到取消请求了，我在安全边界退出了"）。
//! *为什么取消由 job 自己决定**：只有 job 知道哪里是安全边界——
//! 装包装到一半不能停，装完一个包才是边界（ORC-CON-006）。
//!
//! `submit()` 的顺序就是安全性的全部：
//! 生成 taskId 后，持有任务锁执行碰撞检查；
//! **journal 追加 Accepted 条目并 fsync**——这一步失败就停止接收新任务，
//! 返回错误：任务从未进入内存，绝不出现"说接受了但重启后查无此事"；
//! 成功后才登记内存台账（queued, revision=1）；
//! 广播 Accepted 事件；
//! spawn 工作线程；若有 timeout 再 spawn 一个看门狗线程。
//! b 在 c/d 之前，这就是"先落盘后广播"（ORC-STA-006）。
//!
//! `can_transition()` —— 九态的合法性转换表（如 queued→preparing 合法、
//! queued→running 非法、终态→任何 非法）。每个转换一正一反都有测试
//! （ORC-TST-002）。取消是特例：任何活状态都可以直接到 cancelled。
//!
//! `TaskContext::transition()` —— job 用来走中间态（queued→preparing→
//! running，或 waiting_for_input↔running）。顺序：**锁内验证 → journal
//! 追加 → 改状态并 bump revision → 广播事件**。journal 失败会把任务
//! 标记为 poisoned，且不会提交未持久化的新状态。
//!
//! **poisoned 的可见性（诚实纪律 #2）**：任务被污染的瞬间会广播一条
//! `PersistenceFailed` 事件（仅内存——持久化正是失败的原因），快照同时
//! 暴露 `poisoned` 并把 recovery_disposition 呈现为 `InspectRequired`。
//! 污染任务对外不再是"还在跑"，而是"已冻结、等待恢复检查"；对污染任务
//! 的 cancel 返回类型化错误，不再假装受理。重启后权威库仍将其读为
//! inspect_required，两个时刻的语义一致。
//!
//! `emit_progress()` —— job 汇报进度的通道（ORC-IPC-004）。**同样
//! bump revision**（v0 不落 journal）——这样事件流的 revision 严格
//! 递增，前端发现跳号就知道漏了事件、重新拉快照。
//!
//! `cancel()` —— 锁内验证 → journal 记 CancelRequested → 设置原子标志
//! → 广播 CancelRequested 事件。**状态和 revision 在同一把锁里跟标志
//! 一起捕获**，避免 fsync 期间 job 退出后事件携带错误状态。
//! 幂等：重复 cancel 直接 Ok 返回，不重复写 journal。
//!
//! 超时看门狗 `spawn_watchdog()` —— 到点后设置取消与超时标志，要求 job
//! 在下一个安全边界退出。job 确实退出后才由 worker 提交 failed +
//! `vua.task.timeout`，因此终态之后不会再有后台副作用。
//!
//! `finish()` —— 终态落地：一条 Completed 同时持久化状态、错误和结果；
//! fsync 成功后才更新内存并发布 Completed。事件 payload 约定：失败带
//! 错误信封、成功带结果负载。
//!
//! 事件分发 `publish()` —— 每个订阅者一个 mpsc channel，`retain`
//! 静默清掉已关闭的订阅者。漏事件的兜底永远是"重拉快照"
//! （ORC-STA-005），事件本身不承诺不丢。
//!
//! `run_steps` 里出现的"每个 job 一个线程"（ORC-CON-002 的 v0 形态）：
//! 阻塞 I/O 不会卡住主线程；H-STATE 换 async 时这里是对应改造点。

use crate::contracts::{
    AppErrorV1, CommandAcceptedV1, ErrorCategory, ParamValue, TaskEventKind, TaskEventV1,
    TaskState, ENVELOPE_SCHEMA_VERSION,
};
use crate::journal::{
    JournalEntryKind, JournalEntryV1, JournalPayload, JournalSink, RecoveredDisposition,
    JOURNAL_SCHEMA_VERSION,
};
use crate::sqlite_task_store::{NewTask, SqliteStoreError, SqliteTaskStore, TaskMutation};
use crate::time::{Clock, TaskIdGenerator};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// Stable runtime error codes (ORC-ERR-001). Owned by the runtime module.
pub mod error_codes {
    pub const JOURNAL_WRITE_FAILED: &str = "vua.task.journal_write_failed";
    pub const JOURNAL_RECOVERY_REQUIRED: &str = "vua.task.journal_recovery_required";
    pub const TIMEOUT: &str = "vua.task.timeout";
    pub const CANCELLED: &str = "vua.task.cancelled";
    pub const UNKNOWN_TASK: &str = "vua.task.unknown_task";
    pub const INVALID_TRANSITION: &str = "vua.task.invalid_transition";
    /// 生成的任务 ID 与已恢复/已存在的任务撞车：id 生成器坏了或配置重复，
    /// 拒绝而不是覆盖旧任务记录（Fix 3 的防御）。
    pub const ID_COLLISION: &str = "vua.task.id_collision";
}

/// What a job hands back when it finishes (ORC-CON-006: the job itself
/// decides whether it stopped at a safe boundary because of a cancel
/// request).
pub enum TaskExit {
    Done(Value),
    Cancelled,
}

/// The unit of work executed on a dedicated worker thread (ORC-CON-002).
pub type TaskJob = Box<dyn FnOnce(&TaskContext) -> Result<TaskExit, AppErrorV1> + Send>;

pub struct SubmitRequest {
    /// Optional caller-supplied correlation id; generated when absent.
    pub correlation_id: Option<String>,
    /// Optional wall-clock budget. On expiry the cancel flag is set and the
    /// task is force-finished as `failed` with code `vua.task.timeout`
    /// (ORC-CON-004).
    pub timeout: Option<Duration>,
    pub job: TaskJob,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskSnapshot {
    pub task_id: String,
    pub state: TaskState,
    pub revision: u64,
    pub correlation_id: String,
    pub cancel_requested: bool,
    pub recovery_disposition: TaskRecoveryDisposition,
    /// True when a persistence failure froze this task in-session: no
    /// further mutations are accepted and the task must surface as needing
    /// inspection (it will read `inspect_required` from the authority after
    /// restart). Exposed so serving layers can present the freeze as a
    /// failure instead of a task that merely stopped progressing.
    pub poisoned: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskRecoveryDisposition {
    None,
    InspectRequired,
}

struct TaskRecord {
    state: TaskState,
    revision: u64,
    correlation_id: String,
    cancel_requested: AtomicBool,
    timeout_requested: AtomicBool,
    warned: AtomicBool,
    poisoned: bool,
    recovery_disposition: TaskRecoveryDisposition,
}

struct RuntimeInner {
    tasks: Mutex<HashMap<String, TaskRecord>>,
    journal: Option<Arc<dyn JournalSink>>,
    sqlite: Option<Arc<SqliteTaskStore>>,
    clock: Arc<dyn Clock>,
    ids: Arc<dyn TaskIdGenerator>,
    seq: Mutex<u64>,
    journal_accepting: AtomicBool,
    subscribers: Mutex<Vec<mpsc::Sender<TaskEventV1>>>,
}

impl RuntimeInner {
    /// Allocates the global sequence and appends while holding one lock.
    /// Separating these operations permits seq=2/seq=3 to reach the file in
    /// reverse order when two tasks run concurrently.
    fn append_journal(
        &self,
        task_id: &str,
        kind: JournalEntryKind,
        payload: JournalPayload,
    ) -> Result<(), crate::journal::JournalError> {
        if !self.journal_accepting.load(Ordering::Acquire) {
            return Err(crate::journal::JournalError::Io(std::io::Error::other(
                "journal requires recovery",
            )));
        }
        let mut seq = self.seq.lock().expect("journal sequence poisoned");
        *seq += 1;
        let entry = self.journal_entry(*seq, task_id, kind, payload);
        let result = self
            .journal
            .as_ref()
            .expect("legacy append requires a journal")
            .append(&entry);
        if result.is_err() {
            // An append can fail after a partial write. Continuing to append
            // would make the tail impossible to replay deterministically.
            self.journal_accepting.store(false, Ordering::Release);
        }
        result
    }

    fn persist_acceptance(
        &self,
        task_id: &str,
        correlation_id: &str,
        occurred_at: &str,
        accepted: &CommandAcceptedV1,
    ) -> Result<(), PersistenceFailure> {
        if let Some(sqlite) = &self.sqlite {
            sqlite
                .accept_task(&NewTask {
                    task_id: task_id.into(),
                    correlation_id: correlation_id.into(),
                    occurred_at: occurred_at.into(),
                })
                .map(|_| ())
                .map_err(PersistenceFailure::Sqlite)
        } else {
            self.append_journal(
                task_id,
                JournalEntryKind::Accepted,
                JournalPayload::Accepted {
                    accepted: accepted.clone(),
                },
            )
            .map_err(PersistenceFailure::Journal)
        }
    }

    fn persist_mutation(
        &self,
        task_id: &str,
        expected_revision: u64,
        occurred_at: &str,
        mutation: TaskMutation,
    ) -> Result<(), PersistenceFailure> {
        if let Some(sqlite) = &self.sqlite {
            sqlite
                .mutate_task(task_id, expected_revision, occurred_at, mutation)
                .map(|_| ())
                .map_err(PersistenceFailure::Sqlite)
        } else {
            let legacy = match mutation {
                TaskMutation::Transition { state, .. } => Some((
                    JournalEntryKind::StateChanged,
                    JournalPayload::StateChanged { state },
                )),
                // Progress was deliberately never part of the transitional
                // JSONL format. Only the SQLite authority persists it.
                TaskMutation::Progress { .. } => None,
                TaskMutation::RequestCancellation { .. } => Some((
                    JournalEntryKind::CancelRequested,
                    JournalPayload::CancelRequested,
                )),
                TaskMutation::Complete {
                    state,
                    error,
                    result,
                } => Some((
                    JournalEntryKind::Completed,
                    JournalPayload::Completed {
                        state,
                        error,
                        result,
                    },
                )),
            };
            match legacy {
                Some((kind, payload)) => self
                    .append_journal(task_id, kind, payload)
                    .map_err(PersistenceFailure::Journal),
                None => Ok(()),
            }
        }
    }

    /// A Gateway cancellation can race a worker's durable progress/transition. Only that
    /// one external revision is reconciled; arbitrary concurrent edits still freeze the task.
    /// The caller holds the runtime task lock. SQLite CAS keeps both writers ordered.
    fn persist_record_mutation(
        &self,
        task_id: &str,
        record: &mut TaskRecord,
        occurred_at: &str,
        mutation: TaskMutation,
    ) -> Result<(), PersistenceFailure> {
        let result = self.persist_mutation(task_id, record.revision, occurred_at, mutation.clone());
        if matches!(
            result,
            Err(PersistenceFailure::Sqlite(
                SqliteStoreError::RevisionConflict { .. }
            ))
        ) {
            if let Some(sqlite) = &self.sqlite {
                let current = sqlite.task(task_id).map_err(PersistenceFailure::Sqlite)?;
                if let Some(current) = current {
                    if current.revision == record.revision + 1
                        && current.state == record.state
                        && current.cancel_requested
                        && !record.cancel_requested.load(Ordering::SeqCst)
                    {
                        record.revision = current.revision;
                        record.cancel_requested.store(true, Ordering::SeqCst);
                        return self.persist_mutation(
                            task_id,
                            record.revision,
                            occurred_at,
                            mutation,
                        );
                    }
                }
            }
        }
        result
    }

    fn publish(&self, event: TaskEventV1) {
        let mut subscribers = self.subscribers.lock().expect("subscribers poisoned");
        // retain 静默剔除已关闭的订阅者（前端窗口关了 channel 就断了）；
        // 事件不承诺必达——漏事件的兜底是 revision 跳号后重拉快照。
        subscribers.retain(|sender| sender.send(event.clone()).is_ok());
    }

    #[allow(clippy::too_many_arguments)]
    fn make_event_at(
        &self,
        task_id: &str,
        revision: u64,
        kind: TaskEventKind,
        state: TaskState,
        payload: Value,
        occurred_at: String,
        correlation_id: String,
    ) -> TaskEventV1 {
        TaskEventV1 {
            schema_version: ENVELOPE_SCHEMA_VERSION,
            task_id: task_id.to_owned(),
            revision,
            occurred_at,
            correlation_id,
            kind,
            state,
            payload,
        }
    }

    fn journal_entry(
        &self,
        seq: u64,
        task_id: &str,
        kind: JournalEntryKind,
        payload: JournalPayload,
    ) -> JournalEntryV1 {
        JournalEntryV1 {
            schema_version: JOURNAL_SCHEMA_VERSION,
            seq,
            task_id: task_id.to_owned(),
            kind,
            occurred_at: self.clock.now_rfc3339(),
            payload,
        }
    }
}

enum PersistenceFailure {
    Journal(crate::journal::JournalError),
    Sqlite(SqliteStoreError),
}

/// The public handle. Cheap to clone; each engine slice owns one.
#[derive(Clone)]
pub struct TaskRuntime {
    inner: Arc<RuntimeInner>,
}

impl TaskRuntime {
    /// Creates a runtime over the given journal sink (Fix 3): the journal is
    /// replayed so the sequence continues monotonically and previously known
    /// tasks appear in `snapshot_all` with their last journaled state. A
    /// journal with an unknown version or a corrupt tail stays untouched and
    /// is NOT auto-registered (manual diagnosis, ORC-STO-005); the sequence
    /// still continues from the last good entry so no new entry ever
    /// duplicates or regresses an existing one. Recovered tasks are
    /// bookkeeping-only: their jobs are gone with the old process, and
    /// H-STATE will add explicit continue/recover actions.
    pub fn new(
        journal: Arc<dyn JournalSink>,
        clock: Arc<dyn Clock>,
        ids: Arc<dyn TaskIdGenerator>,
    ) -> Self {
        let mut tasks: HashMap<String, TaskRecord> = HashMap::new();
        let mut start_seq: u64 = 0;
        let mut journal_accepting = true;
        if let Some(path) = journal.path() {
            let report = crate::journal::recover_from_journal(path);
            if !report.unknown_version && !report.corrupt_tail {
                start_seq = report.last_seq;
                for recovered in report.tasks {
                    tasks.insert(
                        recovered.task_id.clone(),
                        TaskRecord {
                            state: recovered.last_state,
                            revision: recovered.last_revision.max(1),
                            correlation_id: format!("corr-recovered-{}", recovered.task_id),
                            cancel_requested: AtomicBool::new(recovered.cancel_requested),
                            timeout_requested: AtomicBool::new(false),
                            warned: AtomicBool::new(false),
                            poisoned: false,
                            recovery_disposition: if recovered.last_state.is_terminal() {
                                TaskRecoveryDisposition::None
                            } else {
                                TaskRecoveryDisposition::InspectRequired
                            },
                        },
                    );
                }
            } else {
                // Unclean journal: sequence still continues from the last good
                // entry (no duplicates/regressions), but appended entries stay
                // unreadable to replay until the tail is cleaned up manually.
                start_seq = report.last_seq;
                journal_accepting = false;
            }
        }
        Self {
            inner: Arc::new(RuntimeInner {
                tasks: Mutex::new(tasks),
                journal: Some(journal),
                sqlite: None,
                clock,
                ids,
                seq: Mutex::new(start_seq),
                journal_accepting: AtomicBool::new(journal_accepting),
                subscribers: Mutex::new(Vec::new()),
            }),
        }
    }

    /// Creates the production runtime over the SQLite task authority. Existing
    /// nonterminal tasks are registered for explicit Inspect/recovery; their
    /// vanished jobs are never resumed implicitly.
    pub fn with_sqlite(
        sqlite: Arc<SqliteTaskStore>,
        clock: Arc<dyn Clock>,
        ids: Arc<dyn TaskIdGenerator>,
    ) -> Result<Self, SqliteStoreError> {
        let tasks = sqlite
            .tasks()?
            .into_iter()
            .map(|stored| {
                (
                    stored.task_id,
                    TaskRecord {
                        state: stored.state,
                        revision: stored.revision,
                        correlation_id: stored.correlation_id,
                        cancel_requested: AtomicBool::new(stored.cancel_requested),
                        timeout_requested: AtomicBool::new(false),
                        warned: AtomicBool::new(false),
                        poisoned: false,
                        recovery_disposition: if stored.state.is_terminal() {
                            TaskRecoveryDisposition::None
                        } else {
                            TaskRecoveryDisposition::InspectRequired
                        },
                    },
                )
            })
            .collect();
        Ok(Self {
            inner: Arc::new(RuntimeInner {
                tasks: Mutex::new(tasks),
                journal: None,
                sqlite: Some(sqlite),
                clock,
                ids,
                seq: Mutex::new(0),
                journal_accepting: AtomicBool::new(true),
                subscribers: Mutex::new(Vec::new()),
            }),
        })
    }

    /// Subscribes to lifecycle events. Missed events are recovered by
    /// re-querying [`TaskRuntime::snapshot`] (ORC-STA-005).
    pub fn subscribe(&self) -> mpsc::Receiver<TaskEventV1> {
        let (sender, receiver) = mpsc::channel();
        self.inner
            .subscribers
            .lock()
            .expect("subscribers poisoned")
            .push(sender);
        receiver
    }

    /// Accepts a task for execution. The acceptance is journaled before the
    /// caller observes success (ORC-STA-006); a journal failure rejects the
    /// command without starting the job.
    pub fn submit(&self, request: SubmitRequest) -> Result<CommandAcceptedV1, AppErrorV1> {
        self.submit_inner(request, None)
    }

    /// Atomically bind a command ID and fingerprint to durable task acceptance. Replays
    /// return the original receipt without spawning another worker, including after restart.
    /// This uses the existing SQLite idempotency table; it introduces no persistence format.
    pub fn submit_idempotent(
        &self,
        request: SubmitRequest,
        command_kind: &str,
        command_id: &str,
        fingerprint: &str,
    ) -> Result<CommandAcceptedV1, AppErrorV1> {
        self.submit_inner(request, Some((command_kind, command_id, fingerprint)))
    }

    fn submit_inner(
        &self,
        request: SubmitRequest,
        idempotency: Option<(&str, &str, &str)>,
    ) -> Result<CommandAcceptedV1, AppErrorV1> {
        if !self.inner.journal_accepting.load(Ordering::Acquire) {
            return Err(AppErrorV1::new(
                error_codes::JOURNAL_RECOVERY_REQUIRED,
                ErrorCategory::Unavailable,
                "errors.task.journalRecoveryRequired",
                "corr-journal-recovery",
            )
            .with_recoverable(true));
        }
        let task_id = self.inner.ids.generate();
        let correlation_id = request
            .correlation_id
            .unwrap_or_else(|| format!("corr-{task_id}"));
        let accepted = CommandAcceptedV1 {
            schema_version: ENVELOPE_SCHEMA_VERSION,
            task_id: task_id.clone(),
            accepted_revision: 1,
            initial_state: TaskState::Queued,
        };
        let accepted_at = self.inner.clock.now_rfc3339();

        // Keep collision check, durable acceptance and in-memory visibility
        // under the task lock. A snapshot can never observe an unaccepted
        // task, and two broken generators cannot overwrite one another.
        {
            let mut tasks = self.inner.tasks.lock().expect("tasks poisoned");
            if idempotency.is_none() && tasks.contains_key(&task_id) {
                return Err(AppErrorV1::new(
                    error_codes::ID_COLLISION,
                    ErrorCategory::Internal,
                    "errors.task.idCollision",
                    format!("corr-{task_id}"),
                ));
            }
            if let Some((kind, key, fingerprint)) = idempotency {
                let sqlite = self.inner.sqlite.as_ref().ok_or_else(|| {
                    AppErrorV1::new(
                        "vua.task.idempotency_unavailable",
                        ErrorCategory::Unavailable,
                        "errors.task.idempotencyUnavailable",
                        correlation_id.clone(),
                    )
                })?;
                let task = NewTask {
                    task_id: task_id.clone(),
                    correlation_id: correlation_id.clone(),
                    occurred_at: accepted_at.clone(),
                };
                let response = serde_json::to_value(&accepted).expect("task receipt serializes");
                match sqlite.accept_idempotent_task(kind, key, fingerprint, &task, &response) {
                    Ok(crate::sqlite_task_store::IdempotentTaskAcceptance::Replayed {
                        response,
                        ..
                    }) => {
                        return serde_json::from_value(response).map_err(|_| {
                            AppErrorV1::new(
                                "vua.task.invalid_receipt",
                                ErrorCategory::Internal,
                                "errors.task.invalidReceipt",
                                correlation_id.clone(),
                            )
                        });
                    }
                    Ok(crate::sqlite_task_store::IdempotentTaskAcceptance::Accepted { .. }) => {}
                    Err(SqliteStoreError::IdempotencyConflict { .. }) => {
                        return Err(AppErrorV1::new(
                            "vua.task.idempotency_conflict",
                            ErrorCategory::Conflict,
                            "errors.task.idempotencyConflict",
                            correlation_id.clone(),
                        ))
                    }
                    Err(error) => {
                        self.inner.journal_accepting.store(false, Ordering::Release);
                        return Err(persistence_failure(
                            &PersistenceFailure::Sqlite(error),
                            &task_id,
                        ));
                    }
                }
            } else if let Err(error) =
                self.inner
                    .persist_acceptance(&task_id, &correlation_id, &accepted_at, &accepted)
            {
                self.inner.journal_accepting.store(false, Ordering::Release);
                return Err(persistence_failure(&error, &task_id));
            }
            tasks.insert(
                task_id.clone(),
                TaskRecord {
                    state: TaskState::Queued,
                    revision: 1,
                    correlation_id: correlation_id.clone(),
                    cancel_requested: AtomicBool::new(false),
                    timeout_requested: AtomicBool::new(false),
                    warned: AtomicBool::new(false),
                    poisoned: false,
                    recovery_disposition: TaskRecoveryDisposition::None,
                },
            );
        }

        self.inner.publish(self.inner.make_event_at(
            &task_id,
            1,
            TaskEventKind::Accepted,
            TaskState::Queued,
            Value::Null,
            accepted_at,
            correlation_id,
        ));

        self.spawn_worker(task_id.clone(), request.job);
        if let Some(timeout) = request.timeout {
            self.spawn_watchdog(task_id, timeout);
        }
        Ok(accepted)
    }

    /// Requests cooperative cancellation; takes effect at the job's next safe
    /// boundary (ORC-CON-001, ORC-CON-006). Idempotent.
    /// Complete a vanished SQLite worker after explicit domain inspection.
    /// Inspection and cancellation are recorded together; no worker is resumed.
    pub fn cancel_after_inspection(&self, task_id: &str, observed_revision: u64, result: Value) -> Result<(), AppErrorV1> {
        let refused = || AppErrorV1::new("vua.task.inspection_conflict", ErrorCategory::Conflict, "errors.task.inspectionRequired", task_id);
        let Some(sqlite) = &self.inner.sqlite else { return Err(refused()); };
        let mut tasks = self.inner.tasks.lock().expect("tasks poisoned");
        let Some(record) = tasks.get_mut(task_id) else { return Err(refused()); };
        if record.poisoned || record.recovery_disposition != TaskRecoveryDisposition::InspectRequired { return Err(refused()); }
        let stored = sqlite.task(task_id).map_err(|error| persistence_failure(&PersistenceFailure::Sqlite(error), task_id))?.ok_or_else(refused)?;
        if stored.state.is_terminal() || stored.revision != observed_revision { return Err(refused()); }
        let occurred_at = self.inner.clock.now_rfc3339();
        let event = sqlite.mutate_task(task_id, observed_revision, &occurred_at, TaskMutation::Complete { state: TaskState::Cancelled, error: None, result: Some(result.clone()) })
            .map_err(|error| persistence_failure(&PersistenceFailure::Sqlite(error), task_id))?.ok_or_else(refused)?;
        record.state = TaskState::Cancelled; record.revision = event.revision;
        record.cancel_requested.store(stored.cancel_requested, Ordering::SeqCst);
        record.recovery_disposition = TaskRecoveryDisposition::None;
        self.inner.publish(self.inner.make_event_at(task_id, event.revision, TaskEventKind::Completed, TaskState::Cancelled, result, occurred_at, stored.correlation_id));
        Ok(())
    }

    pub fn cancel(&self, task_id: &str) -> Result<(), AppErrorV1> {
        // State and revision are captured under the same lock as the flag so
        // the event reports the moment of the request, not a later state the
        // job may already have reached while the journal fsync ran.
        // journal-first (Fix 2): the flag is set only after the CancelRequested
        // line is durable -- otherwise a journal failure would leave the worker
        // observing a cancellation that the black box never recorded.
        let occurred_at = self.inner.clock.now_rfc3339();
        let (state_at_request, revision_at_request, correlation_id) = {
            let mut tasks = self.inner.tasks.lock().expect("tasks poisoned");
            let Some(record) = tasks.get_mut(task_id) else {
                return Err(AppErrorV1::new(
                    error_codes::UNKNOWN_TASK,
                    ErrorCategory::Validation,
                    "errors.task.unknownTask",
                    task_id.to_owned(),
                ));
            };
            if record.state.is_terminal() {
                return Ok(());
            }
            if record.poisoned {
                // A frozen task cannot record a cancellation request;
                // pretending success would be a false acknowledgement.
                return Err(AppErrorV1::new(
                    error_codes::JOURNAL_WRITE_FAILED,
                    ErrorCategory::Internal,
                    "errors.task.journalWriteFailed",
                    task_id.to_owned(),
                )
                .with_recoverable(true));
            }
            if record.cancel_requested.load(Ordering::SeqCst) {
                return Ok(());
            }
            if let Err(error) = self.inner.persist_record_mutation(
                task_id,
                record,
                &occurred_at,
                TaskMutation::RequestCancellation {
                    payload: Value::Null,
                },
            ) {
                record.poisoned = true;
                let state = record.state;
                let revision = record.revision + 1;
                record.revision = revision;
                publish_persistence_failed(
                    &self.inner,
                    task_id,
                    state,
                    revision,
                    &record.correlation_id,
                );
                return Err(persistence_failure(&error, task_id));
            }
            record.cancel_requested.store(true, Ordering::SeqCst);
            record.revision += 1;
            (record.state, record.revision, record.correlation_id.clone())
        };
        self.inner.publish(self.inner.make_event_at(
            task_id,
            revision_at_request,
            TaskEventKind::CancelRequested,
            state_at_request,
            Value::Null,
            occurred_at,
            correlation_id,
        ));
        Ok(())
    }

    /// Reads the current snapshot of one task (ORC-IPC-002). A poisoned
    /// record reports `InspectRequired` regardless of its stored disposition:
    /// the frozen condition and the restart-recovery condition require the
    /// same user action.
    pub fn snapshot(&self, task_id: &str) -> Option<TaskSnapshot> {
        let tasks = self.inner.tasks.lock().expect("tasks poisoned");
        tasks.get(task_id).map(|record| TaskSnapshot {
            task_id: task_id.to_owned(),
            state: record.state,
            revision: record.revision,
            correlation_id: record.correlation_id.clone(),
            cancel_requested: record.cancel_requested.load(Ordering::SeqCst),
            recovery_disposition: disposition_of(record),
            poisoned: record.poisoned,
        })
    }

    /// Reads snapshots of all known tasks (ORC-IPC-002).
    pub fn snapshot_all(&self) -> Vec<TaskSnapshot> {
        let tasks = self.inner.tasks.lock().expect("tasks poisoned");
        let mut snapshots: Vec<TaskSnapshot> = tasks
            .iter()
            .map(|(task_id, record)| TaskSnapshot {
                task_id: task_id.clone(),
                state: record.state,
                revision: record.revision,
                correlation_id: record.correlation_id.clone(),
                cancel_requested: record.cancel_requested.load(Ordering::SeqCst),
                recovery_disposition: disposition_of(record),
                poisoned: record.poisoned,
            })
            .collect();
        snapshots.sort_by(|left, right| left.task_id.cmp(&right.task_id));
        snapshots
    }

    fn spawn_worker(self: &TaskRuntime, task_id: String, job: TaskJob) {
        let runtime = self.clone();
        std::thread::spawn(move || {
            let context = TaskContext {
                runtime,
                task_id: task_id.clone(),
            };
            // queued → preparing → running (Fix 2): a transition failure
            // before execution (journal unwritable etc.) must terminate the
            // task -- the job never runs, so side effects cannot happen
            // without a recovery record (ORC-STA-004/006).
            if let Err(error) = context
                .transition(TaskState::Preparing)
                .and_then(|_| context.transition(TaskState::Running))
            {
                context.finish(TaskState::Failed, Some(error), None);
                return;
            }

            let exit = job(&context);
            let timed_out = context.timeout_requested();
            if timed_out {
                context.finish(
                    TaskState::Failed,
                    Some(AppErrorV1::new(
                        error_codes::TIMEOUT,
                        ErrorCategory::Timeout,
                        "errors.task.timeout",
                        format!("corr-{task_id}"),
                    )),
                    None,
                );
                return;
            }
            match exit {
                Ok(TaskExit::Done(value)) => {
                    let warned = context
                        .runtime
                        .inner
                        .tasks
                        .lock()
                        .expect("tasks poisoned")
                        .get(&task_id)
                        .map(|record| record.warned.load(Ordering::SeqCst))
                        .unwrap_or(false);
                    let state = if warned {
                        TaskState::SucceededWithWarnings
                    } else {
                        TaskState::Succeeded
                    };
                    context.finish(state, None, Some(value));
                }
                Ok(TaskExit::Cancelled) => {
                    context.finish(TaskState::Cancelled, None, None);
                }
                Err(error) if error.category == ErrorCategory::Cancelled => {
                    context.finish(TaskState::Cancelled, None, None);
                }
                Err(error) => {
                    context.finish(TaskState::Failed, Some(error), None);
                }
            }
        });
    }

    fn spawn_watchdog(&self, task_id: String, timeout: Duration) {
        let runtime = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(timeout);
            let context = TaskContext {
                runtime,
                task_id: task_id.clone(),
            };
            context.force_timeout();
        });
    }
}

fn persistence_failure(error: &PersistenceFailure, task_id: &str) -> AppErrorV1 {
    match error {
        PersistenceFailure::Journal(error) => {
            let _ = error;
        }
        PersistenceFailure::Sqlite(error) => {
            let _ = error;
        }
    }
    // Never leak filesystem paths, SQL, or driver diagnostics to the wire.
    AppErrorV1::new(
        error_codes::JOURNAL_WRITE_FAILED,
        ErrorCategory::Internal,
        "errors.task.journalWriteFailed",
        format!("corr-{task_id}"),
    )
    .with_recoverable(true)
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
            // Cancellation may arrive at any live state.
            | (Queued, Cancelled)
            | (Preparing, Cancelled)
            | (Running, Cancelled)
            | (WaitingForInput, Cancelled)
            | (Paused, Cancelled)
    )
}

/// The externally visible disposition of a record: a poisoned record awaits
/// inspection exactly like a restart-recovered non-terminal one.
fn disposition_of(record: &TaskRecord) -> TaskRecoveryDisposition {
    if record.poisoned && record.recovery_disposition == TaskRecoveryDisposition::None {
        return TaskRecoveryDisposition::InspectRequired;
    }
    record.recovery_disposition
}

/// Publishes the in-session freeze notification. Called exactly once per
/// task, at the first persistence failure, with the tasks lock held (the
/// same discipline as the Completed publish in `finish`).
///
/// The event is never persisted (persistence is what failed); the revision
/// is bumped in memory so the event stream stays strictly monotonic. After a
/// restart the authority's lower revision wins and consumers re-query a
/// snapshot per the gap rule (ORC-STA-005).
fn publish_persistence_failed(
    inner: &RuntimeInner,
    task_id: &str,
    state: TaskState,
    revision: u64,
    correlation_id: &str,
) {
    let error = AppErrorV1::new(
        error_codes::JOURNAL_WRITE_FAILED,
        ErrorCategory::Internal,
        "errors.task.journalWriteFailed",
        format!("corr-{task_id}"),
    )
    .with_recoverable(true);
    inner.publish(inner.make_event_at(
        task_id,
        revision,
        TaskEventKind::PersistenceFailed,
        state,
        serde_json::to_value(&error).unwrap_or(Value::Null),
        inner.clock.now_rfc3339(),
        correlation_id.to_owned(),
    ));
}
/// The handle a job uses to observe progress boundaries, emit progress and
/// move through intermediate states.
pub struct TaskContext {
    runtime: TaskRuntime,
    task_id: String,
}

impl TaskContext {
    pub fn task_id(&self) -> &str {
        &self.task_id
    }

    /// True once a cancel request (or timeout) has been recorded; the job
    /// decides where its safe boundaries are and exits with
    /// [`TaskExit::Cancelled`] (ORC-CON-006).
    pub fn check_cancel(&self) -> bool {
        // Gateway cancellation is accepted directly by the shared SQLite authority. Refresh
        // under the runtime lock before a safe boundary so its newer revision and cancel flag
        // cannot be missed, or make the following transition fail due to a stale revision.
        if let Some(sqlite) = &self.runtime.inner.sqlite {
            let mut tasks = self.runtime.inner.tasks.lock().expect("tasks poisoned");
            match sqlite.task(&self.task_id) {
                Ok(Some(stored)) => {
                    if let Some(record) = tasks.get_mut(&self.task_id) {
                        if stored.revision > record.revision {
                            record.revision = stored.revision;
                            record.state = stored.state;
                            record
                                .cancel_requested
                                .store(stored.cancel_requested, Ordering::SeqCst);
                        }
                    }
                }
                // Failed reobservation is a safe stop, never permission to continue writes.
                _ => return true,
            }
        }
        self.runtime
            .snapshot(&self.task_id)
            .map(|snapshot| {
                snapshot.cancel_requested
                    || snapshot.poisoned
                    || snapshot.recovery_disposition == TaskRecoveryDisposition::InspectRequired
            })
            .unwrap_or(true)
    }

    fn timeout_requested(&self) -> bool {
        self.runtime
            .inner
            .tasks
            .lock()
            .expect("tasks poisoned")
            .get(&self.task_id)
            .map(|record| record.timeout_requested.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    /// Typed cancellation result for engines at a safe boundary.
    pub fn cancellation_error(&self, correlation_id: &str) -> Option<AppErrorV1> {
        self.check_cancel().then(|| {
            AppErrorV1::new(
                error_codes::CANCELLED,
                ErrorCategory::Cancelled,
                "errors.task.cancelled",
                correlation_id.to_owned(),
            )
            .with_recoverable(true)
        })
    }

    /// Marks the task as having produced warnings; successful completion then
    /// maps to `succeeded_with_warnings`.
    pub fn warn(&self) {
        if let Some(record) = self
            .runtime
            .inner
            .tasks
            .lock()
            .expect("tasks poisoned")
            .get_mut(&self.task_id)
        {
            if !record.state.is_terminal() && !record.poisoned {
                record.warned.store(true, Ordering::SeqCst);
            }
        }
    }

    /// Moves the task through an intermediate state (queued → preparing →
    /// running → waiting_for_input/paused → running). Journal first, then
    /// event (ORC-WF-007, ORC-STA-003).
    pub fn transition(&self, to: TaskState) -> Result<(), AppErrorV1> {
        self.apply_transition(to)
    }

    /// Emits a typed progress datapoint on the request-boundary channel
    /// (ORC-IPC-004). Progress increments the in-memory revision so the event
    /// stream stays strictly monotonic for consumers, but (unlike state
    /// transitions) it is not journaled in v0.
    pub fn emit_progress(&self, payload: Value) {
        let occurred_at = self.runtime.inner.clock.now_rfc3339();
        let (state, revision, correlation_id) = {
            let mut tasks = self.runtime.inner.tasks.lock().expect("tasks poisoned");
            match tasks.get_mut(&self.task_id) {
                Some(record) => {
                    if record.state.is_terminal() || record.poisoned {
                        return;
                    }
                    if self
                        .runtime
                        .inner
                        .persist_record_mutation(
                            &self.task_id,
                            record,
                            &occurred_at,
                            TaskMutation::Progress {
                                payload: payload.clone(),
                            },
                        )
                        .is_err()
                    {
                        record.poisoned = true;
                        let state = record.state;
                        let revision = record.revision + 1;
                        record.revision = revision;
                        let correlation_id = record.correlation_id.clone();
                        publish_persistence_failed(
                            &self.runtime.inner,
                            &self.task_id,
                            state,
                            revision,
                            &correlation_id,
                        );
                        return;
                    }
                    record.revision += 1;
                    (record.state, record.revision, record.correlation_id.clone())
                }
                None => return,
            }
        };
        self.runtime.inner.publish(self.runtime.inner.make_event_at(
            &self.task_id,
            revision,
            TaskEventKind::Progress,
            state,
            payload,
            occurred_at,
            correlation_id,
        ));
    }

    fn apply_transition(&self, to: TaskState) -> Result<(), AppErrorV1> {
        // journal-first (Fix 2, ORC-STA-004): validate, persist, commit
        // memory, publish -- in that order, all under the tasks lock so the
        // outside world never observes an unpersisted transition. Holding
        // the lock across fsync costs a few ms of snapshot/cancel latency;
        // correctness wins. On failure the memory state is untouched and the
        // task is poisoned: spawn_worker must terminate instead of running
        // the job without a recovery record.
        let occurred_at = self.runtime.inner.clock.now_rfc3339();
        let (revision, correlation_id) = {
            let mut tasks = self.runtime.inner.tasks.lock().expect("tasks poisoned");
            let Some(record) = tasks.get_mut(&self.task_id) else {
                return Err(AppErrorV1::new(
                    error_codes::UNKNOWN_TASK,
                    ErrorCategory::Validation,
                    "errors.task.unknownTask",
                    self.task_id.clone(),
                ));
            };
            if !can_transition(record.state, to) {
                let from = record.state;
                return Err(AppErrorV1::new(
                    error_codes::INVALID_TRANSITION,
                    ErrorCategory::Validation,
                    "errors.task.invalidTransition",
                    self.task_id.clone(),
                )
                .with_param("from", ParamValue::Text(from.to_string()))
                .with_param("to", ParamValue::Text(to.to_string())));
            }
            if record.poisoned {
                return Err(AppErrorV1::new(
                    error_codes::JOURNAL_WRITE_FAILED,
                    ErrorCategory::Internal,
                    "errors.task.journalWriteFailed",
                    self.task_id.clone(),
                ));
            }
            if let Err(error) = self.runtime.inner.persist_record_mutation(
                &self.task_id,
                record,
                &occurred_at,
                TaskMutation::Transition {
                    state: to,
                    payload: Value::Null,
                },
            ) {
                record.poisoned = true;
                let state = record.state;
                let revision = record.revision + 1;
                record.revision = revision;
                let correlation_id = record.correlation_id.clone();
                publish_persistence_failed(
                    &self.runtime.inner,
                    &self.task_id,
                    state,
                    revision,
                    &correlation_id,
                );
                return Err(persistence_failure(&error, &self.task_id));
            }
            record.revision += 1;
            record.state = to;
            (record.revision, record.correlation_id.clone())
        };
        self.runtime.inner.publish(self.runtime.inner.make_event_at(
            &self.task_id,
            revision,
            TaskEventKind::StateChanged,
            to,
            Value::Null,
            occurred_at,
            correlation_id,
        ));
        Ok(())
    }
    fn finish(&self, desired: TaskState, error: Option<AppErrorV1>, result: Option<Value>) {
        // Completed 是终态、结果和错误的单一持久化提交点。先追加并 fsync，
        // 再修改内存和发布事件；写入失败时既不能向 UI 宣称成功，也不能
        // 留下只有 StateChanged、没有外部结果的半份终态（ORC-STO-002/004）。
        // 锁覆盖 append，保证 watchdog 与正常退出之间严格 first-writer-wins。
        // 发布同样在锁内：终态对 snapshot 可见与 Completed 事件入队是同一
        // 临界区——消费者（订阅事件 + 轮询快照）在观察到终态后立即排空事件
        // 通道必须能看到 Completed。锁外的 publish 曾留下这个窗口，全量并行
        // 下偶发"终态已见、事件未到"（BOARD #7 观察面，warehouse_import 任务
        // 化测试 2026-09-07 定名复现）。通道无界，锁内 send 不阻塞。
        let occurred_at = self.runtime.inner.clock.now_rfc3339();
        {
            let mut tasks = self.runtime.inner.tasks.lock().expect("tasks poisoned");
            let Some(record) = tasks.get_mut(&self.task_id) else {
                return;
            };
            if record.state.is_terminal() || !can_transition(record.state, desired) {
                return;
            }
            if record.poisoned {
                return;
            }
            if self
                .runtime
                .inner
                .persist_record_mutation(
                    &self.task_id,
                    record,
                    &occurred_at,
                    TaskMutation::Complete {
                        state: desired,
                        error: error.clone(),
                        result: result.clone(),
                    },
                )
                .is_err()
            {
                record.poisoned = true;
                let state = record.state;
                let revision = record.revision + 1;
                record.revision = revision;
                let correlation_id = record.correlation_id.clone();
                publish_persistence_failed(
                    &self.runtime.inner,
                    &self.task_id,
                    state,
                    revision,
                    &correlation_id,
                );
                return;
            }
            record.revision += 1;
            record.state = desired;
            self.runtime.inner.publish(self.runtime.inner.make_event_at(
                &self.task_id,
                record.revision,
                TaskEventKind::Completed,
                desired,
                match (&error, &result) {
                    (Some(error), _) => serde_json::to_value(error).unwrap_or(Value::Null),
                    (None, Some(value)) => value.clone(),
                    (None, None) => Value::Null,
                },
                occurred_at,
                record.correlation_id.clone(),
            ));
        }
    }

    fn force_timeout(&self) {
        let occurred_at = self.runtime.inner.clock.now_rfc3339();
        let event = {
            let mut tasks = self.runtime.inner.tasks.lock().expect("tasks poisoned");
            let Some(record) = tasks.get_mut(&self.task_id) else {
                return;
            };
            if record.state.is_terminal() || record.poisoned {
                return;
            }
            if record.cancel_requested.load(Ordering::SeqCst) {
                record.timeout_requested.store(true, Ordering::SeqCst);
                return;
            }
            if self
                .runtime
                .inner
                .persist_record_mutation(
                    &self.task_id,
                    record,
                    &occurred_at,
                    TaskMutation::RequestCancellation {
                        payload: serde_json::json!({ "reason": "timeout" }),
                    },
                )
                .is_err()
            {
                record.poisoned = true;
                let state = record.state;
                let revision = record.revision + 1;
                record.revision = revision;
                let correlation_id = record.correlation_id.clone();
                publish_persistence_failed(
                    &self.runtime.inner,
                    &self.task_id,
                    state,
                    revision,
                    &correlation_id,
                );
                return;
            }
            record.cancel_requested.store(true, Ordering::SeqCst);
            record.timeout_requested.store(true, Ordering::SeqCst);
            record.revision += 1;
            (record.state, record.revision, record.correlation_id.clone())
        };
        self.runtime.inner.publish(self.runtime.inner.make_event_at(
            &self.task_id,
            event.1,
            TaskEventKind::CancelRequested,
            event.0,
            serde_json::json!({ "reason": "timeout" }),
            occurred_at,
            event.2,
        ));
    }
}

/// Classifies journal-recovered tasks for the frontend (O3 minimal set).
pub fn recovery_dispositions(
    report: &crate::journal::RecoveryReport,
) -> Vec<(String, RecoveredDisposition)> {
    report
        .tasks
        .iter()
        .map(|task| (task.task_id.clone(), task.disposition))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::{FixedClock, FixedIdGenerator};
    use std::sync::atomic::AtomicU64;

    struct StubJournal;

    impl JournalSink for StubJournal {
        fn append(&self, _entry: &JournalEntryV1) -> Result<(), crate::journal::JournalError> {
            Ok(())
        }

        fn path(&self) -> Option<&std::path::Path> {
            None
        }
    }

    fn transition_pairs() -> Vec<(TaskState, TaskState, bool)> {
        use TaskState::*;
        vec![
            (Queued, Preparing, true),
            (Queued, Running, false),
            (Queued, Cancelled, true),
            (Preparing, Running, true),
            (Preparing, Cancelled, true),
            (Preparing, Succeeded, false),
            (Running, WaitingForInput, true),
            (Running, Paused, true),
            (Running, Succeeded, true),
            (Running, SucceededWithWarnings, true),
            (Running, Failed, true),
            (Running, Cancelled, true),
            (WaitingForInput, Running, true),
            (WaitingForInput, Cancelled, true),
            (WaitingForInput, Failed, true),
            (WaitingForInput, Succeeded, false),
            (Paused, Running, true),
            (Paused, Cancelled, true),
            (Paused, Failed, true),
            (Succeeded, Running, false),
            (Failed, Failed, false),
            (Cancelled, Running, false),
        ]
    }

    #[test]
    fn orc_tst_002_every_transition_has_an_allowed_and_a_rejected_case() {
        for (from, to, allowed) in transition_pairs() {
            assert_eq!(can_transition(from, to), allowed, "{from:?} -> {to:?}");
        }
        for from in [
            TaskState::Succeeded,
            TaskState::SucceededWithWarnings,
            TaskState::Failed,
            TaskState::Cancelled,
        ] {
            assert!(
                !can_transition(from, TaskState::Running),
                "{from:?} is terminal"
            );
        }
    }

    #[test]
    fn orc_ipc_010_runtime_error_codes_are_stable_and_prefixed() {
        for code in [
            error_codes::JOURNAL_WRITE_FAILED,
            error_codes::JOURNAL_RECOVERY_REQUIRED,
            error_codes::TIMEOUT,
            error_codes::CANCELLED,
            error_codes::UNKNOWN_TASK,
            error_codes::INVALID_TRANSITION,
        ] {
            assert!(code.starts_with("vua.task."));
        }
    }

    #[test]
    fn orc_con_004_timeout_force_finishes_a_running_task_as_failed() {
        let runtime = TaskRuntime::new(
            Arc::new(StubJournal),
            Arc::new(FixedClock::new(&["2026-08-30T00:00:00.000Z"])),
            Arc::new(FixedIdGenerator::default()),
        );
        let entered = Arc::new(AtomicU64::new(0));
        let entered_for_job = entered.clone();
        let accepted = runtime
            .submit(SubmitRequest {
                correlation_id: None,
                timeout: Some(Duration::from_millis(50)),
                job: Box::new(move |context| {
                    entered_for_job.fetch_add(1, Ordering::SeqCst);
                    while !context.check_cancel() {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    Ok(TaskExit::Cancelled)
                }),
            })
            .unwrap();
        // The watchdog requests cancellation; once the cooperative job exits
        // at its safe boundary, the worker commits the timeout as Failed.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let snapshot = runtime.snapshot(&accepted.task_id).unwrap();
            if snapshot.state.is_terminal() {
                assert_eq!(snapshot.state, TaskState::Failed);
                break;
            }
            assert!(std::time::Instant::now() < deadline, "task never finished");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(entered.load(Ordering::SeqCst) >= 1);
    }
}
