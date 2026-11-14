//! Pure conclusion-to-recovery-ladder planner for `eac-probe v0.2`.
//!
//! Steps are ordered from lightest to heaviest:
//! `wait_unload` → `stop_vrchat` → `quit_steam` → `terminate_residual` → `official_repair` → `restart_pc`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EacConclusionV02 {
    Ready,
    SessionActive,
    Unloading,
    ResidualProcess,
    SteamStale,
    NotInstalled,
    InstallDamaged,
    Unknown,
}

impl EacConclusionV02 {
    pub const fn guidance_code(self) -> &'static str {
        match self {
            Self::Ready => "vua.eac_probe.ready",
            Self::SessionActive => "vua.eac_probe.session_active",
            Self::Unloading => "vua.eac_probe.unloading",
            Self::ResidualProcess => "vua.eac_probe.residual_process",
            Self::SteamStale => "vua.eac_probe.steam_stale",
            Self::NotInstalled => "vua.eac_probe.not_installed",
            Self::InstallDamaged => "vua.eac_probe.install_damaged",
            Self::Unknown => "vua.eac_probe.unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EacRecoveryStepId {
    WaitUnload,
    StopVrchat,
    QuitSteam,
    TerminateResidual,
    OfficialRepair,
    RestartPc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EacRecoverySettings {
    pub experimental_termination_enabled: bool,
    pub has_verified_termination_candidate: bool,
}

/// Pure function mapping an EAC v0.2 conclusion and current capability flags to the ordered
/// recovery step ladder. `SessionActive`, `Ready`, and `Unknown` always produce an empty plan.
pub fn plan_recovery(
    conclusion: EacConclusionV02,
    settings: EacRecoverySettings,
) -> Vec<EacRecoveryStepId> {
    match conclusion {
        EacConclusionV02::Ready | EacConclusionV02::SessionActive | EacConclusionV02::Unknown => {
            Vec::new()
        }
        EacConclusionV02::Unloading => {
            vec![EacRecoveryStepId::WaitUnload, EacRecoveryStepId::RestartPc]
        }
        EacConclusionV02::ResidualProcess => {
            if settings.experimental_termination_enabled
                && settings.has_verified_termination_candidate
            {
                vec![
                    EacRecoveryStepId::StopVrchat,
                    EacRecoveryStepId::TerminateResidual,
                    EacRecoveryStepId::RestartPc,
                ]
            } else {
                vec![EacRecoveryStepId::StopVrchat, EacRecoveryStepId::RestartPc]
            }
        }
        EacConclusionV02::SteamStale => {
            vec![EacRecoveryStepId::QuitSteam, EacRecoveryStepId::RestartPc]
        }
        EacConclusionV02::NotInstalled | EacConclusionV02::InstallDamaged => {
            vec![EacRecoveryStepId::OfficialRepair]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_active_ready_and_unknown_always_have_empty_plans() {
        let all_on = EacRecoverySettings {
            experimental_termination_enabled: true,
            has_verified_termination_candidate: true,
        };
        assert!(plan_recovery(EacConclusionV02::SessionActive, all_on).is_empty());
        assert!(plan_recovery(EacConclusionV02::Ready, all_on).is_empty());
        assert!(plan_recovery(EacConclusionV02::Unknown, all_on).is_empty());
    }

    #[test]
    fn residual_process_omits_termination_when_experimental_switch_is_off_or_no_candidate() {
        assert_eq!(
            plan_recovery(
                EacConclusionV02::ResidualProcess,
                EacRecoverySettings {
                    experimental_termination_enabled: false,
                    has_verified_termination_candidate: true,
                }
            ),
            vec![EacRecoveryStepId::StopVrchat, EacRecoveryStepId::RestartPc]
        );
        assert_eq!(
            plan_recovery(
                EacConclusionV02::ResidualProcess,
                EacRecoverySettings {
                    experimental_termination_enabled: true,
                    has_verified_termination_candidate: false,
                }
            ),
            vec![EacRecoveryStepId::StopVrchat, EacRecoveryStepId::RestartPc]
        );
        assert_eq!(
            plan_recovery(
                EacConclusionV02::ResidualProcess,
                EacRecoverySettings {
                    experimental_termination_enabled: true,
                    has_verified_termination_candidate: true,
                }
            ),
            vec![
                EacRecoveryStepId::StopVrchat,
                EacRecoveryStepId::TerminateResidual,
                EacRecoveryStepId::RestartPc,
            ]
        );
    }

    #[test]
    fn not_installed_and_install_damaged_only_offer_official_repair() {
        let all_on = EacRecoverySettings {
            experimental_termination_enabled: true,
            has_verified_termination_candidate: true,
        };
        assert_eq!(
            plan_recovery(EacConclusionV02::NotInstalled, all_on),
            vec![EacRecoveryStepId::OfficialRepair]
        );
        assert_eq!(
            plan_recovery(EacConclusionV02::InstallDamaged, all_on),
            vec![EacRecoveryStepId::OfficialRepair]
        );
    }
}
