/**
 * Defines the main application menu.
 * Runs within the main process.
 * The spawned window run each in a separate render process.
 *
 * @module app/app
 */

import './menu';
import { app, BrowserWindow, ipcMain } from 'electron';
import { debug, error, info } from '../util/logUtil';
import { List, Range } from 'immutable';
import { path as appRoot } from 'app-root-path';
import config from './config';
import { curry } from 'ramda';
import fs from 'graceful-fs';
import { getLogger } from './log.js';
import InitialPopulationGenerator from '../algorithm/population/initialPopulationGenerator';
import { load } from '../util/path';
import ParcourGenerator from '../algorithm/parcour/parcourGenerator';
import Reporter from '../report/reporter';
import TournamentBasedSelectionStrategy from '../algorithm/selection/tournamentBasedSelectionStrategy';
import { Worker } from './ipc';

const logger = getLogger('app', 'main');
const index = 'file://' + appRoot + '/index.html';
const workerCount = config('workers.count');
const populationSize = config('algorithm.populationSize');
const partialPopulationSize = populationSize / workerCount;
const loadPopulationFromFile = config('algorithm.loadPopulationFromFile');
const bodyPointsMin = 4;
const bodyPointsMax = 8;
const kTournamentBasedSelection = 10;
const increaseDifficultyAfter = config('parcour.increaseDifficultyAfter');
const maxSlopeStep = config('parcour.maxSlopeStep');
const highestYStep = config('parcour.highestYStep');
const limitSlope = config('parcour.limitSlope');
// Find common solution with = 1, evolve evolvability with switchParcourAfterGeneration = increaseDifficultyAfter
const switchParcourAfterGeneration = config('algorithm.switchParcourAfterGeneration');
const reporters = Reporter.createReports();

let parcour;
let workers = null;
let finishedWorkCounter = 0;
let finishedMutationWorkCounter = 0;
let generationCounter = 1;
let maxSlope = config('parcour.startMaxSlope');
let highestY = config('parcour.startHighestY');
let individuals = List();
let individualsMutation = List();

/**
 * Creates a new worker in a browser window.
 *
 * @return {BrowserWindow} The browser window where the worker resides
 */
export function startWorker() {
  const worker = new BrowserWindow({
    width: config('window:width'),
    height: config('window:height')
  });
  worker.loadURL(index);
  worker.on('closed', () => app.exit(0));

  return worker;
}

function distributeInitialWork(ipcQueue, initialPopulation, options, worker, index) {
  info(logger, 'starting to distribute inital work...');
  worker.webContents.on('did-finish-load', () => {
    distributeWork(ipcQueue, initialPopulation, options, worker, index);
    info(logger, 'inital work distributed.');
  });
}
/**
 * Distributes work to a worker on a queue.
 *
 * @param {String} ipcQueue
 * @param {Population} population
 * @param {Object} options
 * @param {BrowserWindow} worker
 * @param {Number} index
 */
function distributeWork(ipcQueue, population, options, worker, index) {
  const start = index * partialPopulationSize;
  const end = (index + 1) * partialPopulationSize;
  const partialPopulation = population.individuals.slice(start, end);
  info(logger, 'distribute work.. partial population size: ' + partialPopulation.size);
  const stringified = partialPopulation.toArray().map((x) => JSON.stringify(x));
  worker.webContents.send(ipcQueue, stringified, population.generationCount, options);
}

function performSimulationPostprocessing(population) {
  info(logger, 'starting postprocessing with populationSize: ' + population.individuals.size);
  reporters(population);
  info(logger, 'reporting done');
  const selectionStrategy = new TournamentBasedSelectionStrategy(kTournamentBasedSelection);
  const selected = selectionStrategy.select(population);
  debug(logger, 'selected individuals size: ' + selected.individuals.size);
  info(logger, 'selection done');
  mutate(selected);
  ++generationCounter;
}

/**
 * Mutates a given population.
 *
 * @param {Population} population The population to be mutated
 */
function mutate(population) {
  const distributor = curry(distributeWork)(Worker.MutationReceive, population, { });
  workers.forEach(distributor);
}

function prepareDistributor(distributeWork, population) {
  population.generationCount = generationCounter;
  if (generationCounter % switchParcourAfterGeneration === 0) {
    parcour = ParcourGenerator.generateParcour(maxSlope, highestY);
  }
  const distributor = curry(distributeWork)(
    Worker.Receive, population, { parcour: JSON.stringify(parcour), maxSlope, highestY }
  );
  return distributor;
}

function createInitalPopulation() {
  if (loadPopulationFromFile) {
    const pathToFile = load('population.json');
    const populationStr = fs.readFileSync(pathToFile).toString();
    const initialPopulation = JSON.parse(populationStr);
    const shrinked = List(initialPopulation.individuals)
      .sortBy((individual) => individual.fitness)
      .reverse()
      .take(populationSize);
    generationCounter = initialPopulation.generationCount;
    return { generationCount: initialPopulation.generationCount, individuals: shrinked};
  } else {
    const initialPopulationGenerator = new InitialPopulationGenerator(
      Range(bodyPointsMin, bodyPointsMax + 1), populationSize);
    const initialPopulation = initialPopulationGenerator.generateInitialPopulation();
    return initialPopulation;
  }
}

ipcMain.on(Worker.Finished, (event, individualsStringified, uuid) => {
  finishedWorkCounter++;
  debug(logger, 'received work finished from ' + uuid + '. finishedWorkCounter: ' + finishedWorkCounter);
  const partialPopulation = individualsStringified.map((x) => JSON.parse(x));
  individuals = individuals.concat(partialPopulation);
  if (finishedWorkCounter % workerCount === 0) {
    debug(logger, 'population complete again.');
    const population = { individuals, generationCount: generationCounter};
    performSimulationPostprocessing(population);
  }
});

ipcMain.on(Worker.MutationFinished, (event, individualsStringified, uuid) => {
  finishedMutationWorkCounter++;
  debug(logger,
    'received work finished mutation from ' + uuid + ' finishedMutationWorkCounter: ' + finishedMutationWorkCounter
  );
  const partialPopulation = individualsStringified.map((x) => JSON.parse(x));
  individualsMutation = individualsMutation.concat(partialPopulation);
  if (finishedMutationWorkCounter % workerCount === 0) {

    if (generationCounter % increaseDifficultyAfter === 0) {
      if (maxSlope < limitSlope) {
        maxSlope = maxSlope + maxSlopeStep;
      }
      highestY = highestY + highestYStep;
    }

    const options = { individuals: individualsMutation, generationCount: generationCounter};
    const distributor = prepareDistributor(distributeWork, options);
    workers.forEach(distributor);
    individuals = List(); // reset
    individualsMutation = List(); // reset
  }

});

app.on('window-all-closed', () =>  {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('ready', () => {
  process.on('uncaughtException', (err) => {
    error(logger, 'an exception happened.');
    error(logger, err);
  });
  const workerRange = List(Range(0, workerCount));
  workers = workerRange.map(() => startWorker());
  const initialPopulation = createInitalPopulation();
  const distributor = prepareDistributor(distributeInitialWork, initialPopulation);
  workers.forEach(distributor);
});
