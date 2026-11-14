/** Five-locale copy for EAC status detection, recovery ladder, and confirmation dialogs. */
const en = {
  dialogTitle: "Easy Anti-Cheat status",
  view: "View",
  launchAnyway: "Launch anyway",
  cancel: "Cancel",
  dismiss: "Close",
  refresh: "Check again",
  openGuide: "Troubleshooting guide",
  nextStep: "Next step",
  remindWhenReady: "Notify me when ready",
  remindArmed: "Waiting in the background—you can close this window and VUA will notify you as soon as EAC finishes unloading.",
  openExplorer: "Show repair tool in Explorer",
  openExplorerFailed: "EasyAntiCheat_EOS_Setup.exe wasn't found in the VRChat folder. Verify integrity of game files in Steam.",
  conclusions: {
    ready: "EAC is ready.",
    session_active: "VRChat is currently running.",
    unloading: "EAC is still unloading from your last session ({minutes} min so far). VRChat can start once it finishes.",
    unloading_long: "EAC is stuck unloading. Restart your PC, then start VRChat.",
    residual_process: "Your last VRChat session is still running in the background and will block the next launch.",
    steam_stale: "Steam still lists VRChat as running. Quit Steam from the tray, then start again.",
    not_installed: "EAC needs to be reinstalled. Run the official repair.",
    install_damaged: "EAC files are missing or couldn't be verified. Run the official repair or verify game files in Steam.",
    unknown: "Couldn't read all EAC status checks right now. You can still launch VRChat normally.",
    ready_after_wait: "EAC has finished unloading. You can start VRChat now.",
  },
  evidence: {
    title: "Observed facts",
    capturedAt: "Read at {time}",
    processes: "Processes",
    processesNone: "None running",
    processesSummary: "{count} running ({names})",
    windowVisible: "window open",
    windowHidden: "background",
    services: "Services",
    serviceAbsent: "{name}: unloaded",
    servicePresent: "{name}: {state}",
    serviceStates: {
      stopped: "stopped",
      start_pending: "starting",
      stop_pending: "unloading",
      running: "running",
      other: "paused",
      unreadable: "unreadable",
    },
    steam: "Steam flag",
    steamRunning: "Marked running (1)",
    steamIdle: "Clear (0)",
    steamUnknown: "Not set",
    install: "Install files",
    installVerified: "Folder present · setup and service signatures verified",
    installSummary: "Folder: {folder} · Setup: {setup} · Service: {service}",
    installStates: {
      present: "present",
      missing: "missing",
      verified: "verified",
      unverified: "unverified",
      unknown: "unknown",
    },
    logs: "Recent log code",
    logsNone: "No recent EAC error code",
    logWithTime: "{label} ({time})",
    logCodes: {
      launch_error_30005: "Launch Error 30005 (driver busy)",
      not_installed: "EAC not installed",
      start_service_1275: "Error 1275 (driver blocked by Windows security)",
      untrusted_system_file: "Untrusted system file / Error 30004",
      connection_lost: "EAC verified connection lost",
    },
    details: "Details (PIDs and full paths)",
    noPath: "Path unavailable",
  },
  steps: {
    wait_unload: {
      button: "Check unload progress",
      hint: "Give Windows 30–90 seconds to finish unloading the previous EAC kernel session.",
    },
    stop_vrchat: {
      button: "Request VRChat close",
      hint: "Ask the previous VRChat process to exit cleanly, or end VRChat.exe in Task Manager.",
    },
    quit_steam: {
      button: "Check again after quitting Steam",
      hint: "Right-click the Steam tray icon and choose Exit so Steam clears the stuck Running flag.",
    },
    terminate_residual: {
      button: "End residual launcher process",
      hint: "Ends the allowlisted user-mode launcher left behind after VRChat exited.",
    },
    official_repair: {
      button: "Run official EAC repair",
      hint: "Locates EasyAntiCheat_EOS_Setup.exe in Explorer, or verifies its Epic Games / EasyAntiCheat Oy signature and starts it via UAC when experimental recovery is enabled.",
    },
    restart_pc: {
      button: "See restart and driver steps",
      hint: "A kernel driver stuck in stop-pending can only be cleared by restarting Windows.",
    },
  },
  preLaunch: {
    title: "EAC isn't ready yet",
  },
  localTest: {
    title: "VRChat or EAC is currently active",
    body: "Easy Anti-Cheat allows only one VRChat instance at a time. Starting an SDK local test while VRChat is running or EAC is still unloading may be blocked.",
    confirm: "Start local test anyway",
  },
  experimental: {
    title: "EAC process and UAC repair recovery",
    description: "Allow ending an allowlisted user-mode EAC launcher process after VRChat exits, and launching the verified official EAC repair tool directly via Windows UAC. Never touches services, kernel drivers, or active game sessions.",
    consentTitle: "Enable experimental EAC recovery actions?",
    consentBody: "When enabled, VUA can offer to end a verified user-mode launcher left behind after VRChat closes and launch EasyAntiCheat_EOS_Setup.exe via Windows UAC after per-use confirmation. Process termination carries residual account risk; VUA never terminates active VRChat sessions or Windows services.",
    consentConfirm: "Understand and enable",
  },
  terminateConfirm: {
    title: "End residual EAC launcher process?",
    riskWarning: "Only proceed after VRChat has exited. Ending an anti-cheat bootstrapper carries residual account risk; VUA will re-verify process identity and signature right before ending it.",
    nameLabel: "Process",
    pidLabel: "PID",
    pathLabel: "Path",
    publisherLabel: "Verified publisher",
    reasonLabel: "Allowlist reason",
    confirmButton: "End process",
    succeeded: "Residual launcher process ended.",
    refused: "Refused to end process ({detail}).",
    failed: "Couldn't confirm process exit ({detail}). Check status again before launching.",
  },
  repairConfirm: {
    title: "Run official Easy Anti-Cheat repair?",
    body: "Windows will show a User Account Control (UAC) prompt for EasyAntiCheat_EOS_Setup.exe with no extra arguments.",
    publisherNote: "Before accepting UAC, confirm the verified publisher shown by Windows is EasyAntiCheat Oy / Epic Games.",
    confirmButton: "Run official repair",
    launched: "Requested official EAC repair via Windows UAC. Complete the setup window, then click Check again.",
    alreadyRunning: "Official EAC repair is already open. Finish or close that window first.",
    completed: "Official EAC repair finished (exit code {code}).",
    completedNonZero: "Official EAC repair exited with code {code} and may not have finished cleanly. Click Check again or verify game files in Steam.",
    declined: "Administrator permission was declined; nothing was changed.",
    reparseRefused: "Official repair cannot be started automatically through a folder-mounted volume or reparse path. Click Show repair tool in Explorer to run it manually.",
    activeRefused: "Close VRChat before running the official EAC repair tool.",
    failed: "Couldn't complete official EAC repair ({outcome}). You can also open the folder in Explorer and run it manually.",
  },
};

type EacCopy = {
  dialogTitle: string;
  view: string;
  launchAnyway: string;
  cancel: string;
  dismiss: string;
  refresh: string;
  openGuide: string;
  nextStep: string;
  remindWhenReady: string;
  remindArmed: string;
  openExplorer: string;
  openExplorerFailed: string;
  conclusions: { [K in keyof typeof en.conclusions]: string };
  evidence: {
    title: string;
    capturedAt: string;
    processes: string;
    processesNone: string;
    processesSummary: string;
    windowVisible: string;
    windowHidden: string;
    services: string;
    serviceAbsent: string;
    servicePresent: string;
    serviceStates: { [K in keyof typeof en.evidence.serviceStates]: string };
    steam: string;
    steamRunning: string;
    steamIdle: string;
    steamUnknown: string;
    install: string;
    installVerified: string;
    installSummary: string;
    installStates: { [K in keyof typeof en.evidence.installStates]: string };
    logs: string;
    logsNone: string;
    logWithTime: string;
    logCodes: { [K in keyof typeof en.evidence.logCodes]: string };
    details: string;
    noPath: string;
  };
  steps: { [K in keyof typeof en.steps]: { button: string; hint: string } };
  preLaunch: { title: string };
  localTest: { title: string; body: string; confirm: string };
  experimental: { [K in keyof typeof en.experimental]: string };
  terminateConfirm: { [K in keyof typeof en.terminateConfirm]: string };
  repairConfirm: { [K in keyof typeof en.repairConfirm]: string };
};

const zhCN: EacCopy = {
  dialogTitle: "Easy Anti-Cheat 状态",
  view: "查看",
  launchAnyway: "仍然启动",
  cancel: "取消",
  dismiss: "关闭",
  refresh: "重新读取",
  openGuide: "查看排障指南",
  nextStep: "下一步",
  remindWhenReady: "好了提醒我",
  remindArmed: "已在后台等待卸载完成，关闭此窗口后也会在就绪时立即弹出提醒。",
  openExplorer: "在资源管理器中定位修复程序",
  openExplorerFailed: "未在 VRChat 目录中找到 EasyAntiCheat_EOS_Setup.exe，请在 Steam 中验证游戏文件完整性。",
  conclusions: {
    ready: "EAC 已就绪。",
    session_active: "VRChat 正在运行。",
    unloading: "EAC 还在卸载上一次的运行，已等 {minutes} 分钟。卸载完成后就能启动。",
    unloading_long: "EAC 卸载卡住了。重启电脑后就能启动。",
    residual_process: "上次的 VRChat 仍在后台运行，会挡住下一次启动。",
    steam_stale: "Steam 还记着 VRChat 在运行。从托盘完全退出 Steam 后再启动。",
    not_installed: "EAC 需要重新安装。运行官方修复程序即可。",
    install_damaged: "EAC 文件缺失或签名无法校验。请运行官方修复程序，或在 Steam 中验证游戏文件完整性。",
    unknown: "暂时无法完整读取 EAC 状态，仍可正常尝试启动 VRChat。",
    ready_after_wait: "EAC 已卸载完成，可以启动了。",
  },
  evidence: {
    title: "当前观测事实",
    capturedAt: "读取于 {time}",
    processes: "进程",
    processesNone: "无运行进程",
    processesSummary: "{count} 个运行中（{names}）",
    windowVisible: "有窗口",
    windowHidden: "后台无窗口",
    services: "服务",
    serviceAbsent: "{name}：未加载",
    servicePresent: "{name}：{state}",
    serviceStates: {
      stopped: "已停止",
      start_pending: "正在启动",
      stop_pending: "正在卸载",
      running: "运行中",
      other: "暂停",
      unreadable: "无法读取",
    },
    steam: "Steam 标记",
    steamRunning: "标记为运行中（1）",
    steamIdle: "空闲（0）",
    steamUnknown: "未记录",
    install: "安装文件",
    installVerified: "目录在场 · 修复程序与服务签名已校验",
    installSummary: "目录：{folder} · 修复程序：{setup} · 服务程序：{service}",
    installStates: {
      present: "在场",
      missing: "缺失",
      verified: "签名已校验",
      unverified: "签名未通过",
      unknown: "未知",
    },
    logs: "最近日志代码",
    logsNone: "无近期 EAC 错误码",
    logWithTime: "{label}（{time}）",
    logCodes: {
      launch_error_30005: "启动错误 30005（驱动仍被占用）",
      not_installed: "EAC 未安装",
      start_service_1275: "错误 1275（Windows 安全功能拦截驱动）",
      untrusted_system_file: "系统文件不受信任 / 错误 30004",
      connection_lost: "运行中 EAC 验证连接中断",
    },
    details: "详情（PID 与完整路径）",
    noPath: "路径不可读",
  },
  steps: {
    wait_unload: {
      button: "刷新卸载进度",
      hint: "通常等待 30–90 秒，Windows 会自行完成上一次 EAC 驱动卸载。",
    },
    stop_vrchat: {
      button: "请求关闭 VRChat",
      hint: "先让上一次的 VRChat 正常退出，或在任务管理器中结束残留的 VRChat.exe。",
    },
    quit_steam: {
      button: "退出 Steam 后重查",
      hint: "右键右下角托盘里的 Steam 图标选择「退出」，清除残留的运行标记后再检查。",
    },
    terminate_residual: {
      button: "结束残留启动器进程",
      hint: "结束 VRChat 退出后遗留的白名单用户态启动器进程。",
    },
    official_repair: {
      button: "运行官方 EAC 修复程序",
      hint: "在资源管理器中定位 EasyAntiCheat_EOS_Setup.exe；开启实验恢复开关后也可校验签名并经系统 UAC 直接启动。",
    },
    restart_pc: {
      button: "查看重启与驱动说明",
      hint: "内核驱动卡在卸载态时无法从用户态强行复位，重启电脑即可恢复。",
    },
  },
  preLaunch: {
    title: "EAC 当前尚未就绪",
  },
  localTest: {
    title: "VRChat 或 EAC 仍在运行",
    body: "Easy Anti-Cheat 同一时间只允许运行一个 VRChat 实例。在 VRChat 运行或 EAC 尚未卸载完时发起 SDK 本地测试，可能会被 EAC 拦截。",
    confirm: "仍然开始本地测试",
  },
  experimental: {
    title: "EAC 进程与 UAC 修复恢复",
    description: "允许在 VRChat 退出后结束白名单内的用户态 EAC 启动器残留进程，并在逐次确认后通过系统 UAC 启动已校验签名的官方 EAC 修复程序；绝不触碰系统服务、内核驱动或正在运行的 VRChat 会话。",
    consentTitle: "开启「EAC 进程与 UAC 修复恢复」实验功能？",
    consentBody: "开启后，VUA 可在 VRChat 已退出时提供结束已校验用户态残留启动器的选项，并在逐次确认后通过 Windows UAC 启动 EasyAntiCheat_EOS_Setup.exe。结束反作弊相关进程始终存在残留账号风险；VUA 绝不会结束运行中的游戏或操作系统服务。",
    consentConfirm: "了解风险并开启",
  },
  terminateConfirm: {
    title: "确认结束残留 EAC 启动器进程？",
    riskWarning: "请确认 VRChat 已退出。结束反作弊启动器进程存在一定账号风险；VUA 会在执行前再次核对进程身份与数字签名。",
    nameLabel: "进程名",
    pidLabel: "PID",
    pathLabel: "路径",
    publisherLabel: "已校验发布者",
    reasonLabel: "白名单依据",
    confirmButton: "确认结束进程",
    succeeded: "已结束残留启动器进程。",
    refused: "已拒绝结束进程（{detail}）。",
    failed: "未能确认进程完全退出（{detail}），请重新读取状态后再启动。",
  },
  repairConfirm: {
    title: "运行官方 Easy Anti-Cheat 修复程序？",
    body: "Windows 将弹出用户账户控制（UAC）窗口，以管理员身份无参数启动 EasyAntiCheat_EOS_Setup.exe。",
    publisherNote: "同意 UAC 前，请确认系统弹窗显示的已验证发布者为 EasyAntiCheat Oy / Epic Games。",
    confirmButton: "运行官方修复",
    launched: "已通过 Windows UAC 请求启动官方 EAC 修复程序；完成修复窗口操作后请点击「重新读取」。",
    alreadyRunning: "官方 EAC 修复程序已在运行，请先完成或关闭该窗口。",
    completed: "官方 EAC 修复程序已执行完毕（退出码 {code}）。",
    completedNonZero: "官方 EAC 修复程序已退出（退出码 {code}，可能未成功完成）。请点击「重新读取」或在 Steam 中验证游戏文件完整性。",
    declined: "已取消管理员授权，未做任何修改。",
    reparseRefused: "修复程序所在目录包含挂载卷或重解析路径，无法自动提权启动。请点击「在资源管理器中定位修复程序」手动运行。",
    activeRefused: "请先关闭正在运行的 VRChat，再运行官方修复程序。",
    failed: "未能完成官方 EAC 修复（{outcome}）。你也可以在资源管理器中定位该程序并手动运行。",
  },
};

const zhTW: EacCopy = {
  dialogTitle: "Easy Anti-Cheat 狀態",
  view: "查看",
  launchAnyway: "仍然啟動",
  cancel: "取消",
  dismiss: "關閉",
  refresh: "重新讀取",
  openGuide: "查看排障指南",
  nextStep: "下一步",
  remindWhenReady: "好了提醒我",
  remindArmed: "已在背景等待卸載完成，關閉此視窗後也會在就緒時立即彈出提醒。",
  openExplorer: "在檔案總管中顯示修復程式",
  openExplorerFailed: "未在 VRChat 目錄中找到 EasyAntiCheat_EOS_Setup.exe，請在 Steam 中驗證遊戲檔案完整性。",
  conclusions: {
    ready: "EAC 已就緒。",
    session_active: "VRChat 正在執行。",
    unloading: "EAC 仍在卸載上一次的執行，已等 {minutes} 分鐘。卸載完成後就能啟動。",
    unloading_long: "EAC 卸載卡住了。重新開機後就能啟動。",
    residual_process: "上次的 VRChat 仍在背景執行，會擋住下一次啟動。",
    steam_stale: "Steam 仍記錄 VRChat 在執行。從系統匣完全結束 Steam 後再啟動。",
    not_installed: "EAC 需要重新安裝。執行官方修復程式即可。",
    install_damaged: "EAC 檔案缺失或簽章無法驗證。請執行官方修復程式，或在 Steam 中驗證遊戲檔案完整性。",
    unknown: "暫時無法完整讀取 EAC 狀態，仍可正常嘗試啟動 VRChat。",
    ready_after_wait: "EAC 已卸載完成，可以啟動了。",
  },
  evidence: {
    title: "目前觀測事實",
    capturedAt: "讀取於 {time}",
    processes: "處理程序",
    processesNone: "無執行中處理程序",
    processesSummary: "{count} 個執行中（{names}）",
    windowVisible: "有視窗",
    windowHidden: "背景無視窗",
    services: "服務",
    serviceAbsent: "{name}：未載入",
    servicePresent: "{name}：{state}",
    serviceStates: {
      stopped: "已停止",
      start_pending: "啟動中",
      stop_pending: "卸載中",
      running: "執行中",
      other: "暫停",
      unreadable: "無法讀取",
    },
    steam: "Steam 標記",
    steamRunning: "標記為執行中（1）",
    steamIdle: "閒置（0）",
    steamUnknown: "未記錄",
    install: "安裝檔案",
    installVerified: "目錄存在 · 修復程式與服務簽章已驗證",
    installSummary: "目錄：{folder} · 修復程式：{setup} · 服務程式：{service}",
    installStates: {
      present: "存在",
      missing: "缺失",
      verified: "簽章已驗證",
      unverified: "簽章未通過",
      unknown: "未知",
    },
    logs: "最近日誌代碼",
    logsNone: "無近期 EAC 錯誤碼",
    logWithTime: "{label}（{time}）",
    logCodes: {
      launch_error_30005: "啟動錯誤 30005（驅動仍被佔用）",
      not_installed: "EAC 未安裝",
      start_service_1275: "錯誤 1275（Windows 安全性阻擋驅動）",
      untrusted_system_file: "系統檔案不受信任 / 錯誤 30004",
      connection_lost: "執行期間 EAC 驗證連線中斷",
    },
    details: "詳情（PID 與完整路徑）",
    noPath: "路徑無法讀取",
  },
  steps: {
    wait_unload: {
      button: "重新整理卸載進度",
      hint: "通常等待 30–90 秒，Windows 會自行完成上一次 EAC 驅動卸載。",
    },
    stop_vrchat: {
      button: "請求關閉 VRChat",
      hint: "先讓上一次的 VRChat 正常結束，或在工作管理員中結束殘留的 VRChat.exe。",
    },
    quit_steam: {
      button: "結束 Steam 後重查",
      hint: "右鍵點擊系統匣中的 Steam 圖示選擇「結束」，清除殘留的執行標記後再檢查。",
    },
    terminate_residual: {
      button: "結束殘留啟動器處理程序",
      hint: "結束 VRChat 關閉後遺留的白名單使用者模式啟動器處理程序。",
    },
    official_repair: {
      button: "執行官方 EAC 修復程式",
      hint: "在檔案總管中顯示 EasyAntiCheat_EOS_Setup.exe；啟用實驗復原開關後也可驗證簽章並經系統 UAC 直接啟動。",
    },
    restart_pc: {
      button: "查看重新開機與驅動說明",
      hint: "核心驅動卡在卸載狀態時無法從使用者模式強制重設，重新開機即可恢復。",
    },
  },
  preLaunch: {
    title: "EAC 目前尚未就緒",
  },
  localTest: {
    title: "VRChat 或 EAC 仍在執行",
    body: "Easy Anti-Cheat 同一時間只允許執行一個 VRChat 實例。在 VRChat 執行中或 EAC 尚未卸載完成時發起 SDK 本機測試，可能會被 EAC 阻擋。",
    confirm: "仍然開始本機測試",
  },
  experimental: {
    title: "EAC 處理程序與 UAC 修復復原",
    description: "允許在 VRChat 關閉後結束白名單內的使用者模式 EAC 啟動器殘留處理程序，並在逐次確認後透過系統 UAC 啟動已驗證簽章的官方 EAC 修復程式；絕不觸碰系統服務、核心驅動或執行中的 VRChat 工作階段。",
    consentTitle: "啟用「EAC 處理程序與 UAC 修復復原」實驗功能？",
    consentBody: "啟用後，VUA 可在 VRChat 已關閉時提供結束已驗證使用者模式殘留啟動器的選項，並在逐次確認後透過 Windows UAC 啟動 EasyAntiCheat_EOS_Setup.exe。結束反作弊相關處理程序始終存在殘留帳號風險；VUA 絕不會結束執行中的遊戲或系統服務。",
    consentConfirm: "了解風險並啟用",
  },
  terminateConfirm: {
    title: "確認結束殘留 EAC 啟動器處理程序？",
    riskWarning: "請確認 VRChat 已關閉。結束反作弊啟動器處理程序存在一定帳號風險；VUA 會在執行前再次核對處理程序身分與數位簽章。",
    nameLabel: "名稱",
    pidLabel: "PID",
    pathLabel: "路徑",
    publisherLabel: "已驗證發行者",
    reasonLabel: "白名單依據",
    confirmButton: "確認結束",
    succeeded: "已結束殘留啟動器處理程序。",
    refused: "已拒絕結束處理程序（{detail}）。",
    failed: "未能確認處理程序完全結束（{detail}），請重新讀取狀態後再啟動。",
  },
  repairConfirm: {
    title: "執行官方 Easy Anti-Cheat 修復程式？",
    body: "Windows 將顯示使用者帳戶控制（UAC）提示，以系統管理員身分無參數啟動 EasyAntiCheat_EOS_Setup.exe。",
    publisherNote: "同意 UAC 前，請確認系統視窗顯示的已驗證發行者為 EasyAntiCheat Oy / Epic Games。",
    confirmButton: "執行官方修復",
    launched: "已透過 Windows UAC 請求啟動官方 EAC 修復程式；完成修復視窗操作後請點擊「重新讀取」。",
    alreadyRunning: "官方 EAC 修復程式已在執行，請先完成或關閉該視窗。",
    completed: "官方 EAC 修復程式已執行完畢（結束代碼 {code}）。",
    completedNonZero: "官方 EAC 修復程式已結束（結束代碼 {code}，可能未順利完成）。請點擊「重新讀取」或在 Steam 中驗證遊戲檔案完整性。",
    declined: "已取消系統管理員授權，未進行任何變更。",
    reparseRefused: "修復程式所在路徑包含掛載磁碟區或重新解析點，無法自動提權啟動。請點擊「在檔案總管中顯示修復程式」手動執行。",
    activeRefused: "請先關閉執行中的 VRChat，再執行官方修復程式。",
    failed: "未能完成官方 EAC 修復（{outcome}）。你也可以在檔案總管中顯示該程式並手動執行。",
  },
};

const ja: EacCopy = {
  dialogTitle: "Easy Anti-Cheat の状態",
  view: "確認",
  launchAnyway: "そのまま起動",
  cancel: "キャンセル",
  dismiss: "閉じる",
  refresh: "再確認",
  openGuide: "対処ガイドを見る",
  nextStep: "次の手順",
  remindWhenReady: "完了したら知らせる",
  remindArmed: "バックグラウンドで終了処理を待っています。このウィンドウを閉じても完了しだい通知します。",
  openExplorer: "エクスプローラーで修復ツールを表示",
  openExplorerFailed: "VRChat フォルダーに EasyAntiCheat_EOS_Setup.exe が見つかりません。Steam でゲームファイルの整合性を確認してください。",
  conclusions: {
    ready: "EAC の準備ができています。",
    session_active: "VRChat は起動中です。",
    unloading: "EAC が前回の終了処理を続けています（{minutes} 分経過）。終わると起動できます。",
    unloading_long: "EAC の終了処理が止まっています。PC を再起動すると起動できます。",
    residual_process: "前回の VRChat がバックグラウンドで動いたままで、次の起動を妨げます。",
    steam_stale: "Steam が VRChat を実行中のままにしています。トレイから Steam を完全に終了してから起動してください。",
    not_installed: "EAC の再インストールが必要です。公式の修復ツールを実行してください。",
    install_damaged: "EAC ファイルが不足しているか署名を検証できません。公式の修復ツールを実行するか、Steam で整合性を確認してください。",
    unknown: "EAC の状態をすべて読み取れませんでした。そのまま VRChat の起動を試せます。",
    ready_after_wait: "EAC の終了処理が完了しました。起動できます。",
  },
  evidence: {
    title: "確認された事実",
    capturedAt: "{time} に取得",
    processes: "プロセス",
    processesNone: "実行中のプロセスなし",
    processesSummary: "{count} 件実行中（{names}）",
    windowVisible: "ウィンドウあり",
    windowHidden: "バックグラウンド",
    services: "サービス",
    serviceAbsent: "{name}：未読み込み",
    servicePresent: "{name}：{state}",
    serviceStates: {
      stopped: "停止",
      start_pending: "開始中",
      stop_pending: "終了処理中",
      running: "実行中",
      other: "一時停止",
      unreadable: "読み取り不可",
    },
    steam: "Steam フラグ",
    steamRunning: "実行中として記録（1）",
    steamIdle: "待機（0）",
    steamUnknown: "未設定",
    install: "導入ファイル",
    installVerified: "フォルダーあり・修復ツールとサービスの署名を確認済み",
    installSummary: "フォルダー：{folder} · 修復ツール：{setup} · サービス：{service}",
    installStates: {
      present: "あり",
      missing: "なし",
      verified: "署名確認済み",
      unverified: "署名未確認",
      unknown: "不明",
    },
    logs: "最近のログコード",
    logsNone: "最近の EAC エラーコードなし",
    logWithTime: "{label}（{time}）",
    logCodes: {
      launch_error_30005: "起動エラー 30005（ドライバー使用中）",
      not_installed: "EAC 未インストール",
      start_service_1275: "エラー 1275（Windows セキュリティによるブロック）",
      untrusted_system_file: "信頼されないシステムファイル / エラー 30004",
      connection_lost: "EAC 認証接続の切断",
    },
    details: "詳細（PID とフルパス）",
    noPath: "パスを取得できません",
  },
  steps: {
    wait_unload: {
      button: "終了処理を再確認",
      hint: "通常 30〜90 秒待つと、前回の EAC ドライバーの終了処理が完了します。",
    },
    stop_vrchat: {
      button: "VRChat の終了を要求",
      hint: "前回の VRChat を通常終了させるか、タスクマネージャーから VRChat.exe を終了してください。",
    },
    quit_steam: {
      button: "Steam 終了後に再確認",
      hint: "タスクトレイの Steam アイコンを右クリックして「終了」を選び、実行中フラグを消してから再確認します。",
    },
    terminate_residual: {
      button: "残留ランチャーを終了",
      hint: "VRChat 終了後に残った許可リスト対象のユーザーモード起動プロセスを終了します。",
    },
    official_repair: {
      button: "公式 EAC 修復ツールを実行",
      hint: "エクスプローラーで EasyAntiCheat_EOS_Setup.exe を表示するか、実験機能を有効にしている場合は署名を検証して UAC 経由で起動します。",
    },
    restart_pc: {
      button: "再起動と対処手順を見る",
      hint: "カーネルドライバーが停止待ちで固まった場合は、PC の再起動で解消できます。",
    },
  },
  preLaunch: {
    title: "EAC の準備がまだ完了していません",
  },
  localTest: {
    title: "VRChat または EAC が動作中です",
    body: "Easy Anti-Cheat は同時に 1 つの VRChat インスタンスしか許可しません。VRChat 実行中や EAC の終了処理中にローカルテストを始めるとブロックされる場合があります。",
    confirm: "そのままローカルテストを開始",
  },
  experimental: {
    title: "EAC プロセス終了と UAC 修復起動",
    description: "VRChat 終了後に残った許可リスト対象のユーザーモード EAC ランチャーの終了と、検証済み公式 EAC 修復ツールの UAC 起動を許可します。サービスやカーネルドライバー、実行中のゲームは操作しません。",
    consentTitle: "実験機能「EAC プロセス終了と UAC 修復起動」を有効にしますか？",
    consentBody: "有効にすると、VRChat 終了後に残った検証済みユーザーモードランチャーの終了や、都度確認のうえでの EasyAntiCheat_EOS_Setup.exe の UAC 起動を利用できます。アンチチート関連プロセスの終了には常にアカウント上のリスクが伴います。実行中の VRChat や Windows サービスは一切終了しません。",
    consentConfirm: "リスクを理解して有効化",
  },
  terminateConfirm: {
    title: "残留している EAC ランチャーを終了しますか？",
    riskWarning: "VRChat が終了していることを確認してください。アンチチート起動プロセスの終了にはリスクが伴います。実行直前にも署名とプロセス識別情報を再検証します。",
    nameLabel: "プロセス名",
    pidLabel: "PID",
    pathLabel: "パス",
    publisherLabel: "確認済み発行元",
    reasonLabel: "許可理由",
    confirmButton: "プロセスを終了",
    succeeded: "残留ランチャープロセスを終了しました。",
    refused: "プロセスの終了を見送りました（{detail}）。",
    failed: "プロセスの終了を確認できませんでした（{detail}）。状態を再確認してから起動してください。",
  },
  repairConfirm: {
    title: "公式の Easy Anti-Cheat 修復ツールを実行しますか？",
    body: "Windows のユーザーアカウント制御（UAC）が表示され、引数なしで EasyAntiCheat_EOS_Setup.exe を起動します。",
    publisherNote: "UAC を承認する前に、確認済み発行元が EasyAntiCheat Oy / Epic Games であることを確認してください。",
    confirmButton: "公式修復を実行",
    launched: "Windows UAC 経由で公式 EAC 修復ツールを起動しました。修復完了後に「再確認」を押してください。",
    alreadyRunning: "公式 EAC 修復ツールは既に開いています。先にそのウィンドウを完了または閉じてください。",
    completed: "公式 EAC 修復ツールが完了しました（終了コード {code}）。",
    completedNonZero: "公式 EAC 修復ツールが終了コード {code} で終了しました。正常に完了していない可能性があるため、「再確認」を押すか Steam で整合性を確認してください。",
    declined: "管理者権限の承認がキャンセルされたため、変更は行われませんでした。",
    reparseRefused: "フォルダーマウントされたボリュームまたは再解析ポイント上のパスのため自動起動できません。「エクスプローラーで修復ツールを表示」から手動で実行してください。",
    activeRefused: "公式修復ツールを実行する前に VRChat を終了してください。",
    failed: "公式 EAC 修復を完了できませんでした（{outcome}）。エクスプローラーで開いて手動実行することもできます。",
  },
};

const ko: EacCopy = {
  dialogTitle: "Easy Anti-Cheat 상태",
  view: "보기",
  launchAnyway: "그대로 실행",
  cancel: "취소",
  dismiss: "닫기",
  refresh: "다시 확인",
  openGuide: "해결 가이드 보기",
  nextStep: "다음 단계",
  remindWhenReady: "준비되면 알려주기",
  remindArmed: "백그라운드에서 정리가 끝나기를 기다리고 있어요. 이 창을 닫아도 준비되면 바로 알려드릴게요.",
  openExplorer: "탐색기에서 복구 프로그램 보기",
  openExplorerFailed: "VRChat 폴더에서 EasyAntiCheat_EOS_Setup.exe를 찾지 못했어요. Steam에서 게임 파일 무결성을 확인해 주세요.",
  conclusions: {
    ready: "EAC가 준비되었어요.",
    session_active: "VRChat이 실행 중이에요.",
    unloading: "EAC가 지난 실행을 정리하고 있어요({minutes}분째). 끝나면 실행할 수 있어요.",
    unloading_long: "EAC 정리가 멈췄어요. PC를 다시 시작하면 실행할 수 있어요.",
    residual_process: "지난 VRChat이 아직 백그라운드에서 실행 중이라 다음 실행을 막고 있어요.",
    steam_stale: "Steam이 VRChat을 아직 실행 중으로 표시해요. 트레이에서 Steam을 완전히 종료한 뒤 다시 실행해 주세요.",
    not_installed: "EAC를 다시 설치해야 해요. 공식 복구 프로그램을 실행해 주세요.",
    install_damaged: "EAC 파일이 없거나 서명을 확인할 수 없어요. 공식 복구 프로그램을 실행하거나 Steam에서 파일 무결성을 확인해 주세요.",
    unknown: "지금은 EAC 상태를 모두 읽지 못했어요. 그대로 VRChat 실행을 시도할 수 있어요.",
    ready_after_wait: "EAC 정리가 끝났어요. 이제 실행할 수 있어요.",
  },
  evidence: {
    title: "확인된 상태",
    capturedAt: "{time} 기준",
    processes: "프로세스",
    processesNone: "실행 중인 프로세스 없음",
    processesSummary: "{count}개 실행 중({names})",
    windowVisible: "창 열림",
    windowHidden: "백그라운드",
    services: "서비스",
    serviceAbsent: "{name}: 로드 안 됨",
    servicePresent: "{name}: {state}",
    serviceStates: {
      stopped: "중지됨",
      start_pending: "시작 중",
      stop_pending: "정리 중",
      running: "실행 중",
      other: "일시 중지",
      unreadable: "읽기 불가",
    },
    steam: "Steam 표시",
    steamRunning: "실행 중으로 표시됨(1)",
    steamIdle: "대기(0)",
    steamUnknown: "기록 없음",
    install: "설치 파일",
    installVerified: "폴더 있음 · 복구 도구 및 서비스 서명 확인됨",
    installSummary: "폴더: {folder} · 복구 도구: {setup} · 서비스: {service}",
    installStates: {
      present: "있음",
      missing: "없음",
      verified: "서명 확인됨",
      unverified: "서명 미확인",
      unknown: "알 수 없음",
    },
    logs: "최근 로그 코드",
    logsNone: "최근 EAC 오류 코드 없음",
    logWithTime: "{label}({time})",
    logCodes: {
      launch_error_30005: "실행 오류 30005(드라이버 사용 중)",
      not_installed: "EAC 미설치",
      start_service_1275: "오류 1275(Windows 보안 기능으로 드라이버 차단)",
      untrusted_system_file: "신뢰할 수 없는 시스템 파일 / 오류 30004",
      connection_lost: "EAC 인증 연결 끊김",
    },
    details: "자세히(PID 및 전체 경로)",
    noPath: "경로를 읽을 수 없음",
  },
  steps: {
    wait_unload: {
      button: "정리 상태 다시 확인",
      hint: "보통 30~90초 정도 기다리면 이전 EAC 드라이버 정리가 끝나요.",
    },
    stop_vrchat: {
      button: "VRChat 종료 요청",
      hint: "이전 VRChat이 정상 종료되도록 기다리거나 작업 관리자에서 VRChat.exe를 종료해 주세요.",
    },
    quit_steam: {
      button: "Steam 종료 후 다시 확인",
      hint: "트레이의 Steam 아이콘을 우클릭해 완전히 종료한 뒤 다시 확인해 주세요.",
    },
    terminate_residual: {
      button: "남은 런처 프로세스 종료",
      hint: "VRChat이 닫힌 뒤 남은 허용 목록 사용자 모드 런처 프로세스를 종료해요.",
    },
    official_repair: {
      button: "공식 EAC 복구 프로그램 실행",
      hint: "탐색기에서 EasyAntiCheat_EOS_Setup.exe 위치를 열거나, 실험 복구 기능을 켠 경우 서명을 확인한 뒤 UAC로 바로 실행해요.",
    },
    restart_pc: {
      button: "다시 시작 및 드라이버 안내 보기",
      hint: "커널 드라이버가 정리 중 상태에서 멈춘 경우 PC를 다시 시작하면 해결돼요.",
    },
  },
  preLaunch: {
    title: "EAC가 아직 준비되지 않았어요",
  },
  localTest: {
    title: "VRChat 또는 EAC가 아직 실행 중이에요",
    body: "Easy Anti-Cheat는 한 번에 하나의 VRChat 인스턴스만 허용해요. VRChat이 켜져 있거나 EAC가 정리 중일 때 SDK 로컬 테스트를 시작하면 차단될 수 있어요.",
    confirm: "그대로 로컬 테스트 시작",
  },
  experimental: {
    title: "EAC 프로세스 종료 및 UAC 복구 실행",
    description: "VRChat 종료 후 남은 허용 목록 사용자 모드 EAC 런처 프로세스 종료와 검증된 공식 EAC 복구 도구의 Windows UAC 실행을 허용해요. 서비스, 커널 드라이버, 실행 중인 게임 세션은 건드리지 않아요.",
    consentTitle: "실험 기능 'EAC 프로세스 종료 및 UAC 복구 실행'을 켤까요?",
    consentBody: "켜 두면 VRChat 종료 후 백그라운드에 남은 검증된 사용자 모드 런처를 종료하거나, 매번 확인을 거쳐 EasyAntiCheat_EOS_Setup.exe를 UAC로 실행할 수 있어요. 안티치트 관련 프로세스 종료에는 항상 계정 위험이 따르며, 실행 중인 VRChat이나 Windows 서비스는 절대 종료하지 않아요.",
    consentConfirm: "위험을 이해하고 켜기",
  },
  terminateConfirm: {
    title: "남아 있는 EAC 런처 프로세스를 종료할까요?",
    riskWarning: "VRChat이 종료되었는지 확인해 주세요. 안티치트 런처 종료에는 계정 위험이 따르며, 종료 직전에 프로세스 정보와 디지털 서명을 다시 확인해요.",
    nameLabel: "프로세스",
    pidLabel: "PID",
    pathLabel: "경로",
    publisherLabel: "확인된 게시자",
    reasonLabel: "허용 근거",
    confirmButton: "프로세스 종료",
    succeeded: "남은 런처 프로세스를 종료했어요.",
    refused: "프로세스 종료를 거부했어요({detail}).",
    failed: "프로세스 종료를 확인하지 못했어요({detail}). 상태를 다시 확인한 뒤 실행해 주세요.",
  },
  repairConfirm: {
    title: "공식 Easy Anti-Cheat 복구 프로그램을 실행할까요?",
    body: "Windows 사용자 계정 컨트롤(UAC) 창이 표시되며 추가 인자 없이 EasyAntiCheat_EOS_Setup.exe를 실행해요.",
    publisherNote: "UAC를 허용하기 전에 확인된 게시자가 EasyAntiCheat Oy / Epic Games인지 확인해 주세요.",
    confirmButton: "공식 복구 실행",
    launched: "Windows UAC를 통해 공식 EAC 복구 프로그램 실행을 요청했어요. 복구를 마친 뒤 '다시 확인'을 눌러 주세요.",
    alreadyRunning: "공식 EAC 복구 프로그램이 이미 열려 있어요. 먼저 해당 창을 마치거나 닫아 주세요.",
    completed: "공식 EAC 복구 프로그램이 완료되었어요(종료 코드 {code}).",
    completedNonZero: "공식 EAC 복구 프로그램이 종료 코드 {code}(으)로 끝났어요. 정상 완료되지 않았을 수 있으니 '다시 확인'을 누르거나 Steam에서 파일 무결성을 확인해 주세요.",
    declined: "관리자 권한 요청이 취소되어 변경된 내용이 없어요.",
    reparseRefused: "폴더에 연결된 볼륨이나 재분석 지점 경로여서 자동으로 실행할 수 없어요. '탐색기에서 복구 프로그램 보기'를 눌러 직접 실행해 주세요.",
    activeRefused: "공식 복구 프로그램을 실행하기 전에 실행 중인 VRChat을 먼저 닫아 주세요.",
    failed: "공식 EAC 복구를 마치지 못했어요({outcome}). 탐색기에서 폴더를 열어 직접 실행할 수도 있어요.",
  },
};

export const eacCopy = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
};
