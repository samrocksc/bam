const { promisify } = require('util');
const fs = require('fs');
const https = require('https');
const AWS = require('aws-sdk');

const createDirectory = require('../src/util/createDirectory');
const configTemplate = require('../templates/configTemplate');
const createRole = require('../src/aws/createRole');
const createJSONFile = require('../src/util/createJSONFile');

const createLambda = require('../src/aws/createLambda.js');
const deployLambda = require('../src/aws/deployLambda.js');
const deployApi = require('../src/aws/deployApi.js');

const deleteLambda = require('../src/aws/deleteLambda');
const { doesApiExist } = require('../src/aws/doesResourceExist');
const deleteApi = require('../src/aws/deleteApi');
const delay = require('../src/util/delay.js');

const iam = new AWS.IAM();
const roleName = 'testDefaultBamRole';
const lambdaName = 'testBamLambda1';
const stageName = 'test';
const testPolicyARN = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
const config = configTemplate(roleName);
config.accountNumber = process.env.AWS_ID;

const asyncDetachPolicy = promisify(iam.detachRolePolicy.bind(iam));
const asyncDeleteRole = promisify(iam.deleteRole.bind(iam));

describe('bam deploy api', () => {
  beforeEach(async () => {
    jest.setTimeout(60000);
    createDirectory('bam', './test');
    createDirectory('functions', './test/bam/');
    createJSONFile('config', './test/bam', config);
    createJSONFile('library', './test/bam/functions', {});
    await createRole(roleName, './test');
    createLambda(lambdaName, './test');
  });

  afterEach(async () => {
    const library = JSON.parse(fs.readFileSync('./test/bam/functions/library.json'));
    const { restApiId } = library[lambdaName].api;
    await deleteApi(restApiId, './test');
    await deleteLambda(lambdaName, './test');
    fs.unlinkSync('./test/bam/functions/library.json');
    fs.rmdirSync('./test/bam/functions');
    fs.unlinkSync('./test/bam/config.json');
    fs.rmdirSync('./test/bam');
    await asyncDetachPolicy({ PolicyArn: testPolicyARN, RoleName: roleName });
    await asyncDeleteRole({ RoleName: roleName });
    await delay(30000);
  });

  test('Response is 200 when hitting endpoint from library.json', async () => {
    await deployLambda(lambdaName, 'test description', './test');
    await deployApi(lambdaName, './test', stageName);

    const library = JSON.parse(fs.readFileSync('./test/bam/functions/library.json'));
    const url = library[lambdaName].api.endpoint;
    let responseStatus;

    const asyncHttpsGet = endpoint => (
      new Promise((resolve) => {
        https.get(endpoint, resolve);
      })
    );

    try {
      const response = await asyncHttpsGet(url);
      responseStatus = response.statusCode;
    } catch (err) {
      console.log(err, err.stack);
    }

    expect(responseStatus).toEqual(200);
  });

  test('Api metadata exists within ./test/bam/functions/library.json', async () => {
    await deployLambda(lambdaName, 'test description', './test');
    await deployApi(lambdaName, './test', stageName);

    const library = JSON.parse(fs.readFileSync('./test/bam/functions/library.json'));
    const { api } = library[lambdaName];
    expect(api).toBeTruthy();
  });

  test('Api endpoint exists on AWS', async () => {
    await deployLambda(lambdaName, 'test description', './test');
    await deployApi(lambdaName, './test', stageName);

    const library = JSON.parse(fs.readFileSync('./test/bam/functions/library.json'));
    const { restApiId } = library[lambdaName].api;
    const apiExists = await doesApiExist(restApiId);
    expect(apiExists).toBe(true);
  });

  test('Response contains query param in body', async () => {
    const testLambdaWithQueryParams = fs.readFileSync('./test/templates/testLambdaWithQueryParams.js');
    fs.writeFileSync(`./test/bam/functions/${lambdaName}/index.js`, testLambdaWithQueryParams);
    await deployLambda(lambdaName, 'test description', './test');
    await deployApi(lambdaName, './test', stageName);

    const library = JSON.parse(fs.readFileSync('./test/bam/functions/library.json'));
    const url = `${library[lambdaName].api.endpoint}?name=John`;
    let responseBody;

    const asyncHttpsGet = endpoint => (
      new Promise((resolve) => {
        https.get(endpoint, resolve);
      })
    );

    try {
      const response = await asyncHttpsGet(url);
      response.setEncoding('utf8');
      response.on('data', (data) => {
        console.log(data);
        responseBody = data;
        expect(responseBody).toMatch('John');
      });
    } catch (err) {
      console.log(err, err.stack);
    }
  });

  describe('lambda with dependencies', () => {
    beforeEach(async () => {
      const testLambdaWithDependencies = fs.readFileSync('./test/templates/testLambdaWithDependencies.js');
      fs.writeFileSync(`./test/bam/functions/${lambdaName}/index.js`, testLambdaWithDependencies);
      await deployLambda(lambdaName, 'test description', './test');
      await deployApi(lambdaName, './test', stageName);
    });

    test('Response contains output from dependencies in body', async () => {
      const library = JSON.parse(fs.readFileSync('./test/bam/functions/library.json'));
      const url = library[lambdaName].api.endpoint;
      let responseBody;

      const asyncHttpsGet = endpoint => (
        new Promise((resolve) => {
          https.get(endpoint, resolve);
        })
      );

      try {
        const response = await asyncHttpsGet(url);
        response.setEncoding('utf8');
        response.on('data', (data) => {
          responseBody = data;
          expect(responseBody).toMatch('uuid');
          expect(responseBody).toMatch('2016-12');
          expect(responseBody).toMatch('cool');
        });
      } catch (err) {
        console.log(err, err.stack);
      }
    });

    test('package.json file is created', async () => {
      const packageJSONExists = fs.existsSync(`./test/bam/functions/${lambdaName}/package.json`);
      const packageLockJSONExists = fs.existsSync(`./test/bam/functions/${lambdaName}/package-lock.json`);
      expect(packageJSONExists).toBe(true);
      expect(packageLockJSONExists).toBe(true);
    });

    test('node modules directory is created', async () => {
      const nodeModulesDirExists = fs.existsSync(`./test/bam/functions/${lambdaName}/node_modules`);
      expect(nodeModulesDirExists).toBe(true);
    });

    test('node modules directory contains dependencies', async () => {
      const uuid = fs.existsSync(`./test/bam/functions/${lambdaName}/node_modules/uuid`);
      const moment = fs.existsSync(`./test/bam/functions/${lambdaName}/node_modules/moment`);
      expect(uuid).toBe(true);
      expect(moment).toBe(true);
    });

    test('node modules directory does not contain native node modules', async () => {
      const util = fs.existsSync(`./test/bam/functions/${lambdaName}/node_modules/util`);
      expect(util).toBe(false);
    });
  });

  describe('lambda with dependencies after exports.handler', () => {
    beforeEach(async () => {
      const testLambdaWithIncorrectDependencies = fs.readFileSync('./test/templates/testLambdaWithIncorrectDependencies.js');
      fs.writeFileSync(`./test/bam/functions/${lambdaName}/index.js`, testLambdaWithIncorrectDependencies);
      await deployLambda(lambdaName, 'test description', './test');
      await deployApi(lambdaName, './test', stageName);
    });

    test('node modules directory does not contain modules listed after exports.handler', async () => {
      const moment = fs.existsSync(`./test/bam/functions/${lambdaName}/node_modules/moment`);
      expect(moment).toBe(false);
    });
  });
});
