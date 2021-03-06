/**
 * Lenses for accessing constraints.
 *
 * @module engine/lenses
 */

import * as L from 'partial.lenses';
import { lens, values } from 'ramda';
import random from '../util/random';

/**
 * Describes a lens.
 *
 * @typedef {Object} LensDescriptor
 * @property {Number} index
 * @property {String} side
 * @property {String} type
 */

/**
 * Available sides.
 *
 * @enum {String}
 */
export const Sides = {
  Left: 'left',
  Right: 'right'
};

/**
 * Available sides.
 *
 * @enum {String}
 */
export const Types = {
  Hip: 'hip',
  Knee: 'knee'
};

/**
 * Lens for immutable-js data types.
 *
 * @function
 * @param {String} key
 * @return {Lens}
 */
export const immutableLens = (key) => lens((x) => x.get(key), (val, x) => x.set(key, val));

/**
 * Create a lens desriptor object.
 *
 * @param {String} side The side, left or right
 * @param {Number} index The leg index
 * @param {String} type The type, hip or joint
 * @return {LensDescriptor} The lens descriptor
 */
export function makeLensDescriptor(side, index, type) {
  return { side, index, type };
}

/**
 * Returns a random lens descriptor.
 *
 * @return {LensDescriptor} A random lens descriptor
 */
export function makeRandomLensDescriptor() {

  const legs = 6;

  const side = random.pick(values(Sides));
  const type = random.pick(values(Types));
  const leg = random.integer(0, legs / 2 - 1);

  return makeLensDescriptor(side, leg, type);
}

/**
 * Resolve a lens descriptor and return the lens.
 *
 * @param {LensDescriptor} descriptor
 * @return {Lens} The lens
 */
export function resolveLensDescriptor({ side, index, type }) {
  return L.compose(
    L.prop('jointsMap'),
    immutableLens(side),
    immutableLens(index),
    L.prop(type)
  );
}
