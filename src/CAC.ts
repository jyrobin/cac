import { EventEmitter } from 'events'
import mri from 'mri'
import Command, {
  GlobalCommand,
  CommandConfig,
  HelpCallback,
  CommandExample,
} from './Command'
import { OptionConfig } from './Option'
import {
  getMriOptions,
  setDotProp,
  setByType,
  getFileName,
  camelcaseOptionName,
} from './utils'
import { processArgs } from './node'

interface ParsedArgv {
  args: ReadonlyArray<string>
  options: {
    [k: string]: any
  }
}

export interface CacCntx<T> {
  env: T
  name: string
  /**
   * Raw CLI arguments
   */
  rawArgs: string[]
  /**
   * Parsed CLI arguments
   */
  args: ParsedArgv['args']
  /**
   * Parsed CLI options, camelCased
   */
  options: ParsedArgv['options']
  matchedCommand?: Command<T>
  matchedCommandName?: string
  result?: unknown
}

class CAC<T> extends EventEmitter {
  /** The program name to display in help and version message */
  name: string
  commands: Command<T>[]
  globalCommand: GlobalCommand<T>
  showHelpOnExit?: boolean
  showVersionOnExit?: boolean

  /**
   * @param name The program name to display in help and version message
   */
  constructor(name = '') {
    super()
    this.name = name
    this.commands = []
    this.globalCommand = new GlobalCommand<T>(this)
    this.globalCommand.usage('<command> [options]')
  }

  /**
   * Add a global usage text.
   *
   * This is not used by sub-commands.
   */
  usage(text: string) {
    this.globalCommand.usage(text)
    return this
  }

  /**
   * Add a sub-command
   */
  command(rawName: string, description?: string, config?: CommandConfig) {
    const command = new Command<T>(rawName, description || '', config, this)
    command.globalCommand = this.globalCommand
    this.commands.push(command)
    return command
  }

  /**
   * Add a global CLI option.
   *
   * Which is also applied to sub-commands.
   */
  option(rawName: string, description: string, config?: OptionConfig) {
    this.globalCommand.option(rawName, description, config)
    return this
  }

  /**
   * Show help message when `-h, --help` flags appear.
   *
   */
  help(callback?: HelpCallback) {
    this.globalCommand.option('-h, --help', 'Display this message')
    this.globalCommand.helpCallback = callback
    this.showHelpOnExit = true
    return this
  }

  /**
   * Show version number when `-v, --version` flags appear.
   *
   */
  version(version: string, customFlags = '-v, --version') {
    this.globalCommand.version(version, customFlags)
    this.showVersionOnExit = true
    return this
  }

  /**
   * Add a global example.
   *
   * This example added here will not be used by sub-commands.
   */
  example(example: CommandExample) {
    this.globalCommand.example(example)
    return this
  }

  /**
   * Output the corresponding help message
   * When a sub-command is matched, output the help message for the command
   * Otherwise output the global one.
   *
   */
  outputHelp(cntx: CacCntx<T>) {
    if (cntx.matchedCommand) {
      cntx.matchedCommand.outputHelp(cntx)
    } else {
      this.globalCommand.outputHelp(cntx)
    }
  }

  /**
   * Output the version number.
   *
   */
  outputVersion() {
    this.globalCommand.outputVersion()
  }

  private setParsedInfo(
    cntx: CacCntx<T>,
    { args, options }: ParsedArgv,
    matchedCommand?: Command<T>,
    matchedCommandName?: string
  ) {
    cntx.args = args
    cntx.options = options
    if (matchedCommand) {
      cntx.matchedCommand = matchedCommand
    }
    if (matchedCommandName) {
      cntx.matchedCommandName = matchedCommandName
    }
  }

  unsetMatchedCommand(cntx: CacCntx<T>) {
    cntx.matchedCommand = undefined
    cntx.matchedCommandName = undefined
  }

  /**
   * Parse argv
   */
  parse(
    env: T,
    argv = processArgs,
    {
      /** Whether to run the action for matched command */
      run = true,
    } = {}
  ): CacCntx<T> {
    const cntx: CacCntx<T> = {
      env,
      rawArgs: argv,
      name: this.name || argv[1] ? getFileName(argv[1]) : 'cli',
      args: [],
      options: {},
    }

    let shouldParse = true

    // Search sub-commands
    for (const command of this.commands) {
      const parsed = this.mri(argv.slice(2), command)

      const commandName = parsed.args[0]
      if (command.isMatched(commandName)) {
        shouldParse = false
        const parsedInfo = {
          ...parsed,
          args: parsed.args.slice(1),
        }
        this.setParsedInfo(cntx, parsedInfo, command, commandName)
        this.emit(`command:${commandName}`, command)
      }
    }

    if (shouldParse) {
      // Search the default command
      for (const command of this.commands) {
        if (command.name === '') {
          shouldParse = false
          const parsed = this.mri(argv.slice(2), command)
          this.setParsedInfo(cntx, parsed, command)
          this.emit(`command:!`, command)
        }
      }
    }

    if (shouldParse) {
      const parsed = this.mri(argv.slice(2))
      this.setParsedInfo(cntx, parsed)
    }

    if (cntx.options.help && this.showHelpOnExit) {
      this.outputHelp(cntx)
      run = false
      this.unsetMatchedCommand(cntx)
    }

    if (
      cntx.options.version &&
      this.showVersionOnExit &&
      cntx.matchedCommandName == null
    ) {
      this.outputVersion()
      run = false
      this.unsetMatchedCommand(cntx)
    }

    if (run) {
      cntx.result = this.runMatchedCommand(cntx)
    }

    if (!cntx.matchedCommand && cntx.args[0]) {
      this.emit('command:*')
    }

    return cntx
  }

  private mri(
    argv: string[],
    /** Matched command */ command?: Command<T>
  ): ParsedArgv {
    // All added options
    const cliOptions = [
      ...this.globalCommand.options,
      ...(command ? command.options : []),
    ]
    const mriOptions = getMriOptions(cliOptions)

    // Extract everything after `--` since mri doesn't support it
    let argsAfterDoubleDashes: string[] = []
    const doubleDashesIndex = argv.indexOf('--')
    if (doubleDashesIndex > -1) {
      argsAfterDoubleDashes = argv.slice(doubleDashesIndex + 1)
      argv = argv.slice(0, doubleDashesIndex)
    }

    let parsed = mri(argv, mriOptions)
    parsed = Object.keys(parsed).reduce(
      (res, name) => {
        return {
          ...res,
          [camelcaseOptionName(name)]: parsed[name],
        }
      },
      { _: [] }
    )

    const args = parsed._

    const options: { [k: string]: any } = {
      '--': argsAfterDoubleDashes,
    }

    // Set option default value
    const ignoreDefault =
      command && command.config.ignoreOptionDefaultValue
        ? command.config.ignoreOptionDefaultValue
        : this.globalCommand.config.ignoreOptionDefaultValue

    let transforms = Object.create(null)

    for (const cliOption of cliOptions) {
      if (!ignoreDefault && cliOption.config.default !== undefined) {
        for (const name of cliOption.names) {
          options[name] = cliOption.config.default
        }
      }

      // If options type is defined
      if (Array.isArray(cliOption.config.type)) {
        if (transforms[cliOption.name] === undefined) {
          transforms[cliOption.name] = Object.create(null)

          transforms[cliOption.name]['shouldTransform'] = true
          transforms[cliOption.name]['transformFunction'] =
            cliOption.config.type[0]
        }
      }
    }

    // Set option values (support dot-nested property name)
    for (const key of Object.keys(parsed)) {
      if (key !== '_') {
        const keys = key.split('.')
        setDotProp(options, keys, parsed[key])
        setByType(options, transforms)
      }
    }

    return {
      args,
      options,
    }
  }

  runMatchedCommand(cntx: CacCntx<T>) {
    const { args, options, matchedCommand: command } = cntx

    if (!command || !command.commandAction) return

    command.checkUnknownOptions(cntx)

    command.checkOptionValue(cntx)

    command.checkRequiredArgs(cntx)

    const actionArgs: any[] = [cntx.env]
    command.args.forEach((arg, index) => {
      if (arg.variadic) {
        actionArgs.push(args.slice(index))
      } else {
        actionArgs.push(args[index])
      }
    })
    actionArgs.push(options)
    return command.commandAction.apply(this, actionArgs)
  }
}

export default CAC
