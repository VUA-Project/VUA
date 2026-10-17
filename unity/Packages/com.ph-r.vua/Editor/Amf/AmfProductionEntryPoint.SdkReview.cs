using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;

namespace Vua.Editor.Bridge
{
    // The SDK panel's own Avatar checks and performance estimate, read in batch mode without opening
    // the panel: the same check method the panel runs, collected from the panel's issue lists.
    internal static partial class AmfProductionEntryPoint
    {
        [Serializable] internal sealed class SdkIssue { public string level; public string text; public bool canFix; }
        [Serializable] internal sealed class SdkStat { public string category; public string rating; public string text; }
        [Serializable] internal sealed class SdkReview
        {
            // checked: every check ran; partial: the SDK stopped part-way; unavailable: none ran; not_run.
            public string state = "not_run";
            public string platform = "";
            public string overall = "";
            public List<SdkIssue> issues = new List<SdkIssue>();
            public List<SdkStat> stats = new List<SdkStat>();
            public string detail = "";
        }

        private const int MaxSdkIssues = 64;
        private const int MaxSdkText = 600;
        private const BindingFlags AnyInstance = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
        private const BindingFlags StaticMembers = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;

        private static SdkReview ReviewWithSdk(GameObject avatar)
        {
            var review = new SdkReview();
            if (avatar == null) return review;
            try { ReadPerformance(avatar, review); }
            catch (Exception error) { review.stats.Clear(); review.detail = SdkText("Performance: " + Unwrap(error).Message); }

            var panelType = SdkType("VRCSdkControlPanel");
            var builderType = SdkType("VRC.SDK3A.Editor.VRCSdkControlPanelAvatarBuilder");
            var descriptorType = SdkType("VRC.SDKBase.VRC_AvatarDescriptor");
            var check = builderType?.GetMethod("OnGUIAvatarCheck", AnyInstance);
            var descriptor = descriptorType == null ? null : avatar.GetComponent(descriptorType);
            if (panelType == null || check == null || descriptor == null)
            {
                review.state = "unavailable";
                review.detail = descriptor == null && descriptorType != null
                    ? "The Avatar has no VRChat Avatar descriptor."
                    : "This VRChat SDK does not offer its Avatar checks.";
                return review;
            }

            ScriptableObject panel = null;
            try
            {
                panel = ScriptableObject.CreateInstance(panelType);
                panel.hideFlags = HideFlags.HideAndDontSave;
                var builder = Activator.CreateInstance(builderType);
                builderType.GetMethod("RegisterBuilder", AnyInstance)?.Invoke(builder, new object[] { panel });
                panelType.GetMethod("ResetIssues", AnyInstance)?.Invoke(panel, null);
                review.state = "checked";
                try { check.Invoke(builder, new object[] { descriptor }); }
                catch (Exception error)
                {
                    // Issues reported before the SDK stopped still stand.
                    review.state = "partial";
                    review.detail = SdkText(Unwrap(error).Message);
                }
                CollectIssues(panel, panelType, "GUIErrors", "error", review);
                CollectIssues(panel, panelType, "GUIWarnings", "warning", review);
                CollectIssues(panel, panelType, "GUIInfos", "info", review);
            }
            catch (Exception error)
            {
                review.state = "unavailable";
                review.issues.Clear();
                review.detail = SdkText(Unwrap(error).Message);
            }
            finally
            {
                if (panel != null) UnityEngine.Object.DestroyImmediate(panel);
            }
            return review;
        }

        private static void CollectIssues(object panel, Type panelType, string field, string level, SdkReview review)
        {
            if (!(panelType.GetField(field, AnyInstance)?.GetValue(panel) is IDictionary report)) return;
            foreach (DictionaryEntry entry in report)
            {
                if (!(entry.Value is IEnumerable issues)) continue;
                foreach (var issue in issues)
                {
                    if (issue == null || review.issues.Count >= MaxSdkIssues) continue;
                    var type = issue.GetType();
                    var text = type.GetField("issueText", AnyInstance)?.GetValue(issue) as string;
                    if (string.IsNullOrWhiteSpace(text)) continue;
                    var fix = type.GetField("fixThisIssue", AnyInstance)?.GetValue(issue);
                    var bounded = SdkText(text);
                    if (review.issues.Any(known => known.level == level && known.text == bounded)) continue;
                    review.issues.Add(new SdkIssue { level = level, text = bounded, canFix = fix != null });
                }
            }
        }

        // The SDK's estimate for the build target this project is set to, per category.
        private static void ReadPerformance(GameObject avatar, SdkReview review)
        {
            var statsType = SdkType("VRC.SDKBase.Validation.Performance.Stats.AvatarPerformanceStats");
            var performance = SdkType("VRC.SDKBase.Validation.Performance.AvatarPerformance");
            var categoryType = SdkType("VRC.SDKBase.Validation.Performance.AvatarPerformanceCategory");
            var display = SdkType("VRC.SDKBase.Validation.Performance.SDKPerformanceDisplay");
            var helpers = SdkType("VRC.SDKBase.Editor.Validation.ValidationEditorHelpers");
            if (statsType == null || performance == null || categoryType == null) return;
            var mobile = helpers?.GetMethod("IsMobilePlatform", StaticMembers, null, Type.EmptyTypes, null)?.Invoke(null, null) is bool isMobile && isMobile;
            var stats = Activator.CreateInstance(statsType, new object[] { mobile });
            var calculate = performance.GetMethods(StaticMembers).FirstOrDefault(m => m.Name == "CalculatePerformanceStats" && m.GetParameters().Length == 4);
            var rating = statsType.GetMethod("GetPerformanceRatingForCategory", AnyInstance, null, new[] { categoryType }, null);
            if (calculate == null || rating == null) return;
            calculate.Invoke(null, new object[] { avatar.name, avatar, stats, mobile });
            var describe = display?.GetMethods(StaticMembers).FirstOrDefault(m => m.Name == "GetSDKPerformanceInfoText" && m.GetParameters().Length == 5);
            review.platform = mobile ? "android" : "pc";
            foreach (var category in Enum.GetValues(categoryType))
            {
                var name = category.ToString();
                if (name == "None" || name == "AvatarPerformanceCategoryCount") continue;
                var level = rating.Invoke(stats, new[] { category })?.ToString() ?? "None";
                if (name == "Overall") { review.overall = level; continue; }
                if (level == "None") continue;
                var text = "";
                if (describe != null)
                {
                    var arguments = new object[] { stats, category, null, null, null };
                    describe.Invoke(null, arguments);
                    text = arguments[2] as string ?? "";
                }
                review.stats.Add(new SdkStat { category = name, rating = level, text = SdkText(text) });
            }
        }

        private static Type SdkType(string fullName)
        {
            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            var exact = assemblies.Select(a => a.GetType(fullName, false)).FirstOrDefault(t => t != null);
            if (exact != null) return exact;
            // Namespaces move between SDK releases; the type name stays.
            var simple = fullName.Substring(fullName.LastIndexOf('.') + 1);
            foreach (var assembly in assemblies.Where(a => a.GetName().Name.StartsWith("VRC", StringComparison.Ordinal)))
            {
                Type[] types;
                try { types = assembly.GetTypes(); }
                catch (ReflectionTypeLoadException partial) { types = partial.Types.Where(t => t != null).ToArray(); }
                catch (Exception) { continue; }
                var match = types.FirstOrDefault(t => t.Name == simple);
                if (match != null) return match;
            }
            return null;
        }

        private static string SdkText(string text)
        {
            var single = (text ?? "").Replace("\r", "").Trim();
            return single.Length <= MaxSdkText ? single : single.Substring(0, MaxSdkText - 1) + "…";
        }
    }
}
