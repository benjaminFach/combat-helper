<script setup>
defineProps({
  busy: { type: Boolean, default: false },
});
defineEmits(['rest']);
</script>

<template>
  <div class="flex items-center gap-2" role="group" aria-label="Party rest controls">
    <button
      type="button"
      data-testid="short-rest"
      class="rounded border border-edge px-3 py-1.5 text-sm text-parchment transition-colors duration-100
        hover:border-ember hover:text-ember focus-visible:outline focus-visible:outline-2
        focus-visible:outline-ember disabled:cursor-not-allowed disabled:opacity-40
        motion-reduce:transition-none"
      :disabled="busy"
      @click="$emit('rest', 'short_rest')"
    >
      Take short rest
    </button>
    <button
      type="button"
      data-testid="long-rest"
      class="rounded border border-ember bg-ember/15 px-3 py-1.5 text-sm text-ember transition-colors
        duration-100 hover:bg-ember/25 focus-visible:outline focus-visible:outline-2
        focus-visible:outline-ember disabled:cursor-not-allowed disabled:opacity-40
        motion-reduce:transition-none"
      :disabled="busy"
      @click="$emit('rest', 'long_rest')"
    >
      Take long rest
    </button>
  </div>
</template>
