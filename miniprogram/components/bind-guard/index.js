Component({
  data: {
    show: false
  },
  pageLifetimes: {
    show() {
      const app = getApp()
      this.setData({ show: app && !app.isBound() })
    }
  },
  methods: {
    goToBind() {
      wx.navigateTo({ url: '/pages/Bind/index' })
    }
  }
})
