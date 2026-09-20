<script setup lang="ts">
import { computed } from "vue";
import ClaimForm from "./components/ClaimForm.vue";
import ClaimList from "./components/ClaimList.vue";
import OrderBoard from "./components/OrderBoard.vue";
import QuotaPanel from "./components/QuotaPanel.vue";
import { dayKey } from "./domain/claims";
import { STATIONS } from "./domain/config";
import { useClaimStore } from "./store/claimStore";

const store = useClaimStore();

const stack = ["Vue3", "Vite", "TypeScript", "Pinia", "Element Plus"];

const metrics = computed(() => {
  const today = dayKey(new Date());
  const paid = STATIONS.reduce((sum, station) => sum + store.paidOn(station, today), 0);
  const occupied = STATIONS.reduce((sum, station) => sum + store.occupiedOn(station, today), 0);
  return [
    { label: "认领单", value: store.claims.length },
    { label: "待复核", value: store.pendingClaims.length },
    { label: "今日已赔付（元）", value: paid },
    { label: "额度占用（元）", value: occupied },
  ];
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流行业前端最小闭环</p>
          <h1>城市末端配送模拟 · 货损认领与赔付复核</h1>
          <p class="subtitle">
            骑手登记破损类别、凭证编号与申报金额；同一订单待复核时，后续申请直接阻止。
            站点当日赔付累计触及上限后，超出部分占用待复核额度，释放超时占用后才能放行。
            复核通过后订单结案，补证生成带原因的新版本，旧金额与凭证清单保留。
          </p>
        </div>
        <div class="stack">
          <span v-for="item in stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="metric in metrics" :key="metric.label" class="metric">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </section>

      <section class="workspace">
        <div class="side">
          <ClaimForm />
          <QuotaPanel />
        </div>
        <ClaimList />
      </section>

      <OrderBoard />
    </div>
  </main>
</template>
