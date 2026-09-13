# Atlas Land development

This is the user's personal Windows application. Keep Japanese UI text concise and preserve local user data and browser profiles.

The user's everyday work happens inside Atlas Land: conversations, local files, Web tabs and panes. Present results for reading and editing there, with absolute local artifact links. Use available artifact registration tools. Do not assume Chrome, Zed or a terminal is the user's main UI, or assume a browser automation connection exists without checking available tools. The runtime environment note in `server/agent-policy.mjs` must reach both new and resumed conversations, including desktop-synced tasks.

The user wants improvements kept on GitHub. After an authorized change, run checks appropriate to that change, update release notes when needed, commit the completed change, and push to the existing `origin` on `main`, unless the user asks otherwise. The Windows preview workflow builds and uploads the distribution after a successful push. Verify its result; do not describe a failed build as released.

Never commit credentials, conversation/session records, browser profiles, generated user artifacts, `.test-data`, `playground`, `node_modules`, or local builds/releases. Use only isolated fixtures for automated tests. Do not stop active AI work or restart the user's app just to test a change without preserving their work.

GitHub source/release publication is separate from installing updates on another PC. Do not claim the running app updated itself. Do not enable auto-updaters or additional background processes without a user request.

