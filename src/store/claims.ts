/**
 * 状态与持久化：把订单资料（data/orders）与赔付判断（domain/compensation）接到一起，
 * 认领记录、额度占用、补证版本整体写入 localStorage，重载后三者关系保持一致。
 */

import { reactive } from "vue";
import {
  approveClaim,
  fileClaim,
  rejectClaim,
  supplementClaim,
  sweepOccupations,
  ORDER_CLOSED_STATUS,
  type Claim,
  type ClaimInput,
  type Occupation,
  type Verdict,
} from "../domain/compensation";
import {
  nextFlowStatus,
  seedOrders,
  type OrderPoint,
  type Rider,
} from "../data/orders";

const STORAGE_KEY = "hxwlfront-15-damage-claims";

interface PersistedState {
  orders: OrderPoint[];
  claims: Claim[];
  occupations: Occupation[];
}

function freshState(): PersistedState {
  return { orders: seedOrders(), claims: [], occupations: [] };
}

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (
        Array.isArray(parsed.orders) &&
        Array.isArray(parsed.claims) &&
        Array.isArray(parsed.occupations)
      ) {
        return {
          orders: parsed.orders,
          claims: parsed.claims,
          occupations: parsed.occupations,
        };
      }
    }
  } catch {
    // 数据损坏时回退到种子数据
  }
  return freshState();
}

export const state = reactive<PersistedState>(load());

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      orders: state.orders,
      claims: state.claims,
      occupations: state.occupations,
    })
  );
}

export function addOrder(input: {
  rider: Rider;
  address: string;
  distance: number;
  slot: string;
  notes: string;
}) {
  const order: OrderPoint = {
    id: `ORD-${String(1000 + state.orders.length + 1).padStart(4, "0")}-${crypto.randomUUID().slice(0, 4)}`,
    rider: input.rider,
    address: input.address,
    distance: input.distance,
    slot: input.slot,
    status: "未分配",
    notes: input.notes || "暂无备注",
    createdAt: new Date().toISOString(),
  };
  state.orders = [order, ...state.orders];
  persist();
}

export function flowOrder(orderId: string) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || order.status === ORDER_CLOSED_STATUS) return;
  order.status = nextFlowStatus(order.status);
  persist();
}

export function submitClaim(input: ClaimInput): Verdict {
  const now = new Date();
  const order = state.orders.find((item) => item.id === input.orderId);
  const result = fileClaim({
    claims: state.claims,
    occupations: state.occupations,
    order,
    // 骑手以订单资料为准，不信任表单传入值
    input: { ...input, rider: order?.rider ?? input.rider },
    now,
  });
  if (!result.ok) return result;
  state.claims = [result.claim, ...state.claims];
  state.occupations = result.occupations;
  persist();
  return { ok: true };
}

export function supplement(claimId: string, reason: string, amount: number, vouchers: string[]): Verdict {
  const result = supplementClaim({
    claims: state.claims,
    occupations: state.occupations,
    claimId,
    reason,
    amount,
    vouchers,
    now: new Date(),
  });
  if (!result.ok) return result;
  state.claims = result.claims;
  state.occupations = result.occupations;
  persist();
  return { ok: true };
}

export function approve(claimId: string): Verdict {
  const result = approveClaim({
    claims: state.claims,
    occupations: state.occupations,
    claimId,
    now: new Date(),
  });
  if (!result.ok) return result;
  state.claims = result.claims;
  state.occupations = result.occupations;
  // 复核通过后订单结案
  state.orders = state.orders.map((order) =>
    order.id === result.closedOrderId
      ? { ...order, status: ORDER_CLOSED_STATUS }
      : order
  );
  persist();
  return { ok: true };
}

export function reject(claimId: string): Verdict {
  const result = rejectClaim({
    claims: state.claims,
    occupations: state.occupations,
    claimId,
    now: new Date(),
  });
  if (!result.ok) return result;
  state.claims = result.claims;
  state.occupations = result.occupations;
  persist();
  return { ok: true };
}

/** 释放超时占用，返回释放的笔数 */
export function releaseExpired(): number {
  const { occupations, released } = sweepOccupations(state.occupations, new Date());
  if (released.length > 0) {
    state.occupations = occupations;
    persist();
  }
  return released.length;
}

export function resetAll() {
  const fresh = freshState();
  state.orders = fresh.orders;
  state.claims = fresh.claims;
  state.occupations = fresh.occupations;
  persist();
}
