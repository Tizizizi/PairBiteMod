const app = getApp()

Page({
  data: {
    orders: [],
    allOrders: [],
    loading: true,
    hasMore: true,
    page: 0,
    pageSize: 10,
    openid: '',
    partnerName: '对方',
    partnerNickname: '对方',
    myNickname: '我',
    myOpenid: '',
    showTipModal: false,
    tipText: '',
    // 搜索
    searchKey: '',
    // 筛选
    showFilterPanel: false,
    filterType: '',
    filterCategoryId: '',
    filterCreator: '',
    filterMealStatus: '',    // '' | 'done' | 'pending'
    filterLabel: '筛选',
    filterExpandedCats: {},
    parentCats: [],
    childrenMap: {},
    allCategories: [],
    // 排序
    showSortPanel: false,
    sortOrder: 'desc',
    sortLabel: '最新优先',
  },

  _loaded: false,

  async onShow() {
    app.setKitchenTitle()
    await app.loadUserInfo(true)
    await app.loadCategories(true)
    this.loadUserData()
    this.buildCategoryData()
    if (!this._loaded || app.globalData._orderChanged) {
      app.globalData._orderChanged = false
      await this._loadDishMap()
      await this.loadOrders(true)
      this._loaded = true
    }
  },

  loadUserData() {
    const myOpenid = app.globalData.currentUser?._id || ''
    const myNickname = app.globalData.currentUser?.nickname || '我'
    const partnerNickname = app.globalData.partner?.nickname || '对方'
    this.setData({ myOpenid, openid: myOpenid, myNickname, partnerNickname, partnerName: partnerNickname })
  },

  buildCategoryData() {
    const all = app.globalData.categories || []
    const parentCats = all.filter(c => !c.parentId).sort((a, b) => (a.sort||0) - (b.sort||0))
    const childrenMap = {}
    parentCats.forEach(p => { childrenMap[p._id] = all.filter(c => c.parentId === p._id).sort((a, b) => (a.sort||0) - (b.sort||0)) })
    this.setData({ allCategories: all, parentCats, childrenMap })
  },

  async loadOrders(reset = false) {
    if (reset) this.setData({ page: 0, allOrders: [], orders: [], hasMore: true })
    this.setData({ loading: true })

    try {
      const { page, pageSize, allOrders: existing } = this.data
      const res = await wx.cloud.callFunction({
        name: 'getCoupleData',
        data: { collection: app.globalData.collectionOrderList, orderBy: 'createTime', order: 'desc', skip: page * pageSize, limit: pageSize }
      })
      if (!res.result?.success) throw new Error()

      const data = res.result.data
      const newOrders = data.map(item => this._processOrder(item))
      const allOrders = reset ? newOrders : [...existing, ...newOrders]
      await app.convertFileURLs(allOrders, ['imageUrl'])
      this.setData({ allOrders, hasMore: data.length === pageSize, page: page + 1, loading: false })
      this.applyFilterAndSort()
    } catch (e) {
      console.error('加载历史失败', e)
      this.setData({ loading: false })
    }
  },

  // 加载菜品库最新数据，建立 ID→图片 的映射
  async _loadDishMap() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getCoupleData',
        data: { collection: app.globalData.collectionDishList, orderBy: 'createTime', order: 'desc', limit: 100 }
      })
      if (res.result?.success) {
        const map = {}
        res.result.data.forEach(d => {
          map[d._id] = { imageUrl: d.imageUrl, name: d.name }
        })
		await app.convertFileURLs(res.result.data, ['imageUrl'])
        this._dishMap = map
      }
    } catch (e) {
      this._dishMap = {}
    }
  },


  _processOrder(item) {
    const noteCount = (item.mealNotes || []).length
    return {
      ...item,
      dishes: (item.dishes || []).map(d => {
        const fresh = this._dishMap?.[d._id]
        return {
          ...d,
          imageUrl: fresh ? fresh.imageUrl : d.imageUrl,
          name: fresh ? fresh.name : d.name,
          optionsText: d.selectedOptions && Object.keys(d.selectedOptions).length > 0
            ? Object.values(d.selectedOptions).join('/') : ''
        }
      }),
      dateText: this.formatDate(item.createTime),
      timeText: this.formatTime(item.createTime),
      creatorName: this.getCreatorName(item._openid),
      slideButtons: this.getSlideButtons(item.marked),
      hasFinishedPhoto: !!(item.finishedPhoto || (item.finishedPhotos && item.finishedPhotos.length > 0)),
      noteCount,
    }
  },

  // ===== 搜索 =====
  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value.trim() })
    this.applyFilterAndSort()
  },
  clearSearch() { this.setData({ searchKey: '' }); this.applyFilterAndSort() },

  // ===== 筛选 =====
  toggleFilterPanel() { this.setData({ showFilterPanel: !this.data.showFilterPanel, showSortPanel: false, filterExpandedCats: {} }) },
  toggleFilterCat(e) {
    const id = e.currentTarget.dataset.id
    const expanded = Object.assign({}, this.data.filterExpandedCats)
    expanded[id] = !expanded[id]
    this.setData({ filterExpandedCats: expanded })
  },

  selectCategoryFilter(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.filterCategoryId) {
      this.setData({ filterCategoryId: '', filterType: this.data.filterCreator || this.data.filterMealStatus ? this.data.filterType : '', filterLabel: this._buildFilterLabel('', this.data.filterCreator, this.data.filterMealStatus), showFilterPanel: false })
    } else {
      const cat = this.data.allCategories.find(c => c._id === id)
      this.setData({ filterCategoryId: id, filterType: 'active', filterLabel: this._buildFilterLabel(cat ? cat.icon + cat.name : '', this.data.filterCreator, this.data.filterMealStatus), showFilterPanel: false })
    }
    this.applyFilterAndSort()
  },

  selectCreatorFilter(e) {
    const who = e.currentTarget.dataset.who
    const newCreator = who === this.data.filterCreator ? '' : who
    const label = newCreator === 'me' ? this.data.myNickname : (newCreator === 'partner' ? this.data.partnerNickname : '')
    this.setData({ filterCreator: newCreator, filterType: newCreator || this.data.filterCategoryId || this.data.filterMealStatus ? 'active' : '', filterLabel: this._buildFilterLabel(this.data.filterCategoryId ? '' : '', newCreator ? label : '', this.data.filterMealStatus), showFilterPanel: false })
    this.applyFilterAndSort()
  },

  selectMealStatusFilter(e) {
    const status = e.currentTarget.dataset.status
    const newStatus = status === this.data.filterMealStatus ? '' : status
    this.setData({ filterMealStatus: newStatus, filterType: newStatus || this.data.filterCategoryId || this.data.filterCreator ? 'active' : '', showFilterPanel: false })
    this._updateFilterLabel()
    this.applyFilterAndSort()
  },

  _buildFilterLabel(catLabel, creatorLabel, mealStatus) {
    const parts = []
    if (catLabel) parts.push(catLabel)
    if (creatorLabel) parts.push(creatorLabel)
    if (mealStatus === 'done') parts.push('已用餐')
    if (mealStatus === 'pending') parts.push('待用餐')
    return parts.length > 0 ? parts.join('+') : '筛选'
  },

  _updateFilterLabel() {
    const { filterCategoryId, filterCreator, filterMealStatus, allCategories, myNickname, partnerNickname } = this.data
    const cat = filterCategoryId ? allCategories.find(c => c._id === filterCategoryId) : null
    const catLabel = cat ? cat.icon + cat.name : ''
    const creatorLabel = filterCreator === 'me' ? myNickname : (filterCreator === 'partner' ? partnerNickname : '')
    this.setData({ filterLabel: this._buildFilterLabel(catLabel, creatorLabel, filterMealStatus) })
  },

  clearFilter() {
    this.setData({ filterType: '', filterCategoryId: '', filterCreator: '', filterMealStatus: '', filterLabel: '筛选', showFilterPanel: false, filterExpandedCats: {} })
    this.applyFilterAndSort()
  },

  // ===== 排序 =====
  toggleSortPanel() { this.setData({ showSortPanel: !this.data.showSortPanel, showFilterPanel: false }) },

  selectSort(e) {
    const order = e.currentTarget.dataset.order
    this.setData({ sortOrder: order, sortLabel: order === 'desc' ? '最新优先' : '最早优先', showSortPanel: false })
    this.applyFilterAndSort()
  },

  // ===== 核心筛选排序 =====
  applyFilterAndSort() {
    let { allOrders, searchKey, filterCategoryId, filterCreator, filterMealStatus, myOpenid, sortOrder, childrenMap } = this.data
    let result = [].concat(allOrders)

    // 搜索（菜品名）
    if (searchKey) {
      result = result.filter(o => (o.dishes || []).some(d => d.name && d.name.includes(searchKey)))
    }

    // 筛选-分类
    if (filterCategoryId) {
      const children = childrenMap[filterCategoryId] || []
      const ids = [filterCategoryId, ...children.map(c => c._id)]
      result = result.filter(o => (o.dishes || []).some(d => ids.includes(d.category)))
    }

    // 筛选-下单者
    if (filterCreator === 'me') result = result.filter(o => o._openid === myOpenid)
    else if (filterCreator === 'partner') result = result.filter(o => o._openid && o._openid !== myOpenid)

    // 筛选-用餐情况
    if (filterMealStatus === 'done') result = result.filter(o => o.hasFinishedPhoto)
    else if (filterMealStatus === 'pending') result = result.filter(o => !o.hasFinishedPhoto)

    // 排序
    result.sort((a, b) => {
      const ta = new Date(a.createTime || 0).getTime()
      const tb = new Date(b.createTime || 0).getTime()
      return sortOrder === 'desc' ? tb - ta : ta - tb
    })

    this.setData({ orders: result })
  },

  closeAllPanels() { this.setData({ showFilterPanel: false, showSortPanel: false }) },

  loadMore() { if (this.data.hasMore && !this.data.loading) this.loadOrders() },

  getCreatorName(openid) { return app.getDisplayName(openid) },

  formatDate(date) {
    if (!date) return ''
    const d = new Date(date), today = new Date(), yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return '今天'
    if (d.toDateString() === yesterday.toDateString()) return '昨天'
    return `${(d.getMonth()+1).toString().padStart(2,'0')}月${d.getDate().toString().padStart(2,'0')}日`
  },

  formatTime(date) {
    if (!date) return ''
    const d = new Date(date)
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
  },

  getSlideButtons(marked) {
    return [
      { text: marked ? '取消' : '标记', type: 'default', extClass: 'mark-btn' },
      { text: '删除', type: 'warn', extClass: 'delete-btn' }
    ]
  },

  onSlideButtonTap(e) {
    const { index } = e.detail
    const id = e.currentTarget.dataset.id
    if (index === 0) this.toggleMark(id)
    else this.deleteOrder(id)
  },

  async toggleMark(id) {
    const orders = this.data.allOrders
    const index = orders.findIndex(item => item._id === id)
    if (index === -1) return
    const newMarked = !orders[index].marked
    wx.showLoading({ title: '处理中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'updateCoupleData', data: { collection: app.globalData.collectionOrderList, docId: id, action: 'update', data: { marked: newMarked } } })
      wx.hideLoading()
      if (!res.result?.success) { this.showTip('标记失败'); return }
      orders[index].marked = newMarked
      orders[index].slideButtons = this.getSlideButtons(newMarked)
      this.setData({ allOrders: orders })
      this.applyFilterAndSort()
      wx.showToast({ title: newMarked ? '已标记' : '已取消', icon: 'success' })
    } catch (e) { wx.hideLoading(); this.showTip('标记失败了') }
  },

  deleteOrder(id) {
    wx.showModal({
      title: '确认删除', content: '确定要删除这条点菜记录吗？', confirmColor: '#E57373',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...', mask: true })
        try {
          const result = await wx.cloud.callFunction({ name: 'updateCoupleData', data: { collection: app.globalData.collectionOrderList, docId: id, action: 'remove' } })
          wx.hideLoading()
          if (!result.result?.success) { setTimeout(() => this.showTip('删除失败'), 300); return }
          // 扣减菜品的已点次数
          const deletedOrder = this.data.allOrders.find(item => item._id === id)
          if (deletedOrder?.dishes) {
            for (const dish of deletedOrder.dishes) {
              wx.cloud.callFunction({
                name: 'updateCoupleData',
                data: {
                  collection: app.globalData.collectionDishList,
                  docId: dish._id,
                  action: 'inc',
                  data: { orderCount: -1 }
                }
              }).catch(() => {})
            }
          }		  
          wx.showToast({ title: '已删除', icon: 'success' })
          const allOrders = this.data.allOrders.filter(item => item._id !== id)
          this.setData({ allOrders })
          this.applyFilterAndSort()
        } catch (e) { wx.hideLoading(); setTimeout(() => this.showTip('只能删除自己点的菜哦~'), 300) }
      }
    })
  },

  showTip(text) { this.setData({ showTipModal: true, tipText: text }) },
  closeTipModal() { this.setData({ showTipModal: false }) },
  preventClose() {},

  goToDetail(e) {
    this._loaded = false
    const id = e.currentTarget.dataset.id
    wx.requestSubscribeMessage({ tmplIds: app.globalData.notifyTmplIds, complete: () => { wx.navigateTo({ url: `/pages/OrderDetail/index?id=${id}` }) } })
  },

  onPullDownRefresh() {
    this._loaded = false
    this._loadDishMap().then(() => {
      this.loadOrders(true).then(() => {
        this._loaded = true
        wx.stopPullDownRefresh()
      })
    })
  },
  onReachBottom() { this.loadMore() },
})

