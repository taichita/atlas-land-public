export function usageLimited(error) {
  const info=error?.codexErrorInfo||error?.data?.codexErrorInfo;
  const kinds=typeof info==='string'?[info]:Object.keys(info||{});
  return kinds.some(k=>k.replaceAll('_','').toLowerCase()==='usagelimitexceeded') ||
    /usage[_ ]limit|insufficient_quota|hit your .{0,20}limit|credits? (?:exhausted|depleted)|利用上限|クレジット.{0,8}(?:不足|使い切)/i.test(typeof error==='string'?error:error?.message||'');
}
export function aiErrorText(error) {
  return usageLimited(error)?'AIの利用上限に達しました。利用量を確認してください。Web閲覧・ファイル編集はそのまま使えます。':(typeof error==='string'?error:error?.message||'');
}
