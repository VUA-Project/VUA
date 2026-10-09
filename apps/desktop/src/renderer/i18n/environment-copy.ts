const en = {
  close: "Close",
  network: "Network", details: "See what's included in {name}", prepare: "Prepare {name}", start: "Start {name}", stop: "Close this session of {name}",
  inspect: "Check again", checking: "Checking…", installing: "Preparing…", ready: "Ready", missing: "Needs software", starting: "Starting…", running: "Running", stopping: "Closing…", attention: "Needs attention", unknown: "Not confirmed",
  included: "Included software", install: "Prepare or repair", launch: "Start this environment", closeHint: "Only software started by this card will receive a close request. Software already running stays open.",
  runningHint: "Software is running. Complete any login or headset connection in the official apps.", borrowed: "Already running — kept open", owned: "Started by this card", stopped: "Not running",
  runtime: "Other VR software", runtimeHint: "These are detected software facts. Choose the environment for your headset above.",
  editors: "Unity editors", managers: "Hub and package managers", installed: "Detected", notFound: "Not found in known locations", configFound: "Configuration found", configMissing: "No configuration found", configFailed: "Configuration could not be read",
  managerHint: "Software and configuration are detected separately. Portable or custom installations may not be found here.", otherEditor: "This version is installed. The current Avatar preparation path uses Unity 2022.3.22f1 or 2022.3.22f1c1.", paths: "Detected locations", noEditors: "No other complete editor installations were found.", inventoryUnknown: "Editor detection is unavailable. Existing installations have not been ruled out.", official: "Open official page", choose2022: "Prepare Unity 2022", connection: "Connect your PICO", closeDetails: "Close details",
  issues: { close_pending: "Steam may still have a queued launch. Cancel it in Steam; VUA has stopped sending new launch requests.", not_installed: "Some required software is missing or incomplete. Open the preparation plan.", other_route_active: "The other play card has an active session. Close that session first.", start_failed: "Startup did not finish. Check the official apps; you can close this card's session and try again.", start_timeout: "Still waiting for an app. Check Steam login, downloads and any open prompts. Cancel a queued launch in Steam if you stop here.", close_failed: "Some software could not be closed. It has been left running. You can close it in its own app.", close_timeout: "Some software is still running after the close request. It has been left open; you can exit it in its own app." },
};
type Copy = { [K in keyof typeof en]: typeof en[K] extends string ? string : { [P in keyof typeof en[K]]: string } };
const zh: Copy = {
  close: "关闭",
  network: "网络测试", details: "查看{name}包含的内容", prepare: "准备{name}", start: "启动{name}", stop: "关闭{name}的本次启动",
  inspect: "重新检测", checking: "正在检测…", installing: "正在准备…", ready: "已准备好", missing: "还缺软件", starting: "正在启动…", running: "运行中", stopping: "正在关闭…", attention: "需要处理", unknown: "尚未确认",
  included: "这套环境包含", install: "安装或修复", launch: "启动这套环境", closeHint: "只尝试关闭这张卡本次启动的软件；点击前已在运行的软件会保留。",
  runningHint: "软件已运行。登录和头显连接请在对应软件中完成。", borrowed: "原本就在运行，会保留", owned: "由这张卡启动", stopped: "未运行",
  runtime: "其他 VR 软件", runtimeHint: "这里显示检测到的软件；请在上方选择与你的头显对应的环境。",
  editors: "Unity 编辑器", managers: "Hub 与包管理器", installed: "已检测到", notFound: "未在常用位置找到", configFound: "配置已找到", configMissing: "未找到配置", configFailed: "配置读取失败",
  managerHint: "软件和配置分开检测。便携版或自定义位置的安装可能不会出现在这里。", otherEditor: "已找到这个版本。当前 Avatar 准备路线使用 Unity 2022.3.22f1 或 2022.3.22f1c1。", paths: "检测到的位置", noEditors: "未找到其他完整的编辑器安装。", inventoryUnknown: "暂时无法检测编辑器，不能据此认定没有安装。", official: "打开官方页面", choose2022: "准备 Unity 2022", connection: "连接你的 PICO", closeDetails: "收起详情",
  issues: { close_pending: "Steam 的启动交接可能还在等待。请在 Steam 中取消；VUA 已停止发送后续启动请求。", not_installed: "还缺少必要软件，或安装不完整。请打开准备计划。", other_route_active: "另一张游玩卡片正在使用这套软件，请先关闭那张卡的本次启动。", start_failed: "启动没有完成。请查看对应软件；可以先关闭这张卡的本次启动，再重试。", start_timeout: "还在等待软件启动。请查看 Steam 登录、下载和弹出的提示；如果在这里停止，也请在 Steam 中取消等待中的启动。", close_failed: "部分软件未能关闭，已保留运行。你可以到软件自己的菜单里退出。", close_timeout: "发出关闭请求后，部分软件仍在运行，已保留。你可以到软件自己的菜单里退出。" },
};
const ja: Copy = {
  close: "閉じる",
  network: "ネットワーク", details: "{name}の内容を見る", prepare: "{name}を準備", start: "{name}を起動", stop: "{name}の今回の起動を閉じる",
  inspect: "再確認", checking: "確認中…", installing: "準備中…", ready: "準備完了", missing: "ソフトウェアが必要", starting: "起動中…", running: "実行中", stopping: "終了を要求中…", attention: "対応が必要", unknown: "未確認",
  included: "含まれるソフトウェア", install: "インストール・修復", launch: "この環境を起動", closeHint: "このカードで起動したソフトウェアだけに終了を要求します。元から実行中のものは残します。",
  runningHint: "ソフトウェアは実行中です。ログインやヘッドセット接続は各公式アプリで完了してください。", borrowed: "元から実行中・終了しません", owned: "このカードで起動", stopped: "実行していません",
  runtime: "その他の VR ソフトウェア", runtimeHint: "検出したソフトウェアの情報です。上のカードでヘッドセットに合った環境を選んでください。",
  editors: "Unity エディター", managers: "Hub とパッケージ管理", installed: "検出済み", notFound: "一般的な場所では未検出", configFound: "設定を検出", configMissing: "設定が見つかりません", configFailed: "設定を読み取れません",
  managerHint: "ソフトウェアと設定は別々に確認します。ポータブル版や独自の場所へのインストールは見つからない場合があります。", otherEditor: "このバージョンを検出しました。現在の Avatar 準備には Unity 2022.3.22f1 または 2022.3.22f1c1 を使用します。", paths: "検出した場所", noEditors: "他の完全なエディターのインストールは見つかりませんでした。", inventoryUnknown: "エディターを確認できません。未インストールとは判断できません。", official: "公式ページを開く", choose2022: "Unity 2022 を準備", connection: "PICO を接続", closeDetails: "詳細を閉じる",
  issues: { close_pending: "Steam の起動処理が待機中の可能性があります。Steam 側で取り消してください。VUA は追加の起動を停止しています。", not_installed: "必要なソフトウェアが不足しているか、インストールが不完全です。準備計画を開いてください。", other_route_active: "別のプレイカードが使用中です。そのカードの今回の起動を先に閉じてください。", start_failed: "起動を完了できませんでした。公式アプリを確認し、今回の起動を閉じてから再試行してください。", start_timeout: "アプリの起動を待っています。Steam のログイン、ダウンロード、表示中の確認を確認してください。ここで停止した場合は Steam 側の待機中の起動も取り消してください。", close_failed: "一部のソフトウェアを終了できず、そのまま実行しています。各アプリのメニューから終了してください。", close_timeout: "終了要求後も一部のソフトウェアが実行中です。各アプリから終了できます。" },
};
const ko: Copy = {
  close: "닫기",
  network: "네트워크", details: "{name} 구성 보기", prepare: "{name} 준비", start: "{name} 시작", stop: "{name}의 이번 실행 닫기",
  inspect: "다시 확인", checking: "확인 중…", installing: "준비 중…", ready: "준비됨", missing: "소프트웨어 필요", starting: "시작 중…", running: "실행 중", stopping: "종료 요청 중…", attention: "확인 필요", unknown: "확인되지 않음",
  included: "포함된 소프트웨어", install: "설치 또는 복구", launch: "이 환경 시작", closeHint: "이 카드가 이번에 시작한 소프트웨어에만 종료를 요청합니다. 원래 실행 중이던 소프트웨어는 유지합니다.",
  runningHint: "소프트웨어가 실행 중입니다. 로그인과 헤드셋 연결은 각 공식 앱에서 완료하세요.", borrowed: "원래 실행 중 — 유지됨", owned: "이 카드로 시작함", stopped: "실행 중 아님",
  runtime: "기타 VR 소프트웨어", runtimeHint: "감지된 소프트웨어 정보입니다. 위에서 헤드셋에 맞는 환경을 선택하세요.",
  editors: "Unity 에디터", managers: "Hub 및 패키지 관리자", installed: "감지됨", notFound: "일반적인 위치에서 찾지 못함", configFound: "설정 감지됨", configMissing: "설정을 찾지 못함", configFailed: "설정 읽기 실패",
  managerHint: "소프트웨어와 설정은 별도로 확인합니다. 포터블 버전이나 사용자 지정 위치의 설치는 찾지 못할 수 있습니다.", otherEditor: "이 버전이 감지되었습니다. 현재 Avatar 준비에는 Unity 2022.3.22f1 또는 2022.3.22f1c1을 사용합니다.", paths: "감지된 위치", noEditors: "다른 완전한 에디터 설치를 찾지 못했습니다.", inventoryUnknown: "에디터를 확인할 수 없습니다. 설치되지 않았다는 뜻은 아닙니다.", official: "공식 페이지 열기", choose2022: "Unity 2022 준비", connection: "PICO 연결", closeDetails: "상세 닫기",
  issues: { close_pending: "Steam에 대기 중인 실행이 남아 있을 수 있습니다. Steam에서 취소하세요. VUA는 추가 실행 요청을 중단했습니다.", not_installed: "필수 소프트웨어가 없거나 설치가 불완전합니다. 준비 계획을 여세요.", other_route_active: "다른 플레이 카드가 사용 중입니다. 그 카드의 이번 실행을 먼저 닫으세요.", start_failed: "시작이 완료되지 않았습니다. 공식 앱을 확인하고 이번 실행을 닫은 뒤 다시 시도하세요.", start_timeout: "앱이 시작되기를 기다리는 중입니다. Steam 로그인, 다운로드, 열린 안내를 확인하세요. 여기서 멈춘 경우 Steam에 대기 중인 실행도 취소하세요.", close_failed: "일부 소프트웨어를 닫지 못해 실행 상태를 유지했습니다. 해당 앱의 메뉴에서 종료할 수 있습니다.", close_timeout: "종료 요청 후에도 일부 소프트웨어가 실행 중입니다. 해당 앱에서 직접 종료할 수 있습니다." },
};
export const environmentCopy = { en, "zh-CN": zh, ja, ko };
