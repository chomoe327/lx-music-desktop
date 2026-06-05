import { appSetting } from '@renderer/store/setting'
import { defaultList, loveList, userLists } from '@renderer/store/list/listManage'
import { filterFileName } from '@common/utils/common'
import { clipFileNameLength } from '@common/utils/tools'
import { joinPath } from '@common/utils/nodejs'

export const buildSavePath = (musicInfo: LX.Download.ListItem) => {
  let savePath = appSetting['download.savePath']
  if (appSetting['download.isSavePathGroupByListName']) {
    let dirName: string | undefined
    const listId = musicInfo.metadata.listId
    if (listId) {
      switch (listId) {
        case defaultList.id:
          dirName = window.i18n.t(defaultList.name)
          break
        case loveList.id:
          dirName = window.i18n.t(loveList.name)
          break
        default:
          dirName = userLists.find(list => list.id === listId)?.name
          break
      }
      // Use listId itself if no matching local list found (e.g. from Open API)
      if (!dirName) dirName = listId
      if (dirName) savePath = joinPath(savePath, clipFileNameLength(filterFileName(dirName)))
    }
  }
  return savePath
}
