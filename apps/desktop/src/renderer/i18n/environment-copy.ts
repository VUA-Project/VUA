const en = {
  close: "Close",
  network: "Network", details: "See what's included in {name}", prepare: "Set up {name}", start: "Start {name}", stop: "Close apps started by {name}",
  inspect: "Check again", checking: "Checking…", installing: "Setting up…", ready: "Ready", missing: "Missing software", starting: "Starting…", running: "Running", stopping: "Closing…", attention: "Needs attention", unknown: "Couldn't check",
  included: "Includes", install: "Install or repair", launch: "Launch environment", closeHint: "Only closes apps started from this card",
  runningHint: "Running now. Complete sign-in and headset pairing inside each app.", borrowed: "Already running (kept open)", owned: "Started from this card", stopped: "Not running",
  runtime: "Other VR runtimes & tools",
  editors: "Unity Editors", managers: "Unity Hub & package managers", installed: "Detected", notFound: "Not found in standard paths", configFound: "Config detected", configMissing: "No config found", configFailed: "Couldn't read config",
  otherEditor: "Installed on this PC. Avatar builds use Unity 2022.3.22f1 or 2022.3.22f1c1.", paths: "Detected paths", inventoryUnknown: "Couldn't scan installed Unity Editors right now.", official: "Open official page", choose2022: "Set up Unity 2022", connection: "Connect PICO", closeDetails: "Hide details",
  issues: { close_pending: "Stopped launching further apps, though Steam may still have a launch queued—cancel it in Steam if needed.", not_installed: "Required software is missing or incomplete. Check the setup plan.", other_route_active: "Another Play card is currently using this software. Close that session first.", start_failed: "Launch didn't complete. Check the app window, or close this session and try again.", start_timeout: "Still waiting for the app to finish starting. Check Steam sign-in, active downloads, or pop-up dialogs; if you stop here, cancel any queued launch in Steam too.", close_failed: "Some apps stayed open. Quit them directly from their window or tray icon.", close_timeout: "Some apps are still running after the close request. Quit them from their window or tray icon." },
  eacAttribution: {
    start_timeout: "EAC check: {reason}",
    close_failed: "EAC / VRChat is still running ({reason}) and will block the next launch until closed.",
    close_timeout: "EAC / VRChat is still running ({reason}) and will block the next launch until closed.",
  },
};
type Copy = { [K in keyof typeof en]: typeof en[K] extends string ? string : { [P in keyof typeof en[K]]: string } };
const zh: Copy = {
  close: "关闭",
  network: "网络检测", details: "查看{name}包含的软件", prepare: "准备{name}", start: "启动{name}", stop: "关闭本次启动的{name}",
  inspect: "重新检测", checking: "正在检测…", installing: "正在准备…", ready: "已就绪", missing: "缺少软件", starting: "正在启动…", running: "运行中", stopping: "正在关闭…", attention: "需要处理", unknown: "暂未确认",
  included: "包含软件", install: "安装或修复", launch: "启动环境", closeHint: "只会关闭本次由该卡片启动的软件",
  runningHint: "软件已在运行，请在对应软件窗口内完成登录与头显连接。", borrowed: "原本已在运行，关闭时保留", owned: "本次由本卡启动", stopped: "未运行",
  runtime: "其他 VR 软件",
  editors: "Unity 编辑器", managers: "Unity Hub 与包管理器", installed: "已检测到", notFound: "未在常用路径中找到", configFound: "已找到配置文件", configMissing: "未找到配置文件", configFailed: "配置文件读取失败",
  otherEditor: "已检测到该版本；当前改模流程使用 Unity 2022.3.22f1 或 2022.3.22f1c1。", paths: "检测到的路径", inventoryUnknown: "暂时无法读取本机已安装的编辑器。", official: "打开官方页面", choose2022: "准备 Unity 2022", connection: "连接 PICO", closeDetails: "收起详情",
  issues: { close_pending: "已停止后续启动请求；如果 Steam 里还挂着待启动提示，请在 Steam 中手动取消。", not_installed: "缺少必要软件或安装不完整，请查看安装计划。", other_route_active: "另一张游玩卡片正在使用这套软件，请先关闭那边的启动会话。", start_failed: "启动未能完成，请查看对应软件窗口，或关闭本次启动后重试。", start_timeout: "等待软件启动超时。请检查 Steam 是否已登录、有无正在下载的更新或确认弹窗；若在此停止，也请顺手取消 Steam 里挂起的启动项。", close_failed: "部分软件未能自动关闭，请直接从软件菜单或托盘退出。", close_timeout: "发送关闭请求后仍有软件在运行，请从软件菜单或系统托盘手动退出。" },
  eacAttribution: {
    start_timeout: "EAC 原因：{reason}",
    close_failed: "检测到 EAC 或 VRChat 仍在占用（{reason}），退出前会挡住下一次启动。",
    close_timeout: "检测到 EAC 或 VRChat 仍在占用（{reason}），退出前会挡住下一次启动。",
  },
};
const zhTW: Copy = {
  close: "關閉",
  network: "網路測試", details: "查看{name}包含的軟體", prepare: "準備{name}", start: "啟動{name}", stop: "關閉本次啟動的{name}",
  inspect: "重新偵測", checking: "正在偵測…", installing: "正在準備…", ready: "已就緒", missing: "缺少軟體", starting: "正在啟動…", running: "執行中", stopping: "正在關閉…", attention: "需要處理", unknown: "尚未確認",
  included: "包含軟體", install: "安裝或修復", launch: "啟動環境", closeHint: "只會關閉這張卡片啟動的軟體",
  runningHint: "軟體已在執行，請在各軟體視窗中完成登入與頭顯連線。", borrowed: "原本已在執行，將保留開啟", owned: "由本卡啟動", stopped: "未執行",
  runtime: "其他 VR 軟體",
  editors: "Unity 編輯器", managers: "Unity Hub 與套件管理工具", installed: "已偵測到", notFound: "未在常見路徑找到", configFound: "已找到設定檔", configMissing: "未找到設定檔", configFailed: "無法讀取設定檔",
  otherEditor: "已偵測到此版本；目前改模流程使用 Unity 2022.3.22f1 或 2022.3.22f1c1。", paths: "偵測到的路徑", inventoryUnknown: "目前無法偵測已安裝的編輯器。", official: "開啟官方頁面", choose2022: "準備 Unity 2022", connection: "連接 PICO", closeDetails: "收合詳情",
  issues: { close_pending: "已停止後續啟動請求；若 Steam 內仍有等待中的啟動項目，請到 Steam 中取消。", not_installed: "缺少必要軟體或安裝不完整，請查看準備計畫。", other_route_active: "另一張遊玩卡片正在使用這組軟體，請先關閉該卡片的啟動工作階段。", start_failed: "啟動未完成，請檢查對應軟體視窗，或關閉本次啟動後重試。", start_timeout: "等待軟體啟動逾時。請檢查 Steam 登入狀態、下載進度與彈出視窗；若在此停止，也請一併取消 Steam 中等待啟動的項目。", close_failed: "部分軟體未能關閉而仍在執行，請從該軟體選單或系統匣手動結束。", close_timeout: "送出關閉請求後仍有部分軟體在執行，請從該軟體選單或系統匣手動結束。" },
  eacAttribution: {
    start_timeout: "EAC 原因：{reason}",
    close_failed: "偵測到 EAC 或 VRChat 仍在佔用（{reason}），結束前會擋住下一次啟動。",
    close_timeout: "偵測到 EAC 或 VRChat 仍在佔用（{reason}），結束前會擋住下一次啟動。",
  },
};
const ja: Copy = {
  close: "閉じる",
  network: "通信テスト", details: "{name}に含まれるソフトを見る", prepare: "{name}を準備", start: "{name}を起動", stop: "{name}で起動したソフトを閉じる",
  inspect: "再確認", checking: "確認中…", installing: "準備中…", ready: "準備完了", missing: "ソフト不足", starting: "起動中…", running: "起動中", stopping: "終了中…", attention: "要確認", unknown: "未確認",
  included: "含まれるソフト", install: "導入・修復", launch: "環境を起動", closeHint: "このカードから起動したソフトだけを閉じます",
  runningHint: "起動中です。ログインやヘッドセットの接続は各アプリ側で行ってください。", borrowed: "元から起動中（維持）", owned: "このカードで起動", stopped: "停止中",
  runtime: "その他の VR ソフト",
  editors: "Unity エディター", managers: "Unity Hub・パッケージ管理", installed: "検出済み", notFound: "標準パスでは未検出", configFound: "設定あり", configMissing: "設定なし", configFailed: "設定を読み取れません",
  otherEditor: "導入済みですが、アバター制作では Unity 2022.3.22f1 または 2022.3.22f1c1 を使用します。", paths: "検出された場所", inventoryUnknown: "現在エディターの導入状況を確認できません。", official: "公式ページを開く", choose2022: "Unity 2022 を準備", connection: "PICO を接続", closeDetails: "詳細を閉じる",
  issues: { close_pending: "後続の起動を止めました。Steam 側に起動待ちが残っている場合は Steam でキャンセルしてください。", not_installed: "必要なソフトが未導入か不完全です。準備計画を確認してください。", other_route_active: "別のプレイカードがこのソフトを使用中です。先にそちらを閉じてください。", start_failed: "起動が完了しませんでした。該当アプリを確認するか、いったん閉じて再試行してください。", start_timeout: "ソフトの起動を待っています。Steam のログイン状態・ダウンロード・確認ダイアログを見てください。ここで止める場合は Steam 側の起動待ちもキャンセルしてください。", close_failed: "一部のソフトが終了せず動いています。アプリ側のメニューやトレイから終了してください。", close_timeout: "終了リクエスト後も一部のソフトが動いています。アプリ側のメニューやトレイから終了してください。" },
  eacAttribution: {
    start_timeout: "EAC の確認：{reason}",
    close_failed: "EAC または VRChat が動作中のままです（{reason}）。終了するまで次の起動を妨げます。",
    close_timeout: "EAC または VRChat が動作中のままです（{reason}）。終了するまで次の起動を妨げます。",
  },
};
const ko: Copy = {
  close: "닫기",
  network: "네트워크 점검", details: "{name} 구성 프로그램 보기", prepare: "{name} 준비", start: "{name} 실행", stop: "{name}에서 실행한 앱 닫기",
  inspect: "다시 확인", checking: "확인 중…", installing: "준비 중…", ready: "준비 완료", missing: "설치 필요", starting: "실행 중…", running: "실행 중", stopping: "종료 중…", attention: "확인 필요", unknown: "확인 불가",
  included: "포함된 프로그램", install: "설치 또는 복구", launch: "환경 실행", closeHint: "이 카드에서 켠 프로그램만 닫아요",
  runningHint: "실행 중이에요. 로그인과 헤드셋 연결은 각 프로그램 창에서 진행해 주세요.", borrowed: "원래 켜져 있었음(유지)", owned: "이 카드에서 실행함", stopped: "꺼져 있음",
  runtime: "기타 VR 소프트웨어",
  editors: "Unity 에디터", managers: "Unity Hub 및 패키지 관리자", installed: "감지됨", notFound: "기본 경로에 없음", configFound: "설정 확인됨", configMissing: "설정 없음", configFailed: "설정을 읽지 못함",
  otherEditor: "설치되어 있지만, 아바타 제작에는 Unity 2022.3.22f1 또는 2022.3.22f1c1을 사용해요.", paths: "감지된 경로", inventoryUnknown: "지금은 설치된 에디터를 확인할 수 없어요.", official: "공식 페이지 열기", choose2022: "Unity 2022 준비", connection: "PICO 연결", closeDetails: "상세 접기",
  issues: { close_pending: "추가 실행 요청은 멈췄어요. Steam에 대기 중인 실행이 남아 있다면 Steam에서도 취소해 주세요.", not_installed: "필요한 프로그램이 없거나 설치가 덜 끝났어요. 준비 계획을 확인해 주세요.", other_route_active: "다른 플레이 카드에서 이 프로그램을 사용 중이에요. 먼저 그쪽 실행을 닫아 주세요.", start_failed: "실행을 마치지 못했어요. 해당 프로그램 창을 확인하거나 닫고 다시 시도해 주세요.", start_timeout: "프로그램이 켜지기를 기다리고 있어요. Steam 로그인, 업데이트 다운로드, 팝업 창을 확인해 주세요. 여기서 멈추면 Steam에 대기 중인 실행도 함께 취소해 주세요.", close_failed: "일부 프로그램이 닫히지 않고 켜져 있어요. 프로그램 메뉴나 시스템 트레이에서 직접 종료해 주세요.", close_timeout: "종료 요청 후에도 일부 프로그램이 실행 중이에요. 프로그램 메뉴나 트레이에서 직접 종료해 주세요." },
  eacAttribution: {
    start_timeout: "EAC 확인: {reason}",
    close_failed: "EAC 또는 VRChat이 아직 남아 있어({reason}) 종료하기 전까지 다음 실행을 막아요.",
    close_timeout: "EAC 또는 VRChat이 아직 남아 있어({reason}) 종료하기 전까지 다음 실행을 막아요.",
  },
};
export const environmentCopy = { en, "zh-CN": zh, "zh-TW": zhTW, ja, ko };
