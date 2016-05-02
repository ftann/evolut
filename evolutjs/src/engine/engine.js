/**
 * Movement engine module.
 *
 * @module engine/engine
 */

import { forEach, nth } from 'ramda';
import { resolveMovementDescriptor } from './movement';

/**
 * Represents an engine.
 * It's responsibility is moving an phenotype's legs.
 * An engine consists of multiple movements.
 * A movement itself may consist of multiple movements.
 */
export default class Engine {

  /**
   * Applies the initial step of an engine.
   * This most often comes down to initialize the movement,
   * angles and velocitities of constraints, and the position of bodies.
   *
   * @param {Phenotype} phenotype Applies the movement of this engine to this phenotype.
   */
  static initialStep(phenotype) {
    forEach(
      (descriptor) => resolveMovementDescriptor(descriptor)(phenotype, 0),
      phenotype.engine.descriptor.initial
    );
  }

  /**
   * Executes a single step of the engine.
   *
   * @param {Phenotype} phenotype Applies the movement of this engine to this phenotype
   * @param {Number} time The current world time
   * @param {Object} [event] The event that caused the step
   * @return {Phenotype}
   */
  static step(phenotype, time, event) { // eslint-disable-line no-unused-vars

    const descriptor = nth(phenotype.engine.current, phenotype.engine.descriptor.movements);
    const movement = resolveMovementDescriptor(descriptor);
    const moved = movement(phenotype, time);

    if (moved) {
      phenotype.engine.current = this.nextState(phenotype);
      // TODO register feedback
    }

    return phenotype;
  }

  /**
   * Returns the index of the next state.
   *
   * @protected
   * @param {Phenotype} phenotype
   * @return {Number} The index of the next state
   */
  static nextState(phenotype) {
    return (phenotype.engine.current + 1) % phenotype.engine.descriptor.movements.length;
  }

}
