require('ts-node/register')
const cli = require('../src/index').cac()

cli.option('--no-clear-screen', 'Do not clear screen')

const parsed = cli.parse()
const { args, options } = parsed

console.log(JSON.stringify({ args, options }, null, 2))
