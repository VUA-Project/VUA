//! Independent scenario SOP and software observation. Neither performs installation.
use crate::deployment::{
    DeploymentIntent, DeploymentObservation, DeploymentPresence, DeploymentPurpose,
    DeploymentService,
};
use serde::{Deserialize, Serialize};

pub const SCENARIO_SCHEMA: &str = "vua.scenario-environment/v0.1";
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioConnection {
    Usb,
    Wifi,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioSopParams {
    pub scenario: DeploymentPurpose,
    pub connection: Option<ScenarioConnection>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSopStep {
    pub id: String,
    pub title: String,
    pub explanation: String,
    pub expected_result: String,
    pub automatic: bool,
}
pub fn required_components(purposes: &[DeploymentPurpose]) -> Vec<&'static str> {
    let mut result = std::collections::BTreeSet::new();
    for purpose in purposes {
        match purpose {
            DeploymentPurpose::DesktopPlay => {
                result.extend(["steam", "vrchat"]);
            }
            DeploymentPurpose::PicoPcvr => {
                result.extend(["steam", "vrchat", "steamvr", "pico_runtime"]);
            }
            DeploymentPurpose::PcAvatar => {
                result.insert("unity_editor");
            }
            DeploymentPurpose::QuestAvatar => {
                result.extend(["unity_editor", "android_modules"]);
            }
        }
    }
    result.into_iter().collect()
}
pub fn scenario_sop(params: &ScenarioSopParams) -> Result<serde_json::Value, &'static str> {
    if params.scenario != DeploymentPurpose::PicoPcvr && params.connection.is_some() {
        return Err("vua.scenario.invalid_params");
    }
    let mut steps = vec![
        step(
            "check",
            "Check the required software",
            "Look for reusable installations. This check does not install anything.",
            "A list of installed, missing or uncertain software.",
            true,
        ),
        step(
            "install",
            "Prepare missing software",
            "Review a separate installation plan; existing usable software is retained.",
            "Required applications are detected after installation or official handoff.",
            true,
        ),
    ];
    match params.scenario {
        DeploymentPurpose::DesktopPlay => {
            steps.extend([
            step("steam-account","Sign in to Steam","Use your own account in Steam. VUA does not receive the password.","Steam can install or launch VRChat.",false),
            step("launch","Open VRChat on your computer","Use PC screen play. No headset or SteamVR is required.","The actual VRChat window opens.",true),
            step("vrchat-account","Finish VRChat sign-in","Register or sign in in the official flow. A full VRChat account can also be linked later.","You can enter a room and follow the in-game assistant.",false)]);
        }
        DeploymentPurpose::PicoPcvr => {
            let wireless = params.connection == Some(ScenarioConnection::Wifi);
            steps.extend([step("headset","Prepare the headset",if params.connection.is_none() {"Choose USB or Wi-Fi, then follow its headset connection steps."}else if wireless {"Connect the PC by Ethernet if possible and put the headset on the same local network."}else{"Connect a suitable USB data cable and allow the headset connection."},"PICO Connect can see the actual headset.",false),
                step("stream","Start PICO streaming","Confirm the connection in PICO Connect, then start SteamVR.","The headset displays the PC VR environment.",false),
                step("openxr","Use SteamVR as the OpenXR runtime","If the selected game needs OpenXR, follow the SteamVR runtime guide.","The intended runtime is selected in SteamVR.",false),
                step("launch","Launch VRChat in VR","Sign in through Steam/VRChat and start the selected VR play route.","The actual game renders in the headset.",true)]);
        }
        DeploymentPurpose::PcAvatar | DeploymentPurpose::QuestAvatar => {
            steps.extend([
            step("unity-license","Activate Unity before editing","Installation and file detection need no Editor launch. Running the Editor requires an active license. Sign in to Unity Hub and activate an eligible Personal or assigned paid license.","The Editor can start with its actual licensed identity.",false),
            step("materials","Select your materials","Enable AMF and select locally available inputs; the basic path prepares a separate managed project.","Actual Avatar and material candidates are observed in Unity.",true),
            step("assembly","Review and assemble","Resolve ambiguity, configure switches and confirm the concrete plan.","A retained result reports real target checks and any warnings.",true),
            step("sdk","Review the result in the official SDK","Check appearance and switches, then perform SDK build/upload checks. Upload remains your action.","Actual SDK results, rather than installation readiness alone.",false)]);
        }
    }
    steps.push(step("recovery","Continue after an interruption","Read the current state again. Recheck installation or reinspect retained AMF work before confirming a new plan.","Continue from observed facts without blindly repeating completed work.",false));
    Ok(
        serde_json::json!({"schemaVersion":SCENARIO_SCHEMA,"scenario":params.scenario,"connection":params.connection,
        "requirements":required_components(&[params.scenario]),"steps":steps,"performed":"sop_only",
        "nextAction":"check_environment","licenseRequiredFor":if matches!(params.scenario,DeploymentPurpose::PcAvatar|DeploymentPurpose::QuestAvatar){"editor_execution"}else{"none"}}),
    )
}
fn step(
    id: &str,
    title: &str,
    explanation: &str,
    expected: &str,
    automatic: bool,
) -> ScenarioSopStep {
    ScenarioSopStep {
        id: id.into(),
        title: title.into(),
        explanation: explanation.into(),
        expected_result: expected.into(),
        automatic,
    }
}
pub fn check_scenario(
    service: &DeploymentService,
    intent: &DeploymentIntent,
) -> Result<serde_json::Value, &'static str> {
    let observations = service.check_software(intent)?;
    let required = required_components(&intent.purposes);
    let facts = required
        .iter()
        .map(|component| {
            observations
                .iter()
                .find(|o| o.component == *component)
                .cloned()
                .unwrap_or(DeploymentObservation {
                    component: (*component).into(),
                    presence: DeploymentPresence::DetectionFailed,
                    location: None,
                    version: None,
                })
        })
        .collect::<Vec<_>>();
    let ready = facts
        .iter()
        .all(|f| f.presence == DeploymentPresence::Verified);
    Ok(
        serde_json::json!({"schemaVersion":SCENARIO_SCHEMA,"intent":intent,"observations":facts,
        "softwareReady":ready,"licenseState":"not_checked","performed":"software_check_only",
        "nextAction":if ready {"follow_sop"} else {"plan_installation"},"installationStarted":false}),
    )
}
