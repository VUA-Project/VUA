using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Vua.Editor.Bridge
{
    // Release: the 60-frame turntable of the finished Avatar (batch mode), and the managed upload
    // through the official VRChat SDK builder inside the open Editor. The SDK is reached by
    // reflection so this package compiles in every work project the Bridge is installed into.
    internal static partial class AmfProductionEntryPoint
    {
        private const string TurntableRoot = ".vua/turntables";
        private const int TurntableFrames = 60;
        private const int TurntableSize = 512;
        [Serializable] internal sealed class TurntableFacts { public string folder = ""; public int frames; public int size; }

        // Bakes the owned Avatar of the saved work scene into frame-00.png … frame-59.png, camera yaw
        // 0° to 354° in 6° steps, with the preview rig of the three still views.
        private static void BakeTurntable(BridgeCommand command, Result result, string root)
        {
            if (command.commandId.Length > 160 || !command.commandId.All(c => (c < 128 && char.IsLetterOrDigit(c)) || c == '-' || c == '_'))
                throw new InvalidOperationException("The turntable needs a plain command identity.");
            var avatar = string.IsNullOrEmpty(result.data.avatarGlobalObjectId) ? null : FindOwned(result.data.avatarGlobalObjectId);
            if (avatar == null) throw new InvalidOperationException("The finished Avatar is missing from the work scene. Check the work project again.");
            var folder = TurntableRoot + "/" + command.commandId;
            var full = Path.Combine(root, folder.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(full);
            BridgePreviewBake.RenderTurntable(avatar, TurntableSize, TurntableFrames, index => Path.Combine(full, "frame-" + index.ToString("D2") + ".png"));
            result.data.turntable = new TurntableFacts { folder = folder, frames = TurntableFrames, size = TurntableSize };
            result.changedPaths.Add(folder);
        }

        [Serializable] private sealed class UploadRequest
        {
            public string schemaVersion; public string runId; public string uploadId; public string avatarGlobalObjectId;
            public string avatarName; public string thumbnail; public bool rightsConfirmed;
        }
        [Serializable] private sealed class UploadLine
        {
            public string schemaVersion = "0.1"; public string runId; public string uploadId; public string stage;
            public float progress = -1f; public string status = "";
        }
        [Serializable] private sealed class UploadReceipt
        {
            public string schemaVersion = "0.1"; public string runId; public string uploadId; public string outcome = "failed";
            public string blueprintId = ""; public string reason = ""; public string detail = "";
            public List<string> errors = new List<string>(); public bool firstUpload; public bool sceneSaved;
            public string sdkSignIn = "panel";
        }
        [Serializable] private sealed class UploadCancel { public string schemaVersion; public string runId; public string uploadId; }
        // The VRChat session VUA holds for the player, handed over once for an upload.
        [Serializable] private sealed class SessionHandoff
        {
            public string schemaVersion; public string createdAt; public string username;
            public string auth; public string twoFactorAuth;
        }

        private static bool uploadRunning;

        // VUA writes .vua/bridge/amf-upload.json after the player confirmed the content rights in
        // VUA. The observer answers with amf-upload.progress.json lines and one amf-upload.result.json.
        [InitializeOnLoadMethod] private static void InstallUploadObserver()
        {
            if (Application.isBatchMode) return;
            double next = 0;
            EditorApplication.update += () =>
            {
                if (uploadRunning || EditorApplication.timeSinceStartup < next || EditorApplication.isCompiling || EditorApplication.isUpdating) return;
                next = EditorApplication.timeSinceStartup + 0.5;
                var file = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".vua", "bridge", "amf-upload.json"));
                if (!File.Exists(file)) return;
                uploadRunning = true;
                RunUpload(file);
            };
        }

        private static async void RunUpload(string file)
        {
            var folder = Path.GetDirectoryName(file);
            var started = Path.Combine(folder, "amf-upload.started");
            var receipt = new UploadReceipt();
            try
            {
                var request = JsonUtility.FromJson<UploadRequest>(File.ReadAllText(file));
                var marker = Path.Combine(folder, "..", "amf-run.txt");
                if (request == null || request.schemaVersion != "0.1" || string.IsNullOrEmpty(request.uploadId)
                    || !File.Exists(marker) || File.ReadAllText(marker).Trim() != request.runId)
                {
                    TryDelete(file);
                    return;
                }
                receipt.runId = request.runId; receipt.uploadId = request.uploadId;
                if (!request.rightsConfirmed)
                {
                    receipt.reason = "unknown"; receipt.detail = "The content rights for this upload were not confirmed in VUA.";
                    return;
                }
                // A domain reload during this upload ends it; it never starts a second build of the same request.
                if (File.Exists(started) && File.ReadAllText(started).Trim() == request.uploadId)
                {
                    receipt.reason = "interrupted"; receipt.detail = "Unity reloaded while this upload ran. Check the Avatar on VRChat, then upload again.";
                    return;
                }
                await Upload(request, receipt, folder, started);
            }
            catch (Exception error)
            {
                receipt.reason = Classify(error, receipt.errors);
                receipt.outcome = receipt.reason == "cancelled" ? "cancelled" : "failed";
                receipt.detail = Unwrap(error).Message;
            }
            finally
            {
                if (!string.IsNullOrEmpty(receipt.uploadId))
                {
                    try { AtomicWrite(Path.Combine(folder, "amf-upload.result.json"), JsonUtility.ToJson(receipt, true)); }
                    catch (Exception error) { Debug.LogWarning("VUA upload receipt: " + error.Message); }
                    TryDelete(file); TryDelete(started); TryDelete(Path.Combine(folder, "amf-upload.cancel"));
                }
                uploadRunning = false;
            }
        }

        private static async Task Upload(UploadRequest request, UploadReceipt receipt, string folder, string started)
        {
            void Line(string stage, float progress = -1f, string status = "")
            {
                try
                {
                    AtomicWrite(Path.Combine(folder, "amf-upload.progress.json"), JsonUtility.ToJson(new UploadLine
                        { runId = request.runId, uploadId = request.uploadId, stage = stage, progress = progress, status = status ?? "" }, true));
                }
                catch (Exception error) { Debug.LogWarning("VUA upload progress: " + error.Message); }
            }
            bool StopRequested()
            {
                var path = Path.Combine(folder, "amf-upload.cancel");
                if (!File.Exists(path)) return false;
                try { var stop = JsonUtility.FromJson<UploadCancel>(File.ReadAllText(path)); return stop != null && stop.uploadId == request.uploadId; }
                catch (Exception) { return false; }
            }
            void Stopped() { receipt.outcome = "cancelled"; receipt.reason = "cancelled"; }

            Line("sdk_panel");
            if (SceneManager.GetActiveScene().path != ScenePath)
            {
                if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) { Stopped(); receipt.detail = "The scene open in Unity was kept."; return; }
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }
            var avatar = FindOwned(request.avatarGlobalObjectId);
            if (avatar == null) { receipt.reason = "avatar_missing"; receipt.detail = "The finished Avatar is not in the work scene. Check the work project again."; return; }
            UnityEditor.Selection.activeGameObject = avatar;
            var sdk = SdkBuilder.Load();
            // VUA's own VRChat session, when the player signed in there: the SDK panel
            // starts signed in. The handoff file is deleted on read; any problem falls
            // back to signing in inside the panel.
            var handoff = ReadSessionHandoff(folder);
            if (handoff != null)
            {
                try
                {
                    if (await sdk.ApplySession(handoff.username, handoff.auth, handoff.twoFactorAuth))
                        receipt.sdkSignIn = "vua_session";
                }
                catch (Exception error) { Debug.LogWarning("VUA upload session: " + Unwrap(error).Message); }
            }
            EditorApplication.ExecuteMenuItem("VRChat SDK/Show Control Panel");

            // The builder exists while the SDK panel is open; the VRChat sign-in happens in that panel.
            object builder = null;
            while (true)
            {
                if (StopRequested()) { Stopped(); return; }
                builder = sdk.Builder();
                if (builder != null && sdk.SignedIn()) break;
                Line(builder == null ? "sdk_panel" : "sign_in");
                await Task.Delay(1000);
            }
            if (!sdk.CanPublishAvatars()) { receipt.reason = "no_publish_permission"; receipt.detail = "This VRChat account cannot upload Avatars yet."; return; }
            sdk.Select(builder, avatar);
            var pipeline = sdk.Pipeline(avatar);
            var blueprint = sdk.BlueprintId(pipeline);
            receipt.firstUpload = string.IsNullOrEmpty(blueprint);
            string thumbnail = null;
            if (receipt.firstUpload)
            {
                var root = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
                thumbnail = string.IsNullOrEmpty(request.thumbnail) || !request.thumbnail.StartsWith(".vua/previews/", StringComparison.Ordinal) || request.thumbnail.Contains("..")
                    ? null : Path.GetFullPath(Path.Combine(root, request.thumbnail.Replace('/', Path.DirectorySeparatorChar)));
                if (thumbnail == null || !thumbnail.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(thumbnail))
                {
                    receipt.reason = "thumbnail_missing"; receipt.detail = "VRChat needs a picture for a new Avatar. Check the work project again to render its previews.";
                    return;
                }
            }

            Line("checking");
            // A new Avatar gets the name the player gave in VUA; an Avatar already on VRChat keeps its own details.
            var content = receipt.firstUpload ? sdk.NewAvatar(request.avatarName) : await sdk.RemoteAvatar(blueprint);
            File.WriteAllText(started, request.uploadId);
            using (var cancel = new CancellationTokenSource())
            {
                EditorApplication.CallbackFunction watch = () => { if (!cancel.IsCancellationRequested && StopRequested()) cancel.Cancel(); };
                EditorApplication.update += watch;
                var events = sdk.Listen(builder, (stage, share, status) => Line(stage, share, status), id => receipt.blueprintId = id ?? "");
                try { await sdk.BuildAndUpload(builder, avatar, content, thumbnail, cancel.Token); }
                catch (Exception error) when (cancel.IsCancellationRequested)
                {
                    Stopped(); receipt.detail = Unwrap(error).Message;
                    return;
                }
                finally { events(); EditorApplication.update -= watch; }
            }
            if (string.IsNullOrEmpty(receipt.blueprintId)) receipt.blueprintId = sdk.BlueprintId(pipeline) ?? "";
            receipt.outcome = "succeeded";
            Line("finishing", 1f);
            if (receipt.firstUpload && !string.IsNullOrEmpty(receipt.blueprintId))
            {
                // The SDK writes the new Avatar ID into the scene; saving it keeps later uploads on this Avatar.
                EditorSceneManager.MarkSceneDirty(avatar.scene);
                receipt.sceneSaved = EditorSceneManager.SaveScene(avatar.scene);
                if (!receipt.sceneSaved) receipt.detail = "Save the scene in Unity so the next upload updates this Avatar.";
            }
        }

        private static Exception Unwrap(Exception error)
        {
            while ((error is TargetInvocationException || error is AggregateException) && error.InnerException != null) error = error.InnerException;
            return error;
        }

        /// VUA writes .vua/bridge/vrchat-session.json before an upload when the player is
        /// signed in to VRChat in VUA. The Editor reads it once and deletes it right away;
        /// a file left by an upload that never started is ignored after fifteen minutes.
        private static SessionHandoff ReadSessionHandoff(string folder)
        {
            var file = Path.Combine(folder, "vrchat-session.json");
            try
            {
                if (!File.Exists(file)) return null;
                if ((DateTime.UtcNow - File.GetLastWriteTimeUtc(file)).TotalMinutes > 15) { TryDelete(file); return null; }
                var handoff = JsonUtility.FromJson<SessionHandoff>(File.ReadAllText(file));
                TryDelete(file);
                if (handoff == null || handoff.schemaVersion != "0.1" || string.IsNullOrEmpty(handoff.username) || string.IsNullOrEmpty(handoff.auth))
                    return null;
                return handoff;
            }
            catch (Exception error) { TryDelete(file); Debug.LogWarning("VUA upload session: " + error.Message); return null; }
        }

        // The SDK's exception types name why an upload ended.
        private static string Classify(Exception exception, List<string> errors)
        {
            var error = Unwrap(exception);
            bool Says(string word) => error.Message.IndexOf(word, StringComparison.OrdinalIgnoreCase) >= 0;
            switch (error.GetType().Name)
            {
                case "ValidationException":
                    if (error.GetType().GetField("Errors")?.GetValue(error) is IEnumerable<string> list) errors.AddRange(list.Where(e => !string.IsNullOrEmpty(e)).Take(32));
                    return "validation";
                case "CopyrightOwnershipAgreementException": return "agreement_declined";
                case "OwnershipException": return Says("agree") ? "agreement_declined" : "ownership";
                case "BuildBlockedException": return Says("permission") ? "no_publish_permission" : "build_blocked";
                case "BuilderException": return "build";
                case "UploadException": case "BundleExistsException": case "ApiErrorException": case "ApiModeratedException":
                    return Says("thumbnail") ? "thumbnail_missing" : "upload";
                case "TaskCanceledException": case "OperationCanceledException": return "cancelled";
                default: return "unknown";
            }
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch (Exception error) { Debug.LogWarning("VUA upload: " + error.Message); }
        }

        // The public SDK builder API (VRC.SDK3A.Editor.IVRCSdkAvatarBuilderApi), reached by reflection.
        private sealed class SdkBuilder
        {
            private const BindingFlags Static = BindingFlags.Public | BindingFlags.Static;
            private Type panel, builderApi, avatarApi, avatar, api, user, pipeline, credentials, container;

            internal static SdkBuilder Load()
            {
                Type Find(string name) => AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType(name, false)).FirstOrDefault(t => t != null);
                var sdk = new SdkBuilder
                {
                    panel = Find("VRCSdkControlPanel"), builderApi = Find("VRC.SDKBase.Editor.IVRCSdkBuilderApi"),
                    avatarApi = Find("VRC.SDK3A.Editor.IVRCSdkAvatarBuilderApi"), avatar = Find("VRC.SDKBase.Editor.Api.VRCAvatar"),
                    api = Find("VRC.SDKBase.Editor.Api.VRCApi"), user = Find("VRC.Core.APIUser"), pipeline = Find("VRC.Core.PipelineManager"),
                };
                if (new[] { sdk.panel, sdk.builderApi, sdk.avatarApi, sdk.avatar, sdk.api, sdk.user, sdk.pipeline }.Any(t => t == null))
                    throw new InvalidOperationException("The VRChat SDK's builder is not available in this project.");
                // Only needed when VUA hands its own session over; missing types just disable that path.
                sdk.credentials = Find("VRC.Core.ApiCredentials");
                sdk.container = Find("VRC.Core.ApiModelContainer`1");
                return sdk;
            }

            // TryGetBuilder logs an error while the panel is closed, so it is asked only once the panel exists.
            internal object Builder()
            {
                if (panel.GetField("window", Static)?.GetValue(null) == null) return null;
                var args = new object[] { null };
                var tryGet = panel.GetMethod("TryGetBuilder", Static)?.MakeGenericMethod(avatarApi);
                return tryGet != null && tryGet.Invoke(null, args) is bool found && found ? args[0] : null;
            }

            internal bool SignedIn() => user.GetProperty("IsLoggedIn", Static)?.GetValue(null) is bool signedIn && signedIn;

            /// Applies VUA's session the same way the SDK panel does on a successful
            /// sign-in: ApiCredentials.Set with the session cookies, then a fetch of the
            /// current user. A session VRChat has since ended reports false.
            internal async Task<bool> ApplySession(string username, string auth, string twoFactorAuth)
            {
                if (credentials == null || container == null) throw new InvalidOperationException("The VRChat SDK cannot take over this sign-in.");
                MethodInfo Set(int parameters) => credentials.GetMethods(Static).FirstOrDefault(m =>
                    m.Name == "Set" && m.GetParameters().Length == parameters && m.GetParameters().All(p => p.ParameterType == typeof(string)));
                var set = twoFactorAuth != null ? Set(5) ?? Set(4) : Set(4) ?? Set(5);
                if (set == null) throw new InvalidOperationException("The VRChat SDK cannot take over this sign-in.");
                set.Invoke(null, set.GetParameters().Length == 5
                    ? new object[] { username, username, "vrchat", auth, twoFactorAuth ?? "" }
                    : new object[] { username, username, "vrchat", auth });
                var fetch = new SessionFetch(user);
                var method = user.GetMethods(Static).FirstOrDefault(m => m.Name == "InitialFetchCurrentUser" && m.GetParameters().Length == 2);
                if (method == null) throw new InvalidOperationException("The VRChat SDK cannot confirm this sign-in.");
                var closed = container.MakeGenericType(user);
                var callbackType = typeof(Action<>).MakeGenericType(closed);
                var handler = Delegate.CreateDelegate(callbackType, fetch, typeof(SessionFetch).GetMethod(nameof(SessionFetch.OnFetched)));
                method.Invoke(null, new object[] { handler, null });
                var finished = await Task.WhenAny(fetch.Done.Task, Task.Delay(TimeSpan.FromSeconds(30)));
                var signedIn = finished == fetch.Done.Task && fetch.Done.Task.Result;
                if (!signedIn)
                {
                    // A session VRChat ended leaves the panel's own sign-in path untouched.
                    try { credentials.GetMethod("Clear", Static)?.Invoke(null, null); } catch (Exception) { }
                }
                return signedIn;
            }

            /// Waits for APIUser.InitialFetchCurrentUser and judges the container it hands back.
            private sealed class SessionFetch
            {
                private readonly Type user;
                public SessionFetch(Type user) { this.user = user; }
                public readonly TaskCompletionSource<bool> Done = new TaskCompletionSource<bool>();
                public void OnFetched(object modelContainer)
                {
                    var model = modelContainer == null ? null : modelContainer.GetType().GetProperty("Model")?.GetValue(modelContainer);
                    Done.TrySetResult(model != null && user.IsInstanceOfType(model));
                }
            }

            internal bool CanPublishAvatars()
            {
                var current = user.GetProperty("CurrentUser", Static)?.GetValue(null);
                if (current == null) return false;
                var type = current.GetType();
                var allowed = type.GetProperty("canPublishAvatars")?.GetValue(current) ?? type.GetField("canPublishAvatars")?.GetValue(current);
                return allowed is bool yes && yes;
            }

            internal void Select(object builder, GameObject target)
            {
                try { avatarApi.GetMethod("SelectAvatar")?.Invoke(builder, new object[] { target }); }
                catch (Exception error) { Debug.LogWarning("VUA upload: the SDK panel did not select the Avatar: " + Unwrap(error).Message); }
            }

            internal Component Pipeline(GameObject target)
            {
                var component = target.GetComponent(pipeline);
                return component != null ? component : Undo.AddComponent(target, pipeline);
            }

            internal string BlueprintId(Component component) =>
                (pipeline.GetField("blueprintId")?.GetValue(component) ?? pipeline.GetProperty("blueprintId")?.GetValue(component)) as string;

            internal object NewAvatar(string name)
            {
                var content = Activator.CreateInstance(avatar);
                void Set(string property, object value) => avatar.GetProperty(property)?.SetValue(content, value);
                Set("Name", name); Set("Description", ""); Set("Tags", new List<string>()); Set("ReleaseStatus", "private");
                return content;
            }

            internal async Task<object> RemoteAvatar(string id)
            {
                var get = api.GetMethods(Static).FirstOrDefault(m => m.Name == "GetAvatar" && m.GetParameters().Length == 3 && m.GetParameters()[0].ParameterType == typeof(string)) ?? throw new InvalidOperationException("The VRChat SDK cannot read Avatars.");
                var task = (Task)get.Invoke(null, new object[] { id, true, CancellationToken.None });
                await task;
                return task.GetType().GetProperty("Result")?.GetValue(task) ?? throw new InvalidOperationException("VRChat returned no Avatar for " + id + ".");
            }

            // Subscribes to the builder's progress events; the returned action unsubscribes.
            internal Action Listen(object builder, Action<string, float, string> line, Action<string> succeeded)
            {
                var handlers = new List<(EventInfo, Delegate)>();
                void On(string name, Delegate handler)
                {
                    var info = builderApi.GetEvent(name);
                    if (info == null || info.EventHandlerType != handler.GetType()) return;
                    info.AddEventHandler(builder, handler);
                    handlers.Add((info, handler));
                }
                On("OnSdkBuildStart", new EventHandler<object>((_, __) => line("building", -1f, "")));
                On("OnSdkBuildProgress", new EventHandler<string>((_, status) => line("building", -1f, status)));
                On("OnSdkUploadStart", new EventHandler((_, __) => line("uploading", 0f, "")));
                On("OnSdkUploadProgress", new EventHandler<(string status, float percentage)>((_, update) => line("uploading", Mathf.Clamp01(update.percentage), update.status)));
                On("OnSdkUploadSuccess", new EventHandler<string>((_, id) => succeeded(id)));
                return () => { foreach (var (info, handler) in handlers) info.RemoveEventHandler(builder, handler); };
            }

            internal async Task BuildAndUpload(object builder, GameObject target, object content, string thumbnail, CancellationToken cancel)
            {
                var method = avatarApi.GetMethods().FirstOrDefault(m => m.Name == "BuildAndUpload" && m.GetParameters().Length == 4
                    && m.GetParameters()[0].ParameterType == typeof(GameObject) && m.GetParameters()[1].ParameterType == avatar)
                    ?? throw new InvalidOperationException("The VRChat SDK has no Avatar build-and-upload method.");
                await (Task)method.Invoke(builder, new object[] { target, content, thumbnail, cancel });
            }
        }
    }
}
