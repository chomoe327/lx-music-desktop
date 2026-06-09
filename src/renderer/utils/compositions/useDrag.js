import Sortable, { AutoScroll } from 'sortablejs/modular/sortable.core.esm'
import { onBeforeUnmount, onMounted, watch } from '@common/utils/vueTools'
import { clearDownKeys } from '@renderer/event'

Sortable.mount(new AutoScroll())

const noop = () => {}

export default ({ dom_list, dragingItemClassName, filter, handle, onUpdate, onStart = noop, onEnd = noop }) => {
  let sortable
  let disabled = true

  const init = () => {
    if (sortable || !dom_list.value) return
    sortable = Sortable.create(dom_list.value, {
      animation: 150,
      disabled,
      forceFallback: false,
      filter: filter ? '.' + filter : null,
      handle: handle ? '.' + handle : null,
      ghostClass: dragingItemClassName,
      onUpdate(event) {
        onUpdate(event.newIndex, event.oldIndex)
      },
      onMove(event) {
        return filter ? !event.related.classList.contains(filter) : true
      },
      onChoose() {
        onStart()
      },
      onUnchoose() {
        onEnd()
        // 处于拖动状态期间，键盘事件无法监听，拖动结束手动清理按下的键
        // window.app_event.emit(eventBaseName.setClearDownKeys)
        clearDownKeys()
      },
      onStart(event) {
        window.app_event.dragStart()
      },
      onEnd(event) {
        window.app_event.dragEnd()
      },
    })
  }

  onMounted(init)
  watch(() => dom_list.value, init)
  onBeforeUnmount(() => {
    sortable?.destroy()
    sortable = null
  })

  return {
    setDisabled(enable) {
      disabled = enable
      if (!sortable) return
      sortable.option('disabled', enable)
    },
  }
}
