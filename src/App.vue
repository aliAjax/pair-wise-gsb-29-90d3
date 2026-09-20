<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import {
  RIDERS,
  projectMeta,
  type OrderPoint,
} from "./data/orders";
import {
  CLAIM_STATUSES,
  DAMAGE_CATEGORIES,
  ORDER_CLOSED_STATUS,
  STATION_POLICY,
  activeOccupied,
  committedToday,
  expiredOccupations,
  isOccupationActive,
  paidToday,
  pendingClaimFor,
  type Claim,
  type ClaimStatus,
  type Occupation,
  type Verdict,
} from "./domain/compensation";
import {
  addOrder,
  approve,
  flowOrder,
  reject,
  releaseExpired,
  resetAll,
  state,
  submitClaim,
  supplement,
} from "./store/claims";

/* 页面呈现只负责组装：订单资料来自 data/orders，赔付判断来自 domain/compensation */

const now = ref(new Date());
const timer = setInterval(() => {
  now.value = new Date();
}, 1000);
onUnmounted(() => clearInterval(timer));

const riderFilter = ref("全部骑手");
const filters = ["全部骑手", ...RIDERS];

const flash = ref<{ kind: "ok" | "error"; text: string } | null>(null);
function applyVerdict(verdict: Verdict, okText: string) {
  flash.value = verdict.ok ? { kind: "ok", text: okText } : { kind: "error", text: verdict.reason };
}

/* ---------- 货损申报 ---------- */
const claimForm = reactive({
  orderId: "",
  category: DAMAGE_CATEGORIES[0] as (typeof DAMAGE_CATEGORIES)[number],
  vouchersText: "",
  amount: 100,
});

const claimableOrders = computed(() =>
  state.orders.filter((order) => order.status !== ORDER_CLOSED_STATUS)
);

const selectedOrder = computed(() =>
  state.orders.find((order) => order.id === claimForm.orderId)
);

function parseVouchers(text: string): string[] {
  return text.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean);
}

function submitClaimForm() {
  const result = submitClaim({
    orderId: claimForm.orderId,
    rider: selectedOrder.value?.rider ?? "",
    category: claimForm.category,
    amount: claimForm.amount,
    vouchers: parseVouchers(claimForm.vouchersText),
  });
  applyVerdict(result, "申报成功，已进入待复核队列");
  if (result.ok) {
    claimForm.orderId = "";
    claimForm.vouchersText = "";
    claimForm.amount = 100;
  }
}

/* ---------- 复核 / 补证 ---------- */
const supplementingId = ref<string | null>(null);
const supplementForm = reactive({ reason: "", amount: 0, vouchersText: "" });

function openSupplement(claim: Claim) {
  supplementingId.value = claim.id;
  supplementForm.reason = "";
  supplementForm.amount = claim.amount;
  supplementForm.vouchersText = claim.vouchers.join(", ");
}

function submitSupplement(claim: Claim) {
  const nextVersion = claim.versions.length + 1;
  const result = supplement(
    claim.id,
    supplementForm.reason,
    supplementForm.amount,
    parseVouchers(supplementForm.vouchersText)
  );
  applyVerdict(result, `补证成功，已生成 v${nextVersion} 版本`);
  if (result.ok) supplementingId.value = null;
}

function approveClaimAction(claim: Claim) {
  applyVerdict(approve(claim.id), "复核通过，订单已结案");
}

function rejectClaimAction(claim: Claim) {
  applyVerdict(reject(claim.id), "已驳回，该申请占用的额度已释放");
}

/* ---------- 额度占用 ---------- */
const sortedOccupations = computed(() =>
  [...state.occupations].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);

const expiredCount = computed(() => expiredOccupations(state.occupations, now.value).length);

function releaseExpiredAction() {
  const count = releaseExpired();
  flash.value =
    count > 0
      ? { kind: "ok", text: `已释放 ${count} 笔超时占用，可继续放行` }
      : { kind: "error", text: "暂无已超时的占用" };
}

function resetAllAction() {
  if (!window.confirm("确定重置全部演示数据？认领、额度占用与版本记录都会清空。")) return;
  resetAll();
  flash.value = { kind: "ok", text: "已重置为种子数据" };
}

/* ---------- 订单 ---------- */
const orderForm = reactive({ rider: RIDERS[0] as (typeof RIDERS)[number], address: "", distance: 1, slot: "", notes: "" });

function submitOrder() {
  addOrder({ ...orderForm });
  orderForm.address = "";
  orderForm.slot = "";
  orderForm.notes = "";
  flash.value = { kind: "ok", text: "订单点已加入清单" };
}

const filteredOrders = computed(() =>
  riderFilter.value === "全部骑手"
    ? state.orders
    : state.orders.filter((order) => order.rider === riderFilter.value)
);

function claimsOf(order: OrderPoint): Claim[] {
  return state.claims.filter((claim) => claim.orderId === order.id);
}

function orderOptionLabel(order: OrderPoint): string {
  const pending = pendingClaimFor(state.claims, order.id) ? " · 待复核中" : "";
  return `${order.id} · ${order.rider} · ${order.address}（${order.status}${pending}）`;
}

function claimOfOccupation(occupation: Occupation): Claim | undefined {
  return state.claims.find((claim) => claim.id === occupation.claimId);
}

/* ---------- 指标与图表 ---------- */
const metrics = computed(() => {
  const committed = committedToday(state.claims, now.value);
  const occupied = activeOccupied(state.occupations, now.value);
  const pending = state.claims.filter((claim) => claim.status === "待复核").length;
  const closed = state.orders.filter((order) => order.status === ORDER_CLOSED_STATUS).length;
  return { committed, occupied, pending, closed, paid: paidToday(state.claims, now.value) };
});

const chartRows = computed(() =>
  CLAIM_STATUSES.map((status) => ({
    status,
    value: state.claims.filter((claim) => claim.status === status).length,
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

/* ---------- 展示辅助 ---------- */
function fmtTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function countdown(occupation: Occupation): string {
  const ms = new Date(occupation.expiresAt).getTime() - now.value.getTime();
  if (ms <= 0) return "已超时";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `剩余 ${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

function claimStatusClass(status: ClaimStatus): string {
  if (status === "待复核") return "is-pending";
  if (status === "已通过") return "is-approved";
  return "is-rejected";
}

function orderStatusClass(order: OrderPoint): string {
  return order.status === ORDER_CLOSED_STATUS ? "is-closed" : "";
}

const occupyTimeoutMinutes = Math.round(STATION_POLICY.occupyTimeoutMs / 60000);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ projectMeta.industry }}行业前端最小闭环 · 货损赔付扩展</p>
          <h1>{{ projectMeta.title }}</h1>
          <p class="subtitle">{{ projectMeta.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in projectMeta.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>今日申报累计 / 当日上限</span>
          <strong>¥{{ metrics.committed }} <small>/ ¥{{ STATION_POLICY.dailyCap }}</small></strong>
        </article>
        <article class="metric">
          <span>待复核额度占用 / 额度</span>
          <strong>¥{{ metrics.occupied }} <small>/ ¥{{ STATION_POLICY.reviewQuota }}</small></strong>
        </article>
        <article class="metric">
          <span>待复核申请</span>
          <strong>{{ metrics.pending }}</strong>
        </article>
        <article class="metric">
          <span>已结案订单（今日已赔付 ¥{{ metrics.paid }}）</span>
          <strong>{{ metrics.closed }}</strong>
        </article>
      </section>

      <section class="workspace">
        <div class="side">
          <form class="panel" @submit.prevent="submitClaimForm">
            <h2>货损认领申报</h2>
            <div class="form-grid">
              <label>
                订单
                <select v-model="claimForm.orderId" required>
                  <option value="">请选择订单</option>
                  <option v-for="order in claimableOrders" :key="order.id" :value="order.id">
                    {{ orderOptionLabel(order) }}
                  </option>
                </select>
              </label>
              <label>
                破损类别
                <select v-model="claimForm.category" required>
                  <option v-for="category in DAMAGE_CATEGORIES" :key="category">{{ category }}</option>
                </select>
              </label>
              <label>
                凭证编号
                <input v-model="claimForm.vouchersText" placeholder="多个凭证用逗号分隔，如 ZP-001, ZP-002" required />
              </label>
              <label>
                申报金额（元）
                <input v-model.number="claimForm.amount" type="number" min="0.01" step="0.01" required />
              </label>
              <p class="hint">
                申报骑手：{{ selectedOrder?.rider || "选择订单后自动带出" }}。同一订单待复核期间，后续申请将被直接阻止。
              </p>
              <button type="submit">提交申报</button>
            </div>
          </form>

          <section class="panel">
            <div class="toolbar">
              <h2>待复核额度占用</h2>
              <button type="button" class="secondary" :disabled="expiredCount === 0" @click="releaseExpiredAction">
                释放超时占用{{ expiredCount > 0 ? `（${expiredCount}）` : "" }}
              </button>
            </div>
            <p class="hint">
              当日赔付上限 ¥{{ STATION_POLICY.dailyCap }}，超出部分占用待复核额度 ¥{{ STATION_POLICY.reviewQuota }}，占用 {{ occupyTimeoutMinutes }} 分钟后超时，释放超时占用后才能放行。
            </p>
            <div v-if="sortedOccupations.length === 0" class="empty">暂无额度占用</div>
            <div v-for="occupation in sortedOccupations" :key="occupation.id" class="occupation" :class="{ released: occupation.releasedAt !== null }">
              <div>
                <strong>¥{{ occupation.amount }}</strong>
                <span class="occupation-order">
                  关联 {{ claimOfOccupation(occupation)?.orderId ?? occupation.claimId }}
                </span>
              </div>
              <span v-if="isOccupationActive(occupation, now)" class="occupation-active">{{ countdown(occupation) }}</span>
              <span v-else-if="occupation.releasedAt" class="occupation-released">已释放 · {{ occupation.releaseReason }}</span>
              <span v-else class="occupation-expired">已超时，待释放</span>
            </div>
            <button type="button" class="danger reset" @click="resetAllAction">重置演示数据</button>
          </section>

          <form class="panel" @submit.prevent="submitOrder">
            <h2>新增订单点</h2>
            <div class="form-grid">
              <label>
                骑手
                <select v-model="orderForm.rider" required>
                  <option v-for="rider in RIDERS" :key="rider">{{ rider }}</option>
                </select>
              </label>
              <label>
                地址
                <input v-model="orderForm.address" required />
              </label>
              <label>
                距离km
                <input v-model.number="orderForm.distance" type="number" min="0" step="0.1" required />
              </label>
              <label>
                配送时段
                <input v-model="orderForm.slot" placeholder="如 10:00-12:00" required />
              </label>
              <label>
                备注
                <textarea v-model="orderForm.notes" placeholder="填写处理说明或现场备注" />
              </label>
              <button type="submit">加入清单</button>
            </div>
          </form>
        </div>

        <section class="list-panel">
          <div class="toolbar">
            <h2>订单与赔付申请</h2>
            <select v-model="riderFilter">
              <option v-for="item in filters" :key="item">{{ item }}</option>
            </select>
          </div>

          <p v-if="flash" class="flash" :class="flash.kind">{{ flash.text }}</p>

          <div class="record-grid">
            <div v-if="filteredOrders.length === 0" class="empty">暂无匹配订单</div>
            <article v-for="order in filteredOrders" :key="order.id" class="record">
              <div class="record-head">
                <p class="record-title">订单 {{ order.id }} · {{ order.rider }}</p>
                <span class="status" :class="orderStatusClass(order)">{{ order.status }}</span>
              </div>
              <div class="details">
                <span>地址: {{ order.address }}</span>
                <span>距离: {{ order.distance }}km</span>
                <span>时段: {{ order.slot }}</span>
                <span>备注: {{ order.notes }}</span>
              </div>

              <div v-if="claimsOf(order).length > 0" class="claim-list">
                <div v-for="claim in claimsOf(order)" :key="claim.id" class="claim">
                  <div class="claim-head">
                    <strong>{{ claim.category }} · ¥{{ claim.amount }}</strong>
                    <span class="status" :class="claimStatusClass(claim.status)">{{ claim.status }}</span>
                  </div>
                  <div class="chips">
                    <span v-for="voucher in claim.vouchers" :key="voucher" class="chip">{{ voucher }}</span>
                  </div>
                  <p class="claim-meta">
                    申报 {{ fmtTime(claim.createdAt) }} · {{ claim.rider }}
                    <template v-if="claim.reviewedAt"> · 复核 {{ fmtTime(claim.reviewedAt) }}</template>
                  </p>
                  <div class="versions">
                    <div v-for="version in claim.versions" :key="version.version" class="version">
                      <span class="version-tag">v{{ version.version }}</span>
                      <span>{{ version.reason }} · ¥{{ version.amount }} · 凭证：{{ version.vouchers.join("、") }}</span>
                      <span class="version-time">{{ fmtTime(version.createdAt) }}</span>
                    </div>
                  </div>

                  <div v-if="claim.status === '待复核'" class="actions">
                    <button type="button" @click="approveClaimAction(claim)">复核通过</button>
                    <button type="button" class="danger" @click="rejectClaimAction(claim)">驳回</button>
                    <button type="button" class="secondary" @click="openSupplement(claim)">补证</button>
                  </div>

                  <form v-if="supplementingId === claim.id && claim.status === '待复核'" class="supplement" @submit.prevent="submitSupplement(claim)">
                    <label>
                      补证原因
                      <input v-model="supplementForm.reason" placeholder="如：客户补充开箱照片" required />
                    </label>
                    <label>
                      新申报金额（元）
                      <input v-model.number="supplementForm.amount" type="number" min="0.01" step="0.01" required />
                    </label>
                    <label>
                      新凭证编号
                      <input v-model="supplementForm.vouchersText" placeholder="多个凭证用逗号分隔" required />
                    </label>
                    <div class="actions">
                      <button type="submit">提交补证</button>
                      <button type="button" class="secondary" @click="supplementingId = null">取消</button>
                    </div>
                  </form>
                </div>
              </div>

              <div class="actions">
                <button type="button" :disabled="order.status === ORDER_CLOSED_STATUS" @click="flowOrder(order.id)">
                  流转状态
                </button>
                <span v-if="order.status === ORDER_CLOSED_STATUS" class="hint">复核通过，订单已结案</span>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
