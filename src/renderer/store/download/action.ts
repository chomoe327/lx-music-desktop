import {
  downloadTasksGet,
  // downloadListClear,
  downloadTasksCreate,
  downloadTasksRemove,
  downloadTasksUpdate,
  onOpenApiDownload,
} from '@renderer/utils/ipc'
import {
  downloadList,
} from './state'
import { markRaw, toRaw } from '@common/utils/vueTools'
import { getMusicUrl, getPicUrl, getLyricInfo } from '@renderer/core/music/online'
import { appSetting } from '../setting'
import { qualityList } from '..'
import { proxyCallback } from '@renderer/worker/utils'
import { setUserApi } from '@renderer/core/apiSource'
import { arrPush, arrUnshift, joinPath } from '@renderer/utils'
import { DOWNLOAD_STATUS } from '@common/constants'
import { proxy, apiSource, userApi } from '../index'
import { buildSavePath } from './utils'
import { filterFileName } from '@common/utils/common'
import { clipFileNameLength, clipNameLength } from '@common/utils/tools'
import { rendererSend } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

const waitingUpdateTasks = new Map<string, LX.Download.ListItem>()
let timer: NodeJS.Timeout | null = null
const throttleUpdateTask = (tasks: LX.Download.ListItem[]) => {
  for (const task of tasks) waitingUpdateTasks.set(task.id, toRaw(task))
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void downloadTasksUpdate(Array.from(waitingUpdateTasks.values()))
    waitingUpdateTasks.clear()
  }, 100)
}

const runingTask = new Map<string, LX.Download.ListItem>()

// const initDownloadList = (list: LX.Download.ListItem[]) => {
//   downloadList.splice(0, downloadList.length, ...list)
// }

export const getDownloadList = async(): Promise<LX.Download.ListItem[]> => {
  if (!downloadList.length) {
    const list = await downloadTasksGet()
    for (const downloadInfo of list) {
      markRaw(downloadInfo.metadata)
      switch (downloadInfo.status) {
        case DOWNLOAD_STATUS.RUN:
        case DOWNLOAD_STATUS.WAITING:
          downloadInfo.status = DOWNLOAD_STATUS.PAUSE
          downloadInfo.statusText = window.i18n.t('download___status_paused')
        default:
          break
      }
    }
    arrPush(downloadList, list)
  }
  return downloadList
}

const addTasks = async(list: LX.Download.ListItem[]) => {
  const addMusicLocationType = appSetting['list.addMusicLocationType']

  await downloadTasksCreate(list.map(i => toRaw(i)), addMusicLocationType)

  if (addMusicLocationType === 'top') {
    arrUnshift(downloadList, list)
  } else {
    arrPush(downloadList, list)
  }
  window.app_event.downloadListUpdate()
}

const setStatusText = (downloadInfo: LX.Download.ListItem, text: string) => { // 设置状态文本
  downloadInfo.statusText = text
  throttleUpdateTask([downloadInfo])
}

const setUrl = (downloadInfo: LX.Download.ListItem, url: string) => {
  downloadInfo.metadata.url = url
  throttleUpdateTask([downloadInfo])
}

const updateFilePath = (downloadInfo: LX.Download.ListItem, filePath: string) => {
  downloadInfo.metadata.filePath = filePath
  throttleUpdateTask([downloadInfo])
}

const setProgress = (downloadInfo: LX.Download.ListItem, progress: LX.Download.ProgressInfo) => {
  downloadInfo.total = progress.total
  downloadInfo.downloaded = progress.downloaded
  downloadInfo.writeQueue = progress.writeQueue
  if (progress.progress == 100) {
    downloadInfo.speed = ''
    downloadInfo.progress = 99.99
    setStatusText(downloadInfo, window.i18n.t('download_status_write_queue', { num: progress.writeQueue }))
  } else {
    downloadInfo.speed = progress.speed
    downloadInfo.progress = progress.progress
  }
  throttleUpdateTask([downloadInfo])
}

const setStatus = (downloadInfo: LX.Download.ListItem, status: LX.Download.DownloadTaskStatus, statusText?: string) => { // 设置状态及状态文本
  if (statusText == null) {
    switch (status) {
      case DOWNLOAD_STATUS.RUN:
        statusText = window.i18n.t('download___status_running')
        break
      case DOWNLOAD_STATUS.WAITING:
        statusText = window.i18n.t('download___status_waiting')
        break
      case DOWNLOAD_STATUS.PAUSE:
        statusText = window.i18n.t('download___status_paused')
        break
      case DOWNLOAD_STATUS.ERROR:
        statusText = window.i18n.t('download___status_error')
        break
      case DOWNLOAD_STATUS.COMPLETED:
        statusText = window.i18n.t('download___status_completed')
        break
      default:
        statusText = ''
        break
    }
  }

  if (downloadInfo.statusText == statusText && downloadInfo.status == status) return

  if (status == DOWNLOAD_STATUS.COMPLETED) downloadInfo.isComplate = true
  downloadInfo.statusText = statusText
  downloadInfo.status = status
  throttleUpdateTask([downloadInfo])
}

// 修复 1.1.x版本 酷狗源歌词格式
const fixKgLyric = (lrc: string) => /\[00:\d\d:\d\d.\d+\]/.test(lrc) ? lrc.replace(/(?:\[00:(\d\d:\d\d.\d+\]))/gm, '[$1') : lrc

const getProxy = () => {
  return proxy.enable && proxy.host ? {
    host: proxy.host,
    port: parseInt(proxy.port || '80'),
  } : proxy.envProxy ? {
    host: proxy.envProxy.host,
    port: parseInt(proxy.envProxy.port || '80'),
  } : undefined
}
/**
 * 设置歌曲meta信息
 * @param downloadInfo 下载任务信息
 */
const saveMeta = (downloadInfo: LX.Download.ListItem) => {
  if (downloadInfo.metadata.quality === 'ape') return
  const isOpenApiTask = downloadInfo.metadata.isOpenApiTask
  const isEmbedPic = isOpenApiTask ? true : appSetting['download.isEmbedPic']
  const isEmbedLyric = isOpenApiTask ? true : appSetting['download.isEmbedLyric']
  const isUseOtherSource = appSetting['download.isUseOtherSource']
  const tasks: [Promise<string | null>, Promise<LX.Player.LyricInfo | null>] = [
    isEmbedPic
      ? downloadInfo.metadata.musicInfo.meta.picUrl
        ? Promise.resolve(downloadInfo.metadata.musicInfo.meta.picUrl)
        : getPicUrl({ musicInfo: downloadInfo.metadata.musicInfo, isRefresh: false, allowToggleSource: isUseOtherSource }).catch(err => {
          console.log(err)
          return null
        })
      : Promise.resolve(null),
    isEmbedLyric
      ? getLyricInfo({ musicInfo: downloadInfo.metadata.musicInfo, isRefresh: false, allowToggleSource: isUseOtherSource }).catch(err => {
        console.log(err)
        return null
      })
      : Promise.resolve(null),
  ]
  void Promise.all(tasks).then(([imgUrl, lyrics]) => {
    const info = {
      filePath: downloadInfo.metadata.filePath,
      isEmbedLyricLx: appSetting['download.isEmbedLyricLx'],
      isEmbedLyricT: isOpenApiTask ? true : appSetting['download.isEmbedLyricT'],
      isEmbedLyricR: isOpenApiTask ? true : appSetting['download.isEmbedLyricR'],
      title: downloadInfo.metadata.musicInfo.name,
      artist: downloadInfo.metadata.musicInfo.singer?.replaceAll('、', ';'),
      album: downloadInfo.metadata.musicInfo.meta.albumName,
      APIC: imgUrl,
    }
    void window.lx.worker.download.writeMeta(info, lyrics ?? { lyric: '' }, getProxy())
  })
}

/**
 * 保存歌词文件
 * @param downloadInfo 下载任务信息
 */
const downloadLyric = (downloadInfo: LX.Download.ListItem) => {
  const isOpenApiTask = downloadInfo.metadata.isOpenApiTask
  if (!isOpenApiTask && !appSetting['download.isDownloadLrc']) return
  void getLyricInfo({
    musicInfo: downloadInfo.metadata.musicInfo,
    isRefresh: false,
    allowToggleSource: appSetting['download.isUseOtherSource'],
  }).then(lrcs => {
    if (lrcs.lyric) {
      lrcs.lyric = fixKgLyric(lrcs.lyric)
      const basePath = downloadInfo.metadata.filePath.substring(0, downloadInfo.metadata.filePath.lastIndexOf('.'))
      const info = {
        filePath: basePath + '.lrc',
        format: appSetting['download.lrcFormat'],
        downloadLxlrc: isOpenApiTask ? true : appSetting['download.isDownloadLxLrc'],
        downloadTlrc: isOpenApiTask ? true : appSetting['download.isDownloadTLrc'],
        downloadRlrc: isOpenApiTask ? true : appSetting['download.isDownloadRLrc'],
      }
      void window.lx.worker.download.saveLrc(lrcs, info)
      // Open API: also save JSON lyrics
      if (isOpenApiTask) {
        void window.lx.worker.download.saveLyricJson(lrcs, basePath + '.lyric.json')
      }
    }
  })
}

const getUrl = async(downloadInfo: LX.Download.ListItem, isRefresh: boolean = false) => {
  // Force re-resolution when retrying after format failure (skip URL cache)
  const forceRefresh = isRefresh || (downloadInfo.metadata as any)._retrying
  const quality = downloadInfo.metadata.quality
  const musicInfo = downloadInfo.metadata.musicInfo
  let usedToggleSource: LX.Music.MusicInfoOnline | undefined

  // Try original source first, with source switching enabled to find requested quality
  let url = ''
  let toggleSourceInfo: LX.Music.MusicInfoOnline | undefined
  try {
    url = await getMusicUrl({
      musicInfo,
      isRefresh: forceRefresh,
      quality,
      allowToggleSource: true,
      allowApiSourceSwitch: !forceRefresh, // Don't double-switch API source during retry
      onToggleSource(musicInfo) {
        usedToggleSource = musicInfo
      },
      onApiSourceSwitch(apiName) {
        setStatusText(downloadInfo, `\u6362\u6e90→${apiName}`)
      },
    })
    if (!url) throw new Error('no url')
  } catch (err) {
    // Original + all sources failed, try pre-toggled source if available
    const toggleMusicInfo = musicInfo.meta.toggleMusicInfo
    if (toggleMusicInfo) {
      try {
        url = await getMusicUrl({
          musicInfo: toggleMusicInfo,
          isRefresh,
          quality,
          allowToggleSource: false,
          onToggleSource(musicInfo) {
            toggleSourceInfo = musicInfo
          },
        })
      } catch {
        url = ''
      }
    }
  }

  if (url && usedToggleSource) {
    // Record which source was used (different from original)
    downloadInfo.metadata.actualSource = usedToggleSource.source
    // Verify song name/singer match
    const origName = musicInfo.name?.toLowerCase().trim()
    const origSinger = (musicInfo.singer || '').toLowerCase().trim()
    const newName = usedToggleSource.name?.toLowerCase().trim()
    const newSinger = (usedToggleSource.singer || '').toLowerCase().trim()
    downloadInfo.metadata.versionNote = ''
    if (origName && newName && !newName.includes(origName) && !origName.includes(newName)) {
      downloadInfo.metadata.versionNote = `song_name_mismatch: orig="${musicInfo.name}" -> "${usedToggleSource.name}"`
    }
    if (origSinger && newSinger && !newSinger.includes(origSinger) && !origSinger.includes(newSinger)) {
      downloadInfo.metadata.versionNote += (downloadInfo.metadata.versionNote ? '; ' : '') +
        `singer_mismatch: orig="${musicInfo.singer}" -> "${usedToggleSource.singer}"`
    }
  } else if (url && toggleSourceInfo) {
    downloadInfo.metadata.actualSource = toggleSourceInfo.source
  } else if (url) {
    // Original source worked directly, record it
    downloadInfo.metadata.actualSource = musicInfo.source
  }

  // Record which API source was active
  const activeApi = userApi.list.find(a => a.id === apiSource.value)
  downloadInfo.metadata.apiSourceName = activeApi?.name || apiSource.value || ''

  return url
}
const handleRefreshUrl = (downloadInfo: LX.Download.ListItem) => {
  setStatusText(downloadInfo, window.i18n.t('download_status_error_refresh_url'))
  void getUrl(downloadInfo, true).then(url => {
    if (!url) {
      handleError(downloadInfo, window.i18n.t('download_status_error_url_failed'))
      return
    }
    setUrl(downloadInfo, url)
    void window.lx.worker.download.updateUrl(downloadInfo.id, url)
  }).catch(err => {
    console.log(err)
    handleError(downloadInfo, err.message)
  })
}
const handleError = (downloadInfo: LX.Download.ListItem, message?: string) => {
  // During format-verification retries, forward to verifyAndFinalize to try next API source
  if ((downloadInfo.metadata as any)._retrying) {
    console.log('handleError during retry for', downloadInfo.id, ':', message)
    setStatusText(downloadInfo, message || '')
    void verifyAndFinalize(downloadInfo)
    return
  }
  setStatus(downloadInfo, DOWNLOAD_STATUS.ERROR, message)
  void window.lx.worker.download.removeTask(downloadInfo.id)
  runingTask.delete(downloadInfo.id)
  void checkStartTask()
}

/**
 * Verify that the downloaded file actually matches the requested quality,
 * and if not, delete the fake file and mark as error so the script retries.
 */
const verifyAndFinalize = async(downloadInfo: LX.Download.ListItem) => {
  const filePath = downloadInfo.metadata.filePath
  const requestedQuality = downloadInfo.metadata.quality
  const isLosslessRequest = requestedQuality === 'flac24bit' || requestedQuality === 'flac' || requestedQuality === 'ape' || requestedQuality === 'wav'

  // If retrying and no file was downloaded (URL failure), skip straight to API source switch
  if ((downloadInfo.metadata as any)._retrying && !filePath) {
    console.log(`Retry URL failed for ${downloadInfo.id}, trying next API source`)
    // Fall through to retry logic below
  } else if (!isLosslessRequest || !filePath) {
    finalize(downloadInfo)
    return
  } else {
    // Read FLAC STREAMINFO to detect actual bit depth
    let isFlac = false
    let isLossless = false
    try {
      const { readFile } = await import('@common/utils/nodejs')
      const buffer = await readFile(filePath)
      if (buffer && buffer.length >= 30) {
        // "fLaC" magic at bytes 0-3
        isFlac = buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43
        if (isFlac) {
          // STREAMINFO block starts at byte 8, 34 bytes
          // Bytes 18-25: sample rate (20b), channels-1 (3b), bps-1 (5b), total samples (36b)
          const b20 = buffer[20] || 0
          const b21 = buffer[21] || 0
          // bps-1 = ((b20 & 0x01) << 4) | ((b21 & 0xF0) >> 4)
          const bps = (((b20 & 0x01) << 4) | ((b21 & 0xF0) >> 4)) + 1
          if (requestedQuality === 'flac24bit') {
            isLossless = bps >= 24
          } else {
            isLossless = bps >= 16
          }
        }
      }
    } catch {
      // Can't read, assume OK
    }

    if (isFlac && isLossless) {
      finalize(downloadInfo)
      return
    }

    // Format mismatch: delete the fake file
    const reason = !isFlac ? 'not flac' : 'bit depth too low'
    console.log(`Format mismatch: requested ${requestedQuality} but got ${reason}, switching API source`)

    try {
      const { removeFile } = await import('@common/utils/nodejs')
      await removeFile(filePath)
    } catch { /* ignore */ }
  }

  // Track tried API sources (persist across retries of same task)
  if (!(downloadInfo.metadata as any)._triedApis) {
    (downloadInfo.metadata as any)._triedApis = []
    ;(downloadInfo.metadata as any)._firstApi = apiSource.value
  }
  const triedApis: string[] = (downloadInfo.metadata as any)._triedApis
  const firstApi: string | null = (downloadInfo.metadata as any)._firstApi
  if (apiSource.value && !triedApis.includes(apiSource.value)) {
    triedApis.push(apiSource.value)
  }

  // Find next untried API source (try all, priority sponsors first)
  const priorityApis = userApi.list.filter(a =>
    a.name.includes('赞助') || a.name.includes('ikun') || a.name.includes('聆澜'),
  )
  const otherApis = userApi.list.filter(a => !priorityApis.includes(a))
  const orderedApis = [...priorityApis, ...otherApis]
  const nextApi = orderedApis.find(a => !triedApis.includes(a.id))
  if (nextApi) {
    const msg = `[换源重试] ${triedApis.length + 1}/${orderedApis.length}: ${nextApi.name}`
    console.log(msg)
    setStatusText(downloadInfo, msg)
    try {
      // Kill previous download task
      void window.lx.worker.download.removeTask(downloadInfo.id)
      runingTask.delete(downloadInfo.id)
      // Switch
      setStatusText(downloadInfo, `正在初始化API源: ${nextApi.name}...`)
      await setUserApi(nextApi.id)
      setStatusText(downloadInfo, `等待API源就绪: ${nextApi.name}...`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      await window.lx.apiInitPromise[0]
      // Reset URL and restart
      setStatusText(downloadInfo, `正在通过 ${nextApi.name} 重新下载...`)
      downloadInfo.metadata.url = null
      downloadInfo.metadata.actualSource = ''
      downloadInfo.progress = 0
      downloadInfo.downloaded = 0
      downloadInfo.total = 0
      ;(downloadInfo.metadata as any)._retrying = true
      void startTask(downloadInfo)
    } catch (err) {
      console.log(`Failed to switch to ${nextApi.name}:`, err)
      setStatusText(downloadInfo, `API源 ${nextApi.name} 初始化失败，尝试下一个...`)
      // Retry with next API source
      void verifyAndFinalize(downloadInfo)
    }
    return
  }

  // All API sources exhausted — restore original source FIRST, then mark error
  console.log(`[换源重试] 全部 ${triedApis.length} 个API源已遍历完毕，格式校验仍未通过`)
  ;(downloadInfo.metadata as any)._retrying = false
  if (firstApi && apiSource.value !== firstApi) {
    setStatusText(downloadInfo, '换源重试结束，正在恢复原始API源...')
    await setUserApi(firstApi)
    await new Promise(resolve => setTimeout(resolve, 2000))
    await window.lx.apiInitPromise[0]
  }
  void window.lx.worker.download.removeTask(downloadInfo.id)
  runingTask.delete(downloadInfo.id)
  setStatus(downloadInfo, DOWNLOAD_STATUS.ERROR, 'download_status_error_refresh_url')
  void checkStartTask()
}

const finalize = (downloadInfo: LX.Download.ListItem) => {
  saveMeta(downloadInfo)
  downloadLyric(downloadInfo)
  void window.lx.worker.download.removeTask(downloadInfo.id)
  runingTask.delete(downloadInfo.id)
  setStatus(downloadInfo, DOWNLOAD_STATUS.COMPLETED)
  void checkStartTask()
}

const handleStartTask = async(downloadInfo: LX.Download.ListItem) => {
  if (!downloadInfo.metadata.url) {
    setStatusText(downloadInfo, window.i18n.t('download_status_url_getting'))
    const url = await getUrl(downloadInfo)
    if (!url) {
      handleError(downloadInfo, window.i18n.t('download_status_error_url_failed'))
      return
    }
    setUrl(downloadInfo, url)
    if (downloadInfo.status != DOWNLOAD_STATUS.RUN) return
  }

  let savePath = buildSavePath(downloadInfo)
  // Open API: wrap in per-song subdirectory
  if (downloadInfo.metadata.isOpenApiTask) {
    const songDir = clipFileNameLength(filterFileName(
      `${downloadInfo.metadata.musicInfo.name} - ${clipNameLength(downloadInfo.metadata.musicInfo.singer)}`,
    ))
    savePath = joinPath(savePath, songDir)
  }
  const filePath = joinPath(savePath, downloadInfo.metadata.fileName)
  if (downloadInfo.metadata.filePath != filePath) updateFilePath(downloadInfo, filePath)

  setStatusText(downloadInfo, window.i18n.t('download_status_start'))

  await window.lx.worker.download.startTask(toRaw(downloadInfo), savePath, appSetting['download.skipExistFile'], proxyCallback((event: LX.Download.DownloadTaskActions) => {
    // console.log(event)
    switch (event.action) {
      case 'start':
        setStatus(downloadInfo, DOWNLOAD_STATUS.RUN)
        break
      case 'complete':
        downloadInfo.progress = 100
        void verifyAndFinalize(downloadInfo)
        break
      case 'refreshUrl':
        handleRefreshUrl(downloadInfo)
        break
      case 'statusText':
        setStatusText(downloadInfo, event.data)
        break
      case 'progress':
        setProgress(downloadInfo, event.data)
        break
      case 'error':
        handleError(downloadInfo, event.data.error
          ? window.i18n.t(event.data.error) + (event.data.message ?? '')
          : event.data.message,
        )
        break
      default:
        break
    }
  }), getProxy())
}
const startTask = async(downloadInfo: LX.Download.ListItem) => {
  setStatus(downloadInfo, DOWNLOAD_STATUS.RUN)
  runingTask.set(downloadInfo.id, downloadInfo)
  void handleStartTask(downloadInfo)
}

const getStartTask = (list: LX.Download.ListItem[]): LX.Download.ListItem | null => {
  let downloadCount = 0
  const waitList = list.filter(item => {
    if (item.status == DOWNLOAD_STATUS.WAITING) return true
    if (item.status == DOWNLOAD_STATUS.RUN) ++downloadCount
    return false
  })
  // console.log(downloadCount, waitList)
  return downloadCount < appSetting['download.maxDownloadNum'] ? waitList.shift() ?? null : null
}

const checkStartTask = async() => {
  if (runingTask.size >= appSetting['download.maxDownloadNum']) return
  let result = getStartTask(downloadList)
  // console.log(result)
  while (result) {
    await startTask(result)
    result = getStartTask(downloadList)
  }
}

/**
 * 过滤重复任务
 * @param list
 */
const filterTask = (list: LX.Download.ListItem[]) => {
  const set = new Set<string>()
  for (const item of downloadList) set.add(item.id)
  return list.filter(item => {
    if (set.has(item.id)) return false
    markRaw(item.metadata)
    set.add(item.id)
    return true
  })
}
/**
 * 创建下载任务
 * @param list 要下载的歌曲
 * @param quality 下载音质
 */
export const createDownloadTasks = async(list: LX.Music.MusicInfoOnline[], quality: LX.Quality, listId?: string) => {
  if (!list.length) return
  const tasks = filterTask(await window.lx.worker.download.createDownloadTasks(list, quality,
    appSetting['download.fileName'],
    toRaw(qualityList.value), listId),
  )

  if (tasks.length) await addTasks(tasks)
  void checkStartTask()
}

/**
 * 开始下载任务
 * @param list
 */
export const startDownloadTasks = async(list: LX.Download.ListItem[]) => {
  for (const downloadInfo of list) {
    switch (downloadInfo.status) {
      case DOWNLOAD_STATUS.PAUSE:
      case DOWNLOAD_STATUS.ERROR:
        if (runingTask.size < appSetting['download.maxDownloadNum']) void startTask(downloadInfo)
        else setStatus(downloadInfo, DOWNLOAD_STATUS.WAITING)
      default:
        break
    }
  }
  void checkStartTask()
}

/**
 * 暂停下载任务
 * @param list
 */
export const pauseDownloadTasks = async(list: LX.Download.ListItem[]) => {
  for (const downloadInfo of list) {
    switch (downloadInfo.status) {
      case DOWNLOAD_STATUS.RUN:
        void window.lx.worker.download.pauseTask(downloadInfo.id)
        runingTask.delete(downloadInfo.id)
      case DOWNLOAD_STATUS.WAITING:
      case DOWNLOAD_STATUS.ERROR:
        setStatus(downloadInfo, DOWNLOAD_STATUS.PAUSE)
      default:
        break
    }
  }
  void checkStartTask()
}

/**
 * 移除下载任务
 * @param ids 要移除的任务Id
 */
export const removeDownloadTasks = async(ids: string[]) => {
  await downloadTasksRemove(ids)

  const idsSet = new Set<string>(ids)
  const newList = downloadList.filter(task => {
    if (runingTask.has(task.id)) {
      void window.lx.worker.download.removeTask(task.id)
      runingTask.delete(task.id)
    }
    return !idsSet.has(task.id)
  })
  downloadList.splice(0, downloadList.length)
  arrPush(downloadList, newList)


  void checkStartTask()
  window.app_event.downloadListUpdate()
}


onOpenApiDownload(({ params: { list, quality, listId } }) => {
  void (async() => {
    // Build simple-ID -> metadata mapping from raw song JSON
    const rawSongMap = new Map<string, { name: string, singer: string }>()
    for (const s of list as any[]) {
      const rawId = s.songmid || s.songId || s.id || ''
      rawSongMap.set(rawId, {
        name: s.name || s.songname || 'Unknown',
        singer: Array.isArray(s.singer) ? s.singer.join('、') : (s.singer || s.singername || ''),
      })
    }

    const rawIds = new Set(rawSongMap.keys())
    for (const rawId of rawIds) {
      rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.open_api_download_status, {
        taskId: rawId,
        status: 'queued',
        name: rawSongMap.get(rawId)?.name,
        singer: rawSongMap.get(rawId)?.singer,
      })
    }

    await createDownloadTasks(list, quality, listId)

    // Build simple-ID -> compound-ID mapping from download list items
    const compoundIdMap = new Map<string, string>()
    for (const item of downloadList) {
      if (item.metadata.isOpenApiTask) continue
      const musicId = item.metadata.musicInfo?.id || ''
      if (rawIds.has(musicId)) {
        compoundIdMap.set(item.id, musicId)
        item.metadata.isOpenApiTask = true
      }
    }
    const compoundIds = new Set(compoundIdMap.keys())

    // Poll download list for status changes
    const pollInterval = setInterval(() => {
      let allDone = true
      for (const item of downloadList) {
        if (!compoundIds.has(item.id)) continue
        const status = item.status === 'completed'
          ? 'completed'
          : item.status === 'error'
            ? 'failed'
            : item.status === 'run'
              ? 'running'
              : 'queued'

        if (status !== 'completed' && status !== 'failed') {
          allDone = false
        }

        const rawId = compoundIdMap.get(item.id)
        const meta = rawId ? rawSongMap.get(rawId) : undefined
        const filePath = item.metadata.filePath || ''
        const basePath = filePath ? filePath.substring(0, filePath.lastIndexOf('.')) : ''
        const lyricPath = basePath ? basePath + '.lrc' : ''
        const lyricJsonPath = basePath ? basePath + '.lyric.json' : ''
        rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.open_api_download_status, {
          taskId: item.id,
          status,
          error: item.statusText || undefined,
          filePath: filePath || undefined,
          lyricPath: lyricPath || undefined,
          lyricJsonPath: lyricJsonPath || undefined,
          actualQuality: item.metadata.quality || undefined,
          actualSource: item.metadata.actualSource || undefined,
          apiSourceName: item.metadata.apiSourceName || undefined,
          versionNote: item.metadata.versionNote || undefined,
          name: meta?.name,
          singer: meta?.singer,
          progress: item.progress || undefined,
          speed: item.speed || undefined,
        })
      }
      if (allDone && compoundIds.size > 0) {
        clearInterval(pollInterval)
      }
    }, 3000)

    // Backup timeout: stop polling after 30 minutes
    setTimeout(() => { clearInterval(pollInterval) }, 30 * 60 * 1000)
  })()
})
