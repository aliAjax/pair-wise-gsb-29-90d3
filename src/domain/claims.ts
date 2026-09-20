import type { StationRule } from "./config";
import type { ClaimVersion, DamageClaim, DeliveryOrder, QuotaOccupation } from "./types";

export function dayKey(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function currentVersion(claim: DamageClaim): ClaimVersion {
  return claim.versions[claim.versions.length - 1];
}

/** 站点某日已赔付累计：复核通过日期落在当日，按当前版本金额计 */
export function paidOnDate(claims: DamageClaim[], station: string, date: string): number {
  return claims
    .filter(
      (claim) =>
        claim.station === station &&
        claim.status === "已通过" &&
        claim.reviewedAt !== undefined &&
        dayKey(claim.reviewedAt) === date
    )
    .reduce((sum, claim) => sum + currentVersion(claim).amount, 0);
}

/** 站点某日待复核额度占用：仅统计"占用中"，超时未释放的占用仍然计入 */
export function occupiedOnDate(occupations: QuotaOccupation[], station: string, date: string): number {
  return occupations
    .filter((occ) => occ.station === station && occ.date === date && occ.state === "占用中")
    .reduce((sum, occ) => sum + occ.amount, 0);
}

export function isOccupationExpired(occupation: QuotaOccupation, now: number): boolean {
  return occupation.state === "占用中" && Date.parse(occupation.expiresAt) <= now;
}

/** 释放超时占用，返回释放笔数 */
export function releaseExpiredOccupations(occupations: QuotaOccupation[], now: number): number {
  let released = 0;
  for (const occupation of occupations) {
    if (isOccupationExpired(occupation, now)) {
      occupation.state = "已释放";
      occupation.closedAt = new Date(now).toISOString();
      released += 1;
    }
  }
  return released;
}

/**
 * 额度评估：当日赔付累计触及上限后，超出部分需占用待复核额度；
 * 待复核额度也不足时，需释放超时占用后才能放行。
 */
export function evaluateQuota(input: {
  paid: number;
  occupied: number;
  amount: number;
  rule: StationRule;
}): { ok: boolean; needOccupy: number; coveredByCap: number } {
  const headroom = Math.max(0, input.rule.dailyCap - input.paid);
  const coveredByCap = Math.min(input.amount, headroom);
  const needOccupy = input.amount - coveredByCap;
  const ok = input.occupied + needOccupy <= input.rule.pendingQuota;
  return { ok, needOccupy, coveredByCap };
}

export type Judgement = { ok: true; needOccupy: number } | { ok: false; reason: string };

/** 提交认领判断：同一订单待复核时后续申请直接阻止；结案订单不可申请 */
export function judgeSubmission(input: {
  order?: DeliveryOrder;
  claims: DamageClaim[];
  occupations: QuotaOccupation[];
  station: string;
  date: string;
  amount: number;
  rule: StationRule;
}): Judgement {
  const { order } = input;
  if (!order) return { ok: false, reason: "订单不存在" };
  if (order.status === "已结案") {
    return { ok: false, reason: `订单 ${order.code} 已结案，无法发起认领` };
  }
  const pending = input.claims.find((claim) => claim.orderId === order.id && claim.status === "待复核");
  if (pending) {
    return { ok: false, reason: `订单 ${order.code} 存在待复核认领，后续申请已阻止` };
  }
  if (!(input.amount > 0)) {
    return { ok: false, reason: "申报金额需大于 0" };
  }
  const paid = paidOnDate(input.claims, input.station, input.date);
  const occupied = occupiedOnDate(input.occupations, input.station, input.date);
  const quota = evaluateQuota({ paid, occupied, amount: input.amount, rule: input.rule });
  if (!quota.ok) {
    return {
      ok: false,
      reason: `站点当日赔付触及上限，待复核额度不足（已占用 ${occupied}/${input.rule.pendingQuota} 元），需释放超时占用后放行`,
    };
  }
  return { ok: true, needOccupy: quota.needOccupy };
}

/** 补证判断：待复核认领金额变化需重新核算待复核额度；已驳回不可补证 */
export function judgeSupplement(input: {
  claim: DamageClaim;
  claims: DamageClaim[];
  occupations: QuotaOccupation[];
  newAmount: number;
  rule: StationRule;
}): Judgement {
  const { claim } = input;
  if (claim.status === "已驳回") {
    return { ok: false, reason: "已驳回的认领不可补证，请重新发起申请" };
  }
  if (!(input.newAmount > 0)) {
    return { ok: false, reason: "申报金额需大于 0" };
  }
  if (claim.status === "待复核") {
    const paid = paidOnDate(input.claims, claim.station, claim.date);
    const occupiedByOthers = input.occupations
      .filter(
        (occ) =>
          occ.station === claim.station &&
          occ.date === claim.date &&
          occ.state === "占用中" &&
          occ.claimId !== claim.id
      )
      .reduce((sum, occ) => sum + occ.amount, 0);
    const quota = evaluateQuota({ paid, occupied: occupiedByOthers, amount: input.newAmount, rule: input.rule });
    if (!quota.ok) {
      return {
        ok: false,
        reason: `补证金额超出待复核额度（其他认领已占用 ${occupiedByOthers}/${input.rule.pendingQuota} 元）`,
      };
    }
    return { ok: true, needOccupy: quota.needOccupy };
  }
  return { ok: true, needOccupy: 0 };
}
