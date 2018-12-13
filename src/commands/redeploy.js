const updateLambda = require('../aws/updateLambda');
const deployApi = require('../aws/deployApi');
const { doesApiExist } = require('../aws/doesResourceExist');
const updateHttpMethods = require('../aws/updateHttpMethods');
const bamBam = require('../util/bamBam');
const { asyncGetRegion } = require('../util/getRegion');
const checkForOptionType = require('../util/checkForOptionType');

const {
  asyncCreateDeployment,
  asyncGetResources,
  asyncGetFunction,
} = require('../aws/awsFunctions');

const {
  validateApiMethods,
  validateLambdaReDeployment,
} = require('../util/validations');

const {
  readLambdasLibrary,
  writeLambda,
  writeApi,
  writeApisLibrary,
  readApisLibrary,
  distinctElements,
  deleteStagingDirForLambda,
} = require('../util/fileUtils');

const {
  msgAfterAction,
  bamLog,
  bamWarn,
} = require('../util/logger');

const stageName = 'bam';

module.exports = async function redeploy(resourceName, path, options) {
  let methodPermissionIds = {};
  const region = await asyncGetRegion();
  const api = {
    restApiId: undefined,
    resources: [],
    addMethods: [],
    removeMethods: [],
    existingMethods: [],
  };

  const getApiId = async () => {
    const apis = await readApisLibrary(path);
    return apis[region] && apis[region][resourceName] && apis[region][resourceName].restApiId;
  };

  const getApiResources = async () => {
    const { restApiId } = api;
    const apiExistsOnAws = await doesApiExist(api.restApiId);
    if (restApiId && apiExistsOnAws) {
      api.resources = (await asyncGetResources({ restApiId })).items;
    }
  };

  const resolveHttpMethodsFromOptions = () => {
    let addMethods = options.methods || options.method;
    let removeMethods = options.rmMethods || options.rmMethod;
    let existingMethods = [];

    addMethods = addMethods
      ? distinctElements(addMethods.map(m => m.toUpperCase())) : [];

    removeMethods = removeMethods
      ? distinctElements(removeMethods.map(m => m.toUpperCase())) : [];

    if (api.resources.length > 0) {
      const resource = api.resources.find(res => res.path === '/');
      existingMethods = Object.keys(resource.resourceMethods || {});
    }

    if (existingMethods.length === 0 && addMethods.length === 0) {
      addMethods.push('GET');
    }

    api.addMethods = addMethods;
    api.removeMethods = removeMethods;
    api.existingMethods = existingMethods;
  };

  const deployIntegrations = async () => {
    const rootResource = api.resources.find(res => res.path === '/');
    const greedyResource = api.resources.find(res => res.path === '/{proxy+}');
    const updateParams = {
      rootResource,
      greedyResource,
      resourceName,
      path,
      restApiId: api.restApiId,
      addMethods: api.addMethods,
      removeMethods: api.removeMethods,
    };

    methodPermissionIds = await updateHttpMethods(updateParams);

    await bamBam(asyncCreateDeployment, {
      asyncFuncParams: [{ restApiId: api.restApiId, stageName }],
      retryError: 'TooManyRequestsException',
    });
  };

  const updateApiGateway = async () => {
    const apiExistsInLocalLibrary = !!(api.restApiId);
    const apiExistsOnAws = await doesApiExist(api.restApiId);
    const userIsAddingMethods = !!(options.methods || options.method);
    const userIsAddingEndpoint = checkForOptionType(options, 'endpoint');
    let data;

    if ((apiExistsInLocalLibrary || userIsAddingMethods || userIsAddingEndpoint) && !apiExistsOnAws) {
      data = await deployApi(resourceName, path, api.addMethods, stageName);
    } else if (userIsAddingMethods || api.removeMethods.length > 0) {
      await deployIntegrations(api.resources, api.existingMethods);
    }

    return data;
  };

  const updateLocalLibraries = async (updatedApiData) => {
    const apiExistsOnAws = await doesApiExist(api.restApiId);

    if (updatedApiData) {
      const { restApiId, endpoint } = updatedApiData;

      await writeApi(endpoint, methodPermissionIds, api.addMethods, resourceName, restApiId, path);
    } else if (apiExistsOnAws) {
      const apis = await readApisLibrary(path);
      const regionalApis = apis[region];
      const regionalApi = regionalApis[resourceName];
      const existingApis = regionalApi.methodPermissionIds;
      regionalApi.methodPermissionIds = Object.assign({}, existingApis, methodPermissionIds);
      api.removeMethods.forEach(method => delete regionalApi.methodPermissionIds[method]);
      await writeApisLibrary(path, apis);
    }
  };

  // redployment sequence starts here:
  const invalidLambdaMsg = await validateLambdaReDeployment(resourceName);
  if (invalidLambdaMsg) {
    bamWarn(invalidLambdaMsg);
    return;
  }

  api.restApiId = await getApiId();
  const resources = await getApiResources();
  if (resources) api.resources = resources;

  resolveHttpMethodsFromOptions();

  const validateMethodsParams = {
    addMethods: api.addMethods,
    removeMethods: api.removeMethods,
    existingMethods: api.existingMethods,
    resourceName,
    path,
  };

  const invalidHttp = await validateApiMethods(validateMethodsParams);
  if (invalidHttp) {
    bamWarn(invalidHttp);
    return;
  }

  const localLambda = (await readLambdasLibrary(path))[region][resourceName];
  if (!localLambda) {
    const lambdaData = (await asyncGetFunction({ FunctionName: resourceName })).Configuration;
    writeLambda(lambdaData, path, lambdaData.Description);
  }

  const lambdaUpdateSuccess = await updateLambda(resourceName, path, options);

  if (lambdaUpdateSuccess) {
    const apiData = await updateApiGateway();
    await updateLocalLibraries(apiData);
    await deleteStagingDirForLambda(resourceName, path);
    bamLog(msgAfterAction('lambda', resourceName, 'updated'));
  } else {
    bamWarn(msgAfterAction('lambda', resourceName, 'updated', 'could not be'));
  }
};
