const app = getApp()

Page({
  data: {
    isBound: false, dishes: [], allDishes: [], categories: [],
    parentCats: [], childrenMap: {}, dishesByCategory: {},
    categoryCount: {}, selectedByCategory: {},
    currentCategory: '', categoryScrollId: '', dishScrollId: '',
    selectedCount: 0, selectedDishes: [], loading: true,
    showSuccess: false, showRemarkModal: false, showCartPanel: false,
    showDishDetail: false, detailClosing: false, currentDish: null,
    detailTranslateY: 0, remark: '', submitting: false,
    partnerName: '对方', searchKey: '',
    // 选项组临时选择
    tempOptions: {},  // { '辣度': '微辣', '份量': '大份' }
  },

  _dishesLoaded: false,
  _childrenMap: {},

  async onShow() {
    app.setKitchenTitle(); this.loadPartnerName()
    await app.loadCategories(true)

    // 有再来一单时强制全新加载
    if (app.globalData.reorderDishIds) {
      this._dishesLoaded = false
    }

    if (!this._dishesLoaded) {
      this.loadDishes()
    } else {
      // 已加载过：重新拉取数据但保留已选状态
      this.refreshDishesKeepSelection()
    }
  },
  

  async loadPartnerName() {
    await app.loadUserInfo()
    this.setData({ partnerName: app.getPartnerName() })
  },

  _rebuildCategoryData(dishes) {
    const allCats = app.globalData.categories || []
    const parentCats = allCats.filter(c => !c.parentId).sort((a, b) => (a.sort||0) - (b.sort||0))
    const childrenMap = {}
    parentCats.forEach(p => { childrenMap[p._id] = allCats.filter(c => c.parentId === p._id).sort((a, b) => (a.sort||0) - (b.sort||0)) })
    this._childrenMap = childrenMap

    const dishesByCategory = {}
    allCats.forEach(cat => { dishesByCategory[cat._id] = dishes.filter(d => d.category === cat._id) })

    const categoryCount = {}, selectedByCategory = {}
    parentCats.forEach(p => {
      const childIds = (childrenMap[p._id] || []).map(c => c._id)
      const allIds = [p._id, ...childIds]
      categoryCount[p._id] = dishes.filter(d => allIds.includes(d.category)).length
      selectedByCategory[p._id] = dishes.filter(d => allIds.includes(d.category) && d.selected).length
    })

    return { categories: allCats, parentCats, childrenMap, dishesByCategory, categoryCount, selectedByCategory,
      selectedDishes: dishes.filter(d => d.selected), selectedCount: dishes.filter(d => d.selected).length }
  },

  async loadDishes() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getCoupleData', data: { collection: app.globalData.collectionDishList, orderBy: 'createTime', order: 'desc', limit: 100 } })
      if (!res.result?.success) throw new Error()

      const reorderIds = app.globalData.reorderDishIds ? app.globalData.reorderDishIds.split(',') : []
      app.globalData.reorderDishIds = null

      const dishes = res.result.data.map(item => ({
        ...item, selected: reorderIds.includes(item._id), category: item.category || '',
        selectedOptions: {}, optionsText: ''
      }))
      await app.convertFileURLs(dishes, ['imageUrl'])
      const catData = this._rebuildCategoryData(dishes)
      const firstParent = catData.parentCats.find(c => catData.categoryCount[c._id] > 0)
      this.setData({ dishes, allDishes: dishes, ...catData,
        currentCategory: firstParent ? firstParent._id : (catData.parentCats[0]?._id || ''),
        loading: false, searchKey: '' })

      this._dishesLoaded = true

      if (reorderIds.length > 0) wx.showToast({ title: '已选好菜品~', icon: 'none' })
    } catch (e) { this.setData({ loading: false }) }
  },
  
  async refreshDishesKeepSelection() {
    const now = Date.now()
    if (this._lastRefresh && (now - this._lastRefresh < 10000)) return
    this._lastRefresh = now
    try {
      const res = await wx.cloud.callFunction({
        name: 'getCoupleData',
        data: { collection: app.globalData.collectionDishList, orderBy: 'createTime', order: 'desc', limit: 100 }
      })
      if (!res.result?.success) return

      // 记住之前的选中状态和选项
      const oldSelections = {}
      this.data.dishes.forEach(d => {
        if (d.selected) {
          oldSelections[d._id] = { selectedOptions: d.selectedOptions || {}, optionsText: d.optionsText || '' }
        }
      })

      const dishes = res.result.data.map(item => {
        const old = oldSelections[item._id]
        return {
          ...item,
          category: item.category || '',
          selected: !!old,
          selectedOptions: old ? old.selectedOptions : {},
          optionsText: old ? old.optionsText : ''
        }
      })
	  await app.convertFileURLs(dishes, ['imageUrl'])
      const catData = this._rebuildCategoryData(dishes)
      const firstParent = catData.parentCats.find(c => catData.categoryCount[c._id] > 0)

      this.setData({
        dishes, allDishes: dishes, ...catData,
        currentCategory: this.data.currentCategory || (firstParent ? firstParent._id : ''),
      })
    } catch (e) {
      console.error('刷新菜品失败', e)
    }
  },

  selectCategory(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ currentCategory: id, dishScrollId: 'parent-' + id, categoryScrollId: 'catleft-' + id })
  },

  onSearchInput(e) { this.setData({ searchKey: e.detail.value.trim() }); this.filterDishes(e.detail.value.trim()) },
  clearSearch() { this.setData({ searchKey: '' }); this.filterDishes('') },

  filterDishes(searchKey) {
    let dishes = this.data.allDishes
    if (searchKey) dishes = dishes.filter(d => d.name.includes(searchKey) || (d.description && d.description.includes(searchKey)))
    const catData = this._rebuildCategoryData(dishes)
    const firstParent = catData.parentCats.find(c => catData.categoryCount[c._id] > 0)
    this.setData({ dishes, ...catData, currentCategory: firstParent ? firstParent._id : '' })
  },

  onDishScroll(e) {
    if (this._scrollTimer) return
    this._scrollTimer = setTimeout(() => { this._scrollTimer = null; this._syncCategoryHighlight() }, 100)
  },

  _syncCategoryHighlight() {
    const { parentCats, categoryCount } = this.data
    const visibleParents = parentCats.filter(c => categoryCount[c._id] > 0)
    if (visibleParents.length === 0) return
    const query = this.createSelectorQuery()
    query.select('.dish-list').boundingClientRect()
    visibleParents.forEach(cat => query.select('#parent-' + cat._id).boundingClientRect())
    query.exec(rects => {
      if (!rects || !rects[0]) return
      const listTop = rects[0].top + 20
      let activeId = visibleParents[0]._id
      for (let i = 0; i < visibleParents.length; i++) {
        if (rects[i + 1] && rects[i + 1].top <= listTop) activeId = visibleParents[i]._id
      }
      if (activeId !== this.data.currentCategory) {
        this.setData({ currentCategory: activeId, categoryScrollId: 'catleft-' + activeId })
      }
    })
  },

  // 点击菜品行：有选项组则打开详情面板，否则直接切换
  toggleSelect(e) {
    const id = e.currentTarget.dataset.id
    const dish = this.data.dishes.find(d => d._id === id)
    if (!dish) return

    if (dish.selected) {
      // 取消选中
      const dishes = this.data.dishes.map(d => d._id === id ? { ...d, selected: false, selectedOptions: {}, optionsText: '' } : d)
      this.setData({ dishes, ...this._rebuildCategoryData(dishes) })
    } else if (dish.optionGroups && dish.optionGroups.length > 0) {
      // 有选项组，打开详情面板
      this.setData({ showDishDetail: true, currentDish: dish, tempOptions: {} })
    } else {
      // 无选项组，直接选中
      const dishes = this.data.dishes.map(d => d._id === id ? { ...d, selected: true } : d)
      this.setData({ dishes, ...this._rebuildCategoryData(dishes) })
    }
  },

  toggleCartPanel() { this.setData({ showCartPanel: !this.data.showCartPanel }) },

  openDishDetail(e) {
    const dish = this.data.dishes.find(d => d._id === e.currentTarget.dataset.id)
    if (dish) this.setData({ showDishDetail: true, currentDish: dish, tempOptions: dish.selectedOptions || {} })
  },

  closeDishDetail() {
    this.setData({ detailClosing: true, detailTranslateY: 0 })
    setTimeout(() => this.setData({ showDishDetail: false, detailClosing: false, currentDish: null, tempOptions: {} }), 300)
  },

  onDetailTouchStart(e) { this.touchStartY = e.touches[0].clientY },
  onDetailTouchMove(e) { const dy = e.touches[0].clientY - this.touchStartY; if (dy > 0) this.setData({ detailTranslateY: dy }) },
  onDetailTouchEnd() { if (this.data.detailTranslateY > 150) this.closeDishDetail(); else this.setData({ detailTranslateY: 0 }) },

  // 选项单选
  selectOption(e) {
    const { group, option } = e.currentTarget.dataset
    const tempOptions = Object.assign({}, this.data.tempOptions)
    tempOptions[group] = option
    this.setData({ tempOptions })
  },

  // 详情面板中加入/移出菜单
  toggleDishInDetail() {
    const { currentDish, tempOptions } = this.data
    if (!currentDish) return

    if (currentDish.selected) {
      // 移出
      const dishes = this.data.dishes.map(d => d._id === currentDish._id ? { ...d, selected: false, selectedOptions: {}, optionsText: '' } : d)
      const updated = dishes.find(d => d._id === currentDish._id)
      this.setData({ dishes, ...this._rebuildCategoryData(dishes), currentDish: updated })
    } else {
      // 加入：验证选项组
      const groups = currentDish.optionGroups || []
      if (groups.length > 0) {
        for (const g of groups) {
          if (!tempOptions[g.name]) {
            wx.showToast({ title: `请选择${g.name}`, icon: 'none' }); return
          }
        }
      }

      const optionsText = this._formatOptionsText(tempOptions)
      const dishes = this.data.dishes.map(d => d._id === currentDish._id ? { ...d, selected: true, selectedOptions: tempOptions, optionsText } : d)
      const updated = dishes.find(d => d._id === currentDish._id)
      this.setData({ dishes, ...this._rebuildCategoryData(dishes), currentDish: updated })
      this.closeDishDetail()
    }
  },

  _formatOptionsText(opts) {
    if (!opts || Object.keys(opts).length === 0) return ''
    return Object.entries(opts).map(([k, v]) => `${k}:${v}`).join(' | ')
  },

  removeFromCart(e) {
    const dishes = this.data.dishes.map(d => d._id === e.currentTarget.dataset.id ? { ...d, selected: false, selectedOptions: {}, optionsText: '' } : d)
    this.setData({ dishes, ...this._rebuildCategoryData(dishes) })
  },

  clearCart() {
    const dishes = this.data.dishes.map(d => ({ ...d, selected: false, selectedOptions: {}, optionsText: '' }))
    this.setData({ dishes, ...this._rebuildCategoryData(dishes), showCartPanel: false })
  },

  submitOrder() {
    if (this.data.submitting) return
    if (this.data.selectedDishes.length === 0) { wx.showToast({ title: '请先选择菜品', icon: 'none' }); return }
    this.setData({ showRemarkModal: true, remark: '' })
  },

  onRemarkInput(e) { let v = e.detail.value; if (v.length > 100) v = v.slice(0, 100); this.setData({ remark: v }); return v },
  closeRemarkModal() { this.setData({ showRemarkModal: false }) },
  preventClose() {},
  skipRemark() { this.setData({ showRemarkModal: false }); wx.requestSubscribeMessage({ tmplIds: app.globalData.notifyTmplIds, complete: () => this.doSubmitOrder('') }) },
  confirmRemark() { this.setData({ showRemarkModal: false }); wx.requestSubscribeMessage({ tmplIds: app.globalData.notifyTmplIds, complete: () => this.doSubmitOrder(this.data.remark) }) },

  async doSubmitOrder(remark) {
    if (!app.isBound()) { wx.showToast({ title: '请先绑定伴侣', icon: 'none' }); return }
    const { selectedDishes } = this.data
    this.setData({ submitting: true }); wx.showLoading({ title: '提交中...', mask: true })
    try {
      const db = await app.database()
      const coupleId = app.globalData.currentUser?.coupleId || ''
      const addRes = await db.collection(app.globalData.collectionOrderList).add({
        data: {
          dishes: selectedDishes.map(item => ({
            _id: item._id, name: item.name,
            imageUrl: item._origin_imageUrl || item.imageUrl || '',
            category: item.category,
            selectedOptions: item.selectedOptions || {}
          })),
          remark, coupleId, createTime: db.serverDate(),
        }
      })
      for (const dish of selectedDishes) {
        wx.cloud.callFunction({ name: 'updateCoupleData', data: { collection: app.globalData.collectionDishList, docId: dish._id, action: 'inc', data: { orderCount: 1 } } }).catch(() => {})
      }
      await this.sendNotification(selectedDishes, remark, addRes._id)
	  app.globalData._orderChanged = true
      wx.hideLoading(); this.setData({ showSuccess: true, submitting: false })
    } catch (e) { wx.hideLoading(); wx.showToast({ title: '点菜失败', icon: 'none' }); this.setData({ submitting: false }) }
  },

  async sendNotification(dishes, remark, orderId) {
    try { await wx.cloud.callFunction({ name: 'sendNotify', data: { type: 'newOrder', dishNames: dishes.map(d => d.name).join('、'), count: dishes.length, remark, orderId } }) } catch (e) {}
  },

  closeSuccess() {
    const dishes = this.data.dishes.map(d => ({ ...d, selected: false, selectedOptions: {}, optionsText: '' }))
    this.setData({ showSuccess: false, dishes, ...this._rebuildCategoryData(dishes) })
    this._dishesLoaded = false  // 下次进入重新加载以更新点菜次数
  },

  goToDishes() { wx.switchTab({ url: '/pages/Dishes/index' }) },
})
