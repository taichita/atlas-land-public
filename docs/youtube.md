# YouTube制作ツール

動画ページを開くと、おすすめ欄の上に制作ツールが表示されます。

## 視聴者維持率の初回接続

公開の「よく再生された部分」ではなく、チャンネル所有者のYouTube Analyticsを読みます。YouTubeにログイン済みでも、この読み取り許可は別途必要です。

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクトを選び、YouTube Analytics APIを有効化します。
2. Google Auth PlatformでOAuth同意画面を設定します。テスト中なら自分をテストユーザーに登録します。
3. OAuthクライアントを「デスクトップ アプリ」で作り、JSONをダウンロードします。
4. Atlasの動画ページで「Studio接続」を押し、そのJSONを選びます。
5. 「Googleに接続」を押し、既定ブラウザで対象チャンネルの読み取りを許可します。
6. Atlasに戻ってグラフの ↻ を押します。

Googleの認証仕様に合わせ、認証画面だけは既定ブラウザで開きます。共通OAuthクライアントは配布物に含めていません。テストモード・審査・有効期限にはGoogleの制限が適用されます。

指標は `audienceWatchRatio`、横軸は `elapsedVideoTimeRatio`、期間は全期間です。再視聴による100%超えも表示します。新しい動画・集計不足・別チャンネルの動画ではデータが取得できないことがあります。カーソルで割合を確認し、クリックでその再生位置へ移動できます。

## 取得とプレビュー

- **Ctrl+Shift+Y**：字幕の文字起こしと現在のWebペインのスクショを保存。日本語字幕を優先します。音声から新規文字起こしを生成する機能ではありません。
- **Ctrl+Alt+Y**：現在のサムネイル・タイトル・チャンネル名・尺をおすすめカードの大きさで確認。実際の推薦順位を予測する機能ではありません。
- **F1**：ショートカットを変更。

保存先は `%LOCALAPPDATA%\PersonalAIWorkspace\data\youtube\captures`。「保存先を開く」からアクセスできます。各回のフォルダに `transcript.md` と `screen.png` を保存します。字幕が取得できない場合もスクショを残し、結果に明示します。

接続情報は同じ `data\youtube` 以下に保存され、Webページ・会話・配布ZIPへトークンを渡しません。Google認証の完了は本人が行ってください。YouTubeの画面変更により字幕取得やパネル配置が影響を受ける場合があります。

仕様：[YouTube Analytics reports.query](https://developers.google.com/youtube/analytics/reference/reports/query)、[Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
