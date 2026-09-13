# ローカル機能とモデル接続の候補

2026-09-08、各開発元の資料を確認。以下は追加候補で、拡張機能そのものや他社モデルの実行接続はまだ搭載していない。

| 優先 | 参考にする拡張機能 | Atlasでの用途とローカル制御 |
| --- | --- | --- |
| 1 | [SingleFile](https://github.com/gildas-lormeau/SingleFile) | 参考記事を案件フォルダに保存。URL・取得日時・メモと会話を結びつけ、保存操作にキーを割り当てる。 |
| 2 | [uBO Lite](https://github.com/uBlockOrigin/uBOL-home) | 広告・追跡を抑えるルールをローカル管理。サイト別に切り替える。既存拡張と同等の遮断性能は別途検証する。 |
| 3 | [Dark Reader](https://darkreader.org/) | サイト別の配色・明るさ・コントラストを保存。動画の色確認をするページは除外できるようにする。 |

動画のV/Z操作はAtlasの標準機能。ページ作成時に登録し、キー入力時だけ動画を探す。追加のAI呼び出しは行わない。

他社モデルはモデル名の一覧を増やすだけでなく、実行プロバイダーとして接続する。各社の会話ID、ストリーミング、停止、確認要求、作業フォルダ、利用量を扱う。既存のCodex会話を他社の同一セッションとして扱わない。

- **Claude**: [公式ヘルプの6月15日更新](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)では、Agent SDK・`claude -p`・第三者アプリ利用について、告知していた変更を停止し、現状はサブスク利用枠から消費すると説明している。APIキー接続との違いや提供形態に関する条件は、実装時に再確認する。
- **Gemini**: [公式の認証案内](https://geminicli.com/docs/get-started/authentication/)にGoogleログイン・APIキー・Vertex AIを掲載。個人と組織で要件が異なり、Atlasの非対話実行に適合する接続方法を選ぶ必要がある。
- **Kimi**: [公式CLIリファレンス](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html)にログイン、ACP、ローカルサーバーの接続口がある。Atlasから利用する候補はACPまたは認証付きローカルAPI。

今回は日常操作を優先し、他社モデルの接続は保留。各接続先は使用時のみ起動し、不要な常駐プロセスを増やさない方針。

追加の画面テスト:

```powershell
node test/keyboard-e2e.mjs
node test/media-keyboard-e2e.mjs
```

いずれも一時的なEdgeプロファイルを使う。個人のログインや会話は読み込まず、AIも呼ばない。後者は実キーイベントとiframe内の動画を検証するが、Windowsホストの転送部分は模擬している。
