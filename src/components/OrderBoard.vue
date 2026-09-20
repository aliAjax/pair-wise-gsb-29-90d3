<script setup lang="ts">
import { useClaimStore } from "../store/claimStore";

const store = useClaimStore();

function hasPendingClaim(orderId: string) {
  return store.claims.some((claim) => claim.orderId === orderId && claim.status === "待复核");
}
</script>

<template>
  <section class="panel orders">
    <h2>订单资料</h2>
    <div class="order-grid">
      <article v-for="order in store.orders" :key="order.id" class="order-card">
        <div class="record-head">
          <p class="record-title">{{ order.code }}</p>
          <span class="pill" :class="order.status === '已结案' ? 'pill-approved' : 'pill-hold'">
            {{ order.status }}
          </span>
        </div>
        <div class="details">
          <span>骑手: {{ order.rider }}</span>
          <span>站点: {{ order.station }}</span>
          <span>地址: {{ order.address }}</span>
          <span>时段: {{ order.slot }}</span>
        </div>
        <p v-if="hasPendingClaim(order.id)" class="flag">存在待复核认领，后续申请已阻止</p>
      </article>
    </div>
  </section>
</template>
