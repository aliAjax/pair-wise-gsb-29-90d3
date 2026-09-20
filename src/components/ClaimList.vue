<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { currentVersion } from "../domain/claims";
import { DAMAGE_CATEGORIES } from "../domain/config";
import type { ClaimStatus, DamageClaim } from "../domain/types";
import { useClaimStore } from "../store/claimStore";

const store = useClaimStore();

const filters = ["全部状态", "待复核", "已通过", "已驳回"] as const;
const filter = ref<(typeof filters)[number]>("全部状态");

const list = computed(() =>
  filter.value === "全部状态" ? store.claims : store.claims.filter((claim) => claim.status === filter.value)
);

const statusClass: Record<ClaimStatus, string> = {
  待复核: "pill-pending",
  已通过: "pill-approved",
  已驳回: "pill-rejected",
};

const editingId = ref<string | null>(null);
const draft = reactive({ category: "", amount: 0, voucherText: "", reason: "" });
const messages = ref<Record<string, { ok: boolean; text: string }>>({});

function setMessage(claimId: string, message: { ok: boolean; text: string }) {
  messages.value = { ...messages.value, [claimId]: message };
}

function startSupplement(claim: DamageClaim) {
  const version = currentVersion(claim);
  editingId.value = claim.id;
  draft.category = version.category;
  draft.amount = version.amount;
  draft.voucherText = "";
  draft.reason = "";
}

function submitSupplement(claim: DamageClaim) {
  const addVouchers = draft.voucherText
    .split(/[,，\s]+/)
    .map((voucher) => voucher.trim())
    .filter(Boolean);
  const result = store.supplementClaim({
    claimId: claim.id,
    category: draft.category,
    amount: Number(draft.amount),
    addVouchers,
    reason: draft.reason.trim(),
  });
  setMessage(claim.id, { ok: result.ok, text: result.message });
  if (result.ok) editingId.value = null;
}

function review(claim: DamageClaim, pass: boolean) {
  const result = store.reviewClaim(claim.id, pass);
  setMessage(claim.id, { ok: result.ok, text: result.message });
}

function timeText(isoTime: string) {
  return new Date(isoTime).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>认领复核</h2>
      <select v-model="filter">
        <option v-for="item in filters" :key="item">{{ item }}</option>
      </select>
    </div>

    <div class="record-grid">
      <div v-if="list.length === 0" class="empty">暂无认领记录</div>
      <article v-for="claim in list" :key="claim.id" class="record">
        <div class="record-head">
          <p class="record-title">{{ claim.orderCode }} / {{ claim.rider }} / {{ claim.station }}</p>
          <span class="pill" :class="statusClass[claim.status]">{{ claim.status }}</span>
        </div>

        <div class="details">
          <span>破损类别: {{ currentVersion(claim).category }}</span>
          <span>申报金额: {{ currentVersion(claim).amount }} 元</span>
          <span>当前版本: v{{ currentVersion(claim).version }}</span>
          <span>申报时间: {{ timeText(claim.createdAt) }}</span>
        </div>
        <div class="chips">
          <span v-for="voucher in currentVersion(claim).vouchers" :key="voucher" class="chip">
            {{ voucher }}
          </span>
        </div>

        <div class="timeline">
          <div
            v-for="version in [...claim.versions].reverse()"
            :key="version.version"
            class="timeline-item"
            :class="{ old: version.version !== currentVersion(claim).version }"
          >
            <strong>v{{ version.version }}</strong>
            <span> · {{ version.amount }} 元 · {{ version.reason }} · {{ timeText(version.createdAt) }}</span>
            <div class="chips">
              <span v-for="voucher in version.vouchers" :key="voucher" class="chip">{{ voucher }}</span>
            </div>
          </div>
        </div>

        <p v-if="messages[claim.id]" class="feedback" :class="messages[claim.id].ok ? 'feedback-ok' : 'feedback-err'">
          {{ messages[claim.id].text }}
        </p>

        <div v-if="editingId === claim.id" class="subform">
          <label>
            破损类别
            <select v-model="draft.category">
              <option v-for="item in DAMAGE_CATEGORIES" :key="item">{{ item }}</option>
            </select>
          </label>
          <label>
            新申报金额（元）
            <input v-model="draft.amount" type="number" min="0.01" step="0.01" />
          </label>
          <label>
            追加凭证编号（多个用逗号分隔）
            <input v-model="draft.voucherText" placeholder="留空则沿用原凭证清单" />
          </label>
          <label>
            补证原因
            <textarea v-model="draft.reason" placeholder="必填，说明补证原因" />
          </label>
          <div class="actions">
            <button type="button" @click="submitSupplement(claim)">生成新版本</button>
            <button type="button" class="secondary" @click="editingId = null">取消</button>
          </div>
        </div>

        <div class="actions">
          <template v-if="claim.status === '待复核'">
            <button type="button" @click="review(claim, true)">复核通过并结案</button>
            <button type="button" class="danger" @click="review(claim, false)">复核驳回</button>
            <button type="button" class="secondary" @click="startSupplement(claim)">补证</button>
          </template>
          <template v-else-if="claim.status === '已通过'">
            <span class="closed-hint">订单已结案</span>
            <button type="button" class="secondary" @click="startSupplement(claim)">补证</button>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>
