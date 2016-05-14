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
import Mutator from '../algorithm/mutation/mutator';
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
let generationCounter = 1;
let maxSlope = config('parcour.startMaxSlope');
let highestY = config('parcour.startHighestY');
let individuals = List();

function startWorker() {
  const worker = new BrowserWindow({
    width: config('window:width'),
    height: config('window:height')
  });
  worker.loadURL(index);
  worker.on('closed', () => {
    app.exit(0);
  });
  return worker;
}

function distributeInitialWork(initialPopulation, options, worker, index) {
  worker.webContents.on('did-finish-load', () => {
    distributeWork(initialPopulation, options, worker, index);
  });
}

function distributeWork(population, options, worker, index) {
  const start = index * partialPopulationSize;
  const end = (index + 1) * partialPopulationSize;
  const partialPopulation = population.individuals.slice(start, end);
  const stringified = partialPopulation.toArray().map((x) => JSON.stringify(x));
  worker.webContents.send(Worker.Receive, stringified, population.generationCount, options);
}

function performSimulationPostprocessing(population) {
  info(logger, 'starting postprocessing');
  reporters(population);
  info(logger, 'reporting done');
  const selectionStrategy = new TournamentBasedSelectionStrategy(kTournamentBasedSelection);
  const selected = selectionStrategy.select(population);
  debug(logger, 'selected individuals size: ' + selected.individuals.size);
  info(logger, 'selection done');
  const mutator = new Mutator();
  const mutated = mutator.mutate(selected);
  debug(logger, 'mutation done.');
  mutated.generationCount = ++generationCounter;
  return mutated;
}

function prepareDistributor(distributeWork, population) {
  if (generationCounter % switchParcourAfterGeneration === 0) {
    parcour = ParcourGenerator.generateParcour(maxSlope, highestY);
  }
  const distributor = curry(distributeWork)(population, { parcour: JSON.stringify(parcour), maxSlope, highestY });
  return distributor;
}

function createInitalPopulation() {
  if (loadPopulationFromFile) {
    const pathToFile = load('population.json');
    const populationStr = fs.readFileSync(pathToFile).toString();
    const initialPopulation = JSON.parse(populationStr);
    const shrinked =
      List(initialPopulation.individuals).sortBy((individual) => individual.fitness).reverse().take(populationSize);
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
    const mutated = performSimulationPostprocessing(population);
    // reset list
    individuals = List();
    if (generationCounter % increaseDifficultyAfter === 0) {
      if (maxSlope < limitSlope) {
        maxSlope = maxSlope + maxSlopeStep;
      }
      highestY = highestY + highestYStep;
    }
    const distributor = prepareDistributor(distributeWork, mutated);
    workers.forEach(distributor);
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
