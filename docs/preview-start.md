# Atlas Browser 試用パッケージ

個人開発のWindows用AIワークスペース兼ブラウザです。OpenAIの公式製品ではありません。

## 用意するもの

- Windows 11 x64、.NET Framework 4.8
- Node.js 24（通常のインストーラーで `C:\Program Files\nodejs\node.exe` にインストール）: https://nodejs.org/
- Microsoft Edge WebView2 Evergreen Runtime: https://developer.microsoft.com/microsoft-edge/webview2/
- 最新のCodexデスクトップアプリをインストールし、自分のアカウントでログイン。自分のCodexを利用できる契約・利用枠が必要です。

1. ZIPを任意のフォルダへすべて展開します。ZIPの中から直接起動しないでください。
2. `dist/AtlasBrowser.exe` を開きます。exeだけを移動せず、フォルダ一式を保ってください。
3. 左側の「既定フォルダ」で普段の作業場所を選び、「＋ 新しい案件」から始めます。フォルダは記憶します。`C:\dev` が存在しないPCではユーザーフォルダから始まります。

Codexが見つからない場合は `AI_WORKSPACE_CODEX` に現在のCodexのexeを指定します。既定では `%LOCALAPPDATA%/OpenAI/Codex/bin/` を探します。Node.jsを別の場所へ置いた場合は `AI_WORKSPACE_NODE` にnode.exeを指定します。新しいCodexアプリの配布形態によっては手動指定が必要です。

## 自分のデータとAI利用

配布者の会話、認証、ブラウザ履歴、SkillsやMCP設定は同梱しません。受け取った人のPCにあるCodex設定・認証を使用します。配布者の契約を共有するものではありません。

この版は個人向け設定です。新規案件の既定値は `danger-full-access` / `never` で、AIはWindowsユーザーの権限の範囲で、案件フォルダ外を含むファイル操作やコマンド実行を確認なしに行えます。職場への利用申請には同梱の「職場での利用確認.md」を使ってください。

会話・下書き・保存前バックアップ・Webログインは自分の `%LOCALAPPDATA%/PersonalAIWorkspace/` に保存されます。AIへ送信した指示とツール実行の情報はCodex経由で処理され、Web閲覧時はそのサイトへ接続します。

既存Codex会話のリアルタイム同期にはCodexアプリの起動が必要です。同期にはアプリのバージョンに依存する連携処理があり、別PCでは要確認です。Atlas独自の会話・ファイル・Webタブは同じ画面で扱えます。

## 試してほしい操作

- 「＋ ファイル」でMarkdown、CSV、HTML、画像、PDF、動画を開く。
- 「分割」で右側のタブを選ぶ。「左右を入れ替え」で交換。境界をドラッグして幅を変更。
- V/Zで表示中の動画を0.25倍ずつ変更。F1でキー一覧を表示。
- 「＋メモ」で新規メモ。初回に保存先を選び、以降は同じフォルダから開始します。
- アドレス欄の☆またはCtrl+Dでブックマーク。Ctrl+Shift+Oで一覧を開きます。
- 右上の色ボタンでテーマ・書体・背景の明るさを変更します。
- 編集専用のコピーを用意して「編集」→「保存」を試す。

テキスト編集は2MBまで。動画は部分読み込みを使います。再生できる形式はWebView2とWindowsのコーデックによります。ローカルHTMLは同じフォルダのCSS・画像を表示でき、外部通信や別サイトの埋め込みを必要とするHTMLアプリは対象外です。

この版は署名のない開発用試用版です。別PCでの初回セットアップ・ログインを含む一連の検証は未完了です。自動更新・インストーラーはありません。セキュリティソフトを無効化せず、入手元と同梱ファイルを確認してください。

終了してもアプリや会話・ログイン・下書きは消えません。再び `dist/AtlasBrowser.exe` を開くと1ウィンドウ・空のタブから始まります。更新するときはAtlasを終了し、新しいZIPを別フォルダへ展開して起動します。同じWindowsユーザーでは既存の保存データを使います。exe単体のコピーでは動きません。

依存ライブラリの権利表示は `licenses/` と各 `node_modules`、フォントのライセンスは `public/fonts/` に同梱します。

公式仕様の確認日: 2026-09-08
- Codexの認証: https://learn.chatgpt.com/docs/auth
- Codex App Server: https://learn.chatgpt.com/docs/app-server
- OpenAIの名称に関する方針: https://openai.com/brand/
