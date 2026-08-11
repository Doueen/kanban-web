<script setup>
defineProps({
  label: { type: String, required: true },
  desc: { type: String, default: "" },
  modelValue: { type: Boolean, default: true },
});

const emit = defineEmits(["update:modelValue"]);
</script>

<template>
  <van-cell
    :title="label"
    :label="desc"
    center
    clickable
    @click="emit('update:modelValue', !modelValue)"
  >
    <template #right-icon>
      <van-switch
        :model-value="modelValue"
        @click.stop="emit('update:modelValue', !modelValue)"
      />
    </template>
  </van-cell>
</template>
