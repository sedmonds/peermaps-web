var rx = 0
var connectionLimit = 10

module.exports = function (root) {
  var controllers = {}
  var callbacks = {} // store leaked callbacks here so they may be resumed later
  var active = {}
  var queue = []
  var pending = 0
  var cache = {}

  return {
    length: function f (name, cb) {
      var data = cache[name]
      if (data === undefined) {
        getData(name, function (err, d) {
          if (err) return cb(err)
          data = cache[name] = d
          cb(null, data.length)
        })
      } else {
        cb(null, data.length)
      }
    },
    read: function f (name, offset, length, cb) {
      var data = cache[name]
      if (data === undefined) {
        getData(name, function (err, d) {
          if (err) cb(err)
          else if (offset === 0 && length === data.length) {
            data = cache[name] = d
            cb(null, data)
          } else {
            data = cache[name] = d
            cb(null, data.subarray(offset, offset+length))
          }
        })
      } else if (offset === 0 && length === data.length) {
        cb(null, data)
      } else {
        cb(null, data.subarray(offset, offset+length))
      }
    },
    getRootUrl: function () { return root },
    setRootUrl: function (url) { root = url},
    destroy: function (name, cb) {
      console.log('destroy',name)
      if (controllers[name]) {
        controllers[name].abort()
      }
      controllers[name] = null
      if (cache[name]) {
        delete cache[name]
      }
      for (var i = 0; i < queue.length; i++) {
        var q = queue[i]
        if (q.name === name) {
          leak(q.name, q.cb)
        }
      }
      queue = queue.filter(q => q.name !== name)
      if (cb) cb()
    }
  }

  async function getData(name, cb) {
    if (active[name] || pending >= connectionLimit) {
      queue.push({ name, cb })
      return
    }
    pending++
    console.log('get',name,pending,queue.length)
    active[name] = true
    var opts = {}
    if (typeof AbortController !== 'undefined') {
      controllers[name] = new AbortController
      opts.signal = controllers[name].signal
    }
    var to = setTimeout(function () {
      if (controllers[name]) controllers[name].abort()
      delete controllers[name]
    }, 10_000)
    var delay = 10
    var data = null
    try {
      data = Buffer.from(await (await fetch(root + '/' + name, opts)).arrayBuffer())
      rx += data.length
    } catch (err) {
      if (controllers[name] === null) {
        console.log('abort',name)
        leak(name, cb)
      } else {
        console.error(name, err)
        queue.push({ name, cb })
        delay = 5_000
      }
    }
    clearTimeout(to)
    delete active[name]
    delete controllers[name]
    if (data) {
      try { cb(null, data) }
      catch (err) { console.error(err) }
      var found = false
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].name === name) {
          try { queue[i].cb(null, data) }
          catch (err) { console.error(err) }
          found = true
        }
      }
      if (found) queue = queue.filter(q => q.name !== name)
      if (callbacks[name]) {
        for (var i = 0; i < callbacks.length; i++) {
          try { callbacks[i](null, data) }
          catch (err) { console.error(err) }
        }
        delete callbacks[name]
      }
      //console.log((rx/1024/1024).toFixed(1) + ' M')
    }
    pending--
    if (queue.length > 0 && pending < connectionLimit) {
      setTimeout(next, delay)
    }
  }

  function next() {
    if (queue.length > 0 && pending < connectionLimit) {
      var q = queue.shift()
      getData(q.name, q.cb)
    }
  }
  function leak(name, cb) {
    if (!callbacks[name]) callbacks[name] = [cb]
    else callbacks[name].push(cb)
  }
}
