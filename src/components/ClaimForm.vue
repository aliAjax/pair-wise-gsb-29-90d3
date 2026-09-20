<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { DAMAGE_CATEGORIES } from "../domain/config";
import { useClaimStore } from "../store/claimStore";

const store = useClaimStore();

const form = reactive({
  orderId: "",
  category: DAMAGE_CATEGORIES[0] as string,
  voucherText: "",
  amount: 100,
});

const feedback = ref<{ ok: boolean; text: string } | null>(null);

const pendingOrderIds = computed(() => new Set(store.pendingClaims.map((claim) => claim.orderId)));
const selectableOrders = computed(() => store.orders.filter((order) => order.status !== "已结案"));

function orderLabel(order: { id: string; code: string; rider: string; station: string }) {
  const blocked = pendingOrderIds.value.has(order.id) ? "（待复核中）" : "";
  return `${order.code} / ${order.rider} / ${order.station}${blocked}`;
}

function submit() {
  if (!form.orderId) {
    feedback.value = { ok: false, text: "请选择订单" };
    return;
  }
  const vouchers = form.voucherText
    .split(/[,，\s]+/)
    .map((voucher) => voucher.trim())
    .filter(Boolean);
  const result = store.submitClaim({
    orderId: form.orderId,
    category: form.category,
    amount: Number(form.amount),
    vouchers,
  });
  feedback.value = { ok: result.ok, text: result.message };
  if (result.ok) {
    form.voucherText = "";
    form.amount = 100;
  }
}
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <h2>货损认领登记</h2>
    <div class="form-grid">
      <label>
        订单
        <select v-model="form.orderId" required>
          <option value="">请选择订单</option>
          <option v-for="order in selectableOrders" :key="order.id" :value="order.id">
            {{ orderLabel(order) }}
          </option>
        </select>
      </label>
      <label>
        破损类别
        <select v-model="form.category">
          <option v-for="item in DAMAGE_CATEGORIES" :key="item">{{ item }}</option>
        </select>
      </label>
      <label>
        凭证编号（多个用逗号分隔）
        <input v-model="form.voucherText" placeholder="如 EV-8801, EV-8802" required />
      </label>
      <label>
        申报金额（元）
        <input v-model="form.amount" type="number" min="0.01" step="0.01" required />
      </label>
      <button type="submit">提交认领</button>
      <p v-if="feedback" class="feedback" :class="feedback.ok ? 'feedback-ok' : 'feedback-err'">
        {{ feedback.text }}
      </p>
    </div>
  </form>
</template>
