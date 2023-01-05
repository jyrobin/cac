require('ts-node/register')
const cli = require('../src/index').cac()

cli.option('--type [type]', 'Choose a project type')

const parsed = cli.parse()
const { args, options } = parsed

console.log(JSON.stringify({ args, options }, null, 2))
