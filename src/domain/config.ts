/** 破损类别 */
export const DAMAGE_CATEGORIES = ["外包装破损", "内物破损", "液体渗漏", "配件缺失", "其他"] as const;

export const FIRST_CLAIM_REASON = "首次申报";

/** 站点赔付规则：当日赔付上限 + 待复核额度 */
export interface StationRule {
  dailyCap: number;
  pendingQuota: number;
}

export const STATION_RULES: Record<string, StationRule> = {
  城东站点: { dailyCap: 2000, pendingQuota: 1200 },
  城西站点: { dailyCap: 1500, pendingQuota: 900 },
};

export const STATIONS = Object.keys(STATION_RULES);

/** 占用超时：超时未复核的占用可释放，释放超时占用后才能放行新申请 */
export const OCCUPATION_TIMEOUT_MS = 2 * 60 * 1000;

export const STORAGE_KEY = "hxwlfront-15-damage-claims";
