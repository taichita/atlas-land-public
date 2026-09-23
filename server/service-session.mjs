// A restarted service keeps its loopback origin so existing WebViews and drafts stay open.
export function serviceBinding(env = process.env) {
  const port = env.ATLAS_SERVICE_PORT;
  const token = env.ATLAS_SERVICE_TOKEN;
  if (port === undefined && token === undefined) return { port: 0, token: null };
  if (!/^\d{1,5}$/.test(port || '') || Number(port) < 1 || Number(port) > 65535 || !/^[a-f0-9]{64}$/.test(token || '')) {
    throw new Error('Invalid Atlas service recovery configuration');
  }
  return { port: Number(port), token };
}
