'use strict';

/**
 * Only call logger.debug() if the logger has debug enabled.
 * This should ensure that the built in check in logger.debug() is not invoked
 * because this leads to a huge performance hit.
 *
 * @param {Log4js.Logger} logger logger
 * @param {String} message Debug message
 */
export function debug(logger, message) {
  if (logger && logger.isDebugEnabled()) {
    logger.debug(message);
  }
}

/**
 * Only call logger.info() if the logger has info enabled.
 * This should ensure that the built in check in logger.info() is not invoked
 * because this leads to a huge performance hit.
 *
 * @param {Log4js.Logger} logger logger
 * @param {String} message Info message
 */
export function info(logger, message) {
  if (logger && logger.isInfoEnabled()) {
    logger.info(message);
  }
}
