const app = getApp()

Page({
  data: {
    order: null,
    loading: true,
    noteContent: '',
    isWritingNote: false,
    editingNoteIndex: -1, // -1表示新建，>=0表示编辑某条
    myOpenid: '',
  },

  async onLoad(options) {
    // 先获取自己的openid
    try {
      const res = await wx.cloud.callFunction({ name: 'getOpenId' })
      this.setData({ myOpenid: res.result?.openid || '' })
    } catch (e) {}

    if (options.id) {
      await this.loadOrder(options.id)
    }
  },

  async onShow() {
    // 从编辑菜品返回后刷新
    if (this.data.order?._id) {
      await this.loadOrder(this.data.order._id)
    }
  },

  async loadOrder(id) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getCoupleData',
        data: {
          collection: app.globalData.collectionOrderList,
          docId: id
        }
      })

      if (!res.result?.success) {
        throw new Error(res.result?.message || '加载失败')
      }

      const order = res.result.data
      order.dateText = this.formatDate(order.createTime)
      order.timeText = this.formatTime(order.createTime)
      order.creatorName = this.getDisplayName(order._openid)

      // 兼容旧数据：单张 finishedPhoto → 多张 finishedPhotos
      if (!order.finishedPhotos) {
        order.finishedPhotos = []
      }
      if (order.finishedPhoto && order.finishedPhotos.length === 0) {
        order.finishedPhotos.push({
          url: order.finishedPhoto,
          time: order.finishedPhotoTime || '',
          uploaderOpenid: '',
          uploaderName: '未知'
        })
      }
      // 格式化每张照片的时间和上传者名称
      order.finishedPhotos.forEach(p => {
        p.timeText = p.time ? this.formatFullDateTime(p.time) : ''
        p.uploaderName = p.uploaderOpenid ? this.getDisplayName(p.uploaderOpenid) : (p.uploaderName || '')
      })

      // 兼容旧数据：单条备注 → 多条感想
      if (!order.mealNotes) {
        order.mealNotes = []
      }
      if (order.finishedPhotoNote && order.mealNotes.length === 0) {
        order.mealNotes.push({
          content: order.finishedPhotoNote,
          time: order.finishedPhotoTime || '',
          authorOpenid: '',
          authorName: '未知'
        })
      }
      // 格式化每条感想的时间和作者名
      order.mealNotes.forEach(n => {
        n.timeText = n.time ? this.formatFullDateTime(n.time) : ''
        n.authorName = n.authorOpenid ? this.getDisplayName(n.authorOpenid) : (n.authorName || '')
        n.isMyNote = (n.authorOpenid === this.data.myOpenid)
      })

      // 拉取最新的菜品数据（图片和名称）
      await this.refreshDishData(order)

      // 格式化选项文本
      order.dishes.forEach(d => {
        if (d.selectedOptions && Object.keys(d.selectedOptions).length > 0) {
          d.optionsText = Object.entries(d.selectedOptions).map(([k, v]) => k + ':' + v).join(' | ')
        }
      })
      await app.convertFileURLs([order], ['imageUrl'])
      this.setData({ order, loading: false })
    } catch (e) {
      console.error('加载订单失败', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  // 从菜品库拉取最新数据覆盖订单快照
  async refreshDishData(order) {
    if (!order.dishes || order.dishes.length === 0) return
    try {
      // 一次性加载所有菜品，而不是逐个调用
      const res = await wx.cloud.callFunction({
        name: 'getCoupleData',
        data: { collection: app.globalData.collectionDishList, orderBy: 'createTime', order: 'desc', limit: 100 }
      })
      if (res.result?.success) {
        const dishMap = {}
        res.result.data.forEach(d => { dishMap[d._id] = d })
        for (let i = 0; i < order.dishes.length; i++) {
          const fresh = dishMap[order.dishes[i]._id]
          if (fresh) {
            order.dishes[i].name = fresh.name || order.dishes[i].name
            order.dishes[i].imageUrl = fresh.imageUrl || order.dishes[i].imageUrl
          }
        }
      }
    } catch (e) {
      console.error('refreshDishData error', e)
    }
  },

  getDisplayName(openid) {
    if (!openid) return '未知'
    return app.getDisplayName(openid)
  },

  formatDate(date) {
    if (!date) return ''
    const d = new Date(date)
    const year = d.getFullYear()
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const day = d.getDate().toString().padStart(2, '0')
    return `${year}年${month}月${day}日`
  },

  formatTime(date) {
    if (!date) return ''
    const d = new Date(date)
    const hours = d.getHours().toString().padStart(2, '0')
    const minutes = d.getMinutes().toString().padStart(2, '0')
    return `${hours}:${minutes}`
  },

  formatFullDateTime(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const day = d.getDate().toString().padStart(2, '0')
    const hours = d.getHours().toString().padStart(2, '0')
    const minutes = d.getMinutes().toString().padStart(2, '0')
    return `${month}月${day}日 ${hours}:${minutes}`
  },

  // 再来一单
  reorder() {
    const dishIds = this.data.order.dishes.map(d => d._id).join(',')
    wx.requestSubscribeMessage({
      tmplIds: app.globalData.notifyTmplIds,
      complete: () => {
        wx.switchTab({
          url: '/pages/Order/index',
          success: () => {
            app.globalData.reorderDishIds = dishIds
          }
        })
      }
    })
  },

  // ========== 多张成品照片 ==========

  async uploadPhoto() {
    try {
      const res = await wx.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })

      if (!res.tempFiles || res.tempFiles.length === 0) return

      wx.showLoading({ title: '上传中...', mask: true })

      const photos = this.data.order.finishedPhotos || []
      const now = new Date().toISOString()

      for (const file of res.tempFiles) {
        const cloudPath = `finished_photos/${this.data.order._id}_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath,
          filePath: file.tempFilePath
        })

        photos.push({
          url: uploadRes.fileID,
          time: now,
          uploaderOpenid: this.data.myOpenid,
          uploaderName: this.getDisplayName(this.data.myOpenid)
        })
      }

      // 保存到数据库
      await wx.cloud.callFunction({
        name: 'updateCoupleData',
        data: {
          collection: app.globalData.collectionOrderList,
          docId: this.data.order._id,
          action: 'update',
          data: {
            finishedPhotos: photos,
            finishedPhoto: photos[0]?.url || '' // 兼容旧字段
          }
        }
      })

      // 格式化后刷新
      photos.forEach(p => {
        p.timeText = p.time ? this.formatFullDateTime(p.time) : ''
        if (!p.uploaderName) p.uploaderName = this.getDisplayName(p.uploaderOpenid)
      })

      this.setData({ 'order.finishedPhotos': photos, 'order.finishedPhoto': photos[0]?.url || '' })

      wx.hideLoading()
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      if (e.errMsg && e.errMsg.includes('cancel')) return
      console.error('上传照片失败', e)
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  // 预览某张照片
  previewPhoto(e) {
    const idx = e.currentTarget.dataset.index
    const photos = this.data.order.finishedPhotos || []
    const urls = photos.map(p => p.url)
    wx.previewImage({
      urls,
      current: urls[idx] || urls[0]
    })
  },

  // 删除某张照片
  deletePhoto(e) {
    const idx = e.currentTarget.dataset.index
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这张照片吗？',
      confirmColor: '#E57373',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...', mask: true })

        try {
          const photos = [...(this.data.order.finishedPhotos || [])]
          const removed = photos.splice(idx, 1)[0]

          // 尝试删除云存储文件
          if (removed) {
            const fileUrl = removed._origin_url || removed.url
            if (fileUrl && fileUrl.startsWith('cloud://')) {
              await wx.cloud.deleteFile({ fileList: [fileUrl] }).catch(() => {})
            }
          }

          await wx.cloud.callFunction({
            name: 'updateCoupleData',
            data: {
              collection: app.globalData.collectionOrderList,
              docId: this.data.order._id,
              action: 'update',
              data: {
                finishedPhotos: photos,
                finishedPhoto: photos[0]?.url || ''
              }
            }
          })

          this.setData({
            'order.finishedPhotos': photos,
            'order.finishedPhoto': photos[0]?.url || ''
          })

          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (e) {
          wx.hideLoading()
          console.error('删除失败', e)
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  },

  // ========== 多条用餐感想 ==========

  // 开始写感想
  startWriteNote() {
    this.setData({
      isWritingNote: true,
      noteContent: '',
      editingNoteIndex: -1
    })
  },

  // 编辑已有感想
  editNote(e) {
    const idx = e.currentTarget.dataset.index
    const note = this.data.order.mealNotes[idx]
    this.setData({
      isWritingNote: true,
      noteContent: note.content,
      editingNoteIndex: idx
    })
  },

  onNoteInput(e) {
    this.setData({ noteContent: e.detail.value })
  },

  cancelNote() {
    this.setData({
      isWritingNote: false,
      noteContent: '',
      editingNoteIndex: -1
    })
  },

  async saveNote() {
    const content = this.data.noteContent.trim()
    if (!content) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...', mask: true })

    try {
      const notes = [...(this.data.order.mealNotes || [])]
      const now = new Date().toISOString()

      if (this.data.editingNoteIndex >= 0) {
        // 编辑已有感想
        notes[this.data.editingNoteIndex].content = content
        notes[this.data.editingNoteIndex].time = now
      } else {
        // 新建感想
        notes.push({
          content,
          time: now,
          authorOpenid: this.data.myOpenid,
          authorName: this.getDisplayName(this.data.myOpenid)
        })
      }

      await wx.cloud.callFunction({
        name: 'updateCoupleData',
        data: {
          collection: app.globalData.collectionOrderList,
          docId: this.data.order._id,
          action: 'update',
          data: { mealNotes: notes }
        }
      })

      // 格式化后刷新
      notes.forEach(n => {
        n.timeText = n.time ? this.formatFullDateTime(n.time) : ''
        if (!n.authorName) n.authorName = this.getDisplayName(n.authorOpenid)
        n.isMyNote = (n.authorOpenid === this.data.myOpenid)
      })

      this.setData({
        'order.mealNotes': notes,
        isWritingNote: false,
        noteContent: '',
        editingNoteIndex: -1
      })

      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      console.error('保存感想失败', e)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  // 删除感想
  deleteNote(e) {
    const idx = e.currentTarget.dataset.index
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条感想吗？',
      confirmColor: '#E57373',
      success: async (res) => {
        if (!res.confirm) return

        try {
          const notes = [...(this.data.order.mealNotes || [])]
          notes.splice(idx, 1)

          await wx.cloud.callFunction({
            name: 'updateCoupleData',
            data: {
              collection: app.globalData.collectionOrderList,
              docId: this.data.order._id,
              action: 'update',
              data: { mealNotes: notes }
            }
          })

          this.setData({ 'order.mealNotes': notes })
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (e) {
          console.error('删除感想失败', e)
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  },

  onPullDownRefresh() {
    if (this.data.order?._id) {
      this.loadOrder(this.data.order._id).then(() => {
        wx.stopPullDownRefresh()
      })
    }
  },
})
