<template>
  <material-modal :show="show" :bg-close="bgClose" :teleport="teleport" @close="handleClose">
    <main :class="$style.main">
      <h2>{{ info.name }}<br>{{ info.singer }}</h2>
      <h3 v-if="currentSourceName" :class="$style.sourceTip">
        {{ $t('download__current_source') }}: {{ currentSourceName }}
      </h3>
      <base-btn
        v-for="q in allQualityTiers"
        :key="q.type"
        :class="[$style.btn, q.needsSwitch && !q.hasSongQuality ? $style.btnDisabled : '']"
        :disabled="!q.hasSongQuality"
        @click="handleClick(q.type)"
      >
        {{ getTypeName(q.type) }}{{ q.size && ` - ${q.size.toUpperCase()}` }}
        <span v-if="q.hasSongQuality && q.needsSwitch" :class="$style.autoSwitch">
          {{ $t('download__auto_switch') }}
        </span>
        <span v-else-if="!q.hasSongQuality" :class="$style.notAvailable">
          {{ $t('download__not_available') }}
        </span>
      </base-btn>
    </main>
  </material-modal>
</template>

<script>
import { qualityList } from '@renderer/store'
import { createDownloadTasks } from '@renderer/store/download/action'

const ALL_QUALITY_TIERS = ['flac24bit', 'flac', '320k', '128k']

export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    musicInfo: {
      type: [Object, null],
      required: true,
    },
    listId: {
      type: String,
      default: '',
    },
    bgClose: {
      type: Boolean,
      default: true,
    },
    teleport: {
      type: String,
      default: '#root',
    },
  },
  emits: ['update:show'],
  setup() {
    return {
      qualityList,
    }
  },
  computed: {
    info() {
      return this.musicInfo || {}
    },
    sourceQualityList() {
      return this.qualityList[this.musicInfo.source] || []
    },
    currentSourceName() {
      return this.musicInfo?.source || ''
    },
    allQualityTiers() {
      const _qualitys = this.info.meta?._qualitys || {}
      return ALL_QUALITY_TIERS.map(type => {
        const qInfo = _qualitys[type]
        const hasSongQuality = !!qInfo
        const sourceSupports = this.sourceQualityList.includes(type)
        return {
          type,
          size: qInfo?.size || '',
          hasSongQuality,
          needsSwitch: !sourceSupports,
        }
      })
    },
  },
  methods: {
    handleClick(quality) {
      void createDownloadTasks([this.musicInfo], quality, this.listId)
      this.handleClose()
    },
    handleClose() {
      this.$emit('update:show', false)
    },
    getTypeName(quality) {
      switch (quality) {
        case 'flac24bit':
          return this.$t('download__lossless') + ' FLAC Hires'
        case 'flac':
        case 'ape':
        case 'wav':
          return this.$t('download__lossless') + ' ' + quality.toUpperCase()
        case '320k':
          return this.$t('download__high_quality') + ' ' + quality.toUpperCase()
        case '192k':
        case '128k':
          return this.$t('download__normal') + ' ' + quality.toUpperCase()
      }
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px;
  max-width: 400px;
  min-width: 200px;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  h2 {
    font-size: 13px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
    margin-bottom: 10px;
  }
  h3 {
    font-size: 11px;
    color: var(--color-font-sub);
    text-align: center;
    margin-bottom: 12px;
    opacity: 0.7;
  }
}

.btn {
  display: block;
  margin-bottom: 15px;
  position: relative;
  &:last-child {
    margin-bottom: 0;
  }
}

.btnDisabled {
  opacity: 0.4;
  pointer-events: none;
}

.autoSwitch {
  display: block;
  font-size: 10px;
  color: var(--color-primary);
  line-height: 1.2;
}

.notAvailable {
  display: block;
  font-size: 10px;
  color: var(--color-font-sub);
  line-height: 1.2;
  opacity: 0.6;
}

</style>
