using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using nadena.dev.modular_avatar.core;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Vua.Editor.Bridge
{
    // Candidate v5 requires real SDK/MA packages. Legacy conversion scaffolds exclude this directory.
    internal static partial class AmfProductionEntryPoint
    {
        private const string ScenePath = "Assets/VUA/Production.unity";
        // VUA reads the stage of a batch run from the log; the stage names form a closed set.
        private static void LogStage(string stage) => Debug.LogFormat(LogType.Log, LogOption.NoStacktrace, null, "[VUA] stage={0}", stage);
        private const string OwnershipPath = "Assets/VUA/Ownership.json";
        // Unity keeps the VRChat SDK sign-in per company and product, so every work project shares both.
        private const string WorkCompany = "VUA";
        private const string WorkProduct = "VUA Avatar Work";
        private const int MaxReportedMaterials = 200;
        // Previews stay in the work project beside the Bridge files, outside Assets.
        private const string PreviewRoot = ".vua/previews";
        private const int ViewSize = 512;
        private const int CandidateSize = 256;
        private const int MaxCandidatePreviews = 128;
        [Serializable] internal sealed class Source { public string sourceId; public string role; public string[] assetPaths; }
        [Serializable] internal sealed class Outfit { public string sourceId; public string prefabPath; public string mode; public string bone; public string toggleName; public bool active; }
        [Serializable] internal sealed class Selection { public string avatarPrefab; public Outfit[] outfits; }
        [Serializable] internal sealed class ApplyTarget { public string avatarGlobalObjectId; public string newAvatarKey; public string[] writeSourceIds; }
        [Serializable] internal sealed class Request { public string schemaVersion; public string runId; public Source[] sources; public Selection selection; public ApplyTarget applyTarget; }
        [Serializable] internal sealed class Candidate
        {
            public string sourceId; public string path; public string name; public bool isAvatar;
            public bool hasSkinnedMesh; public bool hasMergeArmature; public bool hasMissingScripts;
            public List<string> humanoidBones = new List<string>();
            public string preview = "";
        }
        [Serializable] internal sealed class PreviewImage { public string view; public string path; }
        [Serializable] internal sealed class BoundObject
        {
            public string sourceId; public string prefabPath; public string globalObjectId;
            public string binding; public bool bindingVerified; public bool menuVerified; public bool menuModified;
            public bool exists; public bool prefabMatches; public string bone; public string toggleName; public bool active;
        }
        [Serializable] internal sealed class Data
        {
            public string editorVersion; public string projectFingerprint; public string avatarName;
            public string avatarGlobalObjectId; public List<Candidate> prefabs = new List<Candidate>();
            public List<BoundObject> instances = new List<BoundObject>();
            public bool sdkDescriptorRecognized; public string officialSdkChecks = "not_run";
            public string visualReview = "pending"; public int missingReferences;
            public bool hasMissingScripts; public Selection observedSelection;
            public List<string> usedSourceIds = new List<string>();
            public List<AvatarObservation> avatars = new List<AvatarObservation>();
            public List<string> missingShaderMaterials = new List<string>();
            public string sdkSignedIn = "unknown";
            public List<PreviewImage> previews = new List<PreviewImage>();
            public TurntableFacts turntable = new TurntableFacts();
            public SdkReview sdkReview = new SdkReview();
        }
        [Serializable] internal sealed class AvatarObservation
        {
            public string globalObjectId; public string name; public bool activeTarget;
            public Selection observedSelection; public List<BoundObject> instances;
            public bool sdkDescriptorRecognized; public int missingReferences;
        }
        [Serializable] internal sealed class Result
        {
            public int schemaVersion = 5; public string commandId; public string operation; public string status = "failed";
            public List<string> changedPaths = new List<string>();
            public List<BridgeDiagnostic> diagnostics = new List<BridgeDiagnostic>(); public Data data = new Data();
        }
        [Serializable] private sealed class Owner { public string key; public string globalObjectId; public string prefabGuid; [NonSerialized] public GameObject liveObject; }
        [Serializable] private sealed class Owners { public string runId; public string activeAvatarKey; public List<Owner> objects = new List<Owner>(); }
        [Serializable] private sealed class OpenRequest { public string schemaVersion; public string runId; public string avatarGlobalObjectId; }
        [Serializable] private sealed class OpenReceipt { public string schemaVersion = "0.1"; public string runId; public bool avatarSelected; public bool sdkPanelRequested; }

        public static void Run()
        {
            var result = new Result(); string output = null;
            try
            {
                var args = Environment.GetCommandLineArgs();
                string Argument(string key) { var i = Array.IndexOf(args, key); if (i < 0 || i + 1 >= args.Length) throw new InvalidOperationException("Missing Bridge argument."); return args[i + 1]; }
                output = BridgeEntryPoint.SafeBridgePath(Argument("-vuaResult"));
                var command = JsonUtility.FromJson<BridgeCommand>(File.ReadAllText(BridgeEntryPoint.SafeBridgePath(Argument("-vuaRequest"))));
                result.commandId = command.commandId; result.operation = command.operation;
                Process(command, result);
                result.status = "succeeded";
            }
            catch (Exception error)
            {
                result.diagnostics.Add(BridgeDiagnostic.Error("amf.production.failed", error.GetType().Name + ": " + error.Message));
            }
            LogStage("finishing");
            if (output != null) AtomicWrite(output, JsonUtility.ToJson(result, true));
            if (Application.isBatchMode) EditorApplication.Exit(result.status == "succeeded" ? 0 : 1);
        }

        private static void Process(BridgeCommand command, Result result)
        {
            LogStage("bridge");
            if (command.schemaVersion != 5 || string.IsNullOrEmpty(command.commandId) || string.IsNullOrEmpty(command.projectId))
                throw new InvalidOperationException("AMF requires Bridge v5 and bound command/project identities.");
            if (Application.unityVersion != "2022.3.22f1" && Application.unityVersion != "2022.3.22f1c1")
                throw new InvalidOperationException("Unsupported actual Editor version: " + Application.unityVersion);
            if (command.operation != "amf_prepare" && command.operation != "amf_inspect" && command.operation != "amf_assemble" && command.operation != "amf_turntable")
                throw new InvalidOperationException("Unknown AMF operation.");
            if (command.dryRun != (command.operation == "amf_inspect")) throw new InvalidOperationException("Invalid operation write mode.");
            var root = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            var requestPath = BridgeEntryPoint.SafeBridgePath(Path.Combine(root, command.payload.planRef ?? ""));
            var bytes = File.ReadAllBytes(requestPath);
            using (var sha = SHA256.Create())
                if (string.Concat(sha.ComputeHash(bytes).Select(b => b.ToString("x2"))) != command.payload.planHash)
                    throw new InvalidOperationException("Production request hash changed.");
            var request = JsonUtility.FromJson<Request>(Encoding.UTF8.GetString(bytes));
            // JsonUtility gives an absent [Serializable] field an empty instance. A Recipe apply
            // always names the Avatar it applies to, so a target without one is no target.
            if (request.applyTarget != null && string.IsNullOrEmpty(request.applyTarget.avatarGlobalObjectId)) request.applyTarget = null;
            if (request.schemaVersion != "0.1" || request.runId != command.projectId || request.sources == null || request.sources.Length > 64)
                throw new InvalidOperationException("Production request binding is invalid.");
            var marker = Path.Combine(root, ".vua", "amf-run.txt");
            if (!File.Exists(marker) || File.ReadAllText(marker).Trim() != request.runId)
                throw new InvalidOperationException("This is not the bound AMF work project.");
            foreach (var source in request.sources)
                if (source.assetPaths == null || source.assetPaths.Any(p => !SafeAssetPath(p)))
                    throw new InvalidOperationException("A source contains an unsafe asset path.");

            if (command.operation == "amf_prepare")
            {
                if (File.Exists(ScenePath)) throw new InvalidOperationException("Work scene already exists. Use reinspection.");
                Directory.CreateDirectory("Assets/VUA");
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                if (!EditorSceneManager.SaveScene(scene, ScenePath)) throw new IOException("Could not save the work scene.");
                result.changedPaths.Add(ScenePath);
            }
            else
            {
                if (!File.Exists(ScenePath)) throw new InvalidOperationException("Preparation has no saved work scene.");
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }
            var fingerprint = ProjectFingerprint.Compute();
            if (command.operation == "amf_assemble" && (string.IsNullOrEmpty(command.expectedProjectFingerprint) || command.expectedProjectFingerprint != fingerprint))
                throw new InvalidOperationException("The scene changed. Reinspect and review the plan.");
            if (PlayerSettings.companyName != WorkCompany || PlayerSettings.productName != WorkProduct)
            {
                PlayerSettings.companyName = WorkCompany; PlayerSettings.productName = WorkProduct;
                AssetDatabase.SaveAssets();
            }
            result.data.sdkSignedIn = SdkSignedIn();
            result.data.editorVersion = Application.unityVersion;
            result.data.prefabs = Inspect(request);
            if (command.operation == "amf_assemble") Assemble(request, result);
            ObserveScene(request, result);
            result.data.missingShaderMaterials = MissingShaderMaterials(request, result.data.avatarGlobalObjectId);
            if (result.data.missingShaderMaterials.Count > 0)
                result.diagnostics.Add(BridgeDiagnostic.Warning("amf.shaders.missing", result.data.missingShaderMaterials.Count + " materials use a shader that is not in the project."));
            if (command.operation == "amf_assemble" && result.data.observedSelection == null)
                throw new InvalidOperationException("The saved scene does not retain the verified Avatar relationships.");
            if (command.operation == "amf_inspect" || command.operation == "amf_assemble")
                result.data.sdkReview = ReviewWithSdk(string.IsNullOrEmpty(result.data.avatarGlobalObjectId) ? null : FindOwned(result.data.avatarGlobalObjectId));
            result.data.projectFingerprint = ProjectFingerprint.Compute();
            if (command.operation == "amf_turntable") BakeTurntable(command, result, root);
            else if (command.operation != "amf_prepare") RenderPreviews(command, result, root);
        }

        // The active Avatar from three sides, and during inspection each prefab candidate. A failed
        // render becomes a warning; the inspected and assembled facts stand on their own.
        private static void RenderPreviews(BridgeCommand command, Result result, string root)
        {
            LogStage("previews");
            if (command.commandId.Length > 160 || !command.commandId.All(c => (c < 128 && char.IsLetterOrDigit(c)) || c == '-' || c == '_'))
            {
                result.diagnostics.Add(BridgeDiagnostic.Warning("amf.preview.failed", "Previews need a plain command identity."));
                return;
            }
            var folder = PreviewRoot + "/" + command.commandId;
            string Full(string relative) => Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
            try { Directory.CreateDirectory(Full(folder)); }
            catch (Exception error)
            {
                result.diagnostics.Add(BridgeDiagnostic.Warning("amf.preview.failed", "The preview folder could not be created: " + error.Message));
                return;
            }
            var failures = new List<string>();
            var avatar = string.IsNullOrEmpty(result.data.avatarGlobalObjectId) ? null : FindOwned(result.data.avatarGlobalObjectId);
            if (avatar != null)
            {
                var views = new[] { ("front", 0f), ("side", 90f), ("back", 180f) };
                try
                {
                    BridgePreviewBake.RenderStills(avatar, ViewSize, views.Select(v => (Full(folder + "/" + v.Item1 + ".png"), v.Item2)).ToArray());
                    foreach (var view in views) result.data.previews.Add(new PreviewImage { view = view.Item1, path = folder + "/" + view.Item1 + ".png" });
                }
                catch (Exception error) { failures.Add(avatar.name + ": " + error.Message); }
            }
            if (command.operation == "amf_inspect")
            {
                var index = 0;
                foreach (var candidate in result.data.prefabs.Take(MaxCandidatePreviews))
                {
                    var relative = folder + "/candidate-" + (index++).ToString("D3") + ".png";
                    try
                    {
                        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(candidate.path);
                        if (prefab == null) throw new InvalidOperationException("The prefab no longer loads.");
                        BridgePreviewBake.RenderStills(prefab, CandidateSize, new[] { (Full(relative), 0f) });
                        candidate.preview = relative;
                    }
                    catch (Exception error) { failures.Add(candidate.path + ": " + error.Message); }
                }
            }
            if (failures.Count > 0)
                result.diagnostics.Add(BridgeDiagnostic.Warning("amf.preview.failed", failures.Count + " preview images could not be rendered. First: " + failures[0]));
        }

        private static bool SafeAssetPath(string path) => !string.IsNullOrEmpty(path) && path.StartsWith("Assets/", StringComparison.Ordinal)
            && !path.Contains('\\') && !path.Contains(':') && !path.Contains('\0') && !path.Split('/').Any(p => p == ".." || p == "." || p.Length == 0);

        private static Type DescriptorType() => AppDomain.CurrentDomain.GetAssemblies()
            .Select(a => a.GetType("VRC.SDK3.Avatars.Components.VRCAvatarDescriptor", false)).FirstOrDefault(t => t != null);

        private static bool IsAvatar(GameObject prefab) { var type = DescriptorType(); return type != null && prefab.GetComponent(type) != null; }
        // Unity draws a material whose shader is absent with its error shader (the pink look).
        private static List<string> MissingShaderMaterials(Request request, string avatarGlobalObjectId)
        {
            var materials = request.sources.SelectMany(s => s.assetPaths)
                .Where(p => p.EndsWith(".mat", StringComparison.OrdinalIgnoreCase)).Select(AssetDatabase.LoadAssetAtPath<Material>);
            var avatar = string.IsNullOrEmpty(avatarGlobalObjectId) ? null : FindOwned(avatarGlobalObjectId);
            if (avatar != null) materials = materials.Concat(avatar.GetComponentsInChildren<Renderer>(true).SelectMany(r => r.sharedMaterials));
            return materials.Where(m => m != null && (m.shader == null || m.shader.name == "Hidden/InternalErrorShader"))
                .Select(AssetDatabase.GetAssetPath).Where(p => !string.IsNullOrEmpty(p))
                .Distinct().OrderBy(p => p, StringComparer.Ordinal).Take(MaxReportedMaterials).ToList();
        }
        // "yes" when the SDK has a saved sign-in for this product; the credentials stay inside the SDK.
        private static string SdkSignedIn()
        {
            try
            {
                var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("VRC.Core.ApiCredentials", false)).FirstOrDefault(t => t != null);
                var load = type?.GetMethod("Load", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static, null, Type.EmptyTypes, null);
                return load?.Invoke(null, null) is bool loaded ? (loaded ? "yes" : "no") : "unknown";
            }
            catch (Exception) { return "unknown"; }
        }
        private static bool MissingScripts(GameObject prefab) => prefab.GetComponentsInChildren<Component>(true).Any(c => c == null);
        private static Animator HumanAnimator(GameObject avatar) => avatar.GetComponentsInChildren<Animator>(true).FirstOrDefault(a => a.isHuman);
        private static List<string> Bones(GameObject avatar)
        {
            var animator = HumanAnimator(avatar); var names = new List<string>();
            if (animator != null) foreach (HumanBodyBones bone in Enum.GetValues(typeof(HumanBodyBones)))
                if (bone != HumanBodyBones.LastBone && animator.GetBoneTransform(bone) != null) names.Add(bone.ToString());
            return names;
        }
        private static List<Candidate> Inspect(Request request)
        {
            if (DescriptorType() == null) throw new InvalidOperationException("The real VRChat Avatar SDK is not available.");
            var candidates = new List<Candidate>();
            foreach (var source in request.sources)
            foreach (var path in source.assetPaths.Distinct().OrderBy(p => p, StringComparer.Ordinal))
            {
                if (!path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase)) continue;
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path); if (prefab == null) continue;
                candidates.Add(new Candidate { sourceId = source.sourceId, path = path, name = prefab.name,
                    isAvatar = IsAvatar(prefab), hasSkinnedMesh = prefab.GetComponentInChildren<SkinnedMeshRenderer>(true) != null,
                    hasMergeArmature = prefab.GetComponentInChildren<ModularAvatarMergeArmature>(true) != null,
                    hasMissingScripts = MissingScripts(prefab), humanoidBones = IsAvatar(prefab) ? Bones(prefab) : new List<string>() });
            }
            return candidates;
        }

        // Read the saved objects, including edits made outside VUA. A previous
        // selection is intent, not evidence of the scene that is now on disk.
        private static void ObserveScene(Request request, Result result, Owners retainedOwners = null)
        {
            var data = result.data;
            data.instances.Clear(); data.missingReferences = 0;
            data.avatarName = null; data.avatarGlobalObjectId = null;
            data.sdkDescriptorRecognized = false; data.observedSelection = null;
            if (!File.Exists(OwnershipPath)) return;
            var owners = retainedOwners ?? JsonUtility.FromJson<Owners>(File.ReadAllText(OwnershipPath));
            if (owners == null || owners.runId != request.runId || owners.objects == null
                || owners.objects.Any(o => o == null || string.IsNullOrEmpty(o.key))
                || owners.objects.Select(o => o.key).Distinct().Count() != owners.objects.Count)
                throw new InvalidOperationException("Saved object ownership is invalid.");
            var avatarOwner = owners.objects.SingleOrDefault(o => o.key == ScopedKey(owners, "avatar"));
            var avatar = avatarOwner == null ? null : FindOwned(avatarOwner.globalObjectId);
            if (avatar == null)
            {
                result.diagnostics.Add(BridgeDiagnostic.Warning("amf.avatar.missing", "The previously owned Avatar is missing. No same-name object is substituted."));
                return;
            }
            data.avatarName = avatar.name; data.avatarGlobalObjectId = avatarOwner.globalObjectId;
            data.sdkDescriptorRecognized = IsAvatar(avatar); data.hasMissingScripts = MissingScripts(avatar);
            foreach (var renderer in avatar.GetComponentsInChildren<Renderer>(true))
            {
                if (renderer is SkinnedMeshRenderer skinned && skinned.sharedMesh == null) data.missingReferences++;
                data.missingReferences += renderer.sharedMaterials.Count(m => m == null || m.shader == null);
            }
            var avatarPath = AssetDatabase.GUIDToAssetPath(avatarOwner.prefabGuid);
            var complete = data.sdkDescriptorRecognized && !data.hasMissingScripts
                && PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(avatar) == avatarPath
                && data.prefabs.Any(p => p.isAvatar && p.path == avatarPath);
            var selection = new Selection { avatarPrefab = avatarPath };
            var observedOutfits = new List<Outfit>();
            foreach (var owner in owners.objects.Where(o => o.key.StartsWith(ScopedKey(owners, "outfit-"), StringComparison.Ordinal)))
            {
                var source = request.sources.SingleOrDefault(s => owner.key == ScopedKey(owners, "outfit-" + ShortHash(s.sourceId)));
                if (source == null) throw new InvalidOperationException("An owned object has no bound source identity.");
                var instance = FindOwned(owner.globalObjectId);
                var fact = new BoundObject { sourceId = source.sourceId, prefabPath = AssetDatabase.GUIDToAssetPath(owner.prefabGuid),
                    globalObjectId = owner.globalObjectId, exists = instance != null, binding = "unresolved", bone = "", toggleName = "" };
                data.instances.Add(fact);
                if (instance == null) { complete = false; continue; }
                fact.active = instance.activeSelf;
                fact.prefabMatches = !string.IsNullOrEmpty(fact.prefabPath) && source.assetPaths.Contains(fact.prefabPath)
                    && PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instance) == fact.prefabPath;
                var merges = instance.GetComponentsInChildren<ModularAvatarMergeArmature>(true);
                if (merges.Length > 0)
                {
                    fact.binding = "merge_armature";
                    fact.bindingVerified = instance.transform.IsChildOf(avatar.transform) && merges.All(m =>
                        m.mergeTarget?.Get(m) is GameObject target && target.transform.IsChildOf(avatar.transform)
                        && !target.transform.IsChildOf(instance.transform));
                }
                else
                {
                    var animator = HumanAnimator(avatar);
                    var bones = animator == null ? new List<HumanBodyBones>() : Enum.GetValues(typeof(HumanBodyBones)).Cast<HumanBodyBones>()
                        .Where(b => b != HumanBodyBones.LastBone && animator.GetBoneTransform(b) == instance.transform.parent).ToList();
                    if (bones.Count == 1)
                    {
                        fact.binding = "attach_to_bone"; fact.bone = bones[0].ToString();
                        fact.bindingVerified = instance.GetComponentInChildren<SkinnedMeshRenderer>(true) == null;
                    }
                }
                var menuOwner = owners.objects.SingleOrDefault(o => o.key == ScopedKey(owners, "menu-" + ShortHash(source.sourceId)));
                fact.menuModified = menuOwner != null;
                fact.menuVerified = menuOwner == null;
                if (menuOwner != null)
                {
                    var menu = FindOwned(menuOwner.globalObjectId);
                    var item = menu == null ? null : menu.GetComponent<ModularAvatarMenuItem>();
                    var toggle = menu == null ? null : menu.GetComponent<ModularAvatarObjectToggle>();
                    fact.toggleName = item == null ? "" : item.label ?? "";
                    fact.menuVerified = menu != null && menu.transform.IsChildOf(avatar.transform)
                        && menu.GetComponents<ModularAvatarMenuInstaller>().Length == 1
                        && menu.GetComponents<ModularAvatarMenuItem>().Length == 1 && menu.GetComponents<ModularAvatarObjectToggle>().Length == 1
                        && item.PortableControl.Type == PortableControlType.Toggle && item.PortableControl.Value == 1
                        && item.isDefault == instance.activeSelf && !string.IsNullOrWhiteSpace(fact.toggleName)
                        && fact.toggleName.Length <= 80 && !fact.toggleName.Any(char.IsControl)
                        && toggle.Objects != null && toggle.Objects.Count == 1
                        && toggle.Objects[0].Object?.Get(toggle) == instance && toggle.Objects[0].Active;
                }
                complete &= fact.prefabMatches && fact.bindingVerified && fact.menuVerified;
                observedOutfits.Add(new Outfit { sourceId = fact.sourceId, prefabPath = fact.prefabPath,
                    mode = fact.binding, bone = fact.bone, toggleName = fact.toggleName, active = fact.active });
            }
            if (complete && observedOutfits.Count > 0) { selection.outfits = observedOutfits.ToArray(); data.observedSelection = selection; }
            var dependencies = new HashSet<string>(EditorUtility.CollectDependencies(new UnityEngine.Object[] { avatar })
                .Select(AssetDatabase.GetAssetPath).Where(path => !string.IsNullOrEmpty(path)));
            data.usedSourceIds = request.sources.Where(source => source.assetPaths.Any(dependencies.Contains)).Select(source => source.sourceId).ToList();
            if (!complete) result.diagnostics.Add(BridgeDiagnostic.Warning("amf.scene.relationships_changed", "Some saved object identities, bindings or switches need review. Previous settings do not prove the current scene."));
            if (data.missingReferences > 0 && !result.diagnostics.Any(d => d.code == "amf.references.missing"))
                result.diagnostics.Add(BridgeDiagnostic.Warning("amf.references.missing", "The result has missing mesh/material references. Review it in Unity."));
            if (retainedOwners == null)
            {
                foreach (var ownedAvatar in owners.objects.Where(o => o.key == "avatar" || o.key.EndsWith("/avatar", StringComparison.Ordinal)))
                {
                    var scope = ownedAvatar.key == "avatar" ? "" : ownedAvatar.key.Substring(0, ownedAvatar.key.Length - "/avatar".Length);
                    var current = scope == (owners.activeAvatarKey ?? "");
                    var observed = data;
                    if (!current)
                    {
                        var other = new Result(); other.data.prefabs = data.prefabs;
                        ObserveScene(request, other, new Owners { runId = owners.runId, activeAvatarKey = scope, objects = owners.objects });
                        observed = other.data;
                    }
                    data.avatars.Add(new AvatarObservation { globalObjectId = ownedAvatar.globalObjectId, name = observed.avatarName,
                        activeTarget = current, observedSelection = observed.observedSelection, instances = observed.instances,
                        sdkDescriptorRecognized = observed.sdkDescriptorRecognized, missingReferences = observed.missingReferences });
                }
            }
        }

        private static void Assemble(Request request, Result result)
        {
            var selection = request.selection ?? throw new InvalidOperationException("No reviewed selection.");
            var candidates = result.data.prefabs;
            var avatarCandidate = candidates.FirstOrDefault(c => c.isAvatar && c.path == selection.avatarPrefab && request.sources.Any(s => s.sourceId == c.sourceId && (s.role == "avatar" || s.role == "auto")));
            if (avatarCandidate == null || avatarCandidate.hasMissingScripts) throw new InvalidOperationException("The chosen Avatar is not a valid observed input.");
            var required = new HashSet<string>(request.sources.Where(s => s.role == "outfit").Select(s => s.sourceId));
            var allowed = new HashSet<string>(request.sources.Where(s => s.role == "outfit" || s.role == "auto").Select(s => s.sourceId));
            var chosen = new HashSet<string>();
            if (selection.outfits == null || selection.outfits.Length == 0) throw new InvalidOperationException("No outfit selection.");
            foreach (var outfit in selection.outfits)
            {
                var candidate = candidates.SingleOrDefault(c => c.sourceId == outfit.sourceId && c.path == outfit.prefabPath && !c.isAvatar);
                if (!allowed.Contains(outfit.sourceId) || !chosen.Add(outfit.sourceId) || candidate == null || candidate.hasMissingScripts)
                    throw new InvalidOperationException("Outfit selection no longer matches its source: " + outfit.prefabPath);
                if (outfit.mode != "merge_armature" && outfit.mode != "attach_to_bone") throw new InvalidOperationException("Unsupported binding mode.");
                if (outfit.mode == "attach_to_bone" && (candidate.hasSkinnedMesh || !avatarCandidate.humanoidBones.Contains(outfit.bone)))
                    throw new InvalidOperationException("A static accessory needs an observed humanoid bone.");
                if ((outfit.toggleName ?? "").Length > 80 || (outfit.toggleName ?? "").Any(char.IsControl)) throw new InvalidOperationException("Invalid switch label.");
            }
            if (request.applyTarget == null && !required.IsSubsetOf(chosen)) throw new InvalidOperationException("Some inputs lack an explicit target prefab.");
            var writes = chosen;
            if (request.applyTarget != null)
            {
                var ids = request.applyTarget.writeSourceIds;
                if (ids == null || ids.Length > 64 || ids.Any(string.IsNullOrEmpty)) throw new InvalidOperationException("Missing Recipe write scope.");
                writes = new HashSet<string>(ids);
                if (writes.Count != ids.Length || !writes.IsSubsetOf(chosen)
                    || (!string.IsNullOrEmpty(request.applyTarget.newAvatarKey) && !writes.SetEquals(chosen)))
                    throw new InvalidOperationException("Recipe write scope does not match its reviewed selection.");
            }

            var owners = File.Exists(OwnershipPath) ? JsonUtility.FromJson<Owners>(File.ReadAllText(OwnershipPath)) : new Owners { runId = request.runId };
            if (owners.runId != request.runId) throw new InvalidOperationException("Object ownership belongs to another run.");
            if (request.applyTarget != null)
            {
                var target = request.applyTarget;
                var currentOwner = owners.objects.SingleOrDefault(o => (o.key == "avatar" || o.key.EndsWith("/avatar", StringComparison.Ordinal))
                    && o.globalObjectId == target.avatarGlobalObjectId);
                if (currentOwner == null || FindOwned(currentOwner.globalObjectId) == null)
                    throw new InvalidOperationException("The reviewed Avatar identity changed. Reinspect before applying the Recipe.");
                owners.activeAvatarKey = currentOwner.key == "avatar" ? "" : currentOwner.key.Substring(0, currentOwner.key.Length - "/avatar".Length);
                if (!string.IsNullOrEmpty(target.newAvatarKey))
                {
                    if (target.newAvatarKey.Length > 60 || !target.newAvatarKey.StartsWith("recipe-", StringComparison.Ordinal)
                        || target.newAvatarKey.Any(c => !char.IsDigit(c) && (c < 'a' || c > 'z') && c != '-')
                        || owners.objects.Any(o => o.key.StartsWith(target.newAvatarKey + "/", StringComparison.Ordinal)))
                        throw new InvalidOperationException("Invalid or previously used new Avatar identity.");
                    // Existing scene roots and their ownership remain intact.
                    owners.activeAvatarKey = target.newAvatarKey;
                }
            }
            var avatar = OwnedInstance(owners, "avatar", selection.avatarPrefab, null);
            result.data.avatarName = avatar.name; result.data.sdkDescriptorRecognized = IsAvatar(avatar);
            if (!result.data.sdkDescriptorRecognized) throw new InvalidOperationException("The actual result has no SDK Avatar descriptor.");
            foreach (var outfit in selection.outfits)
            {
                // The complete selection is a postcondition, not authority to reconfigure
                // retained objects. An unchanged or unmentioned outfit is observed only.
                if (!writes.Contains(outfit.sourceId)) continue;
                var instance = OwnedInstance(owners, "outfit-" + ShortHash(outfit.sourceId), outfit.prefabPath, avatar.transform);
                if (outfit.mode == "merge_armature") ConfigureMerge(avatar, instance);
                else
                {
                    var animator = HumanAnimator(avatar);
                    if (animator == null || !Enum.TryParse(outfit.bone, out HumanBodyBones bone) || bone == HumanBodyBones.LastBone)
                        throw new InvalidOperationException("The selected humanoid bone is unavailable.");
                    var target = animator.GetBoneTransform(bone);
                    if (target == null) throw new InvalidOperationException("The selected humanoid bone is unavailable.");
                    instance.transform.SetParent(target, false);
                }
                instance.SetActive(outfit.active);
                var menuOk = ConfigureSwitch(owners, avatar, instance, outfit);
                var bindingOk = outfit.mode == "attach_to_bone"
                    ? instance.transform.parent == HumanAnimator(avatar).GetBoneTransform((HumanBodyBones)Enum.Parse(typeof(HumanBodyBones), outfit.bone))
                    : instance.GetComponentsInChildren<ModularAvatarMergeArmature>(true).All(m => m.mergeTarget != null && m.mergeTarget.Get(m) != null && m.mergeTarget.Get(m).transform.IsChildOf(avatar.transform) && !m.mergeTarget.Get(m).transform.IsChildOf(instance.transform));
                if (!bindingOk || !menuOk) throw new InvalidOperationException("Actual binding/menu verification failed: " + instance.name);
                result.data.instances.Add(new BoundObject { sourceId = outfit.sourceId, prefabPath = outfit.prefabPath,
                    binding = outfit.mode, bindingVerified = bindingOk, menuVerified = menuOk, menuModified = !string.IsNullOrWhiteSpace(outfit.toggleName) });
            }
            foreach (var renderer in avatar.GetComponentsInChildren<Renderer>(true))
            {
                if (renderer is SkinnedMeshRenderer skinned && skinned.sharedMesh == null) result.data.missingReferences++;
                result.data.missingReferences += renderer.sharedMaterials.Count(m => m == null || m.shader == null);
            }
            if (MissingScripts(avatar)) throw new InvalidOperationException("The assembled Avatar has missing scripts.");
            if (result.data.missingReferences > 0) result.diagnostics.Add(BridgeDiagnostic.Warning("amf.references.missing", "The result has missing mesh/material references. Review it in Unity."));
            EditorSceneManager.MarkSceneDirty(avatar.scene); AssetDatabase.SaveAssets();
            if (!EditorSceneManager.SaveScene(avatar.scene, ScenePath)) throw new IOException("Could not save the result scene.");
            foreach (var owner in owners.objects)
            {
                var instance = owner.liveObject ?? FindOwned(owner.globalObjectId);
                if (instance != null) owner.globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(instance).ToString();
            }
            result.data.avatarGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(avatar).ToString();
            for (var i = 0; i < result.data.instances.Count; i++)
                result.data.instances[i].globalObjectId = owners.objects.Single(o => o.key == ScopedKey(owners, "outfit-" + ShortHash(result.data.instances[i].sourceId))).globalObjectId;
            AtomicWrite(OwnershipPath, JsonUtility.ToJson(owners, true));
            AssetDatabase.ImportAsset(OwnershipPath, ImportAssetOptions.ForceSynchronousImport);
            result.changedPaths.Add(ScenePath); result.changedPaths.Add(OwnershipPath);
        }

        private static GameObject OwnedInstance(Owners owners, string key, string prefabPath, Transform parent)
        {
            key = ScopedKey(owners, key);
            var guid = AssetDatabase.AssetPathToGUID(prefabPath);
            if (string.IsNullOrEmpty(guid)) throw new InvalidOperationException("Prefab identity is missing.");
            var owner = owners.objects.SingleOrDefault(o => o.key == key);
            if (owner != null)
            {
                if (owner.prefabGuid != guid) throw new InvalidOperationException("Changing a previously bound prefab requires a fresh plan/project.");
                var existing = FindOwned(owner.globalObjectId);
                if (existing == null) throw new InvalidOperationException("A previously owned object is missing. No same-name object is substituted.");
                owner.liveObject = existing;
                return existing;
            }
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, SceneManager.GetActiveScene());
            if (instance == null) throw new InvalidOperationException("Prefab instantiation failed.");
            instance.transform.SetParent(parent, false);
            owners.objects.Add(new Owner { key = key, prefabGuid = guid, liveObject = instance, globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(instance).ToString() });
            return instance;
        }
        private static GameObject FindOwned(string id)
        {
            if (GlobalObjectId.TryParse(id, out var parsed))
            {
                var direct = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed) as GameObject;
                if (direct != null && direct.scene.IsValid()) return direct;
            }
            return SceneManager.GetActiveScene().GetRootGameObjects().SelectMany(r => r.GetComponentsInChildren<Transform>(true))
                .Select(t => t.gameObject).FirstOrDefault(o => GlobalObjectId.GetGlobalObjectIdSlow(o).ToString() == id);
        }
        private static void ConfigureMerge(GameObject avatar, GameObject outfit)
        {
            var merges = outfit.GetComponentsInChildren<ModularAvatarMergeArmature>(true);
            if (merges.Length > 0 && merges.All(m => m.mergeTarget?.Get(m) is GameObject target && target.transform.IsChildOf(avatar.transform) && !target.transform.IsChildOf(outfit.transform))) return;
            var animator = HumanAnimator(avatar);
            var hips = animator != null ? animator.GetBoneTransform(HumanBodyBones.Hips) : null;
            if (hips == null || hips.parent == null) throw new InvalidOperationException("The Avatar needs an unambiguous humanoid armature.");
            if (merges.Length == 0)
            {
                var bones = outfit.GetComponentsInChildren<SkinnedMeshRenderer>(true).SelectMany(r => r.bones).Where(b => b != null).Distinct().ToArray();
                if (bones.Length == 0) throw new InvalidOperationException("No outfit skeleton. Choose an explicit static attachment.");
                var common = bones[0];
                while (common != null && bones.Any(b => b != common && !b.IsChildOf(common))) common = common.parent;
                if (common == null || common == outfit.transform || common.parent == null || !common.IsChildOf(outfit.transform))
                    throw new InvalidOperationException("Multiple or unsupported skeleton roots. Use an author-prepared MA prefab.");
                var root = common.parent;
                if (root == outfit.transform) throw new InvalidOperationException("Outfit skeleton has no distinct armature root.");
                var merge = root.gameObject.AddComponent<ModularAvatarMergeArmature>(); merges = new[] { merge };
            }
            foreach (var merge in merges)
            {
                // Retain already-valid author sub-mappings; resolve missing root targets explicitly.
                var existing = merge.mergeTarget?.Get(merge);
                if (existing == null || !existing.transform.IsChildOf(avatar.transform) || existing.transform.IsChildOf(outfit.transform))
                {
                    merge.mergeTarget = new AvatarObjectReference(hips.parent.gameObject);
                    merge.InferPrefixSuffix(); EditorUtility.SetDirty(merge);
                }
            }
        }
        private static bool ConfigureSwitch(Owners owners, GameObject avatar, GameObject target, Outfit outfit)
        {
            if (string.IsNullOrWhiteSpace(outfit.toggleName)) return true;
            var key = ScopedKey(owners, "menu-" + ShortHash(outfit.sourceId)); var owner = owners.objects.SingleOrDefault(o => o.key == key);
            GameObject menu;
            if (owner == null)
            {
                menu = new GameObject("VUA switch " + ShortHash(outfit.sourceId)); menu.transform.SetParent(avatar.transform, false);
                owner = new Owner { key = key, liveObject = menu, globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(menu).ToString(), prefabGuid = "menu" }; owners.objects.Add(owner);
            }
            else { menu = FindOwned(owner.globalObjectId); if (menu == null) throw new InvalidOperationException("Previously owned switch is missing."); owner.liveObject = menu; }
            var installer = menu.GetComponent<ModularAvatarMenuInstaller>() ?? menu.AddComponent<ModularAvatarMenuInstaller>();
            var item = menu.GetComponent<ModularAvatarMenuItem>() ?? menu.AddComponent<ModularAvatarMenuItem>();
            var toggle = menu.GetComponent<ModularAvatarObjectToggle>() ?? menu.AddComponent<ModularAvatarObjectToggle>();
            item.label = outfit.toggleName; item.PortableControl.Type = PortableControlType.Toggle;
            item.PortableControl.Value = 1; item.isDefault = outfit.active;
            toggle.Objects = new List<ToggledObject> { new ToggledObject { Object = new AvatarObjectReference(target), Active = true } };
            EditorUtility.SetDirty(installer); EditorUtility.SetDirty(item); EditorUtility.SetDirty(toggle);
            return toggle.Objects.Count == 1 && toggle.Objects[0].Object.Get(toggle) == target && item.PortableControl.Type == PortableControlType.Toggle;
        }
        private static string ShortHash(string value)
        {
            using (var hash = SHA256.Create()) return string.Concat(hash.ComputeHash(Encoding.UTF8.GetBytes(value)).Take(8).Select(b => b.ToString("x2")));
        }
        private static string ScopedKey(Owners owners, string key) => string.IsNullOrEmpty(owners.activeAvatarKey) ? key : owners.activeAvatarKey + "/" + key;
        private static void AtomicWrite(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)); var pending = path + ".pending";
            File.WriteAllText(pending, text);
            if (File.Exists(path)) File.Replace(pending, path, null); else File.Move(pending, path);
        }

        [InitializeOnLoadMethod] private static void InstallHandoffObserver()
        {
            if (Application.isBatchMode) return;
            double next = 0;
            EditorApplication.update += () =>
            {
                if (EditorApplication.timeSinceStartup < next || EditorApplication.isCompiling || EditorApplication.isUpdating) return;
                next = EditorApplication.timeSinceStartup + 0.5;
                var file = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".vua", "bridge", "amf-open.json"));
                if (!File.Exists(file)) return;
                try
                {
                    var request = JsonUtility.FromJson<OpenRequest>(File.ReadAllText(file));
                    File.Delete(file);
                    var marker = Path.Combine(Path.GetDirectoryName(file), "..", "amf-run.txt");
                    if (request.schemaVersion != "0.1" || !File.Exists(marker) || File.ReadAllText(marker).Trim() != request.runId) return;
                    if (SceneManager.GetActiveScene().path != ScenePath)
                    {
                        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
                        {
                            AtomicWrite(Path.Combine(Path.GetDirectoryName(file), "amf-open.result.json"), JsonUtility.ToJson(new OpenReceipt { runId = request.runId }, true));
                            return;
                        }
                        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                    }
                    var avatar = FindOwned(request.avatarGlobalObjectId);
                    if (avatar != null) { UnityEditor.Selection.activeGameObject = avatar; EditorGUIUtility.PingObject(avatar); }
                    var receipt = new OpenReceipt { runId = request.runId, avatarSelected = avatar != null,
                        sdkPanelRequested = EditorApplication.ExecuteMenuItem("VRChat SDK/Show Control Panel") };
                    AtomicWrite(Path.Combine(Path.GetDirectoryName(file), "amf-open.result.json"), JsonUtility.ToJson(receipt, true));
                }
                catch (Exception error) { Debug.LogWarning("VUA SDK handoff: " + error.Message); }
            };
        }
    }
}
