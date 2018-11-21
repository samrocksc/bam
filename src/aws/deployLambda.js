const AWS = require('aws-sdk');
const { promisify } = require('util');
const { createDirectory } = require('../util/fileUtils');
const zipper = require('../util/zipper.js');
const installLambdaDependencies = require('../util/installLambdaDependencies.js');
const bamBam = require('../util/bamBam.js');

const {
  bamLog,
  bamWarn,
  bamSpinner,
  spinnerCleanup,
} = require('../util/fancyText.js');

const {
  readFuncLibrary,
  writeFuncLibrary,
  readConfig,
  copyFile,
  readFile,
} = require('../util/fileUtils');

const apiVersion = 'latest';

module.exports = async function deployLambda(lambdaName, description, path) {
  const config = await readConfig(path);
  const { accountNumber, region, role } = config;
  const lambda = new AWS.Lambda({ apiVersion, region });
  const asyncLambdaCreateFunction = promisify(lambda.createFunction.bind(lambda));

  const createDeploymentPackage = async () => {
    const cwd = process.cwd();
    await createDirectory(lambdaName, `${path}/.bam/functions`);
    await copyFile(`${cwd}/${lambdaName}.js`, `${path}/.bam/functions/${lambdaName}/index.js`);
  };

  const spinnerInterval = bamSpinner();
  await createDeploymentPackage();
  await installLambdaDependencies(lambdaName, path);
  const zippedFileName = await zipper(lambdaName, path);
  const zipContents = await readFile(zippedFileName);

  const createAwsLambda = async () => {
    const params = {
      Code: {
        ZipFile: zipContents,
      },
      FunctionName: lambdaName,
      Handler: 'index.handler',
      Role: `arn:aws:iam::${accountNumber}:role/${role}`,
      Runtime: 'nodejs8.10',
      Description: description,
    };

    const data = await bamBam(asyncLambdaCreateFunction, params);
    return data;
  };

  const writeToLib = async (data) => {
    const name = data.FunctionName;
    const arn = data.FunctionArn;

    const functions = await readFuncLibrary(path);
    functions[name] = { arn, description };
    await writeFuncLibrary(path, functions);
  };

  const data = await createAwsLambda();

  if (data) {
    await writeToLib(data);
    clearInterval(spinnerInterval);
    spinnerCleanup();
    bamLog(`Lambda "${lambdaName}" has been created`);
  } else {
    clearInterval(spinnerInterval);
    spinnerCleanup();
    bamWarn(`Lambda "${lambdaName}" already exists`);
  }
};
