using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Vua.Editor.Bridge
{
    /// <summary>
    /// build_preview（Release 烘焙转盘，unity-bridge v4；slice/production-nav-
    /// bake-preview，用户裁决 2026-09-20）：在 NewPreviewScene 里实例化 Avatar
    /// 副本，相机环绕烘焙 60 帧 1024×1024 透明底 PNG + cover.png + manifest.json，
    /// 产物写入 .vua/bridge/preview/&lt;commandId&gt;/，不修改用户场景。
    /// dryRun 只做目标识别与结构统计，不生成图片。
    /// 统计口径与 analyze_performance 一致（本地结构估算，非 VRChat 官方性能等级）。
    /// 移植自参考实现 BridgePreviewBake.cs（VRC_Ultra_assistant spike），产物目录
    /// 由 .vrcua/bridge/preview 改为 VUA 桥目录约定 .vua/bridge/preview，manifest
    /// basis 改为 "vua-unity-editor-bake"。
    /// </summary>
    internal static class BridgePreviewBake
    {
        private const int FrameCount = 60;
        private const int FrameSize = 1024;

        [Serializable]
        private sealed class PreviewManifest
        {
            public int schemaVersion = 1;
            public string commandId = string.Empty;
            public string avatarName = string.Empty;
            public string bakedAt = string.Empty;
            public string basis = "vua-unity-editor-bake";
            public int frames;
            public int width;
            public int height;
            public string framePattern = "frames/frame_{0:D2}.png";
            public string cover = "cover.png";
            public int triangles;
            public int materialSlots;
            public int skinnedMeshRenderers;
            public int bones;
        }

        internal static BridgeResult Bake(BridgeCommand command)
        {
            var avatar = ResolveAvatar(command);
            if (avatar == null)
            {
                return Labeled(command, BridgeResult.Reject(command, "preview.no_avatar",
                    "当前场景没有找到可预览的 Avatar（自动识别 VRC_AvatarDescriptor / Animator / 网格量，或在 payload 指定 avatarGlobalObjectId）。"));
            }

            var result = Labeled(command, BridgeResult.Success(command));
            FillStats(avatar, result);

            if (command.dryRun)
            {
                result.diagnostics.Add(BridgeDiagnostic.Info("preview.dry_run",
                    "预览烘焙检查通过:" + avatar.name + ",尚未生成图片。"));
                return result;
            }

            var relativeDir = Path.Combine(".vua", "bridge", "preview", command.commandId);
            var outputDir = Path.Combine(Directory.GetCurrentDirectory(), relativeDir);
            var framesDir = Path.Combine(outputDir, "frames");
            Directory.CreateDirectory(framesDir);

            var previewScene = EditorSceneManager.NewPreviewScene();
            try
            {
                var copy = UnityEngine.Object.Instantiate(avatar);
                copy.name = avatar.name + " (Preview)";
                SceneManager.MoveGameObjectToScene(copy, previewScene);
                copy.transform.position = Vector3.zero;
                copy.transform.rotation = Quaternion.identity;
                // 注意:Unity 禁止把 preview scene 设为活动场景,不要尝试;
                // 实例化/相机/灯光全部显式 MoveGameObjectToScene 进 previewScene。

                var bounds = ComputeBounds(copy);
                if (bounds.size.sqrMagnitude < 1e-6f)
                {
                    bounds = new Bounds(copy.transform.position + Vector3.up, Vector3.one);
                }

                var rig = new GameObject("VUA Preview Rig");
                SceneManager.MoveGameObjectToScene(rig, previewScene);
                var camera = rig.AddComponent<Camera>();
                // Moving the GameObject alone does not select the preview culling scene.
                camera.scene = previewScene;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                camera.fieldOfView = 28f;
                camera.nearClipPlane = 0.01f;
                camera.farClipPlane = 100f;
                camera.enabled = false;

                // RenderSettings 作用于活动场景,改它会污染用户场景的 Lighting
                // 设置,preview scene 又无法设为活动——用第三盏轮廓光补偿无环境光。
                AddLight(rig, "Key", 30f, 35f, 1.35f);
                AddLight(rig, "Fill", -145f, 12f, 0.65f);
                AddLight(rig, "Rim", 95f, 20f, 0.4f);

                var center = bounds.center;
                var fit = Mathf.Max(bounds.extents.y, Mathf.Max(bounds.extents.x, bounds.extents.z));
                var distance = Mathf.Max(fit, 0.05f) / Mathf.Tan(camera.fieldOfView * 0.5f * Mathf.Deg2Rad) * 1.18f;

                // 相机环绕取景(模型静止)。注意:参考实现曾尝试"相机固定+模型自转",
                // 但编辑器非 Play 烘焙下副本姿态在帧间被还原(两工程实测 60 帧
                // 全部同一角度,疑似 NDMF Preview/编辑器管线状态所致),回退环绕。
                // VRC PhysBone 属 VRChat 游戏内运行时,编辑器非 Play 模式不模拟,
                // 反射驱动被仓库纪律禁止——物理摆动暂不可烘焙,留待 Play 模式方案。
                var previousActive = RenderTexture.active;
                var rt = new RenderTexture(FrameSize, FrameSize, 24, RenderTextureFormat.ARGB32);
                var tex = new Texture2D(FrameSize, FrameSize, TextureFormat.RGBA32, false);
                try
                {
                    for (var i = 0; i < FrameCount; i++)
                    {
                        var rad = i * (360f / FrameCount) * Mathf.Deg2Rad;
                        var offset = new Vector3(Mathf.Sin(rad), 0f, Mathf.Cos(rad)) * distance;
                        camera.transform.position = center + offset + Vector3.up * (bounds.extents.y * 0.12f);
                        camera.transform.LookAt(center);

                        camera.targetTexture = rt;
                        camera.Render();
                        RenderTexture.active = rt;
                        tex.ReadPixels(new Rect(0f, 0f, FrameSize, FrameSize), 0, 0);
                        tex.Apply();
                        RenderTexture.active = previousActive;
                        camera.targetTexture = null;

                        File.WriteAllBytes(
                            Path.Combine(framesDir, "frame_" + i.ToString("D2") + ".png"),
                            tex.EncodeToPNG());
                    }
                }
                finally
                {
                    RenderTexture.active = previousActive;
                    camera.targetTexture = null;
                    rt.Release();
                    UnityEngine.Object.DestroyImmediate(tex);
                    UnityEngine.Object.DestroyImmediate(rt);
                }

                File.Copy(Path.Combine(framesDir, "frame_00.png"),
                    Path.Combine(outputDir, "cover.png"), true);

                var manifest = new PreviewManifest
                {
                    commandId = command.commandId,
                    avatarName = avatar.name,
                    bakedAt = DateTimeOffset.Now.ToString("o"),
                    frames = FrameCount,
                    width = FrameSize,
                    height = FrameSize,
                    triangles = result.data.triangles,
                    materialSlots = result.data.materialSlots,
                    skinnedMeshRenderers = result.data.skinnedMeshRenderers,
                    bones = result.data.bones,
                };
                File.WriteAllText(Path.Combine(outputDir, "manifest.json"),
                    JsonUtility.ToJson(manifest, true));

                result.changedPaths.Add(relativeDir);
                result.diagnostics.Add(BridgeDiagnostic.Info("preview.baked",
                    "已烘焙 " + FrameCount + " 帧到 " + relativeDir + "/。"));
                return result;
            }
            catch (Exception exception)
            {
                // 诊断:完整异常消息 + 截断堆栈,定位到具体调用点
                var stack = exception.StackTrace ?? string.Empty;
                if (stack.Length > 600) stack = stack.Substring(0, 600);
                return Labeled(command, BridgeResult.Reject(command, "preview.bake_failed",
                    exception.GetType().Name + ": " + exception.Message + " | " + stack));
            }
            finally
            {
                if (previewScene.IsValid()) EditorSceneManager.ClosePreviewScene(previewScene);
            }
        }

        /// <summary>
        /// Renders still PNG images of one scene object or prefab asset (Bridge v5 AMF previews).
        /// Each view is a camera yaw around the object, 0 facing its front. The copy lives in its
        /// own preview scene with the same white three-light rig as the turntable, on an opaque
        /// neutral grey background, so the user's scene and lighting settings stay untouched.
        /// </summary>
        internal static void RenderStills(GameObject source, int size, (string path, float yaw)[] views)
        {
            var previewScene = EditorSceneManager.NewPreviewScene();
            var previousActive = RenderTexture.active;
            RenderTexture rt = null;
            Texture2D tex = null;
            try
            {
                var copy = EditorUtility.IsPersistent(source)
                    ? PrefabUtility.InstantiatePrefab(source, previewScene) as GameObject
                    : UnityEngine.Object.Instantiate(source);
                if (copy == null) throw new InvalidOperationException("Could not copy " + source.name + " for its preview.");
                if (copy.scene != previewScene) SceneManager.MoveGameObjectToScene(copy, previewScene);
                copy.SetActive(true);
                copy.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);

                var bounds = ComputeBounds(copy);
                if (bounds.size.sqrMagnitude < 1e-6f) bounds = new Bounds(Vector3.up, Vector3.one);

                var rig = new GameObject("VUA Preview Rig");
                SceneManager.MoveGameObjectToScene(rig, previewScene);
                var camera = rig.AddComponent<Camera>();
                camera.scene = previewScene;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.62f, 0.62f, 0.62f, 1f);
                camera.fieldOfView = 28f;
                camera.nearClipPlane = 0.01f;
                camera.farClipPlane = 100f;
                camera.enabled = false;
                AddLight(rig, "Key", 30f, 35f, 1.35f);
                AddLight(rig, "Fill", -145f, 12f, 0.65f);
                AddLight(rig, "Rim", 95f, 20f, 0.4f);

                var center = bounds.center;
                var fit = Mathf.Max(bounds.extents.y, Mathf.Max(bounds.extents.x, bounds.extents.z));
                var distance = Mathf.Max(fit, 0.05f) / Mathf.Tan(camera.fieldOfView * 0.5f * Mathf.Deg2Rad) * 1.18f;

                rt = new RenderTexture(size, size, 24, RenderTextureFormat.ARGB32);
                tex = new Texture2D(size, size, TextureFormat.RGB24, false);
                foreach (var view in views)
                {
                    var rad = view.yaw * Mathf.Deg2Rad;
                    camera.transform.position = center + new Vector3(Mathf.Sin(rad), 0f, Mathf.Cos(rad)) * distance
                        + Vector3.up * (bounds.extents.y * 0.12f);
                    camera.transform.LookAt(center);
                    camera.targetTexture = rt;
                    camera.Render();
                    RenderTexture.active = rt;
                    tex.ReadPixels(new Rect(0f, 0f, size, size), 0, 0);
                    tex.Apply();
                    RenderTexture.active = previousActive;
                    camera.targetTexture = null;

                    var pending = view.path + ".pending";
                    File.WriteAllBytes(pending, tex.EncodeToPNG());
                    if (File.Exists(view.path)) File.Delete(view.path);
                    File.Move(pending, view.path);
                }
            }
            finally
            {
                RenderTexture.active = previousActive;
                if (rt != null) { rt.Release(); UnityEngine.Object.DestroyImmediate(rt); }
                if (tex != null) UnityEngine.Object.DestroyImmediate(tex);
                if (previewScene.IsValid()) EditorSceneManager.ClosePreviewScene(previewScene);
            }
        }

        /// <summary>
        /// Renders the 60-frame turntable of an AMF result (Bridge v5 amf_turntable): the same camera
        /// orbit as Bake, yaw 0° (the Avatar's front) and then 360°/frames per frame, rendered with the
        /// RenderStills rig so the turntable matches the front, side and back views.
        /// </summary>
        internal static void RenderTurntable(GameObject source, int size, int frames, Func<int, string> pathFor)
        {
            RenderStills(source, size, Enumerable.Range(0, frames).Select(i => (pathFor(i), i * (360f / frames))).ToArray());
        }

        /// 收据版本回显命令协议版本(execute_production_job 先例,proposal 016):
        /// v4 命令的 build_preview 收据标 v4,绝不用默认标签冒充。
        private static BridgeResult Labeled(BridgeCommand command, BridgeResult result)
        {
            result.schemaVersion = command.schemaVersion;
            result.operation = command.operation;
            return result;
        }

        private static GameObject ResolveAvatar(BridgeCommand command)
        {
            if (!string.IsNullOrWhiteSpace(command.payload.avatarGlobalObjectId) &&
                GlobalObjectId.TryParse(command.payload.avatarGlobalObjectId, out var id))
            {
                var chosen = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(id) as GameObject;
                if (chosen != null) return chosen;
            }

            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || !scene.isLoaded) return null;

            GameObject best = null;
            var bestScore = -1;
            foreach (var root in scene.GetRootGameObjects())
            {
                var score = Score(root);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = root;
                }
            }
            return bestScore > 0 ? best : null;
        }

        private static int Score(GameObject root)
        {
            var score = 0;
            foreach (var component in root.GetComponents<Component>())
            {
                if (component == null) continue;
                var typeName = component.GetType().FullName ?? string.Empty;
                if (typeName == "VRC.SDK3.Avatars.Components.VRC_AvatarDescriptor") score += 100;
                if (typeName == "VRM10.Vrm10Instance") score += 80;
            }
            if (root.GetComponent<Animator>() != null) score += 10;
            var renderers = root.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            if (renderers.Length == 0) return 0;
            return score + Mathf.Min(renderers.Length, 20);
        }

        private static void FillStats(GameObject avatar, BridgeResult result)
        {
            var renderers = avatar.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            result.data.avatarName = avatar.name;
            result.data.basis = "local_estimate";
            result.data.skinnedMeshRenderers = renderers.Length;
            result.data.materialSlots = renderers.Sum(renderer => renderer.sharedMaterials.Length);
            result.data.bones = renderers.Sum(renderer => renderer.bones == null ? 0 : renderer.bones.Length);
            result.data.triangles = renderers.Sum(renderer => TriangleCount(renderer.sharedMesh));
        }

        private static int TriangleCount(Mesh mesh)
        {
            if (mesh == null) return 0;
            ulong indices = 0;
            for (var subMesh = 0; subMesh < mesh.subMeshCount; subMesh++)
            {
                indices += mesh.GetIndexCount(subMesh);
            }
            return indices > int.MaxValue * 3UL ? int.MaxValue : (int)(indices / 3);
        }

        private static Bounds ComputeBounds(GameObject root)
        {
            // 只统计激活的 SkinnedMeshRenderer:粒子/特效 renderer 的 bounds 是
            // 模拟范围而非实体网格,会把取景距离撑飞(参考实现实测 Nemesis_Full
            // 几乎全黑)。无激活 SMR 时依次回退:全部 SMR → 全部 Renderer(纯静态摆件)。
            var renderers = root.GetComponentsInChildren<SkinnedMeshRenderer>(false);
            if (renderers.Length == 0)
                renderers = root.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            var bounds = new Bounds(root.transform.position, Vector3.zero);
            var first = true;
            foreach (var renderer in renderers)
            {
                if (first)
                {
                    bounds = renderer.bounds;
                    first = false;
                }
                else
                {
                    bounds.Encapsulate(renderer.bounds);
                }
            }
            if (first)
            {
                foreach (var renderer in root.GetComponentsInChildren<Renderer>(false))
                {
                    if (first)
                    {
                        bounds = renderer.bounds;
                        first = false;
                    }
                    else
                    {
                        bounds.Encapsulate(renderer.bounds);
                    }
                }
            }
            return bounds;
        }

        private static void AddLight(GameObject rig, string name, float yaw, float pitch, float intensity)
        {
            var holder = new GameObject(name);
            holder.transform.SetParent(rig.transform, false);
            var light = holder.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = intensity;
            holder.transform.rotation = Quaternion.Euler(pitch, yaw, 0f);
        }
    }
}
