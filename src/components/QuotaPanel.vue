<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { dayKey } from "../domain/claims";
import { STATION_RULES, STATIONS } from "../domain/config";
import { useClaimStore } from "../store/claimStore";

const store = useClaimStore();

const now = ref(Date.now());
const timer = setInterval(() => {
  now.value = Date.now();
}, 1000);
onUnmounted(() => clearInterval(timer));

const releaseMsg = ref("");
const today = computed(() => dayKey(new Date(now.value)));

const rows = computed(() =>
  STATIONS.map((station) => {
    const rule = STATION_RULES[station];
    return {
      station,
      rule,
      paid: store.paidOn(station, today.value),
      occupied: store.occupiedOn(station, today.value),
      holds: store.occupations.filter(
        (occ) => occ.station === station && occ.date === today.value && occ.state === "占用中"
      ),
    };
  })
);

function remainText(expiresAt: string) {
  const ms = Date.parse(expiresAt) - now.value;
  if (ms <= 0) return "已超时，待释放";
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = `${total % 60}`.padStart(2, "0");
  return `剩余 ${minutes}:${seconds}`;
}

function claimLabel(claimId: string) {
  return store.claims.find((claim) => claim.id === claimId)?.orderCode ?? claimId;
}

function release() {
  const count = store.releaseExpired();
  releaseMsg.value = count > 0 ? `已释放 ${count} 笔超时占用` : "暂无超时占用";
}
</script>

<template>
  <section class="panel">
    <div class="toolbar">
      <h2>站点赔付额度</h2>
      <button type="button" class="secondary" @click="release">释放超时占用</button>
    </div>
    <p v-if="releaseMsg" class="feedback feedback-ok">{{ releaseMsg }}</p>
    <div v-for="row in rows" :key="row.station" class="quota-block">
      <h3>{{ row.station }}</h3>
      <div class="bar">
        <span>当日赔付</span>
        <div class="bar-track">
          <div
            class="bar-fill"
            :class="{ warn: row.paid >= row.rule.dailyCap }"
            :style="{ width: `${Math.min(100, (row.paid / row.rule.dailyCap) * 100)}%` }"
          />
        </div>
        <strong>{{ row.paid }}/{{ row.rule.dailyCap }}</strong>
      </div>
      <div class="bar">
        <span>待复核额度</span>
        <div class="bar-track">
          <div
            class="bar-fill warn"
            :style="{ width: `${Math.min(100, (row.occupied / row.rule.pendingQuota) * 100)}%` }"
          />
        </div>
        <strong>{{ row.occupied }}/{{ row.rule.pendingQuota }}</strong>
      </div>
      <ul v-if="row.holds.length" class="occupations">
        <li v-for="hold in row.holds" :key="hold.id">
          <span>{{ claimLabel(hold.claimId) }} 占用 {{ hold.amount }} 元</span>
          <span class="remain">{{ remainText(hold.expiresAt) }}</span>
        </li>
      </ul>
      <p v-else class="quota-empty">暂无额度占用</p>
    </div>
  </section>
</template>
