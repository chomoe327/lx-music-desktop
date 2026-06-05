import { DOWNLOAD_STATUS, QUALITYS } from '@common/constants'
import { filterFileName } from '@common/utils/common'
import { buildLyrics } from './lrcTool'
import fs from 'fs'
import { clipFileNameLength, clipNameLength, formatMusicName } from '@common/utils/tools'

/**
 * 保存歌词文件
 */
export const saveLrc = async(lrcData: LX.Music.LyricInfo, info: {
  filePath: string
  format: LX.LyricFormat
  downloadLxlrc: boolean
  downloadTlrc: boolean
  downloadRlrc: boolean
}) => {
  const iconv = (await import('iconv-lite')).default
  const lrc = buildLyrics(lrcData, info.downloadLxlrc, info.downloadTlrc, info.downloadRlrc)
  switch (info.format) {
    case 'gbk':
      fs.writeFile(info.filePath, iconv.encode(lrc, 'gbk', { addBOM: true }), err => {
        if (err) console.log(err)
      })
      break
    case 'utf8':
    default:
      fs.writeFile(info.filePath, iconv.encode(lrc, 'utf8', { addBOM: true }), err => {
        if (err) console.log(err)
      })
      break
  }
}

/**
 * 保存歌词JSON文件（包含所有歌词类型）
 */
export const saveLyricJson = async(lrcData: LX.Music.LyricInfo, filePath: string) => {
  const jsonData = {
    lyric: lrcData.lyric ?? '',
    tlyric: lrcData.tlyric ?? '',
    rlyric: lrcData.rlyric ?? '',
    lxlyric: lrcData.lxlyric ?? '',
  }
  fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8', err => {
    if (err) console.log(err)
  })
}

export const getExt = (type: string): LX.Download.FileExt => {
  switch (type) {
    case 'ape':
      return 'ape'
    case 'flac':
    case 'flac24bit':
      return 'flac'
    case 'wav':
      return 'wav'
    case '128k':
    case '192k':
    case '320k':
    default:
      return 'mp3'
  }
}

/**
 * 获取音乐音质
 * @param musicInfo
 * @param type 请求的音质
 * @param qualityList
 */
export const getMusicType = (musicInfo: LX.Music.MusicInfoOnline, type: LX.Quality, qualityList: LX.QualityList): LX.Quality => {
  // Always keep the requested quality — auto-switch will try all API sources
  // to find one that supports it. Do NOT downgrade based on _qualitys
  // because the .lxmc export may have incomplete quality data.
  return type
}

// const checkExistList = (list: LX.Download.ListItem[], musicInfo: LX.Music.MusicInfo, type: LX.Quality, ext: string): boolean => {
//   return list.some(s => s.id === musicInfo.id && (s.metadata.type === type || s.metadata.ext === ext))
// }

export const createDownloadInfo = (musicInfo: LX.Music.MusicInfoOnline, type: LX.Quality, fileName: string, qualityList: LX.QualityList, listId?: string) => {
  const requestedType = type
  type = getMusicType(musicInfo, type, qualityList)
  let ext = getExt(type)
  const key = `${musicInfo.id}_${requestedType}_${ext}`
  // if (checkExistList(list, musicInfo, type, ext)) return null
  const downloadInfo: LX.Download.ListItem = {
    id: key,
    isComplate: false,
    status: DOWNLOAD_STATUS.WAITING,
    statusText: '待下载',
    downloaded: 0,
    total: 0,
    progress: 0,
    speed: '',
    writeQueue: 0,
    metadata: {
      musicInfo,
      url: null,
      quality: type,
      ext,
      filePath: '',
      listId,
      fileName: filterFileName(`${clipFileNameLength(formatMusicName(fileName, musicInfo.name, clipNameLength(musicInfo.singer)))}.${ext}`),
    },
  }
  // downloadInfo.metadata.filePath = joinPath(savePath, downloadInfo.metadata.fileName)
  // commit('addTask', downloadInfo)

  // 删除同路径下的同名文件
  // TODO
  // void removeFile(downloadInfo.metadata.filePath)
  // .catch(err => {
  //   if (err.code !== 'ENOENT') {
  //     return commit('setStatusText', { downloadInfo, text: '文件删除失败' })
  //   }
  // })

  return downloadInfo
}
