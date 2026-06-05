import { mainHandle, mainOn } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import {
  startServer,
  stopServer,
  getStatus,
  updateDownloadTaskStatus,
} from '@main/modules/openApi'


export default () => {
  mainHandle<LX.OpenAPI.Actions, any>(WIN_MAIN_RENDERER_EVENT_NAME.open_api_action, async({ params: data }) => {
    switch (data.action) {
      case 'enable':
        return data.data.enable ? await startServer(parseInt(data.data.port), data.data.bindLan) : await stopServer()
      case 'status': return getStatus()
    }
  })

  mainOn<{
    taskId: string
    status: string
    error?: string
    filePath?: string
    lyricPath?: string
    lyricJsonPath?: string
    actualQuality?: string
    actualSource?: string
    apiSourceName?: string
    versionNote?: string
    name?: string
    singer?: string
    progress?: number
    speed?: string
    verifyResult?: string
  }>(WIN_MAIN_RENDERER_EVENT_NAME.open_api_download_status, ({ params }) => {
    updateDownloadTaskStatus(params.taskId, params.status, params.error, {
      filePath: params.filePath,
      lyricPath: params.lyricPath,
      lyricJsonPath: params.lyricJsonPath,
      actualQuality: params.actualQuality,
      actualSource: params.actualSource,
      apiSourceName: params.apiSourceName,
      versionNote: params.versionNote,
      name: params.name,
      singer: params.singer,
      progress: params.progress,
      speed: params.speed,
      verifyResult: params.verifyResult,
    })
  })
}
