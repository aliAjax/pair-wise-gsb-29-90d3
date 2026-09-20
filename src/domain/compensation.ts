/**
 * 赔付判断：货损认领、当日赔付上限、待复核额度占用、补证版本的纯领域逻辑。
 * 不依赖 Vue / localStorage，所有函数显式接收 now，便于测试与重载后重放。
 */

export const DAMAGE_CATEGORIES = ["外包装破损", "内物破损", "渗漏污染", "整件丢失"] as const;
export type DamageCategory = (typeof DAMAGE_CATEGORIES)[number];

export const CLAIM_STATUSES = ["待复核", "已通过", "已驳回"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** 复核通过后订单进入的结案状态 */
export const ORDER_CLOSED_STATUS = "已结案";

/** 补证版本：每次补证生成带原因的新版本，旧金额与凭证清单保留 */
export interface ClaimVersion {
  version: number;
  reason: string;
  amount: number;
  vouchers: string[];
  createdAt: string;
}

export interface Claim {
  id: string;
  orderId: string;
  rider: string;
  category: DamageCategory;
  /** 当前金额 = 最新版本金额 */
  amount: number;
  /** 当前凭证清单 = 最新版本凭证 */
  vouchers: string[];
  status: ClaimStatus;
  createdAt: string;
  reviewedAt: string | null;
  versions: ClaimVersion[];
}

export type ReleaseReason = "超时释放" | "驳回释放" | "补证调整";

/** 待复核额度占用记录：当日赔付累计触及上限后，超出部分占用该额度 */
export interface Occupation {
  id: string;
  claimId: string;
  amount: number;
  createdAt: string;
  expiresAt: string;
  releasedAt: string | null;
  releaseReason: ReleaseReason | null;
}

export interface StationPolicy {
  /** 站点当日赔付上限（元） */
  dailyCap: number;
  /** 待复核额度（元），超出当日上限的部分从这里占用 */
  reviewQuota: number;
  /** 占用超时时长（毫秒），超时后可释放再放行 */
  occupyTimeoutMs: number;
}

export const STATION_POLICY: StationPolicy = {
  dailyCap: 2000,
  reviewQuota: 800,
  occupyTimeoutMs: 2 * 60 * 1000,
};

export type Verdict<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: string };

export interface ClaimInput {
  orderId: string;
  rider: string;
  category: DamageCategory;
  amount: number;
  vouchers: string[];
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeVouchers(vouchers: string[]): string[] {
  return [...new Set(vouchers.map((v) => v.trim()).filter(Boolean))];
}

export function isOccupationActive(occupation: Occupation, now: Date): boolean {
  return occupation.releasedAt === null && new Date(occupation.expiresAt).getTime() > now.getTime();
}

export function isOccupationExpired(occupation: Occupation, now: Date): boolean {
  return occupation.releasedAt === null && new Date(occupation.expiresAt).getTime() <= now.getTime();
}

/** 释放超时占用：把已到期的占用标记为已释放，返回新数组与被释放的记录 */
export function sweepOccupations(
  occupations: Occupation[],
  now: Date
): { occupations: Occupation[]; released: Occupation[] } {
  const released: Occupation[] = [];
  const next = occupations.map((occupation) => {
    if (!isOccupationExpired(occupation, now)) return occupation;
    const freed: Occupation = {
      ...occupation,
      releasedAt: now.toISOString(),
      releaseReason: "超时释放",
    };
    released.push(freed);
    return freed;
  });
  return { occupations: next, released };
}

export function activeOccupied(occupations: Occupation[], now: Date): number {
  return round2(
    occupations
      .filter((occupation) => isOccupationActive(occupation, now))
      .reduce((sum, occupation) => sum + occupation.amount, 0)
  );
}

export function expiredOccupations(occupations: Occupation[], now: Date): Occupation[] {
  return occupations.filter((occupation) => isOccupationExpired(occupation, now));
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 当日赔付累计：今天申报且未被驳回的金额合计（待复核 + 已通过） */
export function committedToday(claims: Claim[], now: Date): number {
  return round2(
    claims
      .filter((claim) => claim.status !== "已驳回" && sameDay(new Date(claim.createdAt), now))
      .reduce((sum, claim) => sum + claim.amount, 0)
  );
}

/** 当日已通过赔付合计（用于指标展示） */
export function paidToday(claims: Claim[], now: Date): number {
  return round2(
    claims
      .filter(
        (claim) =>
          claim.status === "已通过" &&
          claim.reviewedAt !== null &&
          sameDay(new Date(claim.reviewedAt), now)
      )
      .reduce((sum, claim) => sum + claim.amount, 0)
  );
}

export function pendingClaimFor(claims: Claim[], orderId: string): Claim | undefined {
  return claims.find((claim) => claim.orderId === orderId && claim.status === "待复核");
}

/** 在已有累计的基础上再计入 amount 时，超出当日上限的部分 */
function excessAmount(committedBefore: number, amount: number, dailyCap: number): number {
  return round2(Math.max(0, committedBefore + amount - Math.max(dailyCap, committedBefore)));
}

function makeOccupation(claimId: string, amount: number, policy: StationPolicy, now: Date): Occupation {
  return {
    id: crypto.randomUUID(),
    claimId,
    amount,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + policy.occupyTimeoutMs).toISOString(),
    releasedAt: null,
    releaseReason: null,
  };
}

function quotaBlockedReason(excess: number, occupied: number, policy: StationPolicy): string {
  const remaining = round2(policy.reviewQuota - occupied);
  return `当日赔付累计已触及上限 ${policy.dailyCap} 元，超出 ${excess} 元需占用待复核额度，当前剩余额度仅 ${remaining} 元，请释放超时占用后再放行`;
}

/**
 * 骑手申报货损认领。
 * 同一订单存在待复核申请时直接阻止；当日累计触及上限时，超出部分占用待复核额度，
 * 额度不足则阻止，需释放超时占用后再放行。
 */
export function fileClaim(args: {
  claims: Claim[];
  occupations: Occupation[];
  order: { id: string; status: string } | undefined;
  input: ClaimInput;
  policy?: StationPolicy;
  now: Date;
}): Verdict<{ claim: Claim; occupations: Occupation[] }> {
  const { claims, order, input, now } = args;
  const policy = args.policy ?? STATION_POLICY;
  const swept = sweepOccupations(args.occupations, now).occupations;

  if (!order) return { ok: false, reason: "订单不存在，无法申报" };
  if (order.status === ORDER_CLOSED_STATUS) return { ok: false, reason: "订单已结案，无法申报货损" };
  if (pendingClaimFor(claims, input.orderId)) {
    return { ok: false, reason: "该订单已有待复核申请，后续申请已直接阻止" };
  }
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "申报金额需大于 0" };
  const vouchers = normalizeVouchers(input.vouchers);
  if (vouchers.length === 0) return { ok: false, reason: "请至少填写一个凭证编号" };

  const committed = committedToday(claims, now);
  const excess = excessAmount(committed, amount, policy.dailyCap);
  if (excess > 0) {
    const occupied = activeOccupied(swept, now);
    if (round2(occupied + excess) > policy.reviewQuota) {
      return { ok: false, reason: quotaBlockedReason(excess, occupied, policy) };
    }
  }

  const claim: Claim = {
    id: crypto.randomUUID(),
    orderId: input.orderId,
    rider: input.rider,
    category: input.category,
    amount,
    vouchers,
    status: "待复核",
    createdAt: now.toISOString(),
    reviewedAt: null,
    versions: [{ version: 1, reason: "首次申报", amount, vouchers, createdAt: now.toISOString() }],
  };
  const occupations =
    excess > 0 ? [makeOccupation(claim.id, excess, policy, now), ...swept] : swept;
  return { ok: true, claim, occupations };
}

/**
 * 补证：仅待复核申请可补证。生成带原因的新版本，旧金额与凭证清单保留在版本历史中。
 * 金额变化会同步调整该申请的额度占用（先释放旧占用，再按新金额重新占用）。
 */
export function supplementClaim(args: {
  claims: Claim[];
  occupations: Occupation[];
  claimId: string;
  reason: string;
  amount: number;
  vouchers: string[];
  policy?: StationPolicy;
  now: Date;
}): Verdict<{ claims: Claim[]; occupations: Occupation[] }> {
  const { claims, claimId, now } = args;
  const policy = args.policy ?? STATION_POLICY;
  const swept = sweepOccupations(args.occupations, now).occupations;

  const claim = claims.find((item) => item.id === claimId);
  if (!claim) return { ok: false, reason: "赔付申请不存在" };
  if (claim.status !== "待复核") return { ok: false, reason: "仅待复核申请可补证，复核后已锁定" };

  const reason = args.reason.trim();
  if (!reason) return { ok: false, reason: "请填写补证原因" };
  const amount = round2(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "申报金额需大于 0" };
  const vouchers = normalizeVouchers(args.vouchers);
  if (vouchers.length === 0) return { ok: false, reason: "请至少填写一个凭证编号" };

  // 先释放该申请旧的占用，再按“当日累计 - 旧金额 + 新金额”重新计算超出部分
  // （跨天补证时该申请本就不计入当日累计，无需扣减）
  let occupations = swept.map((occupation) =>
    occupation.claimId === claim.id && isOccupationActive(occupation, now)
      ? { ...occupation, releasedAt: now.toISOString(), releaseReason: "补证调整" as ReleaseReason }
      : occupation
  );
  const committed = committedToday(claims, now);
  const committedBefore = sameDay(new Date(claim.createdAt), now)
    ? round2(committed - claim.amount)
    : committed;
  const excess = excessAmount(committedBefore, amount, policy.dailyCap);
  if (excess > 0) {
    const occupied = activeOccupied(occupations, now);
    if (round2(occupied + excess) > policy.reviewQuota) {
      return { ok: false, reason: quotaBlockedReason(excess, occupied, policy) };
    }
    occupations = [makeOccupation(claim.id, excess, policy, now), ...occupations];
  }

  const version: ClaimVersion = {
    version: claim.versions.length + 1,
    reason,
    amount,
    vouchers,
    createdAt: now.toISOString(),
  };
  const updated: Claim = { ...claim, amount, vouchers, versions: [...claim.versions, version] };
  return {
    ok: true,
    claims: claims.map((item) => (item.id === claim.id ? updated : item)),
    occupations,
  };
}

/** 复核通过：申请转为已通过，订单结案。额度占用按既定规则保留至超时释放。 */
export function approveClaim(args: {
  claims: Claim[];
  occupations: Occupation[];
  claimId: string;
  now: Date;
}): Verdict<{ claims: Claim[]; occupations: Occupation[]; closedOrderId: string }> {
  const { claims, claimId, now } = args;
  const swept = sweepOccupations(args.occupations, now).occupations;

  const claim = claims.find((item) => item.id === claimId);
  if (!claim) return { ok: false, reason: "赔付申请不存在" };
  if (claim.status !== "待复核") return { ok: false, reason: "仅待复核申请可复核通过" };

  const updated: Claim = { ...claim, status: "已通过", reviewedAt: now.toISOString() };
  return {
    ok: true,
    claims: claims.map((item) => (item.id === claim.id ? updated : item)),
    occupations: swept,
    closedOrderId: claim.orderId,
  };
}

/** 复核驳回：申请转为已驳回，立即释放该申请占用的待复核额度，订单可重新申报。 */
export function rejectClaim(args: {
  claims: Claim[];
  occupations: Occupation[];
  claimId: string;
  now: Date;
}): Verdict<{ claims: Claim[]; occupations: Occupation[] }> {
  const { claims, claimId, now } = args;
  const swept = sweepOccupations(args.occupations, now).occupations;

  const claim = claims.find((item) => item.id === claimId);
  if (!claim) return { ok: false, reason: "赔付申请不存在" };
  if (claim.status !== "待复核") return { ok: false, reason: "仅待复核申请可驳回" };

  const occupations = swept.map((occupation) =>
    occupation.claimId === claim.id && isOccupationActive(occupation, now)
      ? { ...occupation, releasedAt: now.toISOString(), releaseReason: "驳回释放" as ReleaseReason }
      : occupation
  );
  const updated: Claim = { ...claim, status: "已驳回", reviewedAt: now.toISOString() };
  return {
    ok: true,
    claims: claims.map((item) => (item.id === claim.id ? updated : item)),
    occupations,
  };
}
