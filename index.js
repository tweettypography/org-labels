var co      = require('co')
var channel = require('chanel') // don't need maybe?
var reset   = require('yield-ratelimit-reset') // not sure how to integrate?
var request = require('co-request')

var valid_color = /^([0-9A-F]{3}$|[0-9A-F]{6}$)/i

var GITHUB_USERNAME  = process.env.GITHUB_USERNAME
var GITHUB_PASSWORD  = process.env.GITHUB_PASSWORD
var GITHUB_API_TOKEN = process.env.GITHUB_API_TOKEN

var header = { 'User-Agent': 'org-labels' }
var auth

if (GITHUB_API_TOKEN) {
  auth = {
      user: GITHUB_API_TOKEN
    , pass: 'x-oauth-basic'
  }
} else if (GITHUB_USERNAME && GITHUB_PASSWORD) {
  auth = {
      user: GITHUB_USERNAME
    , pass: GITHUB_PASSWORD
  }
} else {
  throw new Error('requires a personal env.GITHUB_API_TOKEN or both env.GITHUB_USERNAME and env.GITHUB_PASSWORD')
}

module.exports.add    = add
module.exports.remove = remove
module.exports.update = update
module.exports.rename = rename
module.exports.standardize = standardize

function* add(args, program) {
  var org   = args[0]
  var label = args[1]
  var color = args[2]

  if (!valid_color.test(color))
    throw new TypeError('color must be a valid hex color code without the \'#\': 09aF00')

  return yield* do_all(org, 'POST', { name: label, color: color }, 'done adding labels')
}

function* remove(args, program) {
  var org   = args[0]
  var label = args[1]

  return yield* do_all(org, 'DELETE', { name: label, ext: label }, 'done removing labels')
}

function* update(args, program) {
  var org   = args[0]
  var label = args[1]
  var color = args[2]

  if (!valid_color.test(color))
    throw new TypeError('color must be a valid hex color code without the \'#\': 09aF00')

  return yield* do_all(org, 'PATCH', { name: label, color: color, ext: label }, 'done updating labels')
}

function* rename(args, program) {
  var org       = args[0]
  var label     = args[1]
  var new_label = args[2]

  return yield* do_all(org, 'PATCH', { name: new_label, ext: label }, 'done renaming labels')
}

function* do_all(org, method, opts, done) {
  var repos   = yield* get_repos(org)
  var results = yield* send_labels(org, repos, method, opts)

  log_results(results, opts.name)
  console.log(done)

  return yield results
}

function* standardize(args, program) {
  var org         = args[0]
  var config_repo = args[1]

  var res = yield request({
        url:     'https://api.github.com/repos/' + org + '/' + config_repo
               + '/contents/config/github_labels.json'
      , headers: header
      , auth:    auth
      , json:    true
    })
  if (res.statusCode !== 200) throw new Error('error retrieving config from repo: ' + JSON.stringify(res.headers) +'\n')

  console.log('\nGitHub rate limit remaining: ' + res.headers['x-ratelimit-remaining'])

  var config = JSON.parse(new Buffer(res.body.content, 'base64').toString('utf8'))
  var results = yield* process_config(org, config)

  console.log('done standardizing labels')
}

function* process_config(org, config) {
  if (!Array.isArray(config))
    throw new Error('error: github_labels.json must be a json array')

  console.log('standardizing %d labels', config.length)

  var i = config.length
  while (i--) {
    var label = config[i]

    var results = yield* add([org, label.name, label.color])

    var j = results.length
    while(j--) {
      var res = results[j]

      if (res.statusCode === 422) {

        var url = 'https://api.github.com' + res.req.path + '/' + label.name
        var result = yield request({
            url:     url
          , headers: header
          , method:  'PATCH'
          , json:    { name: label.name, color: label.color }
          , auth:    auth
        })

        if (result.statusCode === 200)
          console.log('label "' + label.name + '" successfully updated at ' + result.request.path)
        else {
          console.log(result.request.path)
          console.log('status: ' + result.statusCode)
          if (result.body) console.log(result.body)
        }

        results[j] = result
      }
    }
  }
}

function* get_repos(org) {
  var res = yield request({
        url:     'https://api.github.com/orgs/' + org + '/repos'
      , headers: header
      , auth:    auth
      , json:    true
    })
  if (res.statusCode !== 200) throw new Error('error searching org\'s repos: ' + JSON.stringify(res.headers) +'\n')

  console.log('found %d repositories in %s\n', res.body.length, org)

  var i     = res.body.length
  var repos = []
  while (i--) {
    repos.push(res.body[i].name)
  }

  return repos
}

function* send_labels(org, repos, method, opts) {
  var arr = []
  var i   = repos.length
  var url = 'https://api.github.com/repos/' + org + '/:repo/labels'

  while (i--) {
    arr.push(request({
        url:     url.replace(/:repo/, repos[i]) + (opts.ext ? '/' + opts.ext : '')
      , headers: header
      , method:  method
      , json:    opts
      , auth:    auth
    }))
  }

  return yield arr
}

function log_results(results, label) {
  var i = results.length
  while (i--) {
    var result = results[i]

    if (result.statusCode === 422)
      console.log('label "' + label + '" already exists at ' + result.request.path)

    else if (result.statusCode === 200)
      console.log('label "' + label + '" successfully updated at ' + result.request.path)

    else if (result.statusCode === 201)
      console.log('label "' + label + '" successfully created at ' + result.request.path)

    else if (result.statusCode === 204)
      console.log('label "' + label + '" successfully deleted from ' + result.request.path)

    else {
      console.log(result.request.path)
      console.log('status: ' + result.statusCode)
      if (result.body) console.log(result.body)
    }
  }
}
