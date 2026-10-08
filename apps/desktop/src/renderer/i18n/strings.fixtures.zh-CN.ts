/**
 * 演示数据负载文案(zh-CN)—— DEV 构建专用。
 *
 * 原则①硬防线的结构保证:本模块的应用内引用来自 gateway/fixture-*.ts(fixture-gateway
 * 及其拆分子模块)与 features/overlay/demo/(切片五 Overlay 演示端口)引用,
 * 两条引用链都仅在 import.meta.env.DEV 分支可达(gateway/create.ts 静态分支、
 * overlay-port-instance.ts 动态 import),
 * 生产构建中整条引用链被 Rollup 剔除,演示文案不会进入生产包。
 * scripts/fixtures 下的独立 Chromium 检查也可引用本模块,其入口不属于应用生产入口;
 * 检查专用文案同样参与生产包泄漏检查。
 * 真实数据源接入后,本文件随 fixture-gateway.ts 一并移除。
 *
 * 插值与术语纪律与主字符串表一致(见 strings.en.ts 文件头)。
 */
export const fixtureStrings = {
  /** Standalone Chromium smoke payload; its marker participates in the production leak check. */
  libraryMaintenanceProbeTitle: "Synthetic N5 library interaction test",
  checks: {
    vrchat: { title: "VRChat 本体", okDescription: "已安装,版本已通过验证。" },
    unity: { title: "Unity 版本", okDescription: "Unity 2022.3 LTS 就绪。" },
    vpm: {
      title: "VPM 环境",
      okDescription: "VPM 环境就绪,可管理 Avatar 项目依赖。",
      errorDescription: "未检测到 VPM 环境,无法管理 Avatar 项目依赖。",
      fixLabel: "安装 VPM 环境",
    },
    vrRuntime: {
      title: "VR 运行时与串流",
      okDescription: "SteamVR 运行中,头显已连接。",
      warningDescription: "未检测到头显连接,桌面模式仍可继续。",
      fixLabel: "查看连接指引",
    },
    disk: { title: "磁盘空间", okDescription: "剩余 128 GB,满足快照保留策略。" },
    network: { title: "网络", okDescription: "连接正常,可访问目录与下载源。" },
  },
  /** 修复计划演示负载(C-ENV;版本化 FixPlanV1,步骤含候选确认/外链/手动/重检四类) */
  fixPlans: {
    vpm: {
      title: "安装 VPM 环境",
      impact:
        "将在系统浏览器打开 VCC 官方下载页;下载与安装由官方安装器完成,VUA 不修改系统设置、不代装软件。",
      identify: "未能自动识别 VPM 的安装情况,请确认你的实际状态:",
      identifyCandidates: ["尚未安装 VPM", "已安装,但未被识别"],
      openDownload: "打开 VCC 官方下载页",
      openDownloadDescription: "在系统浏览器中打开 VRChat 官方创作者工具下载页。",
      runInstaller: "运行官方安装器完成安装",
      runInstallerDescription: "下载完成后按官方安装器引导完成安装;VUA 不代为执行。",
      recheck: "重新检测生产环境",
      recheckDescription: "安装完成后重新检测,以最新证据更新结论。",
    },
    vrRuntime: {
      title: "排查 VR 运行时与串流",
      impact: "将在系统浏览器打开官方连接指引;排查操作在你的设备上进行,VUA 不修改任何设置。",
      openGuide: "查看 SteamVR 官方连接指引",
      openGuideDescription: "在系统浏览器中打开官方指引页。",
      followGuide: "按指引检查头显连接与串流状态",
      followGuideDescription: "确认 SteamVR 已启动、头显已连接且串流正常。",
      recheck: "重新检测游玩环境",
      recheckDescription: "排查完成后重新检测,以最新证据更新结论。",
    },
  },
  /** Recipe 图谱演示负载文案(C-RECIPE;冲突说明是 RecipeConflict.description 数据负载) */
  recipe: {
    conflictAvatarBase: "存在两个必需的 avatar_base 资产;图谱不会自动取舍,请人工确认保留其一。",
  },
  /** Release 卡片墙演示负载(C-RECIPE-3;项目标题/配方标题为数据负载) */
  release: {
    projects: {
      summer: { title: "夏日制服 Avatar", recipeTitle: "夏日制服配方" },
      casual: { title: "日常便装 Avatar", recipeTitle: "日常便装配方" },
      legacy: { title: "旧版舞台 Avatar", recipeTitle: "舞台装配方" },
    },
  },
  workshop: {
    headline: "正在执行:{stage} · 骨骼绑定与菜单生成",
    logs: [
      "快照 r7 已创建并验证",
      "素材「Summer_Uniform」导入完成",
      "骨骼绑定完成,共 42 项自动操作",
      "正在生成换装菜单与参数…",
    ],
    /** 回放带演示负载(C-WORKSHOP;六态:空/加载/成功/警告/阻断/恢复) */
    tapes: {
      success: {
        headline: "演示回放:一次完整的装配流程",
        snapshot: "快照 r7 已创建并验证",
        imported: "素材「Summer_Uniform」导入完成",
        rigged: "骨骼绑定完成,共 42 项自动操作",
        menu: "换装菜单与参数生成完成",
        inspected: "检测通过:引用、功能与性能基线均达标",
      },
      warning: {
        headline: "演示回放:装配在检查点等待确认",
        imported: "素材「Summer_Uniform」导入完成",
        rigged: "骨骼绑定完成,共 18 项自动操作",
        checkpoint: "换装菜单合并方式需要你确认后才能继续",
      },
      blocked: {
        headline: "演示回放:依赖缺失导致阻断",
        imported: "素材「Stage_Set」导入完成",
        missing: "依赖缺失:着色系 Shader 包未在 VPM 中解析,流程已阻断",
      },
      recover: {
        headline: "演示回放:失败后从最近快照恢复",
        failed: "骨骼绑定失败:权重数据异常",
        restored: "已恢复快照 r6,回退到绑定前状态",
        retried: "重新执行骨骼绑定完成,共 42 项自动操作",
        inspected: "检测通过:引用、功能与性能基线均达标",
      },
    },
  },
  /** 工具合集演示负载(C-TOOLS;按用途分组键承载 category,分组词表不进入字符串值;
   *  名称/用途/数据去向/维护者均为数据负载,URL 一律 example.invalid) */
  tools: {
    devices: [
      {
        id: "demo-tracker-adapter",
        name: "示例头显追踪适配器",
        purpose: "把头显与手柄的追踪数据转译给捕捉工具使用。",
        installed: true,
        dataDestination: "仅本机处理,不上传。",
        maintainer: "VUA 演示目录",
        homepage: "https://example.invalid/tools/tracker-adapter",
        compatNote: "兼容状态未验证,接入前请自行确认。",
      },
      {
        id: "demo-controller-map",
        name: "示例手柄映射工具",
        purpose: "自定义手柄按键到 Avatar 表情的映射。",
        installed: false,
        dataDestination: "配置保存在本机。",
        maintainer: "社区示例",
        homepage: "https://example.invalid/tools/controller-map",
      },
    ],
    calibration: [
      {
        id: "demo-space-calibrator",
        name: "示例空间校准器",
        purpose: "校准游玩空间边界与追踪原点。",
        installed: true,
        dataDestination: "仅本机处理,不上传。",
        maintainer: "VUA 演示目录",
        homepage: "https://example.invalid/tools/space-calibrator",
      },
    ],
    capture: [
      {
        id: "demo-motion-capture",
        name: "示例动作捕捉输入",
        purpose: "把摄像头画面转换为全身追踪输入。",
        installed: false,
        dataDestination: "画面仅在本机处理;不上传视频。",
        maintainer: "社区示例",
        compatNote: "兼容状态未验证,接入前请自行确认。",
      },
      {
        id: "demo-face-capture",
        name: "示例面捕配置器",
        purpose: "配置面部捕捉参数并映射到 Avatar 表情。",
        installed: false,
        dataDestination: "配置保存在本机。",
        maintainer: "社区示例",
      },
    ],
  },
  /** 版本轨道演示负载(S-XV;轨道名为数据负载,版本号/时间戳/结论在代码侧) */
  versions: {
    vrchat: "VRChat 客户端",
    steamvr: "SteamVR 运行时",
    unity: "Unity 编辑器",
    vrcsdk: "VRChat SDK",
  },
  /** Warehouse 条目演示负载(F4-6 条目模型;文件夹名/显示名/相对路径/拒绝
   *  理由均为数据负载,状态/角色/模式词表由代码承载,不进入字符串值) */
  acquire: {
    entries: {
      summerUniform: {
        displayName: "夏日制服 ver1.2",
        folderName: "Summer_Uniform_v1.2",
        original: {
          relativePath: "Summer_Uniform_v1.2.unitypackage",
          suggestedFileName: "Summer_Uniform_v1.2.unitypackage",
        },
      },
      mikoDress: {
        displayName: "巫女裙套装",
        folderName: "Miko_Dress_set",
        original: {
          relativePath: "orig/Miko_Dress_set_v1.0.unitypackage",
          suggestedFileName: "Miko_Dress_set_v1.0.unitypackage",
        },
        generatedVpm: {
          relativePath: "generated/Miko_Dress_set_v1.0.vpm",
          suggestedFileName: "Miko_Dress_set_v1.0.vpm",
        },
      },
      stageSet: {
        displayName: "舞台道具包",
        folderName: "Stage_Set_pack",
        original: {
          relativePath: "Stage_Set_pack_v0.3.unitypackage",
          suggestedFileName: "Stage_Set_pack_v0.3.unitypackage",
        },
      },
      suspicious: {
        displayName: "免费 Avatar 合集",
        folderName: "free_avatar_bundle",
        original: {
          relativePath: "pack/free_avatar_bundle.zip",
          rejectionReason: "检出可执行内容:setup.exe、scripts/install.bat",
        },
      },
    },
  },
  /** 包管理演示负载(S-XVI;包名/项目名/仓库名/legacy 目录为数据负载,
   *  版本号/时间戳/来源与状态词表由代码承载,不进入字符串值) */
  packages: {
    projects: {
      summer: { name: "夏日制服 Avatar", path: "~/Unity/Projects/SummerAvatar" },
      stage: { name: "舞台演出 Avatar", path: "~/Unity/Projects/StageLive" },
      lost: { name: "旧存档项目", path: "~/Unity/Projects/OldArchive" },
      imported: { name: "手动导入的项目", path: "~/Unity/Projects/ImportedProject" },
    },
    rows: {
      avatarsSdk: {
        displayName: "VRChat SDK - Avatars",
        description: "官方 Avatar 构建基础包。",
      },
      modularCloset: {
        displayName: "示例换装衣柜",
        description: "示例模块化换装组件与换装菜单生成器。",
      },
      facefx: {
        displayName: "示例表情扩展",
        description: "示例面部追踪表情映射合集。",
      },
      toonShader: {
        displayName: "示例卡通着色器",
        description: "示例卡通渲染着色器包。",
      },
      legacyProps: {
        displayName: "示例旧版道具集",
        description: "示例 legacy 目录结构的道具合集。",
      },
      physbonePlus: {
        displayName: "示例物理骨骼增强",
        description: "示例物理骨骼参数预设包。",
      },
      localTail: {
        displayName: "本地导入:示例尾巴物理",
        description: "从本地文件夹导入的示例包,无上游仓库。",
      },
      stageFx: {
        displayName: "示例舞台特效包",
        description: "示例特效合集;旧版本与当前项目不兼容。",
      },
      localImport: {
        displayName: "本地导入:示例发饰物理",
        description: "演示手动导入的本地包。",
      },
    },
    repos: {
      official: { name: "VRChat 官方仓库" },
      curated: { name: "VUA 官方精选" },
      communityA: { name: "示例社区仓库 A", url: "https://example.invalid/repos/community-a" },
      communityB: { name: "示例社区仓库 B", url: "https://example.invalid/repos/community-b" },
    },
    legacyDirs: {
      modularCloset: "Assets/ModularCloset (legacy)",
    },
  },
  /** F3 生产纵向流程演示负载(F3 UI/UX 先行切片;素材名/发现/计划/证据/任务标题/
   *  日志均为数据负载,词表键由代码承载,不进入字符串值) */
  production: {
    materials: {
      unitypackageDirect: "Summer_Uniform_v1.2.unitypackage",
      localVpm: "summer-uniform-local-1.0.0(本地 VPM 包)",
    },
    /** 车间标题行({stage} 由 format + termLabel 注入) */
    headlines: {
      active: "正在执行:{stage} · 换装导入与菜单生成",
      completed: "流程已完成:{stage} · 全部阶段通过",
      cancelled: "流程已取消:{stage} · 在安全边界结束",
      failed: "流程失败:{stage} · 可从快照恢复",
      expired: "确认已过期:{stage} · 未执行任何变更",
    },
    inspection: {
      findings: {
        compat: "衣装「Summer_Uniform」声明兼容目标素体(演示结论)。",
        missing: "可选配件纹理「Summer_Hat」未在本地找到(非阻断)。",
        conflict: "换装菜单与既有参数「OutfitToggle」存在命名冲突。",
      },
    },
    plan: {
      risks: [
        {
          kind: "conflict",
          summary: "换装菜单合并会改动现有参数,已规划快照回退路径。",
          recoverable: true,
          retryable: true,
        },
        {
          kind: "missing",
          summary: "预计额外占用磁盘约 300 MB。",
          recoverable: true,
          retryable: true,
        },
      ],
      diffs: {
        added: "为缺失的可选配件纹理生成占位引用,不阻断构建。",
        resolved: "命名冲突经重命名「OutfitToggle_v2」规避。",
      },
    },
    /** Build Record 末次操作小字(v0.2 evidenceSummary;结构化布尔由代码承载) */
    recordEvidence: {
      completed: "Bridge 作业 bridge-job-demo-0142 已完成(演示)。",
      rolledBack: "Bridge 作业 bridge-job-demo-0142 已回退(演示)。",
      rollbackFailed: "Bridge 作业 bridge-job-demo-0142 回退中断(演示)。",
    },
    /** 生产命令任务标题(任务中心数据负载) */
    tasks: {
      inspect: "检查素材与目标项目",
      plan: "生成执行计划",
      execute: "执行生产变更",
      recover: "恢复生产运行",
    },
    /** 车间执行日志(按运行态迁移追加;时间为演示时钟,不代表真实耗时) */
    transitionLog: {
      inspectStarted: "开始检查素材与目标项目。",
      inspectDone: "检查完成:1 项兼容声明、1 项非阻断缺失、1 项命名冲突。",
      planStarted: "正在生成执行计划…",
      planDone: "执行计划已生成,等待确认。",
      snapshotStarted: "正在创建执行前快照…",
      executeStarted: "正在导入素材并生成换装菜单…",
      validateStarted: "正在校验引用与参数一致性…",
      completed: "全部阶段通过,构建记录已生成。",
      recoverStarted: "恢复任务已启动。",
      continueRerun: "从最近安全点继续执行剩余阶段。",
      expiredBack: "回到计划确认:请审阅最新修订。",
      rollbackDone: "已回滚到执行前快照。",
      rollbackFailed: "回滚失败:快照校验和不匹配,需要人工核对。",
      drifted: "执行漂移:产物与计划不符,可恢复。",
      expired: "计划已变化,此前确认失效,未执行任何变更。",
      cancelled: "已取消:在安全边界结束,未留下半成品。",
    },
  },
} as const;

export type FixtureStrings = typeof fixtureStrings;
