import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  FIRST_CLAIM_REASON,
  OCCUPATION_TIMEOUT_MS,
  STATION_RULES,
  STORAGE_KEY,
} from "../domain/config";
import {
  currentVersion,
  dayKey,
  judgeSubmission,
  judgeSupplement,
  occupiedOnDate,
  paidOnDate,
  releaseExpiredOccupations,
} from "../domain/claims";
import type { DamageClaim, DeliveryOrder, QuotaOccupation } from "../domain/types";

interface PersistedState {
  orders: DeliveryOrder[];
  claims: DamageClaim[];
  occupations: QuotaOccupation[];
}

export interface ClaimInput {
  orderId: string;
  category: string;
  amount: number;
  vouchers: string[];
}

export interface SupplementInput {
  claimId: string;
  category: string;
  amount: number;
  addVouchers: string[];
  reason: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

function seedState(): PersistedState {
  const now = Date.now();
  const today = dayKey(new Date(now));
  const yesterday = dayKey(new Date(now - 86400000));
  return {
    orders: [
      { id: "order-1", code: "SO-1001", rider: "骑手A", station: "城东站点", address: "世纪大道 88 号", slot: "10:00-12:00", status: "已送达", createdAt: iso(now - 2 * 86400000) },
      { id: "order-2", code: "SO-1002", rider: "骑手B", station: "城东站点", address: "陆家嘴环路 12 号", slot: "14:00-16:00", status: "配送中", createdAt: iso(now - 86400000) },
      { id: "order-3", code: "SO-1003", rider: "骑手C", station: "城西站点", address: "滨江路 5 号", slot: "09:00-11:00", status: "已结案", createdAt: iso(now - 3 * 86400000) },
      { id: "order-4", code: "SO-1004", rider: "骑手A", station: "城西站点", address: "梧桐巷 31 号", slot: "16:00-18:00", status: "已送达", createdAt: iso(now - 86400000) },
    ],
    claims: [
      {
        id: "claim-1",
        orderId: "order-1",
        orderCode: "SO-1001",
        rider: "骑手A",
        station: "城东站点",
        date: today,
        status: "待复核",
        createdAt: iso(now - 90000),
        versions: [
          { version: 1, category: "内物破损", amount: 2600, vouchers: ["EV-8801"], reason: FIRST_CLAIM_REASON, createdAt: iso(now - 90000) },
          { version: 2, category: "内物破损", amount: 2600, vouchers: ["EV-8801", "EV-8802"], reason: "补充开箱照片", createdAt: iso(now - 60000) },
        ],
      },
      {
        id: "claim-2",
        orderId: "order-3",
        orderCode: "SO-1003",
        rider: "骑手C",
        station: "城西站点",
        date: yesterday,
        status: "已通过",
        createdAt: iso(now - 2 * 86400000),
        reviewedAt: iso(now - 86400000),
        versions: [
          { version: 1, category: "外包装破损", amount: 480, vouchers: ["EV-7710"], reason: FIRST_CLAIM_REASON, createdAt: iso(now - 2 * 86400000) },
        ],
      },
    ],
    occupations: [
      { id: "occ-1", claimId: "claim-1", station: "城东站点", date: today, amount: 600, state: "占用中", createdAt: iso(now - 30000), expiresAt: iso(now + 90000) },
    ],
  };
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (
        parsed &&
        Array.isArray(parsed.orders) &&
        Array.isArray(parsed.claims) &&
        Array.isArray(parsed.occupations)
      ) {
        return parsed;
      }
    }
  } catch {
    // 数据损坏时回退到种子数据
  }
  return seedState();
}

export const useClaimStore = defineStore("damageClaims", () => {
  const initial = loadState();
  const orders = ref<DeliveryOrder[]>(initial.orders);
  const claims = ref<DamageClaim[]>(initial.claims);
  const occupations = ref<QuotaOccupation[]>(initial.occupations);

  const pendingClaims = computed(() => claims.value.filter((claim) => claim.status === "待复核"));

  function persist() {
    const state: PersistedState = {
      orders: orders.value,
      claims: claims.value,
      occupations: occupations.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function paidOn(station: string, date: string): number {
    return paidOnDate(claims.value, station, date);
  }

  function occupiedOn(station: string, date: string): number {
    return occupiedOnDate(occupations.value, station, date);
  }

  /** 释放超时占用，返回释放笔数 */
  function releaseExpired(): number {
    const count = releaseExpiredOccupations(occupations.value, Date.now());
    if (count > 0) persist();
    return count;
  }

  /** 骑手登记货损认领 */
  function submitClaim(input: ClaimInput): ActionResult {
    if (input.vouchers.length === 0) {
      return { ok: false, message: "请至少填写一个凭证编号" };
    }
    const now = Date.now();
    // 放行前先释放超时占用
    releaseExpiredOccupations(occupations.value, now);
    const order = orders.value.find((item) => item.id === input.orderId);
    if (!order) {
      persist();
      return { ok: false, message: "订单不存在" };
    }
    const rule = STATION_RULES[order.station];
    if (!rule) {
      persist();
      return { ok: false, message: `站点 ${order.station} 未配置赔付规则` };
    }
    const verdict = judgeSubmission({
      order,
      claims: claims.value,
      occupations: occupations.value,
      station: order.station,
      date: dayKey(new Date(now)),
      amount: input.amount,
      rule,
    });
    if (!verdict.ok) {
      persist();
      return { ok: false, message: verdict.reason };
    }
    const claim: DamageClaim = {
      id: crypto.randomUUID(),
      orderId: order.id,
      orderCode: order.code,
      rider: order.rider,
      station: order.station,
      date: dayKey(new Date(now)),
      status: "待复核",
      createdAt: iso(now),
      versions: [
        {
          version: 1,
          category: input.category,
          amount: input.amount,
          vouchers: [...input.vouchers],
          reason: FIRST_CLAIM_REASON,
          createdAt: iso(now),
        },
      ],
    };
    claims.value = [claim, ...claims.value];
    if (verdict.needOccupy > 0) {
      occupations.value.push({
        id: crypto.randomUUID(),
        claimId: claim.id,
        station: claim.station,
        date: claim.date,
        amount: verdict.needOccupy,
        state: "占用中",
        createdAt: iso(now),
        expiresAt: iso(now + OCCUPATION_TIMEOUT_MS),
      });
    }
    persist();
    return {
      ok: true,
      message:
        verdict.needOccupy > 0
          ? `已登记：当日赔付触及上限，超出 ${verdict.needOccupy} 元占用待复核额度`
          : "已登记，等待复核",
    };
  }

  /** 复核：通过后订单结案，占用放行；驳回则释放占用 */
  function reviewClaim(claimId: string, pass: boolean): ActionResult {
    const claim = claims.value.find((item) => item.id === claimId);
    if (!claim) return { ok: false, message: "认领单不存在" };
    if (claim.status !== "待复核") return { ok: false, message: "仅待复核的认领可复核" };
    const now = Date.now();
    claim.reviewedAt = iso(now);
    const held = occupations.value.filter((occ) => occ.claimId === claim.id && occ.state === "占用中");
    if (pass) {
      claim.status = "已通过";
      const order = orders.value.find((item) => item.id === claim.orderId);
      if (order) order.status = "已结案";
      for (const occ of held) {
        occ.state = "已放行";
        occ.closedAt = iso(now);
      }
    } else {
      claim.status = "已驳回";
      for (const occ of held) {
        occ.state = "已释放";
        occ.closedAt = iso(now);
      }
    }
    persist();
    return {
      ok: true,
      message: pass ? `复核通过，订单 ${claim.orderCode} 已结案` : "已驳回，占用额度已释放",
    };
  }

  /** 补证：生成带原因的新版本，旧金额与凭证清单保留 */
  function supplementClaim(input: SupplementInput): ActionResult {
    const claim = claims.value.find((item) => item.id === input.claimId);
    if (!claim) return { ok: false, message: "认领单不存在" };
    if (!input.reason) return { ok: false, message: "补证需填写原因" };
    const now = Date.now();
    releaseExpiredOccupations(occupations.value, now);
    const rule = STATION_RULES[claim.station];
    if (!rule) {
      persist();
      return { ok: false, message: `站点 ${claim.station} 未配置赔付规则` };
    }
    const verdict = judgeSupplement({
      claim,
      claims: claims.value,
      occupations: occupations.value,
      newAmount: input.amount,
      rule,
    });
    if (!verdict.ok) {
      persist();
      return { ok: false, message: verdict.reason };
    }
    const previous = currentVersion(claim);
    const vouchers = [...previous.vouchers];
    for (const voucher of input.addVouchers) {
      if (!vouchers.includes(voucher)) vouchers.push(voucher);
    }
    claim.versions.push({
      version: previous.version + 1,
      category: input.category,
      amount: input.amount,
      vouchers,
      reason: input.reason,
      createdAt: iso(now),
    });
    // 待复核认领的额度占用随新版本金额调整
    if (claim.status === "待复核") {
      const held = occupations.value.find((occ) => occ.claimId === claim.id && occ.state === "占用中");
      if (held && verdict.needOccupy === 0) {
        held.state = "已释放";
        held.closedAt = iso(now);
      } else if (held) {
        held.amount = verdict.needOccupy;
        held.expiresAt = iso(now + OCCUPATION_TIMEOUT_MS);
      } else if (verdict.needOccupy > 0) {
        occupations.value.push({
          id: crypto.randomUUID(),
          claimId: claim.id,
          station: claim.station,
          date: claim.date,
          amount: verdict.needOccupy,
          state: "占用中",
          createdAt: iso(now),
          expiresAt: iso(now + OCCUPATION_TIMEOUT_MS),
        });
      }
    }
    persist();
    return { ok: true, message: `已生成 v${previous.version + 1} 补证版本，旧金额与凭证清单保留` };
  }

  return {
    orders,
    claims,
    occupations,
    pendingClaims,
    paidOn,
    occupiedOn,
    releaseExpired,
    submitClaim,
    reviewClaim,
    supplementClaim,
  };
});
