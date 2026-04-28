const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { fileList } = event
  if (!fileList || fileList.length === 0) {
    return { success: false, message: '缺少文件列表' }
  }
  try {
    // 分批处理，每批最多50个（腾讯云限制）
    let allResults = []
    for (let i = 0; i < fileList.length; i += 50) {
      const batch = fileList.slice(i, i + 50)
      const res = await cloud.getTempFileURL({ fileList: batch })
      allResults = allResults.concat(res.fileList)
    }
    return { success: true, fileList: allResults }
  } catch (e) {
    console.error('getTempFileURL error', e)
    return { success: false, message: '获取临时链接失败', error: e.message }
  }
}
