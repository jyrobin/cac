require('ts-node/register')
const cli = require('../src/index').cac()

cli
  .command('build', 'Build project', {
    ignoreOptionDefaultValue: true,
  })
  .option('--type [type]', 'Choose a project type', {
    default: 'node',
  })

const parsed = cli.parse()
const { args, options } = parsed

console.log(JSON.stringify({ args, options }, null, 2))
