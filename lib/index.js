/**
 * dsh-code-block-quote — Host half.
 *
 * Deliberately empty. Everything this plugin does happens in the browser: it
 * seats a button in a rendered code block and hands the block's text to the
 * composer's own insert-reference path. No host service is needed, no route is
 * registered, no file is read, and no request leaves the machine.
 *
 * The export exists because a profile bundle entry needs a loadable module; an
 * `apply` that does nothing is the whole contract.
 */

export const name = 'dsh-code-block-quote'

/**
 * No-op mount.
 * @param _ctx - owning Cordis context; nothing is registered on it.
 */
export function apply(_ctx) {}
