import { CodexBridge } from "../server/codex.mjs";
const bridge = new CodexBridge();
try {
  await bridge.ready();
  const [account, models, threads] = await Promise.all([
    bridge.call("account/read", {}),
    bridge.call("model/list", { limit: 30, includeHidden: false }),
    bridge.call("thread/list", { limit: 3 }),
  ]);
  console.log(
    JSON.stringify(
      {
        exe: bridge.exe,
        account: account.account
          ? { type: account.account.type, plan: account.account.planType }
          : null,
        models: models.data?.map((m) => ({
          id: m.id,
          model: m.model,
          name: m.displayName,
          default: m.isDefault,
          efforts: m.supportedReasoningEfforts,
        })),
        threads: threads.data?.map((t) => ({
          id: t.id,
          keys: Object.keys(t),
          status: t.status,
          source: t.source,
          historyMode: t.historyMode,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  bridge.close();
}
