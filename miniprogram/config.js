let local = {}
try { local = require('./config.local') } catch (_) {}
module.exports = Object.assign({ cloudEnv: '', functionName: 'game' }, local)
