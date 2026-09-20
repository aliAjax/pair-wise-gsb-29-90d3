/**
 * 订单资料：站点订单点位的静态配置与种子数据。
 * 赔付判断见 src/domain/compensation.ts，页面呈现见 src/App.vue。
 */

import { ORDER_CLOSED_STATUS } from "../domain/compensation";

export const projectMeta = {
  industry: "物流",
  title: "城市末端配送模拟 · 货损认领与赔付复核",
  subtitle:
    "骑手登记破损类别、凭证编号与申报金额；同一订单待复核期间阻止重复申报。站点当日赔付累计触及上限后，超出部分占用待复核额度，释放超时占用后才能放行；复核通过后订单结案，补证生成带原因的新版本。",
  stack: ["Vue3", "Vite", "TypeScript", "Element Plus", "Leaflet"],
} as const;

export const RIDERS = ["骑手A", "骑手B", "骑手C"] as const;
export type Rider = (typeof RIDERS)[number];

/** 配送流转状态（结案只能由复核通过触发，不参与流转） */
export const ORDER_FLOW_STATUSES = ["未分配", "已分配", "已送达"] as const;
export type OrderStatus = (typeof ORDER_FLOW_STATUSES)[number] | typeof ORDER_CLOSED_STATUS;

export interface OrderPoint {
  id: string;
  rider: Rider;
  address: string;
  distance: number;
  slot: string;
  status: OrderStatus;
  notes: string;
  createdAt: string;
}

export function nextFlowStatus(status: OrderStatus): OrderStatus {
  const index = ORDER_FLOW_STATUSES.indexOf(status as (typeof ORDER_FLOW_STATUSES)[number]);
  if (index < 0) return status;
  return ORDER_FLOW_STATUSES[(index + 1) % ORDER_FLOW_STATUSES.length];
}

export function seedOrders(): OrderPoint[] {
  const base = Date.now();
  const seed: Array<Omit<OrderPoint, "createdAt">> = [
    { id: "ORD-1001", rider: "骑手A", address: "世纪大道", distance: 1.8, slot: "10:00-12:00", status: "已分配", notes: "优先配送" },
    { id: "ORD-1002", rider: "骑手B", address: "陆家嘴", distance: 2.4, slot: "14:00-16:00", status: "未分配", notes: "待确认" },
    { id: "ORD-1003", rider: "骑手C", address: "张江高科", distance: 3.1, slot: "09:00-11:00", status: "已送达", notes: "客户已签收" },
    { id: "ORD-1004", rider: "骑手A", address: "静安寺", distance: 0.9, slot: "16:00-18:00", status: "已分配", notes: "易碎品，轻拿轻放" },
  ];
  return seed.map((order, index) => ({
    ...order,
    createdAt: new Date(base - index * 86400000).toISOString(),
  }));
}
