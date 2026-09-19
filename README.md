# Atlas Browser — Windows AI workspace and browser

ローカルCodex、Web閲覧、会話、ファイル編集を同じ画面で扱う、個人開発のWindowsアプリです。OpenAIの公式製品ではありません。

## 起動と配布

[Releases](https://github.com/taichita/atlas-land-public/releases)からZIPを取得し、全展開して `dist/AtlasBrowser.exe` を開きます。exe単体では動きません。Windows 11 x64、.NET Framework 4.8、WebView2 Evergreen Runtime、Node.js 24が必要です。AI連携には利用先PCのCodexと認証が必要です。

[はじめに](docs/preview-start.md) / [職場での利用確認](docs/workplace-review.md) / [更新と配布](docs/updates.md)

## 主な機能

- [縦型タブ](docs/vertical-tabs.md)：普段はアイコン表示、ホバーで名前と検索を表示。
- [複数ウィンドウ](docs/multiple-windows.md)と[ペイン](docs/multiple-panes.md)、タブの移動。通常起動は空の1ウィンドウ、障害からの復旧は作業中の表示を復元。
- [自分向けの操作](docs/personalization.md): 既定フォルダ、案件の片づけ、通知、Chromeブックマーク、メモの即保存、音声入力。
- Codexの会話・進捗・成果物を表示。既存Codex会話の同期にはCodexアプリの起動が必要。
- Markdown、CSV、テキストの閲覧・編集。下書き、外部変更の検知、保存前バックアップ。
- HTML、PDF、画像、対応する音声・動画のプレビュー。
- [メモ](docs/quick-notes.md)、[ブックマーク](docs/bookmarks.md)、[外観設定](docs/appearance.md)。
- [ページの日本語訳](docs/translation.md)。既存Codex接続を利用し、サイトごとの自動翻訳に対応。
- V/Zで動画速度を0.25倍ずつ変更。[ショートカット](docs/shortcuts-and-local-tools.md)は変更可能。
- 案件・フォルダ・成果物の関係を3Dで表示。

## データと実行権限

会話・下書き・ブラウザプロファイルは `%LOCALAPPDATA%\PersonalAIWorkspace\` に保存します。配布物には開発者の認証・会話・ブラウザ履歴・作業ファイルを含めません。

新規案件は `danger-full-access` / `never` が既定です。AIはWindowsユーザーの権限で、作業フォルダ外を含むファイル操作・コマンド実行を個別確認なしに行えます。組織向けの設定固定・集中監査は未実装です。

## 開発

```powershell
npm ci
npm test
node test/ui-check.mjs
node test/vertical-tabs-e2e.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-preview.ps1
```

mainへのpush後、GitHub Actionsでテスト・ビルド・配布検査を行い、成功した版をReleasesに追加します。実行中アプリの自動更新は未実装です。

WinForms + WebView2 + Node.jsを使用し、Three.jsは俯瞰画面で読み込みます。Chrome完全互換を保証するブラウザではありません。テキスト編集は2MBまでで、CSVの文章表示は最初の250行、全文は「元データ」で確認します。[確認範囲](VALIDATION.md)も参照してください。

依存ライブラリの権利表示は `licenses/`、フォントのライセンスは `public/fonts/` に収録しています。

