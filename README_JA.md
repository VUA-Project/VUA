# VUA — VRC Ultra Assistant

[English](README.md) | [简体中文](README_ZH.md) | 日本語 | [한국어](README_KO.md)

**VUA（VRC Ultra Assistant）** は、VRChat プレイヤーのための Windows 優先・ローカル優先の
デスクトップ制作環境です——特に、Unity に触れたことがない、あるいは何が必要かまだ分からない
プレイヤーのために。目標と自分の素材から出発し、環境構築・プロジェクト準備・
Avatar の組み立て・検査・復旧まで、VUA がガイドします。

## VUA でできること

### 1. ゲームアシスタント

> **Materials checked and cleared.**

プレイに必要なソフトウェアや設定を準備し、移動、メニュー、安全設定、デバイスの基本を学びます。目的と機器に応じて必要なものを説明し、環境構築を案内します。

初回のアカウント案内では、内蔵ブラウザーで公式の登録ページを開きます。プレイ向けは Steam と VRChat、制作向けは任意で Unity と BOOTH を案内します。登録、Steam ライブラリへの追加、公式のアカウント連携は利用者自身が行います。アップロードには完全な VRChat アカウントと New User 以上のランクが必要ですが、資格を得る前でもローカルで Avatar の制作準備を進められます。

任意の外部連携として、トラッキング、VR オーバーレイ、睡眠支援、録画・配信ツールへの対応を予定しています。VUA は独立したアプリのインストール状態を検出し、Steam の購入・インストール画面への案内と起動を行います。更新は Steam または上流アプリが管理します。トラッキングツールには設定案内も用意し、PICO のアイトラッキングは最初のプレイ向けリリースに含めます。[対象ツールと対応範囲](docs/development-outline.md#n2-external-gameplay-tools)を参照してください。

### 2. Avatar 制作

> **Sugar, spice, and everything nice.**

所有する素材を組み合わせ、選択と設定を Recipe に記録して共有し、各自で素材を入手した人が再現できるようにします。目標は、検査と制御された変更を伴う Avatar 制作の自動化と、公式 SDK への成果物の引き渡しです。Recipe に含めるのは参照と設定であり、有料素材そのものではありません。

## 使い方の流れ

目的と手元の素材から始め、計画、手順、結果を確認します。Build Record は制作手順、検査の証拠、エラーをまとめ、実行内容と対処が必要な箇所を示します。

プロジェクトとパッケージの管理では、Unity 環境や依存関係、VPM リポジトリ、パッケージのインストール・更新・削除を扱います。既存の ALCOM/VCC プロジェクトは読み取り専用で確認し、編集はユーザーが指定して作成する VUA 管理のコピーで行います。最後のログインとアップロードは、ユーザー自身が VRChat 公式 SDK で行います。

## 安全上の境界

- VUA は VRChat Inc. と提携せず、公認も受けていない独立した第三者製アシスタントであり、文書化された外部インターフェース、OSC、起動オプション、必要なローカルログと文書化された設定のみを対象とし、VRChat クライアントへの注入、フック、パッチや EAC の回避を行いません。
- 初回のアカウント案内は分離された一時ブラウザーセッションを使用します。VUA のアプリ機能はパスワードを収集せず、ログイン Cookie やトークンをアプリのデータ、ログ、エージェントコンテキストへ取り出しません。初回提供では VRChat のログインを記憶しません。後続のウェブ情報読み取りと実験的な永続化は別途開発する方向であり、プラットフォームの承認を意味しません。[アカウント境界](docs/product-boundary.md#account-onboarding-user-ruling-2026-09-30)を参照してください。
- アカウントの変更はユーザーが許可された手順で開始し、VUA がクラウドからアカウントを操作したり、Avatar を代理で自動アップロードしたりすることはありません。
- 必要最小限のデータを原則ローカルに保存し、不要なフレンド活動の追跡やプロファイリングは行わず、有料素材をローカルに保ち、共有 Recipe に素材本体を含めません。
- 文書化されていないクライアント動作、隠し設定、制御されない API 自動化は標準の対象外であり、技術検査の成功は外観、動作、本番環境での安全性を保証しません。

[VRChat Creator Guidelines](https://hello.vrchat.com/creator-guidelines) · [Configuration File](https://docs.vrchat.com/docs/configuration-file)

## 開発状況

v0.6.0 は最新のソースタグであり、インストール可能な成果物はまだ公開されていません（唯一の GitHub Release である v0.5.0 にはアセットがありません）。[N1–N7](docs/development-outline.md) に沿って環境構築、選定した外部プレイ支援ツール、複雑な Avatar 制作、Recipe 再現、素材管理の監査と再実装、復旧、画像付きユーザーガイドを備えた Beta インストーラーを進めます。

プロジェクトは今後も長期間 Beta の状態が続く見込みです。説明は製品の方向性であり、実装や自動テストだけで実機の一連の動作が検証済みになるわけではありません。実際の受け入れ状況は[開発シーケンス](docs/development-outline.md)と[リリースノート](docs/release/)を参照してください。

### 現在の提供状況と開始方法

- インストール可能な成果物はまだ公開されていません。[v0.6.0 の検証記録・制限事項（中国語）](docs/release/v0.6.0.md)に最新のタグの状態を記録しています。上記は製品の方向性であり、N1–N7 の受入完了を意味しません。
- 画像付きユーザーガイドと検証済み Beta インストーラーは N7 の成果物です。現在利用できる操作手順ではありません。利用上の質問は [Issues](https://github.com/VUA-Project/VUA/issues/new/choose)へお願いします。
- 開発者は[依存関係の準備・デスクトップ起動・チェックの選択](apps/desktop/README.md#development-commands)から始め、[貢献ガイド](CONTRIBUTING.md)に従ってください。

## ドキュメント

- [ドキュメントガイド](docs/README.md)——タスクごとの最小ルート
- [プロダクト境界](docs/product-boundary.md)
- [アーキテクチャ](docs/architecture/system.md)
- [v0.6.0 リリースノート（中国語）](docs/release/v0.6.0.md)
- [コントリビューション](CONTRIBUTING.md) · [セキュリティポリシー](SECURITY.md)

## ライセンス

VUA は [Apache-2.0](LICENSE) です。外部アプリにはそれぞれのライセンスが適用されます。[VRCFaceTracking（Apache-2.0）](https://github.com/benaclejames/VRCFaceTracking/blob/master/LICENSE) や [Space Calibrator（MIT の本体と個別ライセンスの第三者コンポーネント）](https://github.com/hyblocker/OpenVR-SpaceCalibrator/blob/develop/LICENSE) も同様です。対応予定の全外部連携、帰属と将来の再配布条件は[第三者通知](THIRD_PARTY_NOTICES.md)を参照してください。

[NOTICE](NOTICE) · [商標ガイダンス](TRADEMARKS.md)

Copyright 2026 Aran52.
