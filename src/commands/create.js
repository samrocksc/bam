const { bamWarn } = require('../util/logger');
const { validateLambdaCreation } = require('../util/validations');
const checkForOptionType = require('../util/checkForOptionType');

const {
  createLocalLambdaFile,
  createLocalLambdaDirectory,
} = require('../util/createLocalLambda');

module.exports = async function create(lambdaName, options) {
  const invalidLambdaMsg = await validateLambdaCreation(lambdaName);
  const createHtmlTemplate = checkForOptionType(options, 'html');
  const createInvokerTemplate = checkForOptionType(options, 'invoke');
  const createDbPutTemplate = checkForOptionType(options, 'dbput');
  const createDbScanTemplate = checkForOptionType(options, 'dbscan');
  const includeComments = checkForOptionType(options, 'verbose');

  if (invalidLambdaMsg) {
    bamWarn(invalidLambdaMsg);
    return;
  }

  if (createHtmlTemplate) {
    await createLocalLambdaDirectory(
      lambdaName,
      createInvokerTemplate,
      createDbScanTemplate,
      includeComments,
    );
  } else {
    await createLocalLambdaFile(
      lambdaName,
      createInvokerTemplate,
      createDbScanTemplate,
      createDbPutTemplate,
      includeComments,
    );
  }
};
