import type { GuideSectionContent } from "../features/guide/guide-content.ts";
import type { LocaleId } from "./index.ts";

const en: readonly GuideSectionContent[] = [
  {
    id: "eac-30005-occupied",
    title: "EAC Launch Error 30005 or Steam still says VRChat is running",
    paragraphs: [
      "After you exit VRChat, the Easy Anti-Cheat kernel driver (EasyAntiCheat_EOSSys) needs a moment to unload. Starting VRChat again before it finishes commonly triggers Launch Error 30005 (CreateFile failed with 32), or leaves Steam showing VRChat as Running.",
      "Wait one to two minutes first—VUA's EAC status dialog shows how long unloading has taken and notifies you as soon as it clears. If processes and services have already stopped, quit Steam completely from the system tray and relaunch; if the driver stays stuck in STOP_PENDING for more than five minutes, restart Windows rather than force-killing services or deleting .sys files.",
    ],
  },
  {
    id: "eac-not-installed",
    title: "Easy Anti-Cheat is not installed, missing files, or blocked by antivirus",
    paragraphs: [
      "Seeing 'Easy Anti-Cheat is not installed'—or VUA reporting EAC not installed right after a fresh VRChat download—usually means VRChat has not run its first-time Steam setup yet, the EAC service was unregistered, files inside VRChat's EasyAntiCheat folder were removed, or security software quarantined EasyAntiCheat_EOS_Setup.exe or the service binary.",
      "If you just installed VRChat for the first time, launch it once directly in Steam so Steam's install script registers EasyAntiCheat_EOS. If you use third-party antivirus software, restore any quarantined files from VRChat's EasyAntiCheat folder and add that folder to its exclusion list, then run EasyAntiCheat_EOS_Setup.exe as Administrator or run 'Verify integrity of game files' in Steam.",
    ],
  },
  {
    id: "eac-1275-driver-blocked",
    title: "StartService EasyAntiCheat EOSSys failed with 1275 on Windows 11",
    paragraphs: [
      "Error 1275 means Windows blocked the EAC kernel driver from loading, most often when Windows 11 Kernel-mode Hardware-enforced Stack Protection (under Windows Security > Device Security > Core Isolation) rejects an older driver build.",
      "Update VRChat in Steam and install pending Windows updates first, as newer EOS/EAC releases resolved the original KB5026372 compatibility issue. VUA never alters Windows Security settings; if Windows still blocks the driver after updating and verifying game files, review Microsoft and VRChat's official Core Isolation guidance before changing any system protection toggle yourself.",
    ],
  },
  {
    id: "eac-untrusted-system-file",
    title: "Untrusted system file or Launch Error 30004",
    paragraphs: [
      "An 'Untrusted system file' message or Error Code 30004 (WaitForSingleObject failed: 2) points to a damaged Windows system file, a corrupted game file, or a third-party utility conflicting with EAC—VRChat's help article specifically notes AVG, Avast, Corsair iCue, ASUS Armoury Crate, and unstable CPU/RAM overclocks.",
      "Verify VRChat's files in Steam, update or temporarily close RGB/overlay/antivirus utilities, and run 'sfc /scannow' in an Administrator Command Prompt followed by a PC restart. If other apps also fail to open while VRChat runs, run a full malware scan with Windows Security.",
    ],
  },
  {
    id: "eac-connection-lost",
    title: "Disconnected in-game: 'could not maintain a verified connection'",
    paragraphs: [
      "If VRChat launches fine but kicks you out with 'The VRChat Anti-Cheat system could not maintain a verified connection', the game lost reachability to Epic Online Services anti-cheat endpoints mid-session due to network jitter, strict NAT/proxy rules, or a game accelerator rerouting traffic.",
      "Test on a direct connection without VPNs or split-tunnel proxies—or switch nodes if you use a network accelerator so VRChat and Epic Online Services share a stable route. Never add hosts-file blocks or EAC bypass tools: blocking EOS prevents VRChat from joining worlds and violates the VRChat Terms of Service.",
    ],
  },
  {
    id: "eac-sdk-multi-instance",
    title: "VRChat SDK Build & Test: 'Only one instance of VRChat at a time'",
    paragraphs: [
      "Easy Anti-Cheat only allows one protected launcher session at a time. Clicking Build & Test in Unity while regular VRChat is still open—or while EAC is still unloading from a session you just closed—triggers the single-instance EAC error.",
      "Close VRChat and wait until VUA shows EAC as ready before launching Build & Test. If you intentionally need multiple local test clients in the Unity SDK, VRChat Canny #1519 documents setting the VRChat Client Path manually to VRChat.exe inside VRChat SDK > Settings so local SDK test launches follow the SDK workflow.",
    ],
  },
];

// All five locales keep identical section IDs and paragraph counts; reviewed against sources checked 2026-11-14.
export const guideEacCopy: Record<LocaleId, readonly GuideSectionContent[]> = {
  en,
  "zh-CN": [
    {
      id: "eac-30005-occupied",
      title: "启动报 30005 占用，或退出后 Steam 仍显示“运行中”",
      paragraphs: [
        "退出 VRChat 后，Easy Anti-Cheat 的内核驱动服务（EasyAntiCheat_EOSSys）需要一小段时间完成卸载。如果驱动还没退干净就再次启动，常会报 Launch Error (30005) CreateFile failed with 32，或者看到 Steam 一直显示 VRChat 正在运行。",
        "先等 1–2 分钟即可——VUA 的 EAC 状态对话框会显示已等待时长，并在卸载完成后提醒你。如果游戏进程与服务都已停止、只有 Steam 标记还留着，从系统托盘完全退出 Steam 再重开即可；若驱动停在 STOP_PENDING 超过 5 分钟，请直接重启电脑，不要强行用命令停服务或手动删除 .sys 驱动文件。",
      ],
    },
    {
      id: "eac-not-installed",
      title: "提示 Easy Anti-Cheat 未安装、缺文件或被杀毒软件拦截",
      paragraphs: [
        "启动弹出“Easy Anti-Cheat is not installed”、刚点开就闪退，或刚下载完 VRChat 首次启动前显示 EAC 未安装，通常是因为尚未通过 Steam 完成首次启动安装脚本、EAC 服务未注册、EasyAntiCheat 文件夹缺失，或杀毒软件隔离了修复程序与服务文件。",
        "若是刚安装完 VRChat 还未启动过，先在 Steam 库中直接启动一次即可自动完成服务注册。若装有第三方杀毒或安全卫士，请先在隔离区恢复被拦截的文件并将 EasyAntiCheat 文件夹加入信任区，随后右键 EasyAntiCheat_EOS_Setup.exe 选择“以管理员身份运行”，或在 Steam 中执行“验证游戏文件的完整性”。",
      ],
    },
    {
      id: "eac-1275-driver-blocked",
      title: "Windows 11 报 StartService 1275（驱动被系统拦截）",
      paragraphs: [
        "错误码 1275 表示 Windows 阻止了 EAC 内核驱动加载，常见于 Windows 11 开启“内核模式硬件强制堆栈保护”（Windows 安全中心 › 设备安全性 › 内核隔离）时拦截了旧版驱动。",
        "请先通过 Steam 更新 VRChat 并安装最新的 Windows 更新——新版 EOS/EAC 驱动已修复早期 KB5026372 补丁带来的兼容问题。VUA 不会代改系统安全开关；若更新并验证游戏文件后仍报 1275，请对照微软与 VRChat 官方说明自行权衡安全设置。",
      ],
    },
    {
      id: "eac-untrusted-system-file",
      title: "提示 Untrusted system file 或错误码 30004",
      paragraphs: [
        "出现 Untrusted system file（不受信任的系统文件）或 Error Code 30004（WaitForSingleObject failed: 2），通常与系统文件损坏、游戏文件残缺，或后台软件与 EAC 冲突有关——VRChat 官方帮助文点名过 AVG、Avast、海盗船 iCue、华硕 Armoury Crate（奥创）以及不稳定的超频设置。",
        "建议先在 Steam 验证 VRChat 文件完整性，更新或暂时退出上述灯效、覆盖层与杀毒软件，并以管理员身份打开命令提示符运行 sfc /scannow 后重启电脑。若 VRChat 运行期间其他软件也打不开，请用 Windows 安全中心做一次完整病毒扫描。",
      ],
    },
    {
      id: "eac-connection-lost",
      title: "游玩中途被踢出：无法维持反作弊验证连接",
      paragraphs: [
        "如果能正常进游戏，但中途弹出“The VRChat Anti-Cheat system could not maintain a verified connection”，说明游戏运行期间到 Epic Online Services 反作弊节点的网络连接中断，常见于网络抖动、代理分流不完整或加速器节点异常。",
        "可先尝试关闭 VPN/代理直连测试，若使用游戏加速器，请切换节点并确认加速规则同时覆盖 VRChat 与 Epic Online Services。切勿通过修改 hosts 屏蔽 EOS 或使用绕过工具——屏蔽反作弊会导致无法进入世界，且违反 VRChat 服务条款。",
      ],
    },
    {
      id: "eac-sdk-multi-instance",
      title: "Unity SDK 本地测试报“Only one instance of VRChat at a time”",
      paragraphs: [
        "Easy Anti-Cheat 同一时间只允许运行一个受保护的启动器实例。当普通 VRChat 还没关闭、或者刚退出但 EAC 仍在卸载时，在 Unity 里点击 Build & Test 就会触发单实例拦截报错。",
        "平时只需先关闭正在运行的 VRChat，等 VUA 显示 EAC 就绪后再点 Build & Test。如果你确实需要在 SDK 本地测试时多开客户端，可按 VRChat Canny #1519 的官方说明，在 Unity 顶部 VRChat SDK › Settings 中将 VRChat Client Path 手动指定到 VRChat.exe。",
      ],
    },
  ],
  "zh-TW": [
    {
      id: "eac-30005-occupied",
      title: "啟動出現 30005 佔用，或結束後 Steam 仍顯示「執行中」",
      paragraphs: [
        "結束 VRChat 後，Easy Anti-Cheat 的核心驅動服務（EasyAntiCheat_EOSSys）需要一點時間完成卸載。若在卸載完成前立刻重開，常會出現 Launch Error (30005) CreateFile failed with 32，或看到 Steam 持續顯示 VRChat 執行中。",
        "建議先稍候 1–2 分鐘——VUA 的 EAC 狀態對話框會顯示已等待時間，並在卸載完成後通知你。若遊戲處理程序與服務都已停止、僅剩 Steam 標記殘留，從系統匣完全結束 Steam 再重開即可；若驅動卡在 STOP_PENDING 超過 5 分鐘，請直接重新開機，切勿強制停用系統服務或手動刪除 .sys 檔案。",
      ],
    },
    {
      id: "eac-not-installed",
      title: "顯示 Easy Anti-Cheat 未安裝、缺少檔案或遭防毒軟體攔截",
      paragraphs: [
        "啟動時跳出「Easy Anti-Cheat is not installed」、一開啟就閃退，或剛下載完 VRChat 首次啟動前顯示 EAC 未安裝，通常是因為尚未透過 Steam 執行首次安裝腳本、EAC 服務尚未註冊、EasyAntiCheat 目錄遺失，或防毒軟體隔離了修復程式與服務執行檔。",
        "若是剛安裝完 VRChat 尚未啟動過，先從 Steam 收藏庫直接啟動一次即可完成服務註冊。若裝有第三方防毒軟體，請先從隔離區還原遭攔截的檔案並將 EasyAntiCheat 資料夾加入排除清單，接著對 EasyAntiCheat_EOS_Setup.exe 按右鍵選擇「以系統管理員身分執行」，或在 Steam 執行「驗證遊戲檔案的完整性」。",
      ],
    },
    {
      id: "eac-1275-driver-blocked",
      title: "Windows 11 出現 StartService 1275（驅動程式遭系統阻擋）",
      paragraphs: [
        "錯誤碼 1275 代表 Windows 攔截了 EAC 核心驅動程式載入，常見於 Windows 11 啟用「核心模式硬體強制堆疊保護」（Windows 安全性 › 裝置安全性 › 核心隔離）時阻擋了舊版驅動。",
        "請先透過 Steam 更新 VRChat 並安裝最新的 Windows 更新——新版 EOS/EAC 驅動已修正早期 KB5026372 更新造成的相容問題。VUA 不會更動系統安全性開關；若更新並驗證檔案後仍出現 1275，請參考微軟與 VRChat 官方說明自行評估安全性設定。",
      ],
    },
    {
      id: "eac-untrusted-system-file",
      title: "出現 Untrusted system file 或錯誤碼 30004",
      paragraphs: [
        "跳出 Untrusted system file（不受信任的系統檔案）或 Error Code 30004（WaitForSingleObject failed: 2），通常與 Windows 系統檔案受損、遊戲檔案缺漏，或背景軟體與 EAC 衝突有關——VRChat 官方說明特別點名 AVG、Avast、Corsair iCue、華碩 Armoury Crate 與不穩定的超頻設定。",
        "請先在 Steam 驗證 VRChat 檔案完整性，更新或暫時關閉上述燈效、覆疊介面與防毒工具，並以系統管理員身分開啟命令提示字元執行 sfc /scannow 後重新開機。若 VRChat 執行期間其他程式也無法開啟，請使用 Windows 安全性執行完整惡意軟體掃描。",
      ],
    },
    {
      id: "eac-connection-lost",
      title: "遊玩途中斷線：無法維持防作弊驗證連線",
      paragraphs: [
        "若能正常進入遊戲，卻在中途跳出「The VRChat Anti-Cheat system could not maintain a verified connection」，代表執行期間連往 Epic Online Services 防作弊節點的連線中斷，常見原因包含網路瞬斷、代理分流規則不完整或加速器節點異常。",
        "建議先關閉 VPN 或代理伺服器以直連測試；若有使用網路加速器，請切換節點並確認規則同時涵蓋 VRChat 與 Epic Online Services。請勿透過修改 hosts 封鎖 EOS 或使用繞過工具——封鎖防作弊會導致無法進入世界，並違反 VRChat 服務條款。",
      ],
    },
    {
      id: "eac-sdk-multi-instance",
      title: "Unity SDK 本機測試出現「Only one instance of VRChat at a time」",
      paragraphs: [
        "Easy Anti-Cheat 同一時間只允許執行一個受保護的啟動器執行個體。當一般版 VRChat 尚未關閉，或剛結束但 EAC 仍在卸載時，在 Unity 點擊 Build & Test 就會觸發單一執行個體限制。",
        "一般情況下請先關閉執行中的 VRChat，等 VUA 顯示 EAC 已就緒後再執行 Build & Test。若因開發測試確實需要同時開啟多個本機測試端，可依 VRChat Canny #1519 的官方說明，在 Unity 的 VRChat SDK › Settings 將 VRChat Client Path 手動指向 VRChat.exe。",
      ],
    },
  ],
  ja: [
    {
      id: "eac-30005-occupied",
      title: "起動時エラー 30005、または終了後も Steam が「実行中」のままになる",
      paragraphs: [
        "VRChat を終了した直後は、Easy Anti-Cheat のカーネルドライバー（EasyAntiCheat_EOSSys）が終了処理を行っています。完了前にすぐ再起動すると、Launch Error (30005) CreateFile failed with 32 が出たり、Steam 上で VRChat が「実行中」のまま残ったりすることがあります。",
        "まずは 1〜2 分お待ちください。VUA の EAC 状態ダイアログで経過時間を確認でき、完了すると通知されます。プロセスとサービスが止まっているのに Steam の表示だけ残る場合はタスクトレイから Steam を完全に終了して開き直し、5 分以上 STOP_PENDING のまま止まっている場合はサービスの強制停止や .sys ファイル削除は行わず PC を再起動してください。",
      ],
    },
    {
      id: "eac-not-installed",
      title: "「Easy Anti-Cheat is not installed」やセキュリティソフトによる隔離",
      paragraphs: [
        "起動時に「Easy Anti-Cheat is not installed」と表示されたり、VRChat の初回ダウンロード直後に EAC 未導入と判定されたりする場合、Steam の初回起動セットアップがまだ実行されていないか、EAC サービスが未登録か、セキュリティソフトが修復ツールやサービス実行ファイルを隔離している可能性があります。",
        "VRChat をインストールしたばかりで一度も起動していない場合は、まず Steam から直接 1 回起動するとサービスが自動登録されます。サードパーティ製ウイルス対策ソフトをお使いの場合は隔離ファイルを復元して EasyAntiCheat フォルダを除外設定に追加し、EasyAntiCheat_EOS_Setup.exe を「管理者として実行」するか Steam で「ゲームファイルの整合性を確認」を実行してください。",
      ],
    },
    {
      id: "eac-1275-driver-blocked",
      title: "Windows 11 で StartService 1275 エラーが出る（ドライバー読み込みブロック）",
      paragraphs: [
        "エラー 1275 は Windows が EAC ドライバーの読み込みをブロックしたことを示します。Windows 11 の「カーネル モード ハードウェア強制スタック保護」（Windows セキュリティ › デバイス セキュリティ › コア分離）が古いドライバーを拒否した場合によく発生します。",
        "まずは Steam で VRChat を最新にし、Windows Update を適用してください（初期の KB5026372 互換性問題は新しい EOS/EAC で解消されています）。VUA が Windows のセキュリティ設定を変更することはありません。更新後も解消しない場合は、Microsoft と VRChat 公式の案内を確認した上でご自身で判断してください。",
      ],
    },
    {
      id: "eac-untrusted-system-file",
      title: "「Untrusted system file」またはエラーコード 30004",
      paragraphs: [
        "「Untrusted system file」や Error Code 30004（WaitForSingleObject failed: 2）は、Windows システムファイルの破損、ゲームファイルの欠損、または常駐ソフトとの競合が原因で起こります。VRChat 公式ヘルプでは AVG、Avast、Corsair iCue、ASUS Armoury Crate、不安定なオーバークロックが例として挙げられています。",
        "Steam でゲームファイルの整合性を確認し、該当する RGB 制御・オーバーレイ・ウイルス対策ソフトを更新または一時終了した上で、管理者権限のコマンドプロンプトで「sfc /scannow」を実行して PC を再起動してください。VRChat 実行中に他のアプリも開けなくなる場合は、Windows セキュリティでフルスキャンを行ってください。",
      ],
    },
    {
      id: "eac-connection-lost",
      title: "プレイ中に「could not maintain a verified connection」で切断される",
      paragraphs: [
        "起動できてもワールド滞在中に「The VRChat Anti-Cheat system could not maintain a verified connection」と出て切断される場合、ネットワークの瞬断やプロキシ・回線最適化ツールの経路設定により、Epic Online Services の認証サーバーとの通信が途切れています。",
        "VPN やプロキシを切って直接接続で試すか、ゲーミング回線ツールをお使いの場合は VRChat と Epic Online Services の両方が安定した経路を通るよう設定を見直してください。hosts の書き換えや EAC 回避ツールの使用はワールドへの参加を妨げるだけでなく、VRChat 利用規約違反となるため絶対に行わないでください。",
      ],
    },
    {
      id: "eac-sdk-multi-instance",
      title: "Unity SDK の Build & Test で「Only one instance of VRChat at a time」と出る",
      paragraphs: [
        "Easy Anti-Cheat の保護付きランチャーは同時に 1 つしか起動できません。通常の VRChat が起動中、または終了直後で EAC がまだ終了処理をしている間に Unity で Build & Test を押すと、このエラーが表示されます。",
        "通常の VRChat を閉じ、VUA で EAC の準備完了を確認してから Build & Test を実行してください。開発テストで複数のローカルクライアントを同時に動かす必要がある場合は、VRChat Canny #1519 の案内どおり Unity の VRChat SDK › Settings で VRChat Client Path に VRChat.exe を手動指定してください。",
      ],
    },
  ],
  ko: [
    {
      id: "eac-30005-occupied",
      title: "실행 오류 30005 또는 종료 후에도 Steam에 '실행 중'으로 남는 현상",
      paragraphs: [
        "VRChat을 종료한 직후에는 Easy Anti-Cheat 커널 드라이버(EasyAntiCheat_EOSSys)가 내려가는 데 잠시 시간이 걸립니다. 정리가 끝나기 전에 바로 다시 실행하면 Launch Error (30005) CreateFile failed with 32가 뜨거나 Steam에 VRChat이 계속 '실행 중'으로 표시될 수 있습니다.",
        "먼저 1~2분 정도 기다려 보세요. VUA의 EAC 상태 창에서 대기 시간을 실시간으로 보여 주며 정리가 끝나면 알려 드립니다. 프로세스와 서비스가 모두 멈췄는데도 Steam 표시만 남아 있다면 시스템 트레이에서 Steam을 완전히 종료한 뒤 다시 켜고, 드라이버가 5분 넘게 STOP_PENDING에 멈춰 있다면 서비스를 강제로 끄거나 .sys 파일을 지우지 말고 PC를 다시 시작해 주세요.",
      ],
    },
    {
      id: "eac-not-installed",
      title: "'Easy Anti-Cheat is not installed' 표시 또는 백신 격리 문제",
      paragraphs: [
        "실행할 때 'Easy Anti-Cheat is not installed'가 뜨거나 VRChat을 처음 설치한 직후 EAC 미설치로 표시된다면, 아직 Steam 첫 실행 설치 스크립트가 동작하지 않았거나 EAC 서비스가 등록되지 않았거나 보안 프로그램이 복구·서비스 파일을 격리했을 가능성이 큽니다.",
        "VRChat을 방금 설치해 아직 한 번도 켜지 않았다면 먼저 Steam 라이브러리에서 직접 한 번 실행해 서비스를 등록하세요. 타사 백신을 사용 중이라면 격리된 파일을 복원하고 EasyAntiCheat 폴더를 예외 목록에 추가한 뒤, EasyAntiCheat_EOS_Setup.exe를 '관리자 권한으로 실행'하거나 Steam에서 '게임 파일 무결성 검사'를 실행하세요.",
      ],
    },
    {
      id: "eac-1275-driver-blocked",
      title: "Windows 11에서 StartService 1275 오류가 발생할 때(드라이버 차단)",
      paragraphs: [
        "오류 코드 1275는 Windows가 EAC 커널 드라이버 로드를 차단했다는 뜻으로, 주로 Windows 11의 '커널 모드 하드웨어 강제 스택 보호'(Windows 보안 › 장치 보안 › 코어 격리)가 구버전 드라이버를 거부할 때 나타납니다.",
        "먼저 Steam에서 VRChat을 최신 버전으로 업데이트하고 Windows 업데이트를 설치하세요(초기 KB5026372 호환성 문제는 최신 EOS/EAC에서 해결되었습니다). VUA는 Windows 보안 설정을 임의로 바꾸지 않으므로, 업데이트 후에도 문제가 계속되면 Microsoft와 VRChat 공식 안내를 확인한 뒤 직접 설정 여부를 결정해 주세요.",
      ],
    },
    {
      id: "eac-untrusted-system-file",
      title: "'Untrusted system file' 또는 오류 코드 30004",
      paragraphs: [
        "'Untrusted system file'(신뢰할 수 없는 시스템 파일)이나 Error Code 30004(WaitForSingleObject failed: 2)는 손상된 Windows 시스템 파일, 누락된 게임 파일, 또는 백그라운드 프로그램 충돌로 발생할 수 있습니다. VRChat 공식 도움말에서는 AVG, Avast, Corsair iCue, ASUS Armoury Crate 및 불안정한 오버클럭을 주요 원인으로 안내합니다.",
        "Steam에서 게임 파일 무결성 검사를 실행하고 RGB·오버레이·백신 도구를 업데이트하거나 잠시 종료한 뒤, 관리자 권한 명령 프롬프트에서 'sfc /scannow'를 실행하고 PC를 다시 시작해 보세요. VRChat 실행 중 다른 프로그램까지 열리지 않는다면 Windows 보안으로 전체 악성코드 검사를 진행해 주세요.",
      ],
    },
    {
      id: "eac-connection-lost",
      title: "플레이 중 'could not maintain a verified connection'으로 튕길 때",
      paragraphs: [
        "게임에 접속한 뒤 'The VRChat Anti-Cheat system could not maintain a verified connection' 메시지와 함께 연결이 끊긴다면, 네트워크 흔들림이나 프록시·게임 VPN(미꾸라지 등) 라우팅 문제로 Epic Online Services 인증 서버와의 연결이 중간에 끊어진 것입니다.",
        "VPN이나 프록시를 끄고 직접 연결로 먼저 확인해 보시고, 네트워크 가속기를 쓴다면 VRChat과 Epic Online Services 트래픽이 모두 안정적으로 전달되도록 노드를 변경해 보세요. hosts 파일 수정이나 EAC 우회 도구는 월드 접속을 막을 뿐 아니라 VRChat 이용약관 위반이므로 절대 사용하지 마세요.",
      ],
    },
    {
      id: "eac-sdk-multi-instance",
      title: "Unity SDK Build & Test 시 'Only one instance of VRChat at a time' 오류",
      paragraphs: [
        "Easy Anti-Cheat 보호 런처는 한 번에 하나만 실행할 수 있습니다. 일반 VRChat이 아직 켜져 있거나 방금 종료해 EAC가 정리 중인 상태에서 Unity의 Build & Test를 누르면 중복 실행 차단 오류가 나타납니다.",
        "실행 중인 VRChat을 닫고 VUA에서 EAC가 준비됨 상태가 된 것을 확인한 뒤 Build & Test를 실행하세요. 개발 테스트를 위해 여러 로컬 클라이언트를 동시에 띄워야 한다면 VRChat Canny #1519 안내에 따라 Unity 상단 VRChat SDK › Settings에서 VRChat Client Path를 VRChat.exe로 직접 지정하면 됩니다.",
      ],
    },
  ],
};
