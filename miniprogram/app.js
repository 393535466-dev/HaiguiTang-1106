const config = require('./config')
const storage = require('./utils/storage')

App({
  globalData: { configured: false, ownerKey: '', health: null },
  onLaunch() {
    storage.purgeExpired()
    this.globalData.configured = Boolean(config.cloudEnv && wx.cloud)
    if (this.globalData.configured) wx.cloud.init({ env: config.cloudEnv, traceUser: false })
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization(resolve => {
        this._privacyResolver = resolve
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        if (page) page.setData({ privacyNeeded: true })
      })
    }
  },
  ensurePrivacy() {
    if (!wx.requirePrivacyAuthorize) return Promise.resolve()
    return new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }))
  },
  resolvePrivacy(agree) {
    if (this._privacyResolver) {
      this._privacyResolver({ event: agree ? 'agree' : 'disagree', buttonId: 'agree-privacy' })
      this._privacyResolver = null
    }
  }
})
