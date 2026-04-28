const app = getApp()

Page({
  data: {
    _id: '', name: '', description: '', imageUrl: '', tempFilePath: '',
    isEdit: false, saving: false, originalDish: null,
    allCategories: [], parentCats: [], childrenMap: {},
    parentIndex: 0, childIndex: 0, currentChildren: [],
    // 选项组
    optionGroups: [],         // [{ name: '辣度', options: ['不辣','微辣'] }]
    showAddGroup: false,
    newGroupName: '',
    addingOptionIndex: -1,    // 正在给哪个组添加选项
    newOptionText: '',
  },

  async onLoad(options) {
    if (options.id) {
      this.setData({ _id: options.id, isEdit: true })
      wx.setNavigationBarTitle({ title: '编辑菜品' })
    }
    await app.loadCategories()
    this.buildCategoryData()
    if (this.data.isEdit && this.data._id) await this.loadDish()
  },

  async onShow() {
    if (app.globalData.categoriesLoaded) this.buildCategoryData()
  },

  buildCategoryData() {
    const all = app.globalData.categories || []
    const parentCats = all.filter(c => !c.parentId).sort((a, b) => (a.sort||0) - (b.sort||0))
    const childrenMap = {}
    parentCats.forEach(p => { childrenMap[p._id] = all.filter(c => c.parentId === p._id).sort((a, b) => (a.sort||0) - (b.sort||0)) })
    const currentChildren = parentCats[this.data.parentIndex] ? (childrenMap[parentCats[this.data.parentIndex]._id] || []) : []
    this.setData({ allCategories: all, parentCats, childrenMap, currentChildren })
  },

  async loadDish() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getCoupleData', data: { collection: app.globalData.collectionDishList, docId: this.data._id } })
      if (!res.result?.success) throw new Error()
      const dish = res.result.data
      const { parentCats, childrenMap } = this.data
      let parentIndex = 0, childIndex = 0
      const dishCat = this.data.allCategories.find(c => c._id === dish.category)
      if (dishCat) {
        if (dishCat.parentId) {
          parentIndex = Math.max(0, parentCats.findIndex(p => p._id === dishCat.parentId))
          const children = childrenMap[parentCats[parentIndex]._id] || []
          childIndex = Math.max(0, children.findIndex(c => c._id === dish.category))
        } else {
          parentIndex = Math.max(0, parentCats.findIndex(p => p._id === dish.category))
        }
      }
      const currentChildren = parentCats[parentIndex] ? (childrenMap[parentCats[parentIndex]._id] || []) : []
      this.setData({
        name: dish.name || '', description: dish.description || '', imageUrl: dish.imageUrl || '',
        parentIndex, childIndex, currentChildren, originalDish: dish, tempFilePath: '',
        optionGroups: dish.optionGroups || [],
      })
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  onParentChange(e) {
    const parentIndex = parseInt(e.detail.value)
    const parent = this.data.parentCats[parentIndex]
    this.setData({ parentIndex, childIndex: 0, currentChildren: parent ? (this.data.childrenMap[parent._id] || []) : [] })
  },
  onChildChange(e) { this.setData({ childIndex: parseInt(e.detail.value) }) },

  getSelectedCategoryId() {
    const { parentCats, currentChildren, parentIndex, childIndex } = this.data
    if (currentChildren.length > 0) return currentChildren[childIndex]?._id || parentCats[parentIndex]?._id
    return parentCats[parentIndex]?._id || ''
  },

  onNameInput(e) { let v = e.detail.value; if (v.length > 20) v = v.slice(0, 20); this.setData({ name: v }); return v },
  onDescInput(e) { let v = e.detail.value; if (v.length > 6) v = v.slice(0, 6); this.setData({ description: v }); return v },

  chooseImage() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: (res) => {
      this.setData({ tempFilePath: res.tempFiles[0].tempFilePath, imageUrl: res.tempFiles[0].tempFilePath })
    }})
  },

  async uploadImage() {
    if (!this.data.tempFilePath) return ''
    const cloudPath = `dishes/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
    const res = await wx.cloud.uploadFile({ cloudPath, filePath: this.data.tempFilePath })
    return res.fileID
  },

  // ===== 选项组管理 =====
  showAddGroupInput() { this.setData({ showAddGroup: true, newGroupName: '' }) },
  hideAddGroupInput() { this.setData({ showAddGroup: false }) },
  onGroupNameInput(e) { this.setData({ newGroupName: e.detail.value }) },

  confirmAddGroup() {
    const name = this.data.newGroupName.trim()
    if (!name) { wx.showToast({ title: '请输入名称', icon: 'none' }); return }
    const groups = [].concat(this.data.optionGroups)
    groups.push({ name, options: [] })
    this.setData({ optionGroups: groups, showAddGroup: false, newGroupName: '' })
  },

  removeGroup(e) {
    const idx = parseInt(e.currentTarget.dataset.index)
    const groups = [].concat(this.data.optionGroups)
    groups.splice(idx, 1)
    this.setData({ optionGroups: groups })
  },

  showAddOptionInput(e) {
    this.setData({ addingOptionIndex: parseInt(e.currentTarget.dataset.index), newOptionText: '' })
  },

  onOptionTextInput(e) { this.setData({ newOptionText: e.detail.value }) },

  confirmAddOption() {
    const text = this.data.newOptionText.trim()
    const idx = this.data.addingOptionIndex
    if (!text) { wx.showToast({ title: '请输入选项', icon: 'none' }); return }
    const groups = JSON.parse(JSON.stringify(this.data.optionGroups))
    groups[idx].options.push(text)
    this.setData({ optionGroups: groups, addingOptionIndex: -1, newOptionText: '' })
  },

  cancelAddOption() { this.setData({ addingOptionIndex: -1 }) },

  removeOption(e) {
    const gIdx = parseInt(e.currentTarget.dataset.gindex)
    const oIdx = parseInt(e.currentTarget.dataset.oindex)
    const groups = JSON.parse(JSON.stringify(this.data.optionGroups))
    groups[gIdx].options.splice(oIdx, 1)
    this.setData({ optionGroups: groups })
  },

  // ===== 保存 =====
  async saveDish() {
    if (!app.isBound()) { wx.showToast({ title: '请先绑定伴侣', icon: 'none' }); return }
    const { name, saving, isEdit, _id } = this.data
    if (saving) return
    if (!name.trim()) { wx.showToast({ title: '请输入菜品名称', icon: 'none' }); return }

    // 过滤掉空选项组
    const optionGroups = this.data.optionGroups.filter(g => g.name && g.options.length > 0)

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...' })

    try {
      let imageUrl = this.data.imageUrl
      if (this.data.tempFilePath) {
        imageUrl = await this.uploadImage()
      } else if (imageUrl && !imageUrl.startsWith('cloud://')) {
        const originUrl = this.data.originalDish?._origin_imageUrl
        if (originUrl) imageUrl = originUrl
      }

      const db = await app.database()
      const category = this.getSelectedCategoryId()

      if (isEdit) {
        const myOpenid = app.globalData.currentUser?._id || ''
        const isCreator = (myOpenid === (this.data.originalDish?._openid || ''))
        const updateData = { name: name.trim(), description: this.data.description.trim(), imageUrl, category, optionGroups }
        if (isCreator) updateData.createTime = new Date()
        else { updateData.modifiedBy = myOpenid; updateData.modifiedTime = new Date() }

        const res = await wx.cloud.callFunction({ name: 'updateCoupleData', data: { collection: app.globalData.collectionDishList, docId: _id, action: 'update', data: updateData } })
        wx.hideLoading()
        if (!res.result?.success) { wx.showToast({ title: '修改失败', icon: 'none' }); return }
        wx.showToast({ title: '修改成功', icon: 'success' })
      } else {
        const coupleId = app.globalData.currentUser?.coupleId || ''
        await db.collection(app.globalData.collectionDishList).add({ data: { name: name.trim(), description: this.data.description.trim(), imageUrl, category, optionGroups, coupleId, createTime: db.serverDate() } })
        wx.hideLoading()
        wx.showToast({ title: '添加成功', icon: 'success' })
      }
      setTimeout(() => wx.navigateBack(), 1500)
    } catch (e) {
      wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }); this.setData({ saving: false })
    }
  },

  resetForm() {
    const currentChildren = this.data.parentCats[0] ? (this.data.childrenMap[this.data.parentCats[0]._id] || []) : []
    this.setData({ name: '', description: '', imageUrl: '', tempFilePath: '', parentIndex: 0, childIndex: 0, currentChildren, optionGroups: [], showAddGroup: false })
  },
})
