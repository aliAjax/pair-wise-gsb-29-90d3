export type OrderStatus = "配送中" | "已送达" | "已结案";
export type ClaimStatus = "待复核" | "已通过" | "已驳回";
export type OccupationState = "占用中" | "已放行" | "已释放";

/** 订单资料 */
export interface DeliveryOrder {
  id: string;
  code: string;
  rider: string;
  station: string;
  address: string;
  slot: string;
  status: OrderStatus;
  createdAt: string;
}

/** 认领单的一个申报版本：补证生成新版本，旧金额与凭证清单保留 */
export interface ClaimVersion {
  version: number;
  category: string;
  amount: number;
  vouchers: string[];
  reason: string;
  createdAt: string;
}

/** 货损认领单 */
export interface DamageClaim {
  id: string;
  orderId: string;
  orderCode: string;
  rider: string;
  station: string;
  /** 申报日期（额度按日累计），格式 YYYY-MM-DD */
  date: string;
  status: ClaimStatus;
  versions: ClaimVersion[];
  createdAt: string;
  reviewedAt?: string;
}

/** 待复核额度占用记录 */
export interface QuotaOccupation {
  id: string;
  claimId: string;
  station: string;
  date: string;
  amount: number;
  state: OccupationState;
  createdAt: string;
  expiresAt: string;
  closedAt?: string;
}
