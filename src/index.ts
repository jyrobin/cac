import CAC from './CAC'
import Command from './Command'

/**
 * @param name The program name to display in help and version message
 */
function cac<T>(name = '') {
  return new CAC<T>(name)
}

export default cac
export { cac, CAC, Command }
