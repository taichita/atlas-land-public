# 更新と配布

GitHubの公開リポジトリ `taichita/atlas-land-public` でソースを管理します。個人の会話、認証、作業ファイル、ブラウザのプロファイル、生成した配布ZIPはGit履歴へ含めません。

変更を確認してmainへpushすると、GitHub ActionsがWindowsでテスト・exeのビルド・配布物の検査を行い、成功した版だけReleasesへZIPとSHA-256を追加します。Actions失敗時には新しい配布版を公開しません。履歴はコミット単位でたどれます。

GitHubへのpushと、利用中のアプリへの反映は別です。開発PCではローカルコードを次回起動時に読み込みます。別PCではReleasesから最新版を取得し、Atlasを終了して展開した版を開きます。常時ポーリング、保存のたびの自動commit、実行中のアプリの差し替えは行いません。

公開ソースとReleasesは誰でも取得できます。元の開発履歴は別の非公開リポジトリに保管しています。

実装の根拠: [GitHub Actionsの成果物](https://docs.github.com/en/actions/tutorials/store-and-share-data)、[GitHub CLI release create](https://cli.github.com/manual/gh_release_create)。

